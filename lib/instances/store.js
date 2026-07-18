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
 * tiny, read ALONE) + `graph.json` (the pure `{lastRev, graph}` serialize) — save = export =
 * import, the same artifact everywhere.
 *
 * NO separate index/db (owner question 07-18, decided): the catalogue is DERIVED — readdir +
 * manifest-only reads (never inflating a graph blob), so it cannot drift from the packs, and id
 * minting derives the same way (max+1 over the scan). If projected-FACTS search ever lands (R7+),
 * it arrives as a RECONSTRUCTIBLE cache file beside the packs — never a second source of truth.
 * A real db is a >10k-instances problem, not this one.
 *
 * The action door is EXCLUSIVE (R0 N2): nothing hands a raw Graph out; every write goes through
 * `act` → `runAction` (typed refusals, `by` stamped by the runner) → persist. The version gate
 * reads the manifest BEFORE any `new Graph` (fail-closed).
 */
const fs = require('fs');
const path = require('path');
const Graph = require('skynet-graph/lib/graph/index.js');
const { nextStable } = require('skynet-graph/lib/authoring/core/supervise.js');
const { validateDescriptor, createInstance, runAction } = require('skynet-graph/lib/plugins/descriptor.js');
const { packEntries, readEntry } = require('./zip.js');

const FORMAT_VERSION = 1;
const major = ( v ) => parseInt(String(v).split('.')[0], 10) || 0;

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

	const hot = new Map();                                   // id -> {graph, descriptor, meta}
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
	function persist( h ) {
		h.meta.rev = h.graph.getCurrentRevision();
		h.meta.updatedAt = clock();
		fs.writeFileSync(file(h.meta.id), packEntries([
			{ name: 'manifest.json', data: JSON.stringify(h.meta) },
			{ name: 'graph.json', data: JSON.stringify(h.graph.serialize()) }
		]));
	}

	const store = {
		async create( type, o ) {
			o = o || {};
			const t = types[type];
			if ( !t ) throw new Error('store: unknown type "' + type + '" (known: ' + Object.keys(types).join(', ') + ')');
			const id = mintId(type);
			const inst = await createInstance(t.descriptor, { seed: o.seed, conceptMap: t.conceptMap, label: id });
			const h = {
				graph: inst.graph, descriptor: t.descriptor,
				meta: {
					formatVersion: FORMAT_VERSION, type, typeVersion: t.descriptor.version, id,
					title: (o.seed && o.seed.title) || '', by: o.agent, createdAt: clock(),
					...(o.parent ? { parent: o.parent } : {})
				}
			};
			persist(h);
			hot.set(id, h);
			return { id, uri: 'mindsmith://' + type + '/' + id };
		},

		async open( id ) {
			if ( hot.has(id) ) return hot.get(id);
			const man = readManifest(id);                      // manifest first…
			if ( man.deleted ) throw new Error('store: ' + id + ' is tombstoned (deleted' + (man.mergedInto ? ', merged into ' + man.mergedInto : '') + ')');
			const t = gate(man);                               // …gate…
			const record = JSON.parse(readEntry(fs.readFileSync(file(id)), 'graph.json'));   // …then the blob
			const g = new Graph(record, {
				label: id, isMaster: true, autoMount: true,
				conceptSets: t.descriptor.conceptSets || [], bagRefManagers: {}, logLevel: 'error'
			}, t.conceptMap);
			await nextStable(g);
			const h = { graph: g, descriptor: t.descriptor, meta: man };
			hot.set(id, h);
			return h;
		},

		async act( id, action, args, ctx ) {
			const h = await store.open(id);
			const a = h.descriptor.actions[action];
			const r = await runAction(h.graph, h.descriptor, action, args, ctx);
			if ( a && a.write && r && r.ok ) persist(h);
			return r;
		},

		async project( id, name ) {
			const h = await store.open(id);
			const p = (h.descriptor.projections || {})[name || 'summary'];
			if ( !p ) throw new Error('store: no projection "' + (name || 'summary') + '" on type ' + h.meta.type);
			return p(h.graph);
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

		async fork( id, ctx ) {
			const parent = await store.open(id);
			const childId = mintId(parent.meta.type);
			const t = types[parent.meta.type];
			const g = parent.graph.fork(null, { label: childId });          // engine primitive; same concept lib
			await nextStable(g);
			const h = {
				graph: g, descriptor: t.descriptor,
				meta: {
					formatVersion: FORMAT_VERSION, type: parent.meta.type, typeVersion: t.descriptor.version,
					id: childId, title: parent.meta.title, by: ctx && ctx.agent, createdAt: clock(), parent: id
				}
			};
			persist(h);
			hot.set(childId, h);
			return { id: childId, uri: 'mindsmith://' + h.meta.type + '/' + childId };
		},

		/**
		 * Merge a forked child back: `project(childGraph) -> template` decides WHAT crosses (the
		 * bounded-frontier discipline); items KEEP their original `by` (provenance), items without
		 * one get the merging agent. The child is tombstoned (`mergedInto`), never erased.
		 */
		async merge( childId, o, ctx ) {
			const child = await store.open(childId);
			if ( !child.meta.parent ) throw new Error('store: ' + childId + ' has no parent to merge into');
			const parent = await store.open(child.meta.parent);
			const tpl = (o && o.project ? o.project(child.graph) : []);
			const stamped = (Array.isArray(tpl) ? tpl : [tpl]).filter(Boolean)
				.map(( item ) => ({ ...item, by: item.by || (ctx && ctx.agent) }));
			if ( stamped.length ) {
				await new Promise(( res ) => { parent.graph.pushMutation(stamped, o && o.into); parent.graph.stabilize(res); });
				persist(parent);
			}
			child.meta.deleted = true;
			child.meta.mergedInto = parent.meta.id;
			persist(child);
			child.graph.destroy();
			hot.delete(childId);
			return { rev: parent.graph.getCurrentRevision() };
		},

		async delete( id, ctx ) {
			const h = await store.open(id);                    // tombstone through the door (attributed)
			h.meta.deleted = true;
			h.meta.deletedBy = ctx && ctx.agent;
			persist(h);
			h.graph.destroy();
			hot.delete(id);
		},

		export( id ) { return fs.readFileSync(file(id)); },    // the pack IS the export artifact

		async import( bytes, ctx ) {
			const man = JSON.parse(readEntry(bytes, 'manifest.json'));
			const t = gate(man);
			const id = mintId(man.type);                       // imports mint a NEW id — never clobber
			const meta = { ...man, id, importedFrom: man.id, importedBy: ctx && ctx.agent };
			delete meta.deleted; delete meta.mergedInto; delete meta.deletedBy;   // a copy, not the same instance
			fs.writeFileSync(file(id), packEntries([
				{ name: 'manifest.json', data: JSON.stringify(meta) },
				{ name: 'graph.json', data: readEntry(bytes, 'graph.json') }
			]));
			void t;
			return { id, uri: 'mindsmith://' + man.type + '/' + id };
		},

		close() { for ( const h of hot.values() ) h.graph && !h.graph._dead && h.graph.destroy(); hot.clear(); }
	};
	return store;
}

module.exports = { createStore, FORMAT_VERSION };
