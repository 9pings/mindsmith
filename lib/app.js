'use strict';
/**
 * wala — the LOCAL APPLIANCE, a thin assembly over the skynet-graph engine:
 *
 *   [OpenAI client] → baseURL → [this app: serve handler → C6 proxy → verified stock (.sgc, gated)]
 *                                                        ↘ (miss) frontier chat (local gguf or endpoint)
 *   [local SGC ROOM] → loadBundles THROUGH the engine's gates (your own bundles: create/freeze/import/export)
 *
 * Guarantees carried from the engine: a covered query is served from VERIFIED stock at 0 frontier
 * calls; the local side never fabricates (0 hallucination); a miss always answers. Personal data never
 * leaves this process — the ONLY outbound destination is the declared frontier (no catalog, no phone-home).
 *
 * `createApp` takes injectable backends (tests run it with stubs, GPU-free); bin/wala
 * resolves the real ones (embedded gguf via env FRONTIER_MODEL, or an OpenAI-compat endpoint via LLM_BASE).
 */
const fs = require('fs');
const path = require('path');
const Graph = require('skynet-graph');
const { createServeHandler, startServeServer } = require('skynet-graph/lib/sg/serve.js');

/** Load every pulled `.sgc` bundle into the proxy THROUGH the gates (kind-dispatched; never a raw write).
 *  `report.versions` = sorted `name@version` of what actually LOADED — the stock-freshness provenance. */
function loadBundles( px, dir ) {
	const report = { methods: [], lattice: [], skipped: [], versions: [] };
	if ( !fs.existsSync(dir) ) return report;
	for ( const f of fs.readdirSync(dir) ) {
		if ( !/\.(json|sgc)$/.test(f) ) continue;
		let art;
		try { art = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch ( e ) { report.skipped.push(f); continue; }
		if ( !art || art.format !== 'sgc' ) { report.skipped.push(f); continue; }
		try {
			if ( art.kind === 'methods' ) { px.load(art); report.methods.push(f); }
			else if ( art.kind === 'lattice' ) { px.library.loadLattice(art); report.lattice.push(f); }   // version-gated, confluence-checked
			else { report.skipped.push(f); continue; }
			const man = art.manifest || {};
			report.versions.push((man.name || f) + '@' + (man.version || '?'));
		} catch ( e ) { report.skipped.push(f + ' (' + e.message + ')'); }
	}
	report.versions.sort();
	return report;
}

/**
 * Build the appliance (no socket yet — start() opens it).
 * The escalation is either an N-tier ROUTER or a single frontier chat (give ONE of):
 * @param cfg.tiers         [{ name, ask|backend, egressClass? }] — ordered answer tiers (local/mid/frontier);
 *                          a tier is a ready chat `ask` or an R0 `backend` preset spec (built via Graph.backends).
 * @param cfg.policy        { dataPolicy:'no-egress'(default)|'allow-mid'|'allow-all', order?:[name] } — the RGPD ceiling.
 * @param cfg.frontierChat  a single async ({system,user,maxTokens,temperature}) -> text — the escalation truth
 *                          (legacy shorthand; treated as one allow-all frontier tier).
 * @param cfg.onRoute       optional ({query,tier}) -> void — provenance of which tier answered.
 * @param cfg.localAsk      optional small-model chat → semantic coverage (paraphrases hit the stock).
 * @param cfg.store         stock file (durable cross-restart). cfg.sgcDir  the local SGC room (default ./sgc).
 * @param cfg.port/host     endpoint bind (default 4747 / 127.0.0.1 — LOCAL by default, on purpose).
 */
/** A routing tier spec -> {name, ask, egressClass}. Either a ready chat `ask`, or an R0 backend preset
 *  built via `Graph.backends` (a backend's `egress:false` maps to the 'none' class unless egressClass is
 *  set). This is where R0 (config) and the routing (policy) converge. */
function resolveTier( t ) {
	if ( typeof t.ask === 'function' ) return { name: t.name, ask: t.ask, egressClass: t.egressClass, egress: t.egress };
	if ( t.backend ) {
		const d = Graph.backends.resolveBackend(t.backend);
		return { name: t.name || d.name, ask: Graph.backends.makeBackend(t.backend), egressClass: t.egressClass, egress: d.egress };
	}
	throw new Error('routing tier "' + (t.name || '?') + '" needs an `ask` or a `backend` spec');
}

/** Build the escalation ROUTER from cfg: an explicit N-tier list (`cfg.tiers` governed by `cfg.policy`,
 *  default dataPolicy no-egress) generalizing the C6 ladder, OR the legacy single chat backend
 *  (`cfg.frontierChat`) treated as an allow-all frontier tier. Either way the proxy sees one frontierAsk. */
function buildRouter( cfg ) {
	const { makeRouter } = require('./routing.js');
	let tiers, policy;
	if ( Array.isArray(cfg.tiers) && cfg.tiers.length ) {
		tiers = cfg.tiers.map(resolveTier);
		policy = cfg.policy;
	} else if ( typeof cfg.frontierChat === 'function' ) {
		tiers = [{ name: 'frontier', ask: cfg.frontierChat, egressClass: 'frontier' }];
		policy = cfg.policy || { dataPolicy: 'allow-all' };   // a single declared frontier is reachable (today's behaviour)
	} else {
		throw new Error('createApp needs cfg.tiers (N-tier routing) or cfg.frontierChat (a single chat backend)');
	}
	return makeRouter({ tiers: tiers, policy: policy, onRoute: cfg.onRoute });
}

function createApp( cfg ) {
	cfg = cfg || {};
	const combos = Graph.combos;
	const router = buildRouter(cfg);   // the escalation: N-tier policy-governed, or a single frontier
	const semantic = cfg.localAsk ? combos.makeLocalCoverage({ localAsk: cfg.localAsk }) : {};
	const px = combos.createProxyCache(Object.assign({
		frontierAsk: combos.makeFrontierAsk(router.ask),
		store: cfg.store, retention: true
	}, semantic));
	const sgcDir = path.resolve(cfg.sgcDir || 'sgc');
	let sgcVersion = '';   // 'name@version,…' of the loaded bundles — refreshed by every sync, served live (x-sg-sgc-version)

	async function sync() {
		const loaded = loadBundles(px, sgcDir);   // (re)load the local room THROUGH the gates
		sgcVersion = loaded.versions.join(',');
		return { loaded };
	}

	// ops readout: up? which SGC bundles are loaded (stock freshness)? the routing posture (configured
	// tiers, which are reachable under the policy, the dataPolicy ceiling). Safe to poll — GET, no key,
	// no query content.
	function health() {
		const m = (px.metrics && px.metrics()) || {};
		return {
			status: 'ok',
			policy: router.policy.dataPolicy,
			tiers: { configured: router.tiers.map(( t ) => t.name), reachable: router.plan().map(( t ) => t.name) },
			sgc: sgcVersion ? sgcVersion.split(',') : [],
			stock: (m.stock && m.stock.size != null) ? m.stock.size : null
		};
	}

	let srv = null;
	return {
		proxy: px, sync, health,
		escalationAsk: router.ask,     // the escalation chat, reusable by other surfaces (mcp critique tool)
		sgcDir,                        // where the room bundles live (mcp assistant lanes re-read them)
		start: async function ( onReady ) {
			const first = await sync();
			const base = createServeHandler({ proxy: px, model: cfg.model, onAnswer: cfg.onAnswer, sgcVersion: () => sgcVersion });
			// the serve handler contract is PURE: (requestDescriptor) -> responseDescriptor (startServeServer
			// owns the socket). Intercept GET /healthz, delegate everything else to the OpenAI handler.
			const handler = function ( reqd ) {
				if ( reqd.method === 'GET' && String(reqd.url || '').split('?')[0] === '/healthz' ) {
					return { status: 200, headers: { 'content-type': 'application/json' }, body: health() };
				}
				return base(reqd);
			};
			srv = startServeServer({ handler, port: cfg.port != null ? cfg.port : 4747, host: cfg.host || '127.0.0.1',
				onReady: () => onReady && onReady(first) });
			return srv;
		},
		stop: function () { if ( srv ) srv.close(); }
	};
}

module.exports = { createApp, loadBundles };
