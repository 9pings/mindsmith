'use strict';
/**
 * R5 — the instance HTTP endpoints (lib/instances/http.js, wired in createApp via cfg.instances):
 * sharing lives OUT OF the LLM context — the `.sgp` rides the wire, never a tool result.
 *
 * PRE-REGISTERED BARS (roadmap R5):
 *  GO        create + notes on appliance A → GET /instances/<type>/<id> (bytes BYTE-IDENTICAL to
 *            the store's own export) → POST /instances/import on appliance B → the facts are
 *            IDENTICAL through the typed-action door (notes + `by` attribution survive the wire);
 *            the import minted a NEW id and is attributed (x-sg-agent).
 *  FRESH     a HOT DIRTY instance (managed policy: acts never write disk) is synced BEFORE serving
 *            — the download always carries the settled latest, never a stale pack.
 *  NEGATIVE  a corrupted pack is refused fail-closed (typed 400, NOTHING written on disk);
 *            unknown id → typed 404; a type-mismatched uri → typed 404 naming the actual type;
 *            an empty body → typed 400. The OpenAI surface is untouched by the new routes.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp } = require('../lib/app.js');
const { createRuntime } = require('../lib/instances/runtime.js');

const NOTEPAD_PATH = require.resolve('skynet-graph/plugins/notepad/descriptor.js');
const CLOCK = () => 1750000000000;

async function boot() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-inst-http-'));
	const runtime = createRuntime({ dir: path.join(dir, 'instances'), descriptors: { notepad: NOTEPAD_PATH }, clock: CLOCK, sweepIntervalMs: 0 });
	const app = createApp({
		tiers: [{ name: 'local', egressClass: 'none', ask: async ( a ) => 'local:' + a.user }],
		policy: { dataPolicy: 'no-egress' },
		sgcDir: path.join(dir, 'sgc'), store: path.join(dir, 'stock.json'), port: 0,
		instances: runtime
	});
	const server = await app.start(() => {});
	if ( !server.address() ) await new Promise(( r ) => server.once('listening', r) );
	return { app, runtime, server, dir, base: 'http://127.0.0.1:' + server.address().port,
		done: async () => { app.stop(); await runtime.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

test('GO: A creates+writes → GET serves the pack byte-identical → B imports → facts identical through the door', async () => {
	const A = await boot(), B = await boot();
	try {
		const { id, uri } = await A.runtime.create('notepad', { seed: { title: 'shared pad' }, agent: 'agentA' });
		await A.runtime.act(id, 'note', { text: 'sweet+salty works' }, { agent: 'agentA' });
		await A.runtime.act(id, 'note', { text: 'texture is the issue' }, { agent: 'agentB' });
		assert.equal(uri, 'mindsmith://notepad/' + id);

		// download — byte-identical to the store's own export artifact (the pack IS the wire format)
		const r = await fetch(A.base + '/instances/notepad/' + id);
		assert.equal(r.status, 200);
		assert.equal(r.headers.get('content-type'), 'application/zip');
		assert.match(r.headers.get('content-disposition'), new RegExp(id + '\\.sgp'));
		const bytes = Buffer.from(await r.arrayBuffer());
		assert.deepEqual(bytes, A.runtime.export(id), 'the wire artifact IS the export artifact');

		// import on B — a NEW id, attributed, facts identical
		const imp = await fetch(B.base + '/instances/import', {
			method: 'POST', headers: { 'x-sg-agent': 'importer-1' }, body: bytes });
		assert.equal(imp.status, 200);
		const got = await imp.json();
		assert.equal(got.id, 'notepad-1', 'fresh dir: first id minted');
		assert.equal(got.uri, 'mindsmith://notepad/notepad-1');
		const rec = await B.runtime.act(got.id, 'recall', {}, { agent: 'reader' });
		assert.deepEqual(rec.notes.map(( n ) => [n.text, n.by] ),
			[['sweet+salty works', 'agentA'], ['texture is the issue', 'agentB']],
			'the facts AND their attribution crossed the wire');
	} finally { await A.done(); await B.done(); }
});

test('FRESH: a hot dirty instance is synced before serving — the download carries the settled latest', async () => {
	const A = await boot();
	try {
		const { id } = await A.runtime.create('notepad', { seed: {}, agent: 'a' });
		await A.runtime.act(id, 'note', { text: 'only-in-memory until sync' }, { agent: 'a' });   // managed: no disk write
		const r = await fetch(A.base + '/instances/notepad/' + id);
		const bytes = Buffer.from(await r.arrayBuffer());
		// pack entries are deflated — inflate the member before looking (raw bytes can't show text)
		const { readEntry } = require('../lib/instances/zip.js');
		assert.match(String(readEntry(bytes, 'graphs/master.json')), /only-in-memory until sync/, 'the served pack has the latest settled write');
	} finally { await A.done(); }
});

test('NEGATIVE: corrupted import refused fail-closed (typed 400, nothing written); empty body 400; unknown/mismatched GET 404', async () => {
	const A = await boot();
	try {
		const dirBefore = fs.readdirSync(path.join(A.dir, 'instances'));
		const bad = await fetch(A.base + '/instances/import', { method: 'POST', body: Buffer.from('PK\x03\x04 not a real zip') });
		assert.equal(bad.status, 400);
		assert.match((await bad.json()).error.message, /import refused \(fail-closed\)/);
		assert.deepEqual(fs.readdirSync(path.join(A.dir, 'instances')), dirBefore, 'NOTHING was written');

		const empty = await fetch(A.base + '/instances/import', { method: 'POST' });
		assert.equal(empty.status, 400);
		assert.match((await empty.json()).error.message, /empty body/);

		assert.equal((await fetch(A.base + '/instances/notepad/ghost-1')).status, 404);
		const { id } = await A.runtime.create('notepad', { seed: {}, agent: 'a' });
		const mm = await fetch(A.base + '/instances/dialectic/' + id);
		assert.equal(mm.status, 404);
		assert.match((await mm.json()).error.message, /it is "notepad"/, 'the mismatch names the actual type');

		// the OpenAI surface is untouched by the new routes
		const c = await fetch(A.base + '/v1/chat/completions', {
			method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'q' }] }) });
		assert.equal((await c.json()).choices[0].message.content, 'local:q');
	} finally { await A.done(); }
});
