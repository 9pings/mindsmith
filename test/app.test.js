'use strict';
// The appliance end-to-end, GPU-free: a stub CATALOG (with one good lattice, one good methods bundle and
// one TAMPERED bundle) + a stub FRONTIER → pull is integrity-checked (tampered REJECTED, never written),
// bundles load THROUGH the engine's gates (the lattice grows the proxy registry), and the OpenAI wire
// serves: first ask escalates, the repeat is served from the local stock at 0 frontier calls.
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { createApp, loadBundles } = require('../lib/app.js');
const { pullAll } = require('../lib/sgc-sync.js');

const sha = ( s ) => crypto.createHash('sha256').update(s).digest('hex');

// a minimal stub catalog: real wire format, one tampered row (sha of OTHER bytes than served).
function stubCatalog() {
	const lattice = JSON.stringify({ format: 'sgc', sgcVersion: 1, kind: 'lattice',
		manifest: { name: 'units', version: '1.0.0' },
		registry: { version: '1.0.0', keys: { unit: { enum: ['celsius', 'kelvin'], synonyms: { celsius: ['centigrade'] } } } } });
	const methods = JSON.stringify({ format: 'sgc', sgcVersion: 1, kind: 'methods', manifest: { name: 'm', version: '1.0.0' }, methods: [] });
	const evil = JSON.stringify({ format: 'sgc', kind: 'lattice', manifest: { name: 'evil', version: '9.9.9' }, registry: { keys: {} } });
	const index = { catalog: 'stub', bundles: [
		{ name: 'units', kind: 'lattice', version: '1.0.0', file: 'units.json', sha256: sha(lattice), size: lattice.length },
		{ name: 'm', kind: 'methods', version: '1.0.0', file: 'm.json', sha256: sha(methods), size: methods.length },
		{ name: 'evil', kind: 'lattice', version: '9.9.9', file: 'evil.json', sha256: sha('NOT THESE BYTES'), size: evil.length }
	] };
	const srv = http.createServer(( req, res ) => {
		const url = String(req.url || '');
		const body = url.endsWith('/index.json') ? JSON.stringify(index)
			: url.endsWith('/units.json') ? lattice : url.endsWith('/m.json') ? methods : url.endsWith('/evil.json') ? evil : null;
		if ( !body ) { res.writeHead(404); return res.end('{}'); }
		res.writeHead(200, { 'content-type': 'application/json' });
		res.end(body);
	});
	return new Promise(( r ) => srv.listen(0, '127.0.0.1', () => r({ srv, url: 'http://127.0.0.1:' + srv.address().port })));
}

test('pull — integrity-checked: good bundles written, the TAMPERED one rejected and never written', async () => {
	const { srv, url } = await stubCatalog();
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-client-'));
	try {
		const r = await pullAll({ url, dir });
		assert.deepEqual(r.pulled.sort(), ['m', 'units']);
		assert.equal(r.rejected.length, 1);
		assert.match(r.rejected[0].reason, /sha256 mismatch/);
		assert.ok(!fs.existsSync(path.join(dir, 'evil.json')), 'the tampered bundle was NOT written');
		// idempotent: a second pull skips what matches.
		const again = await pullAll({ url, dir });
		assert.deepEqual(again.skipped.sort(), ['m', 'units']);
	} finally { srv.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('appliance — pull → load THROUGH the gates → OpenAI wire: escalate then local repeat (0 frontier calls)', async () => {
	const { srv: cat, url } = await stubCatalog();
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-client-'));
	let frontierCalls = 0;
	const app = createApp({
		frontierChat: async ( { user } ) => { frontierCalls++; return 'verified: ' + user; },
		sgcDir: path.join(dir, 'sgc'), store: path.join(dir, 'stock.json'),
		catalog: { url }, port: 0
	});
	try {
		let first;
		const server = await app.start(( f ) => { first = f; });
		if ( !server.address() ) await new Promise(( r ) => server.once('listening', r));
		assert.deepEqual(first.pulled.pulled.sort(), ['m', 'units'], 'boot pulled the catalog');
		assert.deepEqual(first.loaded.lattice, ['units.json'], 'the lattice bundle loaded');
		// the registry actually GREW through the gate (loadLattice adopt) — the ring is live.
		assert.equal(app.proxy.library.registry().keys.unit.synonyms.celsius[0], 'centigrade');

		// the OpenAI wire: escalate, then the repeat is served from the verified local stock.
		const base = 'http://127.0.0.1:' + server.address().port;
		const complete = () => fetch(base + '/v1/chat/completions', {
			method: 'POST', headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ messages: [{ role: 'user', content: 'boiling point of water?' }] })
		});
		const r1 = await complete();
		assert.equal(r1.headers.get('x-sg-served-from'), 'frontier');
		assert.equal((await r1.json()).choices[0].message.content, 'verified: boiling point of water?');
		const r2 = await complete();
		assert.equal(r2.headers.get('x-sg-served-from'), 'local', 'the repeat came from the stock');
		assert.equal(frontierCalls, 1, '0 frontier calls on the repeat');
	} finally { app.stop(); cat.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('loadBundles — kind-dispatch: unknown kinds and broken files are SKIPPED, never raw-written', () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-client-'));
	try {
		fs.writeFileSync(path.join(dir, 'weird.json'), JSON.stringify({ format: 'sgc', kind: 'mystery' }));
		fs.writeFileSync(path.join(dir, 'broken.json'), '{not json');
		const Graph = require('skynet-graph');
		const px = Graph.combos.createProxyCache({ frontierAsk: async () => 'x' });
		const r = loadBundles(px, dir);
		assert.equal(r.methods.length + r.lattice.length, 0);
		assert.equal(r.skipped.length, 2, 'both files skipped, no gate bypass attempted');
	} finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
