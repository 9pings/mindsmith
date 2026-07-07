'use strict';
/**
 * routing — the C6 ladder generalized from 2 tiers to N, governed by a POLICY.
 *
 * The verified stock stays the proxy's job (0-call, exact/semantic — it never egresses). This router is
 * the GENERALIZED FRONTIER: an ordered list of answer tiers, each a chat `ask`
 * (`async ({system,user,maxTokens,temperature}) -> text`), tagged with an EGRESS CLASS:
 *
 *   'none'      the answer never leaves the machine   (embedded gguf / a LAN model declared non-egressing)
 *   'mid'       a hosted mid-quant tier                (the subscription's mid model — leaves, but contracted)
 *   'frontier'  the user's own frontier provider       (leaves, to the user's chosen vendor)
 *
 * `policy.dataPolicy` is the RGPD ceiling — which classes may answer:
 *   'no-egress' (DEFAULT) -> ['none']            nothing leaves; only local answers
 *   'allow-mid'           -> ['none','mid']       up to the hosted mid tier
 *   'allow-all'           -> ['none','mid','frontier']
 *
 * The router walks the reachable tiers in preference order (policy.order, else declaration order) and
 * returns the first that answers; an unavailable tier falls through to the next reachable one. If the
 * policy leaves NO reachable tier (or every reachable tier fails), it is a typed NO_REACHABLE_TIER
 * refusal — a query is NEVER silently sent to a forbidden tier. This is the enforcement side of the M2
 * no-egress guarantee: the default policy calls nothing that egresses. Converges with R0 backends.js — a
 * tier is just a named `ask` (build it with `Graph.backends.makeBackend`) + an egress class (a backend's
 * `egress:false` maps to 'none').
 */
const POLICY = {
	'no-egress': ['none'],
	'allow-mid': ['none', 'mid'],
	'allow-all': ['none', 'mid', 'frontier']
};

function err( message, code, cause ) { const e = new Error(message); e.code = code; if ( cause ) e.cause = cause; return e; }

// a tier's egress class: explicit wins; else inferred from an `egress` boolean (R0 convergence: a
// non-egressing backend is 'none', an egressing one defaults to 'frontier' — the most-restricted class).
function classOf( t ) {
	if ( t.egressClass ) return t.egressClass;
	if ( t.egress === false ) return 'none';
	return 'frontier';
}

/**
 * @param cfg.tiers    [{ name, ask, egressClass?|egress? }]  ordered answer tiers (each a chat ask).
 * @param cfg.policy   { dataPolicy='no-egress', order?:[name] }
 * @param cfg.onRoute  optional ({query,tier}) -> void — provenance of which tier answered.
 */
function makeRouter( cfg ) {
	cfg = cfg || {};
	const tiers = (cfg.tiers || []).map(function ( t ) { return { name: t.name, ask: t.ask, egressClass: classOf(t) }; });
	for ( const t of tiers ) if ( typeof t.ask !== 'function' ) throw err('routing tier "' + t.name + '" needs an ask function', 'BAD_TIER');
	const policy = Object.assign({ dataPolicy: 'no-egress' }, cfg.policy);
	const allowed = POLICY[policy.dataPolicy];
	if ( !allowed ) throw err('unknown dataPolicy "' + policy.dataPolicy + '" — known: ' + Object.keys(POLICY).join(', '), 'BAD_POLICY');
	const onRoute = cfg.onRoute;

	// the reachable tiers, in preference order (policy.order by name, else declaration order — stable).
	function plan() {
		let ordered = tiers;
		if ( Array.isArray(policy.order) ) {
			const rank = function ( name ) { const i = policy.order.indexOf(name); return i === -1 ? policy.order.length : i; };
			ordered = tiers.map(( t, i ) => [t, i]).sort(( a, b ) => (rank(a[0].name) - rank(b[0].name)) || (a[1] - b[1])).map(( x ) => x[0]);
		}
		return ordered.filter(( t ) => allowed.indexOf(t.egressClass) !== -1);
	}

	// walk the reachable tiers; first success wins, an unavailable tier falls through. Typed refusal if
	// the policy leaves nothing reachable, or every reachable tier failed.
	async function route( chatArgs ) {
		const candidates = plan();
		if ( !candidates.length ) throw err('no tier reachable under dataPolicy "' + policy.dataPolicy + '" — a forbidden tier is never called', 'NO_REACHABLE_TIER');
		let last = null;
		for ( const t of candidates ) {
			try {
				const answer = await t.ask(chatArgs);
				if ( onRoute ) onRoute({ query: chatArgs && chatArgs.user, tier: t.name });
				return { answer: answer, tier: t.name };
			} catch ( e ) { last = e; }
		}
		throw err('every reachable tier failed under dataPolicy "' + policy.dataPolicy + '"', 'NO_REACHABLE_TIER', last);
	}

	// chat-shaped: returns just the answer text, so `makeFrontierAsk(router.ask)` wraps it as the proxy's frontier.
	async function ask( chatArgs ) { return (await route(chatArgs)).answer; }

	return { plan: plan, route: route, ask: ask, policy: policy };
}

module.exports = { makeRouter: makeRouter, POLICY: POLICY };
