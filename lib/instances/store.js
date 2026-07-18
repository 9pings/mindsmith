'use strict';
/*
 * Copyright 2026 Nathanael Braun <pp9ping@gmail.com>
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
/**
 * The instance STORE — mindsmith owns the service (ids, catalogue, persistence, sharing,
 * concurrency); the engine gives primitives; the type DESCRIPTORS (skynet-graph plugins,
 * `entrypoints.descriptor`) give the typed actions the store dispatches on.
 *
 * Persistence = one `.sgp` pack per instance (owner decisions 07-18): `manifest.json` (the metas,
 * tiny, read ALONE) + one `graphs/<name>.json` per MEMBER graph — an instance can hold several
 * LINKED graphs (master + pushing clients + data sources) so `1 pack = 1 uri` holds:
 *
 *     mindsmith://<type>/<id>[/<graph>]        default member: `master`
 *
 * Save = export = import, the same artifact everywhere.
 *
 * PLACEMENT (owner 07-18, mandatory): with `placement:'worker'` each hot instance lives in its
 * OWN worker_thread (worker.js) — the llm/mcp server process is never saturated by an instance's
 * stabilizations, and a crashed worker is just COLD (the next open respawns from the last
 * persisted pack). Worker placement requires PATH descriptors (they are code; the worker requires
 * them itself). Placement is invisible to the artifact: same ops → byte-identical packs.
 *
 * What is NOT in the pack: the TYPE descriptor (code, shipped by the plugin — the pack carries
 * `type` + `typeVersion`, gated BEFORE any Graph boots, fail-closed). Big read-only reference
 * material is not uid-deduped into packs either: that is what `.sgc` rooms are for.
 *
 * NO separate index/db: the catalogue is DERIVED — readdir + manifest-only reads (never inflating
 * a blob), so it cannot drift, and id minting derives the same way. FINDABILITY: the manifest
 * carries `description` + `tags` (create meta / setMeta, attributed); `search({q, tags})` matches
 * id/title/description/tags manifest-only.
 *
 * Persist policies: `on-write` (default) or `managed` (the residency layer persists on sync/
 * evict/close — the CORRECT mode under concurrent agents). Persisted state is always QUIESCENT:
 * in-proc graphs settle before act returns; the worker's serialize op awaits nextStable itself.
 */
const fs = require('fs');
const path = require('path');
const Graph = require('skynet-graph/lib/graph/index.js');
const { nextStable } = require('skynet-graph/lib/authoring/core/supervise.js');
const { validateDescriptor, createInstance, runAction } = require('skynet-graph/lib/plugins/descriptor.js');
const { packEntries, readEntry } = require('./zip.js');
const { spawnInstanceWorker } = require('./worker-client.js');
const { revisionsOf } = require('./revisions.js');

const FORMAT_VERSION = 1;
const MASTER = 'master';
const major = ( v ) => parseInt(String(v).split('.')[0], 10) || 0;

/** mindsmith://<type>/<id>[/<graph>] → {type, id, graph} (graph defaults to `master`). */
function parseUri( uri ) {
	const m = String(uri).match(/^mindsmith:\/\/([^/]+)\/([^/]+)(?:\/([^/]+))?$/);
	if ( !m ) throw new Error('not a mindsmith uri: ' + uri);
	return { type: m[1], id: m[2], graph: m[3] || MASTER };
}

function createStore( opts ) {
	if ( !opts || !opts.dir ) throw new Error('store: `dir` is required');
	fs.mkdirSync(opts.dir, { recursive: true });
	const clock = opts.clock || (() => Date.now());
	const managed = opts.persistPolicy === 'managed';
	const inWorker = opts.placement === 'worker';
	// normalize descriptors: a PATH string (worker-capable) | {descriptor, conceptMap, path?} | bare object.
	// A descriptor may CARRY its conceptMap as data (e.g. dialectic ships its grammar tree) — honored
	// unless the caller overrides it explicitly.
	const types = {};
	Object.keys(opts.descriptors || {}).forEach(( t ) => {
		const v = opts.descriptors[t];
		let d, cm = null, p = null;
		if ( typeof v === 'string' ) { p = v; d = require(v); }
		else if ( v && v.actions ) d = v;
		else if ( v ) { d = v.descriptor; cm = v.conceptMap || null; p = v.path || null; }
		validateDescriptor(d);
		if ( inWorker && !p )
			throw new Error('store: placement "worker" requires a PATH for descriptor "' + t + '" (the worker requires the code itself)');
		types[t] = { descriptor: d, conceptMap: cm || d.conceptMap || {}, path: p };
	});

	const hot = new Map();                                   // id -> {graphs?|worker?, descriptor, meta}
	const warming = new Map();                               // id -> in-flight open() promise
	const file = ( id ) => path.join(opts.dir, id + '.sgp');

	function readManifest( id ) {
		return JSON.parse(readEntry(fs.readFileSync(file(id)), 'manifest.json'));
	}
	function listIds() {
		return fs.readdirSync(opts.dir).filter(( f ) => f.endsWith('.sgp')).map(( f ) => f.slice(0, -4)).sort();
	}
	function mintId( type ) {                                // derived from the scan — no state file
		let n = 0;
		for ( const id of listIds() ) {
			const m = id.match(new RegExp('^' + type + '-(\\d+)$'));
			if ( m ) n = Math.max(n, parseInt(m[1], 10));
		}
		return type + '-' + (n + 1);
	}
	function gate( man ) {                                   // the fail-closed door, BEFORE any Graph boot
		const t = types[man.type];
		if ( !t ) throw new Error('store: unknown type "' + man.type + '" (known: ' + Object.keys(types).join(', ') + ')');
		if ( major(man.typeVersion) !== major(t.descriptor.version) )
			throw new Error('store: ' + man.id + ' has typeVersion ' + man.typeVersion + ', incompatible with descriptor ' + t.descriptor.version + ' (fail-closed; migrate or pin the plugin)');
		if ( man.formatVersion !== FORMAT_VERSION )
			throw new Error('store: ' + man.id + ' pack format ' + man.formatVersion + ' != ' + FORMAT_VERSION + ' (fail-closed)');
		return t;
	}
	function bootConf( label, d ) {
		return { label, isMaster: true, autoMount: true, conceptSets: d.conceptSets || [], bagRefManagers: {}, logLevel: 'error' };
	}
	function memberOf( h, name ) {
		const g = h.graphs[name || MASTER];
		if ( !g ) throw new Error('store: ' + h.meta.id + ' has no graph "' + (name || MASTER) + '" (members: ' + Object.keys(h.graphs).join(', ') + ')');
		return g;
	}
	/** Quiescent serialized records for every member — worker call or local (both settle first). */
	async function serializeAll( h ) {
		if ( h.worker ) return h.worker.call('serialize');
		const records = {}, revs = {};
		for ( const name of Object.keys(h.graphs) ) {
			await nextStable(h.graphs[name]);
			records[name] = h.graphs[name].serialize();
			revs[name] = h.graphs[name].getCurrentRevision();
		}
		return { records, revs };
	}
	async function persist( h ) {
		const { records, revs } = await serializeAll(h);
		h.meta.graphs = {};
		const entries = [{ name: 'manifest.json', data: '' }];
		for ( const name of Object.keys(records) ) {
			h.meta.graphs[name] = { rev: revs[name] };
			entries.push({ name: 'graphs/' + name + '.json', data: JSON.stringify(records[name]) });
		}
		h.meta.rev = h.meta.graphs[MASTER] ? h.meta.graphs[MASTER].rev : 0;
		h.meta.updatedAt = clock();
		entries[0].data = JSON.stringify(h.meta);
		fs.writeFileSync(file(h.meta.id), packEntries(entries));
	}
	function unloadHandle( h ) {
		if ( h.worker ) { h.worker.terminate(); return; }
		Object.values(h.graphs).forEach(( g ) => { if ( g && !g._dead ) g.destroy(); });
	}
	function newMeta( type, t, id, o ) {
		const m = (o && o.meta) || {};
		return {
			formatVersion: FORMAT_VERSION, type, typeVersion: t.descriptor.version, id,
			title: m.title || (o && o.seed && o.seed.title) || '',
			description: m.description || '', tags: Array.isArray(m.tags) ? m.tags : [],
			by: o && o.agent, createdAt: clock(), graphs: {},
			...(o && o.parent ? { parent: o.parent } : {})
		};
	}

	const store = {
		/** The registered type descriptors, read-only — the single source the MCP tool generation derives from. */
		descriptors() {
			const out = {};
			Object.keys(types).forEach(( t ) => { out[t] = types[t].descriptor; });
			return out;
		},

		async create( type, o ) {
			o = o || {};
			const t = types[type];
			if ( !t ) throw new Error('store: unknown type "' + type + '" (known: ' + Object.keys(types).join(', ') + ')');
			const id = mintId(type);
			const inst = await createInstance(t.descriptor, { seed: o.seed, conceptMap: t.conceptMap, label: id });
			const h = { graphs: { [MASTER]: inst.graph }, descriptor: t.descriptor, meta: newMeta(type, t, id, o) };
			await persist(h);
			if ( inWorker ) unloadHandle(h);                   // worker placement: hot on first access, in ITS thread
			else hot.set(id, h);
			return { id, uri: 'mindsmith://' + type + '/' + id };
		},

		/** Add a named MEMBER graph to an existing instance (a linked graph inside the same pack). */
		async addGraph( id, name, o ) {
			o = o || {};
			const h = await store.open(id);
			if ( h.worker ) await h.worker.call('addGraph', { name, seed: o.seed });
			else {
				if ( h.graphs[name] ) throw new Error('store: ' + id + ' already has a graph "' + name + '"');
				const t = types[h.meta.type];
				const inst = await createInstance(t.descriptor, { seed: o.seed, conceptMap: t.conceptMap, label: id + '/' + name });
				h.graphs[name] = inst.graph;
			}
			await persist(h);
			return { uri: 'mindsmith://' + h.meta.type + '/' + id + '/' + name };
		},

		/** Member names — manifest-derived when cold (no graph boot). */
		members( id ) {
			const h = hot.get(id);
			if ( h && h.graphs ) return Object.keys(h.graphs);
			if ( h ) return Object.keys(h.meta.graphs || {});
			return Object.keys(readManifest(id).graphs || {});
		},

		async open( id ) {
			const cached = hot.get(id);
			if ( cached ) {
				if ( !(cached.worker && cached.worker.dead) ) return cached;
				hot.delete(id);                                // a crashed worker is just COLD — respawn below
			}
			if ( warming.has(id) ) return warming.get(id);
			const p = (async () => {
				const man = readManifest(id);                    // manifest first…
				if ( man.deleted ) throw new Error('store: ' + id + ' is tombstoned (deleted' + (man.mergedInto ? ', merged into ' + man.mergedInto : '') + ')');
				const t = gate(man);                             // …gate…
				const bytes = fs.readFileSync(file(id));
				const records = {};
				for ( const name of Object.keys(man.graphs || {}) )
					records[name] = JSON.parse(readEntry(bytes, 'graphs/' + name + '.json'));
				let h;
				if ( inWorker ) {
					const wh = await spawnInstanceWorker({ descriptorPath: t.path, conceptMap: t.conceptMap, members: records, label: id });
					wh.onExit(() => { const cur = hot.get(id); if ( cur && cur.worker === wh ) hot.delete(id); });
					h = { worker: wh, descriptor: t.descriptor, meta: man };
				}
				else {
					const graphs = {};
					for ( const name of Object.keys(records) ) {
						const g = new Graph(records[name], bootConf(id + '/' + name, t.descriptor), t.conceptMap);
						await nextStable(g);
						graphs[name] = g;
					}
					h = { graphs, descriptor: t.descriptor, meta: man };
				}
				hot.set(id, h);
				return h;
			})();
			warming.set(id, p);
			try { return await p; }
			finally { warming.delete(id); }
		},

		/** Persist a HOT instance now (the residency layer's checkpoint call). Always quiescent. */
		async persistNow( id ) {
			const h = hot.get(id);
			if ( !h ) throw new Error('store: persistNow(' + id + ') — not resident');
			await persist(h);
		},

		/** Unload a HOT instance (residency eviction — NOT a delete; the pack stays authoritative). */
		unload( id ) {
			const h = hot.get(id);
			if ( !h ) return false;
			unloadHandle(h);
			hot.delete(id);
			return true;
		},

		isHot( id ) { const h = hot.get(id); return !!h && !(h.worker && h.worker.dead); },

		/** ctx.graph targets a member (default `master`) — the uri suffix, as an option. */
		async act( id, action, args, ctx ) {
			ctx = ctx || {};
			const h = await store.open(id);
			const a = h.descriptor.actions[action];
			const r = h.worker
				? await h.worker.call('act', { action, args, ctx: { agent: ctx.agent }, graph: ctx.graph })
				: await runAction(memberOf(h, ctx.graph), h.descriptor, action, args, ctx);
			if ( !managed && a && a.write && r && r.ok ) await persist(h);
			return r;
		},

		/** Edit the findability metas (title/description/tags) — attributed, persisted immediately. */
		async setMeta( id, patch, ctx ) {
			if ( !ctx || !ctx.agent ) throw new Error('store: setMeta requires ctx.agent (attribution is first-class)');
			const h = await store.open(id);
			if ( patch.title !== undefined ) h.meta.title = String(patch.title);
			if ( patch.description !== undefined ) h.meta.description = String(patch.description);
			if ( patch.tags !== undefined ) h.meta.tags = Array.isArray(patch.tags) ? patch.tags.map(String) : [];
			h.meta.metaBy = ctx.agent;
			await persist(h);
			return { id, title: h.meta.title, description: h.meta.description, tags: h.meta.tags };
		},

		/** Bounded revision view of a member — atom authors derived from the `by` passenger facts. */
		async revisions( id, o ) {
			o = o || {};
			const h = await store.open(id);
			if ( h.worker ) return h.worker.call('revisions', { graph: o.graph, last: o.last });
			return revisionsOf(memberOf(h, o.graph), o.last);
		},

		async project( id, name ) {
			const h = await store.open(id);
			if ( h.worker ) return h.worker.call('project', { name });
			const p = (h.descriptor.projections || {})[name || 'summary'];
			if ( !p ) throw new Error('store: no projection "' + (name || 'summary') + '" on type ' + h.meta.type);
			return p(memberOf(h, MASTER));
		},

		/**
		 * Manifest-only catalogue. `q` free-text matches id/title/description/tags
		 * (case-insensitive); `tags` = ANY-of filter. Rows carry description+tags so an
		 * LLM can rank what it got back. Never inflates a graph blob.
		 */
		search( o ) {
			o = o || {};
			const q = o.q && String(o.q).toLowerCase();
			const rows = [];
			for ( const id of listIds() ) {
				let man;
				try { man = readManifest(id); }
				catch ( e ) { rows.push({ id, unreadable: e.message }); continue; }   // a broken pack is LISTED, never hidden
				if ( man.deleted && !o.includeDeleted ) continue;
				if ( o.type && man.type !== o.type ) continue;
				const tags = man.tags || [];
				if ( o.tags && o.tags.length && !o.tags.some(( t ) => tags.includes(t)) ) continue;
				if ( q ) {
					const hay = (id + ' ' + man.title + ' ' + (man.description || '') + ' ' + tags.join(' ')).toLowerCase();
					if ( !hay.includes(q) ) continue;
				}
				rows.push({
					id: man.id, type: man.type, title: man.title, description: man.description || '', tags,
					rev: man.rev, by: man.by, updatedAt: man.updatedAt,
					...(man.deleted ? { deleted: true } : {}), ...(man.parent ? { parent: man.parent } : {})
				});
			}
			return rows;
		},

		/** Fork the MASTER member into a new parented instance (placement-agnostic: snapshot clone). */
		async fork( id, ctx ) {
			const parent = await store.open(id);
			const t = types[parent.meta.type];
			const { records, revs } = await serializeAll(parent);
			const childId = mintId(parent.meta.type);
			const meta = newMeta(parent.meta.type, t, childId, { agent: ctx && ctx.agent, parent: id });
			meta.title = parent.meta.title;
			meta.graphs = { [MASTER]: { rev: revs[MASTER] } };
			meta.rev = revs[MASTER];
			meta.updatedAt = clock();
			fs.writeFileSync(file(childId), packEntries([
				{ name: 'manifest.json', data: JSON.stringify(meta) },
				{ name: 'graphs/master.json', data: JSON.stringify(records[MASTER]) }
			]));
			return { id: childId, uri: 'mindsmith://' + parent.meta.type + '/' + childId };
		},

		/**
		 * Merge a forked child back (master members): `project(childGraph) -> template` decides WHAT
		 * crosses; items KEEP their original `by` (provenance), items without one get the merging
		 * agent. The projection always runs on a TEMP in-proc boot of the child's settled snapshot
		 * (placement-invisible). The child is tombstoned (`mergedInto`), never erased.
		 */
		async merge( childId, o, ctx ) {
			const child = await store.open(childId);
			if ( !child.meta.parent ) throw new Error('store: ' + childId + ' has no parent to merge into');
			const parent = await store.open(child.meta.parent);
			const t = types[child.meta.type];
			const { records } = await serializeAll(child);
			let tpl = [];
			if ( o && o.project ) {
				const tempG = new Graph(records[MASTER], bootConf(childId + '/merge-view', t.descriptor), t.conceptMap);
				await nextStable(tempG);
				try { tpl = o.project(tempG) || []; }
				finally { tempG.destroy(); }
			}
			const stamped = (Array.isArray(tpl) ? tpl : [tpl]).filter(Boolean)
				.map(( item ) => ({ ...item, by: item.by || (ctx && ctx.agent) }));
			if ( stamped.length ) {
				if ( parent.worker ) await parent.worker.call('mutate', { tpl: stamped, parent: o && o.into });
				else {
					const pg = memberOf(parent, MASTER);
					await new Promise(( res ) => { pg.pushMutation(stamped, o && o.into); pg.stabilize(res); });
				}
				await persist(parent);
			}
			child.meta.deleted = true;
			child.meta.mergedInto = parent.meta.id;
			await persist(child);
			unloadHandle(child);
			hot.delete(childId);
			return { rev: parent.meta.rev };
		},

		async delete( id, ctx ) {
			const h = await store.open(id);                    // tombstone through the door (attributed)
			h.meta.deleted = true;
			h.meta.deletedBy = ctx && ctx.agent;
			await persist(h);
			unloadHandle(h);
			hot.delete(id);
		},

		export( id ) { return fs.readFileSync(file(id)); },    // the pack IS the export artifact

		async import( bytes, ctx ) {
			const man = JSON.parse(readEntry(bytes, 'manifest.json'));
			gate(man);
			const id = mintId(man.type);                       // imports mint a NEW id — never clobber
			const meta = { ...man, id, importedFrom: man.id, importedBy: ctx && ctx.agent };
			delete meta.deleted; delete meta.mergedInto; delete meta.deletedBy;   // a copy, not the same instance
			const entries = [{ name: 'manifest.json', data: JSON.stringify(meta) }];
			for ( const name of Object.keys(man.graphs || {}) )
				entries.push({ name: 'graphs/' + name + '.json', data: readEntry(bytes, 'graphs/' + name + '.json') });
			fs.writeFileSync(file(id), packEntries(entries));
			return { id, uri: 'mindsmith://' + man.type + '/' + id };
		},

		async close() {
			for ( const h of hot.values() ) unloadHandle(h);
			hot.clear();
		}
	};
	return store;
}

module.exports = { createStore, parseUri, FORMAT_VERSION, MASTER };
