'use strict';
// resolveRouting — the bin's arg/env -> {tiers, policy} resolver, kept PURE so the CLI is testable without
// spawning a process. A `--routing <file.json>` (or $SG_ROUTING) declares the N tiers (each an R0 backend
// spec) + a policy; `--policy` (or $SG_POLICY) overrides the dataPolicy. No routing config -> null, so the
// bin falls back to the legacy single-frontier path unchanged.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveRouting } = require('../lib/serve-config.js');

function tmpRouting( obj ) {
	const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sk-cfg-')), 'routing.json');
	fs.writeFileSync(f, JSON.stringify(obj));
	return f;
}
const CONFIG = {
	tiers: [
		{ name: 'local', egressClass: 'none', backend: { preset: 'local', modelPath: '/m.gguf' } },
		{ name: 'frontier', egressClass: 'frontier', backend: { preset: 'deepseek' } }
	],
	policy: { dataPolicy: 'allow-mid', order: ['frontier', 'local'] }
};

test('resolveRouting — reads tiers + policy from a --routing file', () => {
	const f = tmpRouting(CONFIG);
	const r = resolveRouting(['serve', '--routing', f], {});
	assert.equal(r.tiers.length, 2);
	assert.equal(r.tiers[0].name, 'local');
	assert.deepEqual(r.policy, { dataPolicy: 'allow-mid', order: ['frontier', 'local'] });
});

test('resolveRouting — --policy overrides the file dataPolicy (order preserved)', () => {
	const f = tmpRouting(CONFIG);
	const r = resolveRouting(['serve', '--routing', f, '--policy', 'no-egress'], {});
	assert.equal(r.policy.dataPolicy, 'no-egress');
	assert.deepEqual(r.policy.order, ['frontier', 'local'], 'the rest of the policy survives the override');
});

test('resolveRouting — $SG_ROUTING / $SG_POLICY env are honoured', () => {
	const f = tmpRouting(CONFIG);
	const r = resolveRouting(['serve'], { SG_ROUTING: f, SG_POLICY: 'allow-all' });
	assert.equal(r.tiers.length, 2);
	assert.equal(r.policy.dataPolicy, 'allow-all');
});

test('resolveRouting — no routing config -> null (the bin uses the legacy single frontier)', () => {
	assert.equal(resolveRouting(['serve'], {}), null);
	assert.equal(resolveRouting(['serve', '--policy', 'no-egress'], {}), null, '--policy alone (no tiers) is not a routing config');
});

test('resolveRouting — a flag argv value wins over the env', () => {
	const fFlag = tmpRouting(CONFIG);
	const r = resolveRouting(['serve', '--routing', fFlag], { SG_ROUTING: '/does/not/exist.json' });
	assert.equal(r.tiers.length, 2, 'the --routing flag file was read, not the env path');
});
