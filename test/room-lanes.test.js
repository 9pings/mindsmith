'use strict';
/**
 * R6 — the ASSISTANT lanes over the WHOLE room (the audit quick-win): `hint`/`propose` must
 * aggregate the certified shapes of EVERY loaded `kind:'methods'` bundle — the old bin wiring read
 * `methods[0]` only, silently dropping the rest of the room.
 *
 * PRE-REGISTERED BARS:
 *  GO        two methods bundles in the room → app.stockLanes(): certifiedShapes = the UNION
 *            (deduped, sorted); `propose` ADMITS a shape that only the SECOND bundle certifies
 *            (the exact case the methods[0] bug refused).
 *  NEGATIVE  an empty room (or lattice-only) → stockLanes() is null (no empty referential that
 *            would refuse everything); a broken bundle contributes nothing but does not kill the
 *            others.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp } = require('../lib/app.js');

const bundle = ( name, kinds ) => JSON.stringify({ format: 'sgc', sgcVersion: 1, kind: 'methods',
	manifest: { name, version: '1.0.0' },
	methods: kinds.map(( k ) => ({ structure: { taskKind: k } }) ) });

async function boot( files ) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-lanes-'));
	const room = path.join(dir, 'sgc');
	fs.mkdirSync(room, { recursive: true });
	Object.keys(files || {}).forEach(( f ) => fs.writeFileSync(path.join(room, f), files[f]) );
	const app = createApp({
		tiers: [{ name: 'local', egressClass: 'none', ask: async ( a ) => 'x' }], policy: { dataPolicy: 'no-egress' },
		sgcDir: room, store: path.join(dir, 'stock.json')
	});
	await app.sync();
	return { app, done: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('GO: the lanes cover the WHOLE room — a shape certified only by the SECOND bundle is admitted', async () => {
	const ctx = await boot({
		'a.json': bundle('a', ['divide', 'aggregate>select']),
		'b.json': bundle('b', ['join>filter>select', 'divide'])
	});
	try {
		const lanes = ctx.app.stockLanes();
		assert.ok(lanes, 'lanes exist');
		assert.deepEqual(lanes.hints.certifiedShapes, ['aggregate>select', 'divide', 'join>filter>select'],
			'the UNION of every bundle, deduped and sorted');
		assert.deepEqual(lanes.gate.check({ shape: 'join>filter>select' }), { ok: true },
			'a bundle-2-only shape is ADMITTED (the methods[0] bug refused it)');
		assert.equal(lanes.gate.check({ shape: 'ghost' }).ok, false, 'the gate still refuses outside the referential');
	} finally { ctx.done(); }
});

test('NEGATIVE: empty/lattice-only room → null (never an empty referential); a broken bundle does not kill the rest', async () => {
	const empty = await boot({});
	try { assert.equal(empty.app.stockLanes(), null); } finally { empty.done(); }

	const broken = await boot({
		'ok.json': bundle('ok', ['divide']),
		'broken.json': '{not json'
	});
	try {
		const lanes = broken.app.stockLanes();
		assert.deepEqual(lanes.hints.certifiedShapes, ['divide'], 'the healthy bundle still serves');
	} finally { broken.done(); }
});
