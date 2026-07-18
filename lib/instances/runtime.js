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
 *  - hot instances carry {lastUsed, dirty}: every access refreshes lastUsed at START and END of
 *    its flight — residency is pure lastAccess+TTL (owner 07-18: refcounts leak on a hung/crashed
 *    act and then pin forever; a TTL is self-healing — the tradeoff is that idleTTL must exceed
 *    the longest act, which it does by orders of magnitude). `dirty` is raised by a successful
 *    WRITE act (uniform across placements); persisted state is always QUIESCENT regardless —
 *    in-proc acts settle before returning, and the worker's serialize op awaits nextStable
 *    itself (the store runs persistPolicy:'managed' — acts never write disk).
 *  - persists happen on: create (crash-survival floor) · sync(id) (the client/LLM asked) ·
 *    eviction drain · close(). A `persistDebounceMs` knob can add settle-driven writes later;
 *    the default keeps disk writes at the FOUR explicit points above (deterministic, testable).
 *  - the sweeper: `sweep()` evicts hot instances idle past `idleTTL` (drain = persist-if-dirty,
 *    then unload). An optional interval (unref'd) drives it in production; tests drive it by
 *    hand with an injected clock.
 *
 * Process placement: with `placement:'worker'` (store option) each hot instance lives in its OWN
 * worker_thread — the llm/mcp server process is never saturated by an instance's stabilizations.
 * This layer is unchanged by placement: it funnels through store.open/act/persistNow/unload.
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
		interval = setInterval(() => { sweep().catch(() => {}); }, opts.sweepIntervalMs || Math.max(idleTTL / 2, 1000));
		interval.unref && interval.unref();
	}

	function entry( id ) {
		let e = res.get(id);
		if ( !e ) { e = { lastUsed: clock(), dirty: false }; res.set(id, e); }
		return e;
	}
	const warmingIds = new Set();                           // rehydration counted at the INITIATOR only
	async function ensure( id ) {
		const initiates = !store.isHot(id) && !warmingIds.has(id);
		if ( initiates ) { warmingIds.add(id); stats.rehydrations++; }
		try {
			const h = await store.open(id);                    // store shares one warming promise
			if ( initiates ) entry(id).dirty = false;
			return h;
		}
		finally { if ( initiates ) warmingIds.delete(id); }
	}
	async function withTouch( id, fn ) {                    // lastAccess refreshed at flight start AND end
		const h = await ensure(id);
		const e = entry(id);
		e.lastUsed = clock();
		try { return await fn(h); }
		finally { e.lastUsed = clock(); }
	}
	async function drain( id ) {                            // persist-if-dirty, then unload
		const e = res.get(id);
		if ( e && e.dirty ) { await store.persistNow(id); e.dirty = false; stats.persists++; }
		store.unload(id);
		res.delete(id);
	}
	async function sweep() {                                // drain = persist BEFORE unload (persist awaits settle)
		for ( const [id, e] of [...res] ) {
			if ( !store.isHot(id) ) { res.delete(id); continue; }
			if ( clock() - e.lastUsed > idleTTL ) {
				await drain(id);
				stats.evictions++;
			}
		}
	}

	const rt = {
		store,                                                // escape hatch for surfaces that need reads
		async create( type, o ) {
			const r = await store.create(type, o);            // store.create persists (crash-survival floor)
			stats.persists++;
			entry(r.id).lastUsed = clock();
			return r;
		},
		// a successful WRITE act (runAction acks {ok, by}) marks the instance dirty — uniform
		// across placements; reads return projections and change nothing.
		act: ( id, action, args, ctx ) => withTouch(id, () => store.act(id, action, args, ctx))
			.then(( r ) => { if ( r && r.ok === true && r.by ) entry(id).dirty = true; return r; }),
		project: ( id, name ) => withTouch(id, () => store.project(id, name)),
		revisions: ( id, o ) => withTouch(id, () => store.revisions(id, o)),
		descriptors: () => store.descriptors(),
		addGraph: ( id, name, o ) => withTouch(id, () => store.addGraph(id, name, o)).then(( r ) => { entry(id).dirty = false; stats.persists++; return r; }),
		setMeta: ( id, patch, ctx ) => withTouch(id, () => store.setMeta(id, patch, ctx)).then(( r ) => { entry(id).dirty = false; stats.persists++; return r; }),
		fork: ( id, ctx ) => withTouch(id, () => store.fork(id, ctx)).then(( r ) => { stats.persists++; return r; }),
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
