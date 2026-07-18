'use strict';
/**
 * R4 first step — the LIVING DEBATE through the STORE (the store analog of skynet-graph's
 * dialectic-descriptor.test.js): the dialectic type registered BY PATH (worker-capable form), a
 * two-day debate persisted as a `.sgp` pack between the days.
 *
 * PRE-REGISTERED BARS (roadmap R4, 07-18):
 *  GO       day 1 through store.create (seed MATERIAL+DECLARED) → V1 established [p1,p2], V2
 *           honestly OPEN (the witness-gate NEGATIVE: refusal journaled, counted 0) → close()
 *           → a FRESH store on the same dir reopens the pack with ZERO new model calls (the
 *           scripted ask THROWS on any unmatched prompt — fail-loud vacuity control) → day 2
 *           addArguments+addViewpoint through the typed-action door → V3 establishes against
 *           the GROWN pool, counts move {PRO:1, CON:1}.
 *  BY       the day-2 items carry `by: agentB` INSIDE the persisted pack (attribution crosses
 *           the store boundary, not just the in-memory graph).
 *  NO-ASK   a process with no wired ask → the state read rejects TYPED (dialecticError) — the
 *           witness gate never silently self-flags; the pack is NOT lost (create persisted it).
 *  DETERM   two fresh runs of the full scenario → byte-identical `.sgp` packs (injected clock).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStore } = require('../lib/instances/store.js');
const { readEntry } = require('../lib/instances/zip.js');

const DESCRIPTOR_PATH = require.resolve('skynet-graph/plugins/critical-mind/descriptor.js');
const descriptor = require(DESCRIPTOR_PATH);            // same module instance the store requires

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sgp-dialectic-'));
const CLOCK = () => 1750000000000;
const mk = ( dir ) => createStore({ dir, descriptors: { dialectic: DESCRIPTOR_PATH }, clock: CLOCK });

// ── the scripted model (verbatim discipline from the engine test): ordered rules, sticky =
// reusable; an unmatched prompt THROWS with the prompt text — fail loud, so a remount that
// fires ANY ask breaks the run instead of silently consuming a rule. ──────────────────────────
function scriptedAsk( rules ) {
	const pool = rules.map(( r ) => ({ ...r, used: false }));
	const counting = async ( p ) => {
		counting.calls++;
		const text = [p && p.system, p && p.user].filter(Boolean).join('\n');
		const hit = pool.find(( r ) => (r.sticky || !r.used) && r.m.test(text) );
		if ( !hit ) throw new Error('scripted ask: no rule matches:\n' + text.slice(0, 300));
		hit.used = true;
		return hit.r;
	};
	counting.calls = 0;
	return counting;
}
const RULES = () => [
	{ m: /Point of view \(PRO\): Coffee improves focus/, r: 'cites: p1 p2' },              // V1 → established
	{ m: /Point of view \(CON\): Coffee is harmful/, r: 'cites: NONE', sticky: true },     // V2 → open
	{ m: /Point of view \(CON\): Coffee disrupts sleep/, r: 'cites: c3' },                 // V3 (day 2)
	{ m: /Candidate point/, r: 'cites: NONE', sticky: true },
	{ m: /Propose ONE NEW/, r: 'NONE', sticky: true },
	{ m: /genuinely CONTESTED/, r: 'CONTESTED', sticky: true },
];
const SEED = {
	topic: 'Is daily coffee good for programmers?',
	statements: [
		{ side: 'PRO', text: 'Caffeine measurably improves sustained attention' },
		{ side: 'PRO', text: 'Coffee breaks improve team communication' },
		{ side: 'CON', text: 'Caffeine crashes hurt afternoon productivity' },
		{ side: 'CON', text: 'Habitual use builds tolerance and dependence' }
	],
	viewpoints: [
		{ side: 'PRO', text: 'Coffee improves focus and collaboration' },
		{ side: 'CON', text: 'Coffee is harmful to health in every amount' }
	]
};

/** The full two-day scenario on one dir. Returns the ids + final state for the bars. */
async function twoDayScenario( dir ) {
	const ask = scriptedAsk(RULES());
	descriptor.wireAsk(ask);

	// ── day 1: create through the store (persists the settled debate as a .sgp) ──
	const store1 = mk(dir);
	const { id, uri } = await store1.create('dialectic', {
		seed: SEED, agent: 'agentA',
		meta: { title: 'Coffee debate', description: 'daily coffee for programmers', tags: ['debate'] }
	});
	assert.equal(uri, 'mindsmith://dialectic/' + id);
	const day1 = await store1.act(id, 'state', {}, {});
	assert.equal(day1.verdict, 'UNDECIDED', 'margin 1 < 3 — honest');
	assert.deepEqual(day1.counts, { PRO: 1, CON: 0 });
	const v1 = day1.ledger.find(( e ) => e.key === 'V1' );
	const v2 = day1.ledger.find(( e ) => e.key === 'V2' );
	assert.deepEqual(v1.witnesses, ['p1', 'p2']);
	assert.equal(v1.status, 'active');
	// NEGATIVE: the witness gate REFUSED V2 — visible as OPEN, journaled, never silently tallied
	assert.equal(v2.status, 'open');
	assert.equal(v2.witnesses, null);
	assert.ok(day1.journal.some(( l ) => /R0 open V2/.test(l) ), 'the refusal is journaled, not hidden');
	store1.close();
	const day1Calls = ask.calls;

	// ── the debate SURVIVES the store boundary: a FRESH store reopens the pack, ZERO new asks ──
	const store2 = mk(dir);
	const day1Again = await store2.act(id, 'state', {}, {});
	assert.deepEqual(day1Again, day1, 'the reopened debate projects byte-equal');
	assert.equal(ask.calls, day1Calls, 'reopening fires ZERO model calls (flags are facts)');

	// ── day 2, through the typed-action door of the store ──
	const r1 = await store2.act(id, 'addArguments', {
		statements: [{ side: 'CON', text: 'Late caffeine disrupts sleep cycles for most adults' }] }, { agent: 'agentB' });
	assert.equal(r1.ok, true);
	const r2 = await store2.act(id, 'addViewpoint', { text: 'Coffee disrupts sleep and recovery', side: 'CON' }, { agent: 'agentB' });
	assert.equal(r2.ok, true);
	const day2 = await store2.act(id, 'state', {}, {});
	const v3 = day2.ledger.find(( e ) => e.key === 'V3' );
	assert.equal(v3.status, 'active', 'the new point ESTABLISHED against the grown pool');
	assert.deepEqual(v3.witnesses, ['c3'], 'witnessed by the day-2 evidence');
	assert.deepEqual(day2.counts, { PRO: 1, CON: 1 }, 'the counts moved');
	assert.equal(day2.pool.length, 5);

	// the summary projection + findability ride the same instance
	const sum = await store2.project(id);
	assert.deepEqual({ v: sum.verdict, c: sum.counts }, { v: 'UNDECIDED', c: { PRO: 1, CON: 1 } });
	assert.equal(store2.search({ q: 'coffee' })[0].id, id, 'the debate is findable by text');
	store2.close();
	return { id };
}

test('GO: the two-day living debate THROUGH the store — create → close → fresh store reopens (0 asks) → day-2 moves the counts', async () => {
	const dir = tmp();
	const { id } = await twoDayScenario(dir);

	// BY: attribution crossed the store boundary — the day-2 items carry agentB INSIDE the pack
	const zip = fs.readFileSync(path.join(dir, id + '.sgp'));
	const master = JSON.parse(readEntry(zip, 'graphs/master.json'));
	const record = JSON.stringify(master);
	assert.ok(/Late caffeine disrupts sleep cycles/.test(record), 'the day-2 statement is in the persisted pack');
	const inner = typeof master.graph === 'string' ? JSON.parse(master.graph) : master;
	const objects = inner.conceptMaps || inner.nodes || [];    // the serialize shape lists objects under `conceptMaps`
	const c3 = objects.find(( n ) => n._id === 'c3' );
	const v3n = objects.find(( n ) => n._id === 'V3' );
	assert.equal(c3 && c3.by, 'agentB', 'the day-2 evidence is attributed in the pack');
	assert.equal(v3n && v3n.by, 'agentB', 'the day-2 viewpoint is attributed in the pack');
	const man = JSON.parse(readEntry(zip, 'manifest.json'));
	assert.equal(man.by, 'agentA', 'the creator is attributed in the manifest');
});

test('NO-ASK negative: without a wired ask the state read rejects TYPED — and the pack is not lost', async () => {
	descriptor.wireAsk(null);                            // nothing wired; no LLM_BASE in tests
	const dir = tmp();
	const store = mk(dir);
	const { id } = await store.create('dialectic', { seed: SEED, agent: 'agentA' });
	assert.ok(fs.existsSync(path.join(dir, id + '.sgp')), 'create persisted the pack before any projection');
	await assert.rejects(async () => {
		const r = await store.act(id, 'state', {}, {});
		if ( r ) throw new Error(JSON.stringify(r).slice(0, 100));
	}, /no ask wired|dialectic/i, 'the debate fails TYPED without a model — the gate never self-flags');
	store.close();
});

test('DETERMINISM: two fresh runs of the two-day scenario yield byte-identical .sgp packs', async () => {
	const d1 = tmp(), d2 = tmp();
	const { id } = await twoDayScenario(d1);
	await twoDayScenario(d2);
	assert.deepEqual(fs.readFileSync(path.join(d1, id + '.sgp')), fs.readFileSync(path.join(d2, id + '.sgp')),
		id + '.sgp is byte-identical across runs');
});
