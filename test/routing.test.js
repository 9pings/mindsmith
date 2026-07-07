'use strict';
// routing (N-tier) — the ladder C6 generalized from 2 tiers (stock -> frontier) to N, GOVERNED BY A
// POLICY. The stock stays the proxy's job (0-call, verified); this router is the generalized frontier:
// an ordered list of answer tiers (local / mid-quant / frontier), each a chat `ask`, where `dataPolicy`
// decides which are REACHABLE. The default is `no-egress` — only tiers that never leave the machine may
// answer. It converges with R0 backends.js: a tier is just a named `ask` + an egress class.
const test = require('node:test');
const assert = require('node:assert');
const { makeRouter } = require('../lib/routing.js');

// a stub answer tier: records hits, echoes the tier name so we can see WHO answered.
function tier( name, egressClass, opts ) {
	opts = opts || {};
	const t = { name: name, egressClass: egressClass, hits: 0,
		ask: async ( a ) => { t.hits++; if ( opts.fail ) throw new Error(name + ' unavailable'); return name + ':' + a.user; } };
	return t;
}

test('plan — dataPolicy decides which tiers are reachable (the RGPD ceiling)', () => {
	const tiers = [tier('local', 'none'), tier('mid', 'mid'), tier('frontier', 'frontier')];
	assert.deepEqual(makeRouter({ tiers, policy: { dataPolicy: 'no-egress' } }).plan().map(( t ) => t.name), ['local']);
	assert.deepEqual(makeRouter({ tiers, policy: { dataPolicy: 'allow-mid' } }).plan().map(( t ) => t.name), ['local', 'mid']);
	assert.deepEqual(makeRouter({ tiers, policy: { dataPolicy: 'allow-all' } }).plan().map(( t ) => t.name), ['local', 'mid', 'frontier']);
});

test('plan — the default policy is no-egress (safe by default, matches the M2 guarantee)', () => {
	const tiers = [tier('local', 'none'), tier('frontier', 'frontier')];
	assert.deepEqual(makeRouter({ tiers }).plan().map(( t ) => t.name), ['local']);
});

test('plan — policy.order reorders preference (best-first), the filter still applies', () => {
	const tiers = [tier('local', 'none'), tier('mid', 'mid'), tier('frontier', 'frontier')];
	const r = makeRouter({ tiers, policy: { dataPolicy: 'allow-all', order: ['frontier', 'mid', 'local'] } });
	assert.deepEqual(r.plan().map(( t ) => t.name), ['frontier', 'mid', 'local']);
});

test('plan — egressClass is inferred from an egress boolean when not given (R0 convergence)', () => {
	const tiers = [{ name: 'local', egress: false, ask: async () => 'x' }, { name: 'cloud', egress: true, ask: async () => 'y' }];
	assert.deepEqual(makeRouter({ tiers, policy: { dataPolicy: 'no-egress' } }).plan().map(( t ) => t.name), ['local']);
});

test('route — answers from the FIRST reachable tier; lower tiers are never touched', async () => {
	const tiers = [tier('local', 'none'), tier('mid', 'mid'), tier('frontier', 'frontier')];
	const r = makeRouter({ tiers, policy: { dataPolicy: 'allow-all', order: ['frontier', 'mid', 'local'] } });
	const out = await r.route({ user: 'q' });
	assert.deepEqual(out, { answer: 'frontier:q', tier: 'frontier' });
	assert.equal(tiers[0].hits, 0, 'local not touched');
	assert.equal(tiers[1].hits, 0, 'mid not touched');
	assert.equal(tiers[2].hits, 1, 'frontier answered');
});

test('route — falls through to the next reachable tier when one is unavailable', async () => {
	const tiers = [tier('mid', 'mid', { fail: true }), tier('frontier', 'frontier')];
	const r = makeRouter({ tiers, policy: { dataPolicy: 'allow-all' } });
	const out = await r.route({ user: 'q' });
	assert.deepEqual(out, { answer: 'frontier:q', tier: 'frontier' });
	assert.equal(tiers[0].hits, 1, 'mid was tried');
});

test('route — no reachable tier under the policy is a typed refusal (nothing is silently egressed)', async () => {
	const tiers = [tier('mid', 'mid'), tier('frontier', 'frontier')];   // no `none` tier
	const r = makeRouter({ tiers, policy: { dataPolicy: 'no-egress' } });
	await assert.rejects(() => r.route({ user: 'q' }), ( e ) => e.code === 'NO_REACHABLE_TIER');
	assert.equal(tiers[0].hits, 0, 'the egress tier was NEVER called under no-egress');
	assert.equal(tiers[1].hits, 0);
});

test('route — when every reachable tier fails, it is a typed refusal carrying the last cause', async () => {
	const tiers = [tier('local', 'none', { fail: true })];
	const r = makeRouter({ tiers, policy: { dataPolicy: 'no-egress' } });
	await assert.rejects(() => r.route({ user: 'q' }), ( e ) => e.code === 'NO_REACHABLE_TIER' && /unavailable/.test(String(e.cause && e.cause.message)));
});

test('onRoute — the chosen tier is reported for provenance', async () => {
	const tiers = [tier('local', 'none')];
	const seen = [];
	const r = makeRouter({ tiers, policy: { dataPolicy: 'no-egress' }, onRoute: ( x ) => seen.push(x) });
	await r.route({ user: 'hello' });
	assert.deepEqual(seen, [{ query: 'hello', tier: 'local' }]);
});

test('ask — chat-shaped (wrappable by makeFrontierAsk): returns just the answer text', async () => {
	const tiers = [tier('local', 'none')];
	const r = makeRouter({ tiers, policy: { dataPolicy: 'no-egress' } });
	assert.equal(await r.ask({ system: 's', user: 'q', maxTokens: 10 }), 'local:q');
});

test('makeRouter — an unknown dataPolicy is a typed error', () => {
	assert.throws(() => makeRouter({ tiers: [tier('local', 'none')], policy: { dataPolicy: 'yolo' } }), ( e ) => e.code === 'BAD_POLICY');
});
