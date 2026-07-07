'use strict';
/**
 * serve-config — the bin's CLI/env -> routing config resolver, kept PURE (arg + env in, plain object out)
 * so the `skynet-client serve` wiring is unit-testable without spawning a process.
 *
 * `--routing <file.json>` (or $SG_ROUTING) declares the N tiers + policy for the appliance:
 *   { "tiers": [ { "name":"local", "egressClass":"none", "backend": { "preset":"local", "modelPath":"…" } },
 *                { "name":"mid",   "egressClass":"mid",  "backend": { "preset":"custom", "base":"…", "key":"…" } },
 *                { "name":"frontier","egressClass":"frontier","backend": { "preset":"deepseek" } } ],
 *     "policy": { "dataPolicy":"no-egress", "order":["frontier","mid","local"] } }
 * `--policy <no-egress|allow-mid|allow-all>` (or $SG_POLICY) overrides just the dataPolicy. Each tier's
 * `backend` is an R0 preset spec (built by Graph.backends at createApp time). No routing config -> null,
 * so the caller uses the legacy single-frontier path unchanged.
 */
const fs = require('fs');

function readFlag( argv, name ) { const i = argv.indexOf('--' + name); return i !== -1 ? argv[i + 1] : undefined; }

/**
 * @param argv  process.argv.slice(2)-style array
 * @param env   an environment object (process.env)
 * @returns { tiers, policy } when an N-tier routing config is present, else null.
 */
function resolveRouting( argv, env ) {
	argv = argv || [];
	env = env || {};
	const file = readFlag(argv, 'routing') || env.SG_ROUTING;
	let tiers = null, policy = null;
	if ( file ) {
		const rc = JSON.parse(fs.readFileSync(file, 'utf8'));
		tiers = rc.tiers || null;
		policy = rc.policy || null;
	}
	if ( !tiers ) return null;   // no tiers declared -> not a routing config; the bin uses the single frontier
	const dp = readFlag(argv, 'policy') || env.SG_POLICY;
	if ( dp ) policy = Object.assign({}, policy, { dataPolicy: dp });
	return { tiers: tiers, policy: policy || undefined };
}

module.exports = { resolveRouting: resolveRouting };
