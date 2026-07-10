'use strict';
// NO-EGRESS — the GDPR guarantee, proven on REAL sockets (M2). The appliance's promise: personal data
// (the user's query) never leaves this process except to the ONE declared destination — the frontier,
// and only on a genuine miss. Stocks come from the LOCAL room (no catalog, no phone-home): a query
// served from verified stock leaves on ZERO outbound sockets.
//
// This is NOT a mock check: a real OpenAI-compat HTTP frontier (wired exactly as the bin's LLM_BASE
// path) is what escalation hits, and an armed fail-closed guard on net.connect observes/blocks every
// outbound connection. The negative control (an undeclared destination is BLOCKED) proves the guard has
// teeth — so the positive assertions ("nothing rogue went out") are a real constraint, not a vacuous pass.
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp } = require('../lib/app.js');
const { makeAsk } = require('skynet-graph/lib/providers/llm.js');

// A distinctive personal-data marker: if this ever reaches anything but the declared frontier, content leaked.
const MARKER = 'zzq-egress-probe-42 boiling point of water';

function makeRoom() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-noegress-'));
	const room = path.join(dir, 'sgc');
	fs.mkdirSync(room, { recursive: true });
	fs.writeFileSync(path.join(room, 'units.json'), JSON.stringify({ format: 'sgc', sgcVersion: 1, kind: 'lattice',
		manifest: { name: 'units', version: '1.0.0' },
		registry: { version: '1.0.0', keys: { unit: { enum: ['celsius', 'kelvin'], synonyms: { celsius: ['centigrade'] } } } } }));
	return { dir, room };
}

// A stub OpenAI-compatible frontier (what escalation escalates TO). Counts hits so a covered query's
// "0 frontier calls" is provable independently of socket pooling. Connection:close keeps socket-counting
// honest (undici won't silently reuse a pooled socket).
function stubFrontier() {
	let hits = 0;
	const srv = http.createServer(( req, res ) => {
		let body = '';
		req.on('data', ( c ) => { body += c; });
		req.on('end', () => {
			hits++;
			res.setHeader('connection', 'close');
			res.writeHead(200, { 'content-type': 'application/json' });
			res.end(JSON.stringify({ choices: [{ message: { content: 'FRONTIER-ANSWER' } }] }));
		});
	});
	return new Promise(( r ) => srv.listen(0, '127.0.0.1', () => r({ srv, hits: () => hits, port: srv.address().port, url: 'http://127.0.0.1:' + srv.address().port })));
}

const complete = ( base, content ) => fetch(base + '/v1/chat/completions', {
	method: 'POST', headers: { 'content-type': 'application/json' },
	body: JSON.stringify({ messages: [{ role: 'user', content }] })
});

test('no-egress — armed fail-closed guard: the appliance connects to NOTHING but the declared frontier; a covered query leaves on 0 sockets; an undeclared destination is BLOCKED', async () => {
	const { srv: front, hits, port: frontPort, url: frontUrl } = await stubFrontier();
	const { dir, room } = makeRoom();

	// The egress guard: observe EVERY outbound TCP connect in this process; FAIL-CLOSED — a destination
	// not in the allowlist gets a socket that errors instead of connecting. Loopback within one process,
	// so the allowlist holds the ONE declared destination + the appliance's own serve port (the test
	// drives it in-process). NB the choke point is `net.connect` (not Socket.prototype.connect) — that is
	// what undici's connector actually calls; the `seen.includes(frontPort)` sanity below is what proves
	// the guard truly intercepts real sockets rather than passing vacuously.
	const allow = new Set([frontPort]);
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
			sgcDir: room, store: path.join(dir, 'stock.json'), port: 0
		});
		// boot loads the LOCAL room — zero outbound sockets involved — then admit the serve port.
		const server = await app.start(() => {});
		if ( !server.address() ) await new Promise(( r ) => server.once('listening', r) );
		const servePort = server.address().port;
		allow.add(servePort);
		assert.deepEqual(blocked, [], 'boot opened NO outbound socket (the room is local — no catalog, no phone-home)');

		const base = 'http://127.0.0.1:' + servePort;
		const r1 = await complete(base, MARKER);
		assert.equal(r1.headers.get('x-sg-served-from'), 'frontier', 'the miss escalated to the declared frontier');
		assert.equal(hits(), 1, 'the frontier was hit exactly once (the miss)');
		const r2 = await complete(base, MARKER);
		assert.equal(r2.headers.get('x-sg-served-from'), 'local', 'the covered repeat came from verified stock');
		assert.equal(hits(), 1, 'THE COVERED QUERY LEFT ON 0 FRONTIER SOCKETS — the frontier was not hit again');

		// The whole flow ran with the guard armed: the appliance never attempted an undeclared connection.
		assert.deepEqual(blocked, [], 'the appliance connected to nothing outside the declared frontier');
		assert.ok(seen.includes(frontPort), 'sanity: the guard actually intercepts undici sockets (it saw the real frontier connect)');

		// NEGATIVE CONTROL — the guard has teeth: an undeclared destination is fail-closed BLOCKED. Without
		// this, the assertions above could pass on a broken (no-op) guard.
		let rogue = 65000; while ( allow.has(rogue) ) rogue--;
		await assert.rejects(() => fetch('http://127.0.0.1:' + rogue + '/x'),
			( e ) => /EGRESS BLOCKED/.test(e && e.cause && e.cause.message), 'a rogue egress was fail-closed by the guard');
		assert.ok(blocked.includes(rogue), 'the guard recorded the blocked rogue destination');
	} finally {
		net.connect = origConnect;
		if ( app ) app.stop(); front.close(); fs.rmSync(dir, { recursive: true, force: true });
	}
});
