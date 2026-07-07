'use strict';
// NO-EGRESS — the GDPR guarantee, proven on REAL sockets (M2). The appliance's promise: personal data
// (the user's query) never leaves this process except to the two DECLARED destinations — the catalog
// (which only ever receives GET + token, never content) and the frontier (only on a genuine miss). A
// query served from verified stock leaves on ZERO outbound sockets.
//
// This is NOT a mock check: a real stub catalog RECORDS every request it receives, a real OpenAI-compat
// HTTP frontier (wired exactly as bin/skynet-client's LLM_BASE path) is what escalation hits, and an
// armed fail-closed guard on net.Socket.prototype.connect observes/blocks every outbound connection. The
// negative control (an undeclared destination is BLOCKED) proves the guard has teeth — so the positive
// assertions ("nothing rogue went out") are a real constraint, not a vacuous pass.
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { createApp } = require('../lib/app.js');
const { makeAsk } = require('skynet-graph/lib/providers/llm.js');

const sha = ( s ) => crypto.createHash('sha256').update(s).digest('hex');
// A distinctive personal-data marker: if any of these substrings ever reach the catalog, content leaked.
const MARKER = 'zzq-egress-probe-42 boiling point of water';
const SECRETS = ['zzq-egress-probe-42', 'boiling'];

// A stub catalog that RECORDS every request (method, url, auth, body) — same wire format as the real one,
// with a token gate. `reqs` is the ledger we assert never carries query content.
function stubCatalog( token ) {
	const reqs = [];
	const lattice = JSON.stringify({ format: 'sgc', sgcVersion: 1, kind: 'lattice',
		manifest: { name: 'units', version: '1.0.0' },
		registry: { version: '1.0.0', keys: { unit: { enum: ['celsius', 'kelvin'], synonyms: { celsius: ['centigrade'] } } } } });
	const methods = JSON.stringify({ format: 'sgc', sgcVersion: 1, kind: 'methods', manifest: { name: 'm', version: '1.0.0' }, methods: [] });
	const index = { catalog: 'stub', bundles: [
		{ name: 'units', kind: 'lattice', version: '1.0.0', file: 'units.json', sha256: sha(lattice), size: lattice.length },
		{ name: 'm', kind: 'methods', version: '1.0.0', file: 'm.json', sha256: sha(methods), size: methods.length }
	] };
	const srv = http.createServer(( req, res ) => {
		let body = '';
		req.on('data', ( c ) => { body += c; });
		req.on('end', () => {
			reqs.push({ method: req.method, url: String(req.url || ''), auth: req.headers.authorization || '', body });
			const url = String(req.url || '');
			const out = url.endsWith('/index.json') ? JSON.stringify(index)
				: url.endsWith('/units.json') ? lattice : url.endsWith('/m.json') ? methods : null;
			res.setHeader('connection', 'close');
			if ( !out ) { res.writeHead(404); return res.end('{}'); }
			res.writeHead(200, { 'content-type': 'application/json' });
			res.end(out);
		});
	});
	return new Promise(( r ) => srv.listen(0, '127.0.0.1', () => r({ srv, reqs, port: srv.address().port, url: 'http://127.0.0.1:' + srv.address().port })));
}

// A stub OpenAI-compatible frontier (what escalation escalates TO). Counts hits so a covered query's
// "0 frontier calls" is provable independently of socket pooling. Connection:close keeps socket-counting
// honest (undici won't silently reuse a pooled socket).
function stubFrontier() {
	let hits = 0;
	const bodies = [];
	const srv = http.createServer(( req, res ) => {
		let body = '';
		req.on('data', ( c ) => { body += c; });
		req.on('end', () => {
			hits++; bodies.push(body);
			res.setHeader('connection', 'close');
			res.writeHead(200, { 'content-type': 'application/json' });
			res.end(JSON.stringify({ choices: [{ message: { content: 'FRONTIER-ANSWER' } }] }));
		});
	});
	return new Promise(( r ) => srv.listen(0, '127.0.0.1', () => r({ srv, hits: () => hits, bodies, port: srv.address().port, url: 'http://127.0.0.1:' + srv.address().port })));
}

function complete( base, content ) {
	return fetch(base + '/v1/chat/completions', {
		method: 'POST', headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ messages: [{ role: 'user', content }] })
	});
}

test('no-egress — the catalog receives ONLY GET + Bearer token, never the query content', async () => {
	const TOKEN = 'tok-secret-123';
	const { srv: cat, reqs, url: catUrl } = await stubCatalog(TOKEN);
	const { srv: front, url: frontUrl } = await stubFrontier();
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-noegress-'));
	const app = createApp({
		frontierChat: makeAsk({ api: 'openai', base: frontUrl, model: 'stub', key: 'sk-test' }),
		sgcDir: path.join(dir, 'sgc'), store: path.join(dir, 'stock.json'),
		catalog: { url: catUrl, token: TOKEN }, port: 0
	});
	try {
		let first;
		const server = await app.start(( f ) => { first = f; });
		if ( !server.address() ) await new Promise(( r ) => server.once('listening', r) );
		// the catalog WAS contacted (otherwise "no leak" would be vacuous): boot pulled index + bundles.
		assert.deepEqual(first.pulled.pulled.sort(), ['m', 'units'], 'boot pulled the catalog');
		assert.ok(reqs.length >= 3, 'the catalog served index + both bundles (' + reqs.length + ' requests)');

		// drive personal data through the endpoint: a miss (escalates) then the covered repeat.
		const base = 'http://127.0.0.1:' + server.address().port;
		const r1 = await complete(base, MARKER);
		assert.equal(r1.headers.get('x-sg-served-from'), 'frontier', 'the miss escalated');
		assert.equal((await r1.json()).choices[0].message.content, 'FRONTIER-ANSWER');
		const r2 = await complete(base, MARKER);
		assert.equal(r2.headers.get('x-sg-served-from'), 'local', 'the repeat came from verified stock');

		// THE GUARANTEE: every catalog request was a token-bearing GET, and NONE carried the query content.
		for ( const q of reqs ) {
			assert.equal(q.method, 'GET', 'catalog request was a GET (never a content-carrying POST): ' + q.url);
			assert.equal(q.auth, 'Bearer ' + TOKEN, 'catalog request carried the entitlement token');
			const blob = (q.url + ' ' + q.body).toLowerCase();
			for ( const s of SECRETS ) assert.ok( !blob.includes(s), 'the catalog NEVER saw query content (' + s + ') — got: ' + blob.slice(0, 120) );
		}
	} finally { app.stop(); cat.close(); front.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('no-egress — armed fail-closed guard: the appliance connects to nothing but the declared catalog + frontier; a covered query leaves on 0 frontier sockets; an undeclared destination is BLOCKED', async () => {
	const { srv: cat, port: catPort, url: catUrl } = await stubCatalog('tok');
	const { srv: front, hits, port: frontPort, url: frontUrl } = await stubFrontier();
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-noegress-'));

	// The egress guard: observe EVERY outbound TCP connect in this process; FAIL-CLOSED — a destination
	// not in the allowlist gets a socket that errors instead of connecting. Loopback within one process,
	// so the allowlist holds the two declared destinations + the appliance's own serve port (the test
	// drives it in-process). NB the choke point is `net.connect` (not Socket.prototype.connect) — that is
	// what undici's connector actually calls; the `seen.includes(frontPort)` sanity below is what proves
	// the guard truly intercepts real sockets rather than passing vacuously.
	const allow = new Set([catPort, frontPort]);
	const seen = [], blocked = [];
	const origConnect = net.connect;
	net.connect = function ( ...args ) {
		const a0 = args[0];
		const port = (a0 && typeof a0 === 'object') ? Number(a0.port) : Number(a0);
		if ( Number.isFinite(port) ) {
			seen.push(port);
			if ( !allow.has(port) ) {
				blocked.push(port);
				const s = new net.Socket();
				process.nextTick(() => s.destroy(new Error('EGRESS BLOCKED to port ' + port)));
				return s;
			}
		}
		return origConnect.apply(this, args);
	};

	let app;
	try {
		app = createApp({
			frontierChat: makeAsk({ api: 'openai', base: frontUrl, model: 'stub', key: 'sk-test' }),
			sgcDir: path.join(dir, 'sgc'), store: path.join(dir, 'stock.json'),
			catalog: { url: catUrl, token: 'tok' }, port: 0
		});
		// boot (pulls the catalog — a declared, allowed destination), then admit the serve port.
		const server = await app.start(() => {});
		if ( !server.address() ) await new Promise(( r ) => server.once('listening', r) );
		const servePort = server.address().port;
		allow.add(servePort);

		const base = 'http://127.0.0.1:' + servePort;
		const r1 = await complete(base, MARKER);
		assert.equal(r1.headers.get('x-sg-served-from'), 'frontier', 'the miss escalated to the declared frontier');
		assert.equal(hits(), 1, 'the frontier was hit exactly once (the miss)');
		const r2 = await complete(base, MARKER);
		assert.equal(r2.headers.get('x-sg-served-from'), 'local', 'the covered repeat came from verified stock');
		assert.equal(hits(), 1, 'THE COVERED QUERY LEFT ON 0 FRONTIER SOCKETS — the frontier was not hit again');

		// The whole flow ran with the guard armed: the appliance never attempted an undeclared connection.
		assert.deepEqual(blocked, [], 'the appliance connected to nothing outside the declared catalog + frontier');
		assert.ok(seen.includes(frontPort), 'sanity: the guard actually intercepts undici sockets (it saw the real frontier connect)');

		// NEGATIVE CONTROL — the guard has teeth: an undeclared destination is fail-closed BLOCKED. Without
		// this, the assertions above could pass on a broken (no-op) guard.
		let rogue = 65000; while ( allow.has(rogue) ) rogue--;
		await assert.rejects(() => fetch('http://127.0.0.1:' + rogue + '/x'),
			( e ) => /EGRESS BLOCKED/.test(e && e.cause && e.cause.message), 'a rogue egress was fail-closed by the guard');
		assert.ok(blocked.includes(rogue), 'the guard recorded the blocked rogue destination');
	} finally {
		net.connect = origConnect;
		if ( app ) app.stop(); cat.close(); front.close(); fs.rmSync(dir, { recursive: true, force: true });
	}
});
