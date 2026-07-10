'use strict';
// The appliance end-to-end, GPU-free: a local ROOM of `.sgc` bundles (the community model — no catalog)
// + a stub FRONTIER → bundles load THROUGH the engine's gates (the lattice grows the proxy registry), and
// the OpenAI wire serves: first ask escalates, the repeat is served from the local stock at 0 frontier
// calls. Plus the rooms surface: gate-checked import (a malformed bundle is REFUSED, never written),
// freeze (auditable sha256 dossier), inventory.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { createApp, loadBundles } = require('../lib/app.js');
const rooms = require('../lib/rooms.js');

const LATTICE = JSON.stringify({ format: 'sgc', sgcVersion: 1, kind: 'lattice',
	manifest: { name: 'units', version: '1.0.0' },
	registry: { version: '1.0.0', keys: { unit: { enum: ['celsius', 'kelvin'], synonyms: { celsius: ['centigrade'] } } } } });
const METHODS = JSON.stringify({ format: 'sgc', sgcVersion: 1, kind: 'methods', manifest: { name: 'm', version: '1.0.0' },
	methods: [{ structure: { taskKind: 'divide' } }] });

function makeRoom() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-deq-'));
	const room = path.join(dir, 'sgc');
	fs.mkdirSync(room, { recursive: true });
	fs.writeFileSync(path.join(room, 'units.json'), LATTICE);
	fs.writeFileSync(path.join(room, 'm.sgc'), METHODS);   // .sgc extension is first-class in the room
	return { dir, room };
}

test('appliance — local room → load THROUGH the gates → OpenAI wire: escalate then local repeat (0 frontier calls)', async () => {
	const { dir, room } = makeRoom();
	let frontierCalls = 0;
	const app = createApp({
		frontierChat: async ( { user } ) => { frontierCalls++; return 'verified: ' + user; },
		sgcDir: room, store: path.join(dir, 'stock.json'), port: 0
	});
	try {
		let first;
		const server = await app.start(( f ) => { first = f; });
		if ( !server.address() ) await new Promise(( r ) => server.once('listening', r));
		assert.deepEqual(first.loaded.lattice, ['units.json'], 'the lattice bundle loaded');
		assert.deepEqual(first.loaded.methods, ['m.sgc'], 'the .sgc methods bundle loaded');
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
		assert.equal(r1.headers.get('x-sg-sgc-version'), 'm@1.0.0,units@1.0.0', 'the loaded room state (stock freshness) rides every completion');
		assert.equal((await r1.json()).choices[0].message.content, 'verified: boiling point of water?');
		const r2 = await complete();
		assert.equal(r2.headers.get('x-sg-served-from'), 'local', 'the repeat came from the stock');
		assert.equal(frontierCalls, 1, '0 frontier calls on the repeat');
	} finally { app.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('loadBundles — kind-dispatch: unknown kinds and broken files are SKIPPED, never raw-written', () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-deq-'));
	try {
		fs.writeFileSync(path.join(dir, 'weird.json'), JSON.stringify({ format: 'sgc', kind: 'mystery' }));
		fs.writeFileSync(path.join(dir, 'broken.sgc'), '{not json');
		const Graph = require('skynet-graph');
		const px = Graph.combos.createProxyCache({ frontierAsk: async () => 'x' });
		const r = loadBundles(px, dir);
		assert.equal(r.methods.length + r.lattice.length, 0);
		assert.equal(r.skipped.length, 2, 'both files skipped, no gate bypass attempted');
	} finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('rooms — import is GATE-CHECKED (a malformed/empty bundle is refused, never written), freeze writes the auditable dossier, list inventories', () => {
	const { dir, room } = makeRoom();
	const outside = path.join(dir, 'outside');
	fs.mkdirSync(outside);
	try {
		// import a GOOD bundle from outside the room
		fs.writeFileSync(path.join(outside, 'good.sgc'), METHODS);
		const ok = rooms.importBundle(room, path.join(outside, 'good.sgc'));
		assert.equal(ok.name, 'm');
		assert.ok(fs.existsSync(path.join(room, 'good.sgc')));

		// a malformed bundle is REFUSED and never lands in the room (fail-closed)
		fs.writeFileSync(path.join(outside, 'evil.sgc'), JSON.stringify({ format: 'sgc', kind: 'methods', methods: [] }));
		assert.throws(() => rooms.importBundle(room, path.join(outside, 'evil.sgc')), /no certified shapes/);
		assert.ok(!fs.existsSync(path.join(room, 'evil.sgc')), 'the refused bundle was NOT written');

		// freeze → dossier with the real sha256 ; list shows it frozen (target by FILE — two bundles share name 'm')
		const fz = rooms.freeze(room, 'm.sgc');
		assert.equal(fz.sha256, crypto.createHash('sha256').update(METHODS).digest('hex'));
		assert.ok(fs.readFileSync(path.join(room, fz.dossier), 'utf8').includes(fz.sha256), 'the dossier carries the sha256');
		const inv = rooms.list(room);
		const frozen = inv.find(( r ) => r.file === 'm.sgc' );
		assert.equal(frozen.frozen, true);
		assert.equal(inv.filter(( r ) => !r.invalid ).length, 3, 'units + m + good inventoried');

		// export ships the bundle + its dossier
		const dest = path.join(dir, 'shipped');
		const ex = rooms.exportBundle(room, 'm.sgc', dest);
		assert.deepEqual(ex.exported.sort(), ['m.dossier.md', 'm.sgc']);
	} finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
