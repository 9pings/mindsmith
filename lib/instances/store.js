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
 * What is NOT in the pack: the TYPE descriptor (it is CODE, shipped by the plugin) — the pack only
 * carries `type` + `typeVersion` and the gate checks them against the loaded descriptor BEFORE any
 * `new Graph` (fail-closed). And big read-only reference material does not get uid-deduped into
 * packs either: that is what `.sgc` rooms are for — a pack carries its OWN mutable members only.
 *
 * NO separate index/db (owner question 07-18, decided): the catalogue is DERIVED — readdir +
 * manifest-only reads (never inflating a graph blob), so it cannot drift from the packs, and id
 * minting derives the same way (max+1 over the scan). If projected-FACTS search ever lands (R7+),
 * it arrives as a RECONSTRUCTIBLE cache file beside the packs — never a second source of truth.
 * A real db is a >10k-instances problem, not this one.
 *
 * The action door is EXCLUSIVE (R0 N2): nothing hands a raw Graph out; every write goes through
 * `act` → `runAction` (typed refusals, `by` stamped at the door) → persist. V1 scope notes:
 * `open` boots ALL members (instances are small; lazy member boot is a later optimization);
 * fork/merge/project operate on the `master` member; the live master↔client sync wiring is R8 —
 * here the pack/uri/API are multi-graph so the format never locks 1-pack-1-graph.
 */
const fs = require('fs');
const path = require('path');
const Graph = require('skynet-graph/lib/graph/index.js');
const { nextStable } = require('skynet-graph/lib/authoring/core/supervise.js');
const { validateDescriptor, createInstance, runAction } = require('skynet-graph/lib/plugins/descriptor.js');
const { packEntries, readEntry } = require('./zip.js');

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
	// normalize {type: descriptor} | {type: {descriptor, conceptMap}} — validated fail-closed at boot
	const types = {};
	Object.keys(opts.descriptors || {}).forEach(( t ) => {
		const v = opts.descriptors[t];
		const d = v && v.actions ? v : v && v.descriptor;
		validateDescriptor(d);
		types[t] = { descriptor: d, conceptMap: (v && v.conceptMap) || {} };
	});

	const hot = new Map();                                   // id -> {graphs:{name->Graph}, descriptor, meta}
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
	function persist( h ) {
		const entries = [{ name: 'manifest.json', data: '' }];           // placeholder, filled after revs
		for ( const name of Object.keys(h.graphs) ) {
			h.meta.graphs[name] = { rev: h.graphs[name].getCurrentRevision() };
			entries.push({ name: 'graphs/' + name + '.json', data: JSON.stringify(h.graphs[name].serialize()) });
		}
		h.meta.rev = h.meta.graphs[MASTER] ? h.meta.graphs[MASTER].rev : 0;
		h.meta.updatedAt = clock();
		entries[0].data = JSON.stringify(h.meta);
		fs.writeFileSync(file(h.meta.id), packEntries(entries));
	}

	const store = {
		async create( type, o ) {
			o = o || {};
			const t = types[type];
			if ( !t ) throw new Error('store: unknown type "' + type + '" (known: ' + Object.keys(types).join(', ') + ')');
			const id = mintId(type);
			const inst = await createInstance(t.descriptor, { seed: o.seed, conceptMap: t.conceptMap, label: id });
			const h = {
				graphs: { [MASTER]: inst.graph }, descriptor: t.descriptor,
				meta: {
					formatVersion: FORMAT_VERSION, type, typeVersion: t.descriptor.version, id,
					title: (o.seed && o.seed.title) || '', by: o.agent, createdAt: clock(), graphs: {},
					...(o.parent ? { parent: o.parent } : {})
				}
			};
			persist(h);
			hot.set(id, h);
			return { id, uri: 'mindsmith://' + type + '/' + id };
		},

		/** Add a named MEMBER graph to an existing instance (a linked graph inside the same pack). */
		async addGraph( id, name, o ) {
			o = o || {};
			const h = await store.open(id);
			if ( h.graphs[name] ) throw new Error('store: ' + id + ' already has a graph "' + name + '"');
			const t = types[h.meta.type];
			const inst = await createInstance(t.descriptor, { seed: o.seed, conceptMap: t.conceptMap, label: id + '/' + name });
			h.graphs[name] = inst.graph;
			persist(h);
			return { uri: 'mindsmith://' + h.meta.type + '/' + id + '/' + name };
		},

		/** Member names, manifest-derived when cold (no graph boot). */
		members( id ) {
			return hot.has(id) ? Object.keys(hot.get(id).graphs) : Object.keys(readManifest(id).graphs || {});
		},

		async open( id ) {
			if ( hot.has(id) ) return hot.get(id);
			const man = readManifest(id);                      // manifest first…
			if ( man.deleted ) throw new Error('store: ' + id + ' is tombstoned (deleted' + (man.mergedInto ? ', merged into ' + man.mergedInto : '') + ')');
			const t = gate(man);                               // …gate…
			const bytes = fs.readFileSync(file(id));
			const graphs = {};
			for ( const name of Object.keys(man.graphs || {}) ) {           // …then the blobs
				const record = JSON.parse(readEntry(bytes, 'graphs/' + name + '.json'));
				const g = new Graph(record, bootConf(id + '/' + name, t.descriptor), t.conceptMap);
				await nextStable(g);
				graphs[name] = g;
			}
			const h = { graphs, descriptor: t.descriptor, meta: man };
			hot.set(id, h);
			return h;
		},

		/** ctx.graph targets a member (default `master`) — the uri suffix, as an option. */
		async act( id, action, args, ctx ) {
			ctx = ctx || {};
			const h = await store.open(id);
			const g = memberOf(h, ctx.graph);
			const a = h.descriptor.actions[action];
			const r = await runAction(g, h.descriptor, action, args, ctx);
			if ( a && a.write && r && r.ok ) persist(h);
			return r;
		},

		async project( id, name ) {
			const h = await store.open(id);
			const p = (h.descriptor.projections || {})[name || 'summary'];
			if ( !p ) throw new Error('store: no projection "' + (name || 'summary') + '" on type ' + h.meta.type);
			return p(memberOf(h, MASTER));
		},

		search( o ) {
			o = o || {};
			const rows = [];
			for ( const id of listIds() ) {
				let man;
				try { man = readManifest(id); }
				catch ( e ) { rows.push({ id, unreadable: e.message }); continue; }   // a broken pack is LISTED, never hidden
				if ( man.deleted && !o.includeDeleted ) continue;
				if ( o.type && man.type !== o.type ) continue;
				if ( o.q && !(String(man.title).includes(o.q) || id.includes(o.q)) ) continue;
				rows.push({ id: man.id, type: man.type, title: man.title, rev: man.rev, by: man.by, updatedAt: man.updatedAt, ...(man.deleted ? { deleted: true } : {}), ...(man.parent ? { parent: man.parent } : {}) });
			}
			return rows;
		},

		async fork( id, ctx ) {                               // forks the MASTER member (V1)
			const parent = await store.open(id);
			const childId = mintId(parent.meta.type);
			const t = types[parent.meta.type];
			const g = memberOf(parent, MASTER).fork(null, { label: childId });   // engine primitive; same concept lib
			await nextStable(g);
			const h = {
				graphs: { [MASTER]: g }, descriptor: t.descriptor,
				meta: {
					formatVersion: FORMAT_VERSION, type: parent.meta.type, typeVersion: t.descriptor.version,
					id: childId, title: parent.meta.title, by: ctx && ctx.agent, createdAt: clock(), graphs: {}, parent: id
				}
			};
			persist(h);
			hot.set(childId, h);
			return { id: childId, uri: 'mindsmith://' + h.meta.type + '/' + childId };
		},

		/**
		 * Merge a forked child back (master members): `project(childGraph) -> template` decides WHAT
		 * crosses (the bounded-frontier discipline); items KEEP their original `by` (provenance),
		 * items without one get the merging agent. The child is tombstoned (`mergedInto`), never erased.
		 */
		async merge( childId, o, ctx ) {
			const child = await store.open(childId);
			if ( !child.meta.parent ) throw new Error('store: ' + childId + ' has no parent to merge into');
			const parent = await store.open(child.meta.parent);
			const tpl = (o && o.project ? o.project(memberOf(child, MASTER)) : []);
			const stamped = (Array.isArray(tpl) ? tpl : [tpl]).filter(Boolean)
				.map(( item ) => ({ ...item, by: item.by || (ctx && ctx.agent) }));
			const pg = memberOf(parent, MASTER);
			if ( stamped.length ) {
				await new Promise(( res ) => { pg.pushMutation(stamped, o && o.into); pg.stabilize(res); });
				persist(parent);
			}
			child.meta.deleted = true;
			child.meta.mergedInto = parent.meta.id;
			persist(child);
			Object.values(child.graphs).forEach(( g ) => g.destroy());
			hot.delete(childId);
			return { rev: pg.getCurrentRevision() };
		},

		async delete( id, ctx ) {
			const h = await store.open(id);                    // tombstone through the door (attributed)
			h.meta.deleted = true;
			h.meta.deletedBy = ctx && ctx.agent;
			persist(h);
			Object.values(h.graphs).forEach(( g ) => g.destroy());
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

		close() {
			for ( const h of hot.values() )
				Object.values(h.graphs).forEach(( g ) => { if ( g && !g._dead ) g.destroy(); });
			hot.clear();
		}
	};
	return store;
}

module.exports = { createStore, parseUri, FORMAT_VERSION, MASTER };
