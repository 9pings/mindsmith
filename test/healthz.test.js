'use strict';
// GET /healthz — the ops readout: is the appliance up, which SGC bundles are loaded (freshness), and the
// routing posture (configured tiers, which are reachable under the policy, the dataPolicy ceiling). A
// plain GET, no key, no query content — safe to poll.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp } = require('../lib/app.js');

function tier( name, egressClass ) { return { name, egressClass, ask: async ( a ) => name + ':' + a.user }; }

async function boot( cfg ) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-health-'));
	const app = createApp(Object.assign({ sgcDir: path.join(dir, 'sgc'), store: path.join(dir, 'stock.json'), port: 0 }, cfg));
	const server = await app.start(() => {});
	if ( !server.address() ) await new Promise(( r ) => server.once('listening', r) );
	return { app, server, dir, base: 'http://127.0.0.1:' + server.address().port, done: () => { app.stop(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

const TIERS = [tier('frontier', 'frontier'), tier('mid', 'mid'), tier('local', 'none')];

test('GET /healthz — status + routing posture (configured tiers, reachable under policy, dataPolicy)', async () => {
	const ctx = await boot({ tiers: TIERS, policy: { dataPolicy: 'no-egress', order: ['frontier', 'mid', 'local'] } });
	try {
		const r = await fetch(ctx.base + '/healthz');
		assert.equal(r.status, 200);
		const h = await r.json();
		assert.equal(h.status, 'ok');
		assert.equal(h.policy, 'no-egress');
		assert.deepEqual(h.tiers.configured, ['frontier', 'mid', 'local'], 'all declared tiers are reported');
		assert.deepEqual(h.tiers.reachable, ['local'], 'only the non-egress tier is reachable under no-egress');
		assert.ok(Array.isArray(h.sgc), 'sgc freshness is a (possibly empty) list of name@version');
	} finally { ctx.done(); }
});

test('app.health() — the same readout is available in-process', async () => {
	const ctx = await boot({ tiers: TIERS, policy: { dataPolicy: 'allow-all' } });
	try {
		const h = ctx.app.health();
		assert.equal(h.status, 'ok');
		assert.equal(h.policy, 'allow-all');
		assert.deepEqual(h.tiers.reachable, ['frontier', 'mid', 'local'], 'allow-all makes every tier reachable');
	} finally { ctx.done(); }
});

test('/healthz — does not disturb the OpenAI surface (a normal completion still works)', async () => {
	const ctx = await boot({ tiers: [tier('local', 'none')], policy: { dataPolicy: 'no-egress' } });
	try {
		await fetch(ctx.base + '/healthz');
		const r = await fetch(ctx.base + '/v1/chat/completions', {
			method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'q' }] })
		});
		assert.equal((await r.json()).choices[0].message.content, 'local:q');
	} finally { ctx.done(); }
});
