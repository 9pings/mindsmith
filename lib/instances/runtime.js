'use strict';
/*
 * Copyright 2026 Nathanael Braun <pp9ping@gmail.com>
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
/**
 * The RESIDENCY layer — the lifecycle manager over the instance store (owner 07-18):
 * agents work in parallel; an instance is persisted WHEN IT SETTLES (and when the client asks),
 * unloaded after an idle TTL, and transparently rehydrated from its `.sgp` the moment an agent
 * needs it again. `runtime` is what a serving surface (MCP tools, HTTP) should talk to; the store
 * below it stays the persistence/boot layer.
 *
 * Residency machine per instance: cold → warming → hot → (draining) → cold.
 *  - warming is DEDUPLICATED (N parallel agents on a cold instance boot it once — store.open's
 *    warming promise is shared).
 *  - hot instances carry {refs, lastUsed, dirty}: every act/project holds a REF for its whole
 *    flight (the sweeper never evicts under a working agent), and `dirty` is raised by the
 *    graph's OWN `stabilize` event — the engine's quiescent point, so a persist never serializes
 *    a mid-stabilization state (the store runs persistPolicy:'managed' — acts never write disk).
 *  - persists happen on: create (crash-survival floor) · sync(id) (the client/LLM asked) ·
 *    eviction drain · close(). A `persistDebounceMs` knob can add settle-driven writes later;
 *    the default keeps disk writes at the FOUR explicit points above (deterministic, testable).
 *  - the sweeper: `sweep()` evicts hot instances with refs==0 idle past `idleTTL` (drain =
 *    persist-if-dirty, then unload). An optional interval (unref'd) drives it in production;
 *    tests drive it by hand with an injected clock.
 *
 * Process/worker placement (one instance = one worker_thread, riding skynet-graph's lib/runtime
 * protocol) is the NEXT rung — this layer is where that placement knob will live, which is why
 * every access already funnels through ensure().
 */
const { createStore } = require('./store.js');

function createRuntime( opts ) {
	if ( !opts || !opts.dir ) throw new Error('runtime: `dir` is required');
	const clock = opts.clock || (() => Date.now());
	const idleTTL = opts.idleTTL == null ? 300000 : opts.idleTTL;
	const store = opts.store || createStore({ ...opts, persistPolicy: 'managed' });
	const res = new Map();                                  // id -> {refs, lastUsed, dirty, hooked}
	const stats = { persists: 0, evictions: 0, rehydrations: 0 };

	let interval = null;
	if ( opts.sweepIntervalMs !== 0 ) {
		interval = setInterval(() => sweep(), opts.sweepIntervalMs || Math.max(idleTTL / 2, 1000));
		interval.unref && interval.unref();
	}

	function entry( id ) {
		let e = res.get(id);
		if ( !e ) { e = { refs: 0, lastUsed: clock(), dirty: false, hooked: new Set() }; res.set(id, e); }
		return e;
	}
	// dirty rides the engine's OWN settle event (quiescent state = the only correct checkpoint)
	function hookSettle( id, h ) {
		const e = entry(id);
		for ( const name of Object.keys(h.graphs) ) {
			const g = h.graphs[name];
			if ( e.hooked.has(g) ) continue;
			e.hooked.add(g);
			g.on('stabilize', () => { e.dirty = true; });
		}
	}
	const warmingIds = new Set();                           // rehydration counted at the INITIATOR only
	async function ensure( id ) {
		const initiates = !store.isHot(id) && !warmingIds.has(id);
		if ( initiates ) { warmingIds.add(id); stats.rehydrations++; }
		try {
			const h = await store.open(id);                    // store shares one warming promise
			if ( initiates ) entry(id).dirty = false;
			hookSettle(id, h);
			return h;
		}
		finally { if ( initiates ) warmingIds.delete(id); }
	}
	async function withRef( id, fn ) {
		const h = await ensure(id);
		const e = entry(id);
		e.refs++; e.lastUsed = clock();
		try { return await fn(h); }
		finally { e.refs--; e.lastUsed = clock(); }
	}
	async function drain( id ) {                            // persist-if-dirty, then unload
		const e = res.get(id);
		if ( e && e.dirty ) { await store.persistNow(id); e.dirty = false; stats.persists++; }
		store.unload(id);
		res.delete(id);
	}
	function sweep() {
		for ( const [id, e] of [...res] ) {
			if ( !store.isHot(id) ) { res.delete(id); continue; }
			if ( e.refs === 0 && clock() - e.lastUsed > idleTTL ) {
				// drain is async only when dirty — fire-and-forget is unsafe; do it inline-sync via
				// persistNow (synchronous fs write under the hood) wrapped in a resolved chain.
				if ( e.dirty ) { store.persistNow(id).catch(() => {}); e.dirty = false; stats.persists++; }
				store.unload(id);
				res.delete(id);
				stats.evictions++;
			}
		}
	}

	const rt = {
		store,                                                // escape hatch for surfaces that need reads
		async create( type, o ) {
			const r = await store.create(type, o);            // store.create persists (crash-survival floor)
			stats.persists++;
			hookSettle(r.id, await store.open(r.id));
			entry(r.id).lastUsed = clock();
			return r;
		},
		act: ( id, action, args, ctx ) => withRef(id, ( h ) => store.act(id, action, args, ctx)),
		project: ( id, name ) => withRef(id, () => store.project(id, name)),
		addGraph: ( id, name, o ) => withRef(id, () => store.addGraph(id, name, o)).then(( r ) => { entry(id).dirty = false; stats.persists++; return r; }),
		setMeta: ( id, patch, ctx ) => withRef(id, () => store.setMeta(id, patch, ctx)).then(( r ) => { entry(id).dirty = false; stats.persists++; return r; }),
		fork: ( id, ctx ) => withRef(id, () => store.fork(id, ctx)).then(( r ) => { stats.persists++; return r; }),
		merge: ( childId, o, ctx ) => store.merge(childId, o, ctx),
		delete: ( id, ctx ) => store.delete(id, ctx),
		search: ( o ) => store.search(o),
		members: ( id ) => store.members(id),
		export: ( id ) => store.export(id),
		import: ( bytes, ctx ) => store.import(bytes, ctx),

		/** The client/LLM asked to persist the settled state now. */
		async sync( id ) {
			const e = res.get(id);
			if ( e && e.dirty && store.isHot(id) ) { await store.persistNow(id); e.dirty = false; stats.persists++; }
		},
		sweep,
		stats() {
			let dirty = 0;
			for ( const e of res.values() ) if ( e.dirty ) dirty++;
			return { hot: [...res.keys()].filter(( id ) => store.isHot(id)).length, dirty, ...stats };
		},
		async close() {
			if ( interval ) clearInterval(interval);
			for ( const id of [...res.keys()] ) await drain(id);
			store.close();
		}
	};
	return rt;
}

module.exports = { createRuntime };
