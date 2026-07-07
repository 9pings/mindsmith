'use strict';
// The appliance with N-tier ROUTING, end-to-end, GPU-free: three real stub OpenAI endpoints (local /
// mid-quant / frontier), wired as tiers from R0 backend presets. THE PRODUCT CLAIM: the SAME appliance,
// only the policy differs. Under the default `no-egress`, a miss is answered by the LOCAL tier and the
// mid/frontier endpoints are NEVER contacted (proven by their hit-counters AND a fail-closed socket guard
// on their ports). Under `allow-all`, the same miss reaches the frontier. This is the routing side of the
// M2 no-egress guarantee: dataPolicy is the enforcement, not a comment.
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp } = require('../lib/app.js');

// a stub OpenAI-compatible model endpoint that tags its answer + counts hits.
function stubModel( tag ) {
	let hits = 0;
	const srv = http.createServer(( req, res ) => {
		let b = ''; req.on('data', ( c ) => { b += c; });
		req.on('end', () => {
			hits++;
			const user = JSON.parse(b).messages.slice(-1)[0].content;
			res.setHeader('connection', 'close'); res.writeHead(200, { 'content-type': 'application/json' });
			res.end(JSON.stringify({ choices: [{ message: { content: tag + ':' + user } }] }));
		});
	});
	return new Promise(( r ) => srv.listen(0, '127.0.0.1', () => r({ srv, hits: () => hits, port: srv.address().port, url: 'http://127.0.0.1:' + srv.address().port })));
}

// the three tiers, best-first preference order — so allow-all reaches the frontier, allow-mid the mid,
// no-egress the local. Each is an R0 'custom' backend preset (any OpenAI-compat base, no key required).
function tiersFor( local, mid, frontier ) {
	return [
		{ name: 'frontier', egressClass: 'frontier', backend: { preset: 'custom', base: frontier.url, key: 'k' } },
		{ name: 'mid',      egressClass: 'mid',      backend: { preset: 'custom', base: mid.url, key: 'k' } },
		{ name: 'local',    egressClass: 'none',     backend: { preset: 'custom', base: local.url, key: 'k' } }
	];
}
const ORDER = { order: ['frontier', 'mid', 'local'] };

async function boot( cfg ) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-routing-'));
	const app = createApp(Object.assign({ sgcDir: path.join(dir, 'sgc'), store: path.join(dir, 'stock.json'), port: 0 }, cfg));
	const server = await app.start(() => {});
	if ( !server.address() ) await new Promise(( r ) => server.once('listening', r) );
	const base = 'http://127.0.0.1:' + server.address().port;
	const complete = ( content ) => fetch(base + '/v1/chat/completions', {
		method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content }] })
	});
	return { app, server, dir, servePort: server.address().port, complete, done: () => { app.stop(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

test('routing — default no-egress: a miss is answered by LOCAL; mid + frontier are never contacted (hit-counters + fail-closed socket guard)', async () => {
	const local = await stubModel('LOCAL'), mid = await stubModel('MID'), frontier = await stubModel('FRONTIER');
	// fail-closed guard: allow only the local tier + the appliance's own serve port; block mid/frontier.
	const allow = new Set([local.port]);
	const seen = [], blocked = [];
	const origConnect = net.connect;
	net.connect = function ( ...args ) {
		const a0 = args[0]; const port = (a0 && typeof a0 === 'object') ? Number(a0.port) : Number(a0);
		if ( Number.isFinite(port) ) {
			seen.push(port);
			if ( !allow.has(port) ) { blocked.push(port); const s = new net.Socket(); process.nextTick(() => s.destroy(new Error('EGRESS BLOCKED to port ' + port))); return s; }
		}
		return origConnect.apply(this, args);
	};
	let ctx;
	try {
		ctx = await boot({ tiers: tiersFor(local, mid, frontier), policy: Object.assign({ dataPolicy: 'no-egress' }, ORDER) });
		allow.add(ctx.servePort);   // the test drives the endpoint in-process
		const r = await ctx.complete('route me please');
		assert.equal((await r.json()).choices[0].message.content, 'LOCAL:route me please', 'the LOCAL tier answered');
		assert.equal(local.hits(), 1, 'local answered');
		assert.equal(mid.hits(), 0, 'the mid-quant tier was NEVER contacted under no-egress');
		assert.equal(frontier.hits(), 0, 'the frontier was NEVER contacted under no-egress');
		assert.deepEqual(blocked, [], 'no socket ever reached a forbidden tier');
		assert.ok(seen.includes(local.port), 'sanity: the escalation really hit the local tier over a real socket');
	} finally {
		net.connect = origConnect;
		if ( ctx ) ctx.done();
		local.srv.close(); mid.srv.close(); frontier.srv.close();
	}
});

test('routing — allow-all: the SAME appliance sends the same miss to the frontier (only the policy changed)', async () => {
	const local = await stubModel('LOCAL'), mid = await stubModel('MID'), frontier = await stubModel('FRONTIER');
	let ctx;
	try {
		ctx = await boot({ tiers: tiersFor(local, mid, frontier), policy: Object.assign({ dataPolicy: 'allow-all' }, ORDER) });
		const r = await ctx.complete('route me please');
		assert.equal((await r.json()).choices[0].message.content, 'FRONTIER:route me please', 'the FRONTIER tier answered');
		assert.equal(frontier.hits(), 1);
		assert.equal(mid.hits(), 0, 'the frontier was preferred; mid untouched');
		assert.equal(local.hits(), 0, 'the frontier was preferred; local untouched');
	} finally { if ( ctx ) ctx.done(); local.srv.close(); mid.srv.close(); frontier.srv.close(); }
});

test('routing — allow-mid: the ceiling stops at the hosted mid tier (frontier forbidden, local skipped by preference)', async () => {
	const local = await stubModel('LOCAL'), mid = await stubModel('MID'), frontier = await stubModel('FRONTIER');
	let ctx;
	try {
		ctx = await boot({ tiers: tiersFor(local, mid, frontier), policy: Object.assign({ dataPolicy: 'allow-mid' }, ORDER) });
		const r = await ctx.complete('route me please');
		assert.equal((await r.json()).choices[0].message.content, 'MID:route me please', 'the MID tier answered');
		assert.equal(mid.hits(), 1);
		assert.equal(frontier.hits(), 0, 'the frontier is forbidden under allow-mid');
	} finally { if ( ctx ) ctx.done(); local.srv.close(); mid.srv.close(); frontier.srv.close(); }
});
