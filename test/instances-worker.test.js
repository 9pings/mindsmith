'use strict';
/**
 * R2c — WORKER PLACEMENT (owner 07-18, mandatory): one hot instance = one worker_thread, so the
 * llm/mcp server process is NEVER saturated by an instance's stabilizations.
 *
 * `placement:'worker'` is a STORE option; descriptors are given BY PATH (they are code — the
 * worker requires them itself). Everything above (runtime lifecycle, packs, uris) is unchanged.
 *
 * THE decisive pair: a sync CPU-burn action delays a main-thread timer when run in-process
 * (the saturation the owner refuses) and does NOT delay it when run in a worker.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStore } = require('../lib/instances/store.js');
const { createRuntime } = require('../lib/instances/runtime.js');

const NOTEPAD_PATH = require.resolve('skynet-graph/plugins/notepad/descriptor.js');
const BURNPAD_PATH = path.join(__dirname, 'fixtures', 'burnpad-descriptor.js');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sgp-wk-'));
const CLOCK = () => 1750000000000;

function mkWorkerStore( dir, descriptors ) {
	return createStore({ dir, placement: 'worker', clock: CLOCK, descriptors: descriptors || { notepad: NOTEPAD_PATH } });
}

test('worker placement: the GO scenario runs in a worker and the pack is BYTE-IDENTICAL to in-process', async () => {
	const d1 = tmp(), d2 = tmp();
	async function scenario( store ) {
		const { id } = await store.create('notepad', { seed: { title: 'wk' }, agent: 'A' });
		await store.act(id, 'note', { text: 'one' }, { agent: 'A' });
		await store.act(id, 'note', { text: 'two' }, { agent: 'B' });
		const r = await store.act(id, 'recall', {}, { agent: 'A' });
		assert.deepEqual(r.notes.map(( n ) => n.by), ['A', 'B']);
		await store.close();
		return id;
	}
	const idW = await scenario(mkWorkerStore(d1));
	const idI = await scenario(createStore({ dir: d2, clock: CLOCK, descriptors: { notepad: require(NOTEPAD_PATH) } }));
	assert.deepEqual(fs.readFileSync(path.join(d1, idW + '.sgp')), fs.readFileSync(path.join(d2, idI + '.sgp')),
		'same ops → byte-identical pack, worker or not (placement is invisible to the artifact)');
});

test('SATURATION PROOF: a sync CPU-burn act delays the main loop in-process and does NOT in a worker', async () => {
	async function mainLoopDelayDuring( store, id ) {
		const p = store.act(id, 'burn', { ms: 250 }, { agent: 'A' });
		const t0 = Date.now();
		await new Promise(( r ) => setTimeout(r, 25));                    // a 25 ms main-thread timer
		const delay = Date.now() - t0;
		await p;
		return delay;
	}
	const sI = createStore({ dir: tmp(), clock: CLOCK, descriptors: { burnpad: require(BURNPAD_PATH) } });
	const { id: i1 } = await sI.create('burnpad', { seed: {}, agent: 'A' });
	const inprocDelay = await mainLoopDelayDuring(sI, i1);
	await sI.close();

	const sW = mkWorkerStore(tmp(), { burnpad: BURNPAD_PATH });
	const { id: i2 } = await sW.create('burnpad', { seed: {}, agent: 'A' });
	const workerDelay = await mainLoopDelayDuring(sW, i2);
	await sW.close();

	assert.ok(inprocDelay >= 200, 'CONTROL: in-process, the burn blocks the main loop (timer delayed ' + inprocDelay + ' ms)');
	assert.ok(workerDelay < 100, 'WORKER: the main loop stays live during the burn (timer fired after ' + workerDelay + ' ms)');
});

test('isolation: two instances = two distinct worker threads', async () => {
	const store = mkWorkerStore(tmp());
	const { id: a } = await store.create('notepad', { seed: {}, agent: 'A' });
	const { id: b } = await store.create('notepad', { seed: {}, agent: 'A' });
	await store.act(a, 'note', { text: 'x' }, { agent: 'A' });
	await store.act(b, 'note', { text: 'y' }, { agent: 'A' });
	const ta = (await store.open(a)).worker.threadId, tb = (await store.open(b)).worker.threadId;
	assert.ok(ta && tb && ta !== tb, 'distinct threads (' + ta + ' vs ' + tb + ')');
	await store.close();
});

test('crash recovery: a killed worker respawns from the last persisted pack on the next act', async () => {
	const store = mkWorkerStore(tmp());
	const { id } = await store.create('notepad', { seed: {}, agent: 'A' });
	await store.act(id, 'note', { text: 'survives the crash' }, { agent: 'A' });   // on-write policy → persisted
	const h = await store.open(id);
	const t1 = h.worker.threadId;
	await h.worker.terminate();                                          // the crash, behind the store's back
	const r = await store.act(id, 'recall', {}, { agent: 'A' });         // self-healing: respawn from pack
	assert.deepEqual(r.notes.map(( n ) => n.text), ['survives the crash']);
	assert.notEqual((await store.open(id)).worker.threadId, t1, 'a NEW worker took over');
	await store.close();
});

test('runtime over worker placement: eviction terminates the worker, the next act respawns it', async () => {
	let now = 1750000000000;
	const rt = createRuntime({ dir: tmp(), placement: 'worker', idleTTL: 60000, clock: () => now, descriptors: { notepad: NOTEPAD_PATH } });
	const { id } = await rt.create('notepad', { seed: {}, agent: 'A' });
	await rt.act(id, 'note', { text: 'kept' }, { agent: 'A' });
	await rt.sync(id);
	assert.equal(rt.stats().hot, 1);
	now += 61000;
	await rt.sweep();
	assert.equal(rt.stats().hot, 0, 'evicted (worker terminated)');
	const r = await rt.act(id, 'recall', {}, { agent: 'A' });
	assert.equal(r.notes[0].text, 'kept', 'respawned with state intact');
	await rt.close();
});
