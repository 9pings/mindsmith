'use strict';
/**
 * R2b — the RESIDENCY layer (lib/instances/runtime.js): the serious lifecycle the owner asked for.
 *
 * Agents work in parallel; an instance is created, worked on, PERSISTED WHEN IT SETTLES (if the
 * client wants), UNLOADED after an idle timeout, then transparently REHYDRATED from its .sgp the
 * moment an agent needs it again. The runtime owns residency (cold → warming → hot → draining);
 * the store stays the persistence/boot layer under it.
 *
 * The correctness point (not just perf): under CONCURRENT acts, persisting per-write can serialize
 * a mid-stabilization state. In managed mode nothing persists off an act — an instance is marked
 * dirty on its own `stabilize` event (the engine's quiescent point) and written on sync/flush/
 * evict/close only. Tests inject the clock and drive the sweeper by hand — deterministic, 0 timers.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRuntime } = require('../lib/instances/runtime.js');
const notepad = require('skynet-graph/plugins/notepad/descriptor.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sgp-rt-'));
function mk( dir, opts ) {
	let now = 1750000000000;
	const rt = createRuntime({
		dir, descriptors: { notepad }, clock: () => now, idleTTL: 60000, ...(opts || {})
	});
	rt._tick = ( ms ) => { now += ms; };
	return rt;
}
const packWrites = ( dir, id ) => fs.existsSync(path.join(dir, id + '.sgp')) ? 1 : 0;

test('managed persistence: acts do NOT hit the disk; sync/evict/close DO — and only settled state is written', async () => {
	const dir = tmp();
	const rt = mk(dir);
	const { id } = await rt.create('notepad', { seed: { title: 'lifecycle' }, agent: 'A' });
	assert.equal(packWrites(dir, id), 1, 'create persists once (the instance must survive a crash)');
	const size0 = fs.statSync(path.join(dir, id + '.sgp')).size;

	await rt.act(id, 'note', { text: 'one' }, { agent: 'A' });
	await rt.act(id, 'note', { text: 'two' }, { agent: 'B' });
	assert.equal(fs.statSync(path.join(dir, id + '.sgp')).size, size0, 'a burst of acts writes NOTHING (managed mode)');
	assert.equal(rt.stats().dirty, 1, 'the instance is marked dirty on its own stabilize');

	await rt.sync(id);                                                   // the client/LLM asked → persist now
	assert.ok(fs.statSync(path.join(dir, id + '.sgp')).size > size0, 'sync wrote the settled state');
	assert.equal(rt.stats().dirty, 0);
	assert.equal(rt.stats().persists, 2, 'create + sync — nothing in between');
	await rt.close();
});

test('idle eviction + transparent rehydration: unload after TTL, remount on the next act, state intact', async () => {
	const dir = tmp();
	const rt = mk(dir);
	const { id } = await rt.create('notepad', { seed: { title: 'evict-me' }, agent: 'A' });
	await rt.act(id, 'note', { text: 'kept across residency' }, { agent: 'A' });
	assert.equal(rt.stats().hot, 1);

	rt._tick(61000);                                                     // idle past the TTL
	rt.sweep();
	assert.equal(rt.stats().hot, 0, 'idle instance UNLOADED (drained: dirty state persisted first)');
	assert.equal(rt.stats().evictions, 1);

	const r = await rt.act(id, 'recall', {}, { agent: 'B' });            // an agent suddenly needs it again
	assert.deepEqual(r.notes.map(( n ) => [n.text, n.by]), [['kept across residency', 'A']], 'rehydrated with the dirty write INCLUDED');
	assert.equal(rt.stats().rehydrations, 1);
	assert.equal(rt.stats().hot, 1, 'resident again');
	await rt.close();
});

test('an in-flight act pins the instance: the sweeper never evicts under a working agent', async () => {
	// a SLOW async write action (the descriptor contract allows async apply) — the agent is "working"
	const slow = {
		...notepad,
		actions: { ...notepad.actions, slowNote: { write: true, input: {}, apply: async ( g ) => {
			await new Promise(( r ) => setTimeout(r, 40));
			return notepad.actions.note.apply(g, { text: 'slow' });
		} } }
	};
	const rt = mk(tmp(), { descriptors: { notepad: slow } });
	const { id } = await rt.create('notepad', { seed: {}, agent: 'A' });
	const p = rt.act(id, 'slowNote', {}, { agent: 'A' });                // launch…
	await new Promise(( r ) => setTimeout(r, 10));                       // …let it get in flight (refcount held)
	rt._tick(120000);                                                    // way past the TTL
	rt.sweep();
	assert.equal(rt.stats().hot, 1, 'pinned by the in-flight act — never evicted under an agent');
	assert.equal(rt.stats().evictions, 0);
	await p;
	const r = await rt.act(id, 'recall', {}, { agent: 'A' });
	assert.equal(r.notes.length, 1, 'the write landed');
	rt._tick(120000);
	rt.sweep();
	assert.equal(rt.stats().hot, 0, 'once the agent is done, the same TTL evicts normally');
	await rt.close();
});

test('warming is deduplicated: N parallel agents hitting a COLD instance boot it exactly once', async () => {
	const dir = tmp();
	const rt = mk(dir);
	const { id } = await rt.create('notepad', { seed: {}, agent: 'A' });
	await rt.act(id, 'note', { text: 'x' }, { agent: 'A' });
	await rt.close();                                                     // cold, persisted

	const rt2 = mk(dir);
	const [r1, r2, r3] = await Promise.all([
		rt2.act(id, 'recall', {}, { agent: 'A' }),
		rt2.act(id, 'recall', {}, { agent: 'B' }),
		rt2.act(id, 'recall', {}, { agent: 'C' })
	]);
	assert.equal(rt2.stats().rehydrations, 1, 'ONE boot for three parallel agents (warming promise shared)');
	assert.deepEqual([r1.notes.length, r2.notes.length, r3.notes.length], [1, 1, 1]);
	await rt2.close();
});

test('close() drains everything: dirty state persisted, all graphs destroyed, dir reload-clean', async () => {
	const dir = tmp();
	const rt = mk(dir);
	const { id } = await rt.create('notepad', { seed: {}, agent: 'A' });
	await rt.act(id, 'note', { text: 'must survive close' }, { agent: 'A' });
	await rt.close();
	assert.equal(rt.stats().hot, 0);

	const rt2 = mk(dir);
	const r = await rt2.act(id, 'recall', {}, { agent: 'A' });
	assert.equal(r.notes[0].text, 'must survive close', 'nothing lost at shutdown');
	await rt2.close();
});
