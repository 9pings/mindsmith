'use strict';
/*
 * Copyright 2026 Nathanael Braun <pp9ping@gmail.com>
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
/**
 * The instance WORKER — one instance's member graphs live here, in their own thread, so the
 * llm/mcp server process is never saturated by stabilizations (owner 07-18, mandatory).
 *
 * Boot: workerData = { descriptorPath, conceptMap, members: {name: serializedRecord}, label }.
 * The descriptor is CODE — the worker requires it by path itself (that is why worker placement
 * demands path-descriptors). Protocol: {id, op, payload} → {id, ok, result|error}; ops:
 * act · project · addGraph · members · mutate · serialize · info · close.
 * `serialize` awaits each graph's next stable point first — a persist NEVER ships a
 * mid-stabilization state.
 */
const { parentPort, workerData, threadId } = require('worker_threads');
const Graph = require('skynet-graph/lib/graph/index.js');
const { nextStable } = require('skynet-graph/lib/authoring/core/supervise.js');
const { runAction, createInstance } = require('skynet-graph/lib/plugins/descriptor.js');

const d = require(workerData.descriptorPath);
const conceptMap = workerData.conceptMap || {};
const graphs = {};

function bootConf( label ) {
	return { label, isMaster: true, autoMount: true, conceptSets: d.conceptSets || [], bagRefManagers: {}, logLevel: 'error' };
}
function member( name ) {
	const g = graphs[name || 'master'];
	if ( !g ) throw new Error('no graph "' + (name || 'master') + '" (members: ' + Object.keys(graphs).join(', ') + ')');
	return g;
}

const ops = {
	act: ( p ) => runAction(member(p.graph), d, p.action, p.args, p.ctx || {}),
	project: ( p ) => {
		const fn = (d.projections || {})[p.name || 'summary'];
		if ( !fn ) throw new Error('no projection "' + (p.name || 'summary') + '" on type ' + d.type);
		return fn(member('master'));
	},
	addGraph: async ( p ) => {
		if ( graphs[p.name] ) throw new Error('already has a graph "' + p.name + '"');
		const inst = await createInstance(d, { seed: p.seed, conceptMap, label: workerData.label + '/' + p.name });
		graphs[p.name] = inst.graph;
		return { ok: true };
	},
	members: () => Object.keys(graphs),
	mutate: async ( p ) => {
		const g = member(p.graph);
		await new Promise(( res ) => { g.pushMutation(p.tpl, p.parent); g.stabilize(res); });
		return { ok: true, rev: g.getCurrentRevision() };
	},
	serialize: async () => {
		const records = {}, revs = {};
		for ( const name of Object.keys(graphs) ) {
			await nextStable(graphs[name]);                    // quiescent — never a mid-stabilization state
			records[name] = graphs[name].serialize();
			revs[name] = graphs[name].getCurrentRevision();
		}
		return { records, revs };
	},
	info: () => ({ threadId, members: Object.keys(graphs) }),
	close: () => {
		Object.values(graphs).forEach(( g ) => { if ( g && !g._dead ) g.destroy(); });
		setTimeout(() => process.exit(0), 0);
		return { ok: true };
	}
};

(async () => {
	for ( const name of Object.keys(workerData.members || {}) ) {
		const g = new Graph(workerData.members[name], bootConf(workerData.label + '/' + name), conceptMap);
		await nextStable(g);
		graphs[name] = g;
	}
	parentPort.postMessage({ ready: true, threadId });
	parentPort.on('message', async ( msg ) => {
		try {
			const fn = ops[msg.op];
			if ( !fn ) throw new Error('unknown op "' + msg.op + '"');
			parentPort.postMessage({ id: msg.id, ok: true, result: await fn(msg.payload || {}) });
		}
		catch ( e ) { parentPort.postMessage({ id: msg.id, ok: false, error: e.message }); }
	});
})().catch(( e ) => { parentPort.postMessage({ bootError: e.message }); process.exit(1); });
