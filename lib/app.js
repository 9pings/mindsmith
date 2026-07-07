'use strict';
/**
 * skynet-client — the LOCAL APPLIANCE, a thin assembly over the skynet-graph engine:
 *
 *   [OpenAI client] → baseURL → [this app: serve handler → C6 proxy → verified stock (.sgc, gated)]
 *                                                        ↘ (miss) frontier chat (local gguf or endpoint)
 *   [skynet-server catalog] → pull (sha256-verified) → loadBundles THROUGH the engine's gates
 *
 * Guarantees carried from the engine: a covered query is served from VERIFIED stock at 0 frontier
 * calls; the local side never fabricates (0 hallucination); a miss always answers. Personal data never
 * leaves this process — the only outbound calls are the declared frontier and the declared catalog.
 *
 * `createApp` takes injectable backends (tests run it with stubs, GPU-free); bin/skynet-client resolves
 * the real ones (embedded gguf via env FRONTIER_MODEL, or an OpenAI-compat endpoint via LLM_BASE).
 */
const fs = require('fs');
const path = require('path');
const Graph = require('skynet-graph');
const { createServeHandler, startServeServer } = require('skynet-graph/lib/sg/serve.js');
const { pullAll } = require('./sgc-sync.js');

/** Load every pulled `.sgc` bundle into the proxy THROUGH the gates (kind-dispatched; never a raw write). */
function loadBundles( px, dir ) {
	const report = { methods: [], lattice: [], skipped: [] };
	if ( !fs.existsSync(dir) ) return report;
	for ( const f of fs.readdirSync(dir) ) {
		if ( !/\.json$/.test(f) ) continue;
		let art;
		try { art = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch ( e ) { report.skipped.push(f); continue; }
		if ( !art || art.format !== 'sgc' ) { report.skipped.push(f); continue; }
		try {
			if ( art.kind === 'methods' ) { px.load(art); report.methods.push(f); }
			else if ( art.kind === 'lattice' ) { px.library.loadLattice(art); report.lattice.push(f); }   // version-gated, confluence-checked
			else report.skipped.push(f);
		} catch ( e ) { report.skipped.push(f + ' (' + e.message + ')'); }
	}
	return report;
}

/**
 * Build the appliance (no socket yet — start() opens it).
 * @param cfg.frontierChat  REQUIRED async ({system,user,maxTokens,temperature}) -> text — the escalation truth.
 * @param cfg.localAsk      optional small-model chat → semantic coverage (paraphrases hit the stock).
 * @param cfg.store         stock file (durable cross-restart). cfg.sgcDir  pulled-bundle dir (default ./sgc).
 * @param cfg.catalog       optional { url, token?, refresh? } — pull on boot (+ every `refresh` s).
 * @param cfg.port/host     endpoint bind (default 4747 / 127.0.0.1 — LOCAL by default, on purpose).
 */
function createApp( cfg ) {
	cfg = cfg || {};
	if ( typeof cfg.frontierChat !== 'function' ) throw new Error('createApp needs cfg.frontierChat (async ({system,user}) -> text)');
	const combos = Graph.combos;
	const semantic = cfg.localAsk ? combos.makeLocalCoverage({ localAsk: cfg.localAsk }) : {};
	const px = combos.createProxyCache(Object.assign({
		frontierAsk: combos.makeFrontierAsk(cfg.frontierChat),
		store: cfg.store, retention: true
	}, semantic));
	const sgcDir = path.resolve(cfg.sgcDir || 'sgc');

	async function sync() {
		let pulled = null;
		if ( cfg.catalog && cfg.catalog.url ) pulled = await pullAll({ url: cfg.catalog.url, token: cfg.catalog.token, dir: sgcDir });
		const loaded = loadBundles(px, sgcDir);
		return { pulled, loaded };
	}

	let srv = null, timer = null;
	return {
		proxy: px, sync,
		start: async function ( onReady ) {
			const first = await sync();
			const handler = createServeHandler({ proxy: px, model: cfg.model, onAnswer: cfg.onAnswer });
			srv = startServeServer({ handler, port: cfg.port != null ? cfg.port : 4747, host: cfg.host || '127.0.0.1',
				onReady: () => onReady && onReady(first) });
			if ( cfg.catalog && cfg.catalog.refresh ) {
				timer = setInterval(() => sync().catch(() => {}), Number(cfg.catalog.refresh) * 1000);
				timer.unref();
			}
			return srv;
		},
		stop: function () { if ( timer ) clearInterval(timer); if ( srv ) srv.close(); }
	};
}

module.exports = { createApp, loadBundles };
