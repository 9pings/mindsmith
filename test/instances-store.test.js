'use strict';
/**
 * R2 — the instance store (lib/instances/store.js): mindsmith OWNS the service; the engine gives
 * primitives, the descriptors give the typed actions, the `.sgp` pack gives persistence.
 *
 * GO bar (roadmap R2): create → note[A] → note[B] → recall(by) → fork → note → merge → recall,
 * deterministic (two fresh runs → byte-identical packs).
 * Negatives: version-mismatch fail-closed BEFORE new Graph · corrupted pack fail-closed (manifest
 * still listable) · delete = tombstone (never a silent loss) · unknown type refused.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStore } = require('../lib/instances/store.js');
const { packEntries, readEntry, listEntries } = require('../lib/instances/zip.js');
const notepad = require('skynet-graph/plugins/notepad/descriptor.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sgp-store-'));
const CLOCK = () => 1750000000000;                    // injected: persisted timestamps are deterministic
const mk = ( dir ) => createStore({ dir, descriptors: { notepad }, clock: CLOCK });

/** The GO scenario, reused by the determinism bar. Returns {store, dir, padId, childId}. */
async function goScenario( dir ) {
	const store = mk(dir);
	const { id } = await store.create('notepad', { seed: { title: 'debate log' }, agent: 'agentA' });
	assert.equal(id, 'notepad-1');
	await store.act(id, 'note', { text: 'sweet+salty works' }, { agent: 'agentA' });
	await store.act(id, 'note', { text: 'texture is the issue' }, { agent: 'agentB' });
	const r1 = await store.act(id, 'recall', {}, { agent: 'agentA' });
	assert.deepEqual(r1.notes.map(( n ) => n.by), ['agentA', 'agentB'], 'both notes carry their writer');

	const { id: childId } = await store.fork(id, { agent: 'agentC' });
	assert.equal(childId, 'notepad-2');
	await store.act(childId, 'note', { text: 'cheese anchors the salt' }, { agent: 'agentC' });
	// merge policy (type-aware policies are a later rung — here the TEST declares the projection):
	// append the child's post-fork notes into the parent, preserving their original authors.
	await store.merge(childId, {
		project: ( g ) => notepad.actions.recall.project(g).notes.filter(( n ) => n.seq > 2 )
			.map(( n ) => ({ $$_id: 'note-' + n.seq, NoteEntry: true, seq: n.seq, text: n.text, by: n.by }))
	}, { agent: 'agentA' });
	const r2 = await store.act(id, 'recall', {}, { agent: 'agentA' });
	assert.equal(r2.notes.length, 3, 'the merged note landed');
	assert.deepEqual(r2.notes.map(( n ) => n.by), ['agentA', 'agentB', 'agentC'], 'merge PRESERVES the original author');
	return { store, id, childId };
}

test('GO: create → note[A] → note[B] → recall(by) → fork → note → merge → recall', async () => {
	const dir = tmp();
	const { store, id, childId } = await goScenario(dir);
	assert.ok(fs.existsSync(path.join(dir, id + '.sgp')), 'the instance persists as a .sgp pack');
	const zip = fs.readFileSync(path.join(dir, id + '.sgp'));
	assert.deepEqual(listEntries(zip).slice(0, 2), ['manifest.json', 'graph.json'], 'metas SEPARATE from the graph in the pack');
	const man = JSON.parse(readEntry(zip, 'manifest.json'));
	assert.equal(man.type, 'notepad');
	assert.equal(man.typeVersion, '1.0.0');
	assert.equal(man.by, 'agentA', 'the creator is attributed');
	const childMan = JSON.parse(readEntry(fs.readFileSync(path.join(dir, childId + '.sgp')), 'manifest.json'));
	assert.equal(childMan.parent, id, 'the fork is parented');
	assert.ok(childMan.deleted && childMan.mergedInto === id, 'a merged child is tombstoned, never silently gone');
	store.close();
});

test('persistence round-trip: a FRESH store on the same dir lists (manifest-only) and reopens the instance', async () => {
	const dir = tmp();
	(await goScenario(dir)).store.close();
	const store2 = mk(dir);
	const rows = store2.search();
	assert.equal(rows.length, 1, 'the merged child is tombstone-hidden by default');
	assert.deepEqual({ id: rows[0].id, type: rows[0].type, title: rows[0].title }, { id: 'notepad-1', type: 'notepad', title: 'debate log' });
	assert.equal(store2.search({ includeDeleted: true }).length, 2, 'the tombstone is still there when asked');
	const r = await store2.act('notepad-1', 'recall', {}, { agent: 'agentA' });
	assert.equal(r.notes.length, 3, 'the full pad survived the .sgp round-trip');
	store2.close();
});

test('NEGATIVE version gate: an incompatible typeVersion is refused BEFORE any graph boot; unknown type refused', async () => {
	const dir = tmp();
	(await goScenario(dir)).store.close();
	const f = path.join(dir, 'notepad-1.sgp');
	const zip = fs.readFileSync(f);
	const man = JSON.parse(readEntry(zip, 'manifest.json'));
	fs.writeFileSync(f, packEntries([
		{ name: 'manifest.json', data: JSON.stringify({ ...man, typeVersion: '999.0.0' }) },
		{ name: 'graph.json', data: readEntry(zip, 'graph.json') }
	]));
	const store = mk(dir);
	await assert.rejects(() => store.act('notepad-1', 'recall', {}, { agent: 'a' }), /typeVersion 999\.0\.0.*1\.0\.0/s);
	// unknown type: same pack relabeled
	fs.writeFileSync(f, packEntries([
		{ name: 'manifest.json', data: JSON.stringify({ ...man, type: 'ghost' }) },
		{ name: 'graph.json', data: readEntry(zip, 'graph.json') }
	]));
	await assert.rejects(() => mk(dir).open('notepad-1'), /unknown type "ghost".*notepad/s, 'the refusal NAMES the known types');
});

test('NEGATIVE corruption: a stomped graph entry fails CLOSED on open — but search (manifest-only) still lists it', async () => {
	const dir = tmp();
	(await goScenario(dir)).store.close();
	const f = path.join(dir, 'notepad-1.sgp');
	const zip = fs.readFileSync(f);
	const at = zip.indexOf(Buffer.from('graph.json')) + 'graph.json'.length;
	for ( let i = 12; i < 40; i++ ) zip[at + i] ^= 0xff;
	fs.writeFileSync(f, zip);
	const store = mk(dir);
	assert.equal(store.search()[0].id, 'notepad-1', 'listing never inflates the graph — the corrupt blob does not hide the instance');
	await assert.rejects(() => store.open('notepad-1'), /corrupt|crc|inflate/i, 'opening fails CLOSED, typed');
	store.close();
});

test('delete = tombstone; export/import mints a NEW id and preserves the facts', async () => {
	const dir = tmp();
	const { store, id } = await goScenario(dir);
	await store.delete(id, { agent: 'agentA' });
	assert.equal(store.search().length, 0, 'tombstoned instances are hidden');
	assert.ok(fs.existsSync(path.join(dir, id + '.sgp')), 'the pack is NEVER erased');
	await assert.rejects(() => store.open(id), /tombstoned/i);

	const dir2 = tmp();
	const store2 = mk(dir2);
	const bytes = store.export(id);                                     // export works even tombstoned (it IS the file)
	const { id: imported } = await store2.import(bytes, { agent: 'agentB' });
	assert.equal(imported, 'notepad-1', 'fresh dir: first id');
	const r = await store2.act(imported, 'recall', {}, { agent: 'agentB' });
	assert.equal(r.notes.length, 3, 'import restores the full pad');
	assert.equal(JSON.parse(readEntry(store2.export(imported), 'manifest.json')).deleted, undefined, 'import lifts the tombstone (a copy, not the same instance)');
	store.close(); store2.close();
});

test('DETERMINISM: two fresh runs of the GO scenario yield byte-identical .sgp packs', async () => {
	const d1 = tmp(), d2 = tmp();
	(await goScenario(d1)).store.close();
	(await goScenario(d2)).store.close();
	for ( const f of ['notepad-1.sgp', 'notepad-2.sgp'] )
		assert.deepEqual(fs.readFileSync(path.join(d1, f)), fs.readFileSync(path.join(d2, f)), f + ' is byte-identical across runs');
});
