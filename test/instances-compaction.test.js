'use strict';
/**
 * R7 — persistence hardening: the ATTRIBUTED HISTORY survives restarts, and a LONG instance is
 * BOUNDED (memory + pack) with an honest compaction marker.
 *
 * Before R7 the revision atoms lived only in the hot graph: a close/reopen kept the FACTS but
 * lost WHO wrote WHAT per revision. Now every persist writes `revs/<member>.json` — the bounded
 * audit VIEW ({rev, atoms, by[]}, never the raw templates: the facts stay the single truth) —
 * and the hot graph itself is bounded by the engine's native `maxRevisions` window.
 *
 * PRE-REGISTERED BARS:
 *  GO        a notepad grown by TWO agents across TWO sessions → close → reopen → the revision
 *            authors are still there (merged persisted∪live view, rev space continuous);
 *            the pack carries revs/master.json; facts fully intact.
 *  BOUNDED   with revisionsTail K, a LONG run (300 writes) keeps ≤K persisted rows and reports
 *            `compactedBelow` (> 0, honest) — never a silently absent history; the hot graph's
 *            snapshots stay within the maxRevisions window.
 *  NEGATIVE  compaction NEVER touches the facts (recall shows all 300 notes after remount);
 *            an OLD pack without revs/*.json (pre-R7) still opens — revisions = live view only
 *            (additive format, no version bump needed).
 *  DETERM    two fresh runs → byte-identical packs (the view rows are deterministic).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStore } = require('../lib/instances/store.js');
const { packEntries, readEntry, listEntries } = require('../lib/instances/zip.js');

const NOTEPAD_PATH = require.resolve('skynet-graph/plugins/notepad/descriptor.js');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sgp-compact-'));
const CLOCK = () => 1750000000000;
const mk = ( dir, o ) => createStore({ dir, descriptors: { notepad: NOTEPAD_PATH }, clock: CLOCK, ...(o || {}) });

test('GO: the attributed history SURVIVES close/reopen — authors per revision, rev space continuous', async () => {
	const dir = tmp();
	const s1 = mk(dir);
	const { id } = await s1.create('notepad', { seed: { title: 'history' }, agent: 'agentA' });
	await s1.act(id, 'note', { text: 'day-1 by A' }, { agent: 'agentA' });
	await s1.act(id, 'note', { text: 'day-1 by B' }, { agent: 'agentB' });
	const before = await s1.revisions(id);
	assert.ok(new Set(before.revisions.flatMap(( r ) => r.by )).has('agentB'), 'live view sees the authors');
	s1.close();

	assert.ok(listEntries(fs.readFileSync(path.join(dir, id + '.sgp'))).includes('revs/master.json'),
		'the pack carries the audit view');

	const s2 = mk(dir);
	const after = await s2.revisions(id);
	const authors = new Set(after.revisions.flatMap(( r ) => r.by ));
	assert.ok(authors.has('agentA') && authors.has('agentB'),
		'WHO wrote WHAT survives the restart (the R7 headline)');
	// day 2 continues the SAME rev space — the merged view holds both sessions
	await s2.act(id, 'note', { text: 'day-2 by C' }, { agent: 'agentC' });
	const day2 = await s2.revisions(id);
	assert.ok(new Set(day2.revisions.flatMap(( r ) => r.by )).has('agentC'), 'live day-2 author present');
	assert.ok(new Set(day2.revisions.flatMap(( r ) => r.by )).has('agentB'), 'day-1 author STILL present');
	const revs = day2.revisions.map(( r ) => r.rev );
	assert.deepEqual(revs, [...revs].sort(( a, b ) => a - b ), 'one continuous, ordered rev space');
	assert.equal(new Set(revs).size, revs.length, 'no duplicate rev rows after the merge');
	s2.close();
});

test('BOUNDED: a 300-write instance keeps ≤ revisionsTail rows + an honest compactedBelow; facts intact; hot graph windowed', async () => {
	const dir = tmp();
	const store = mk(dir, { revisionsTail: 40, maxRevisions: 60 });
	const { id } = await store.create('notepad', { seed: {}, agent: 'boss' });
	for ( let i = 1; i <= 300; i++ )
		await store.act(id, 'note', { text: 'n' + i }, { agent: i % 2 ? 'A' : 'B' });

	const v = await store.revisions(id, { last: 500 });
	assert.ok(v.revisions.length <= 40 + 60, 'the view is bounded (persisted tail + live window)');
	assert.ok(v.compactedBelow > 0, 'compaction is REPORTED, never silent');
	assert.ok(v.snapshots.length <= 61, 'the hot graph snapshots stay within the maxRevisions window');

	// NEGATIVE: compaction never touches the FACTS — all 300 notes are there after a remount
	store.close();
	const store2 = mk(dir, { revisionsTail: 40 });
	const r = await store2.act(id, 'recall', {}, { agent: 'x' });
	assert.equal(r.notes.length, 300, 'every fact survived compaction + remount');
	assert.equal(r.notes[299].text, 'n300');
	const v2 = await store2.revisions(id, { last: 500 });
	assert.ok(v2.revisions.length > 0 && v2.revisions.length <= 40, 'reopened: the persisted tail serves the view');
	assert.ok(v2.compactedBelow > 0, 'the marker survives the restart');
	store2.close();
});

test('NEGATIVE: a pre-R7 pack (no revs/*.json) still opens — revisions falls back to the live view', async () => {
	const dir = tmp();
	const s1 = mk(dir);
	const { id } = await s1.create('notepad', { seed: {}, agent: 'a' });
	await s1.act(id, 'note', { text: 'old world' }, { agent: 'a' });
	s1.close();
	// strip the revs entry — the pre-R7 layout
	const f = path.join(dir, id + '.sgp');
	const zip = fs.readFileSync(f);
	const entries = listEntries(zip).filter(( e ) => !/^revs\//.test(e) )
		.map(( name ) => ({ name, data: readEntry(zip, name) }));
	fs.writeFileSync(f, packEntries(entries));

	const s2 = mk(dir);
	const r = await s2.act(id, 'recall', {}, { agent: 'x' });
	assert.equal(r.notes.length, 1, 'the old pack opens fine (additive format)');
	const v = await s2.revisions(id);
	assert.ok(Array.isArray(v.revisions), 'revisions degrades to the live view, never throws');
	s2.close();
});

test('DETERM: two fresh runs yield byte-identical packs (the audit view is deterministic)', async () => {
	async function scenario( dir ) {
		const store = mk(dir, { revisionsTail: 10 });
		const { id } = await store.create('notepad', { seed: { title: 't' }, agent: 'A' });
		for ( let i = 0; i < 15; i++ ) await store.act(id, 'note', { text: 'x' + i }, { agent: i % 2 ? 'A' : 'B' });
		store.close();
		return id;
	}
	const d1 = tmp(), d2 = tmp();
	const id = await scenario(d1);
	await scenario(d2);
	assert.deepEqual(fs.readFileSync(path.join(d1, id + '.sgp')), fs.readFileSync(path.join(d2, id + '.sgp')),
		'byte-identical across runs');
});
