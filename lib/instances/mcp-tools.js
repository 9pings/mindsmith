'use strict';
/*
 * Copyright 2026 Nathanael Braun <pp9ping@gmail.com>
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
/**
 * The MCP tools GENERATED from the type descriptors (roadmap R4) — the instance service's agent
 * surface. One descriptor = one set of TYPED tools (`<type>_<action>`, inputSchema derived from
 * the action's `input` spec) + the generic socle `instances_{create,search,fork,delete,
 * revisions,sync}`. Everything dispatches on the RUNTIME (residency, managed persistence,
 * placement-agnostic) — never on a raw store handle, never out-of-band.
 *
 * The envelope every typed tool adds to the action's own input:
 *   id      the instance id — or its `mindsmith://<type>/<id>[/<graph>]` uri (the suffix routes
 *           the member unless an explicit `graph` param overrides it)
 *   graph   optional member name (default `master`)
 *   agent   REQUIRED on write actions (attribution is first-class — the runner stamps `by`)
 *
 * Fail-closed at GENERATION: an action whose `input` declares a reserved envelope key
 * (id/graph/agent) or an unknown spec is refused with a named error — a colliding tool schema
 * must never reach a host. A type without a registered descriptor exposes NO tool (no phantom
 * endpoint — the R4 negative). Typed refusals from the runner (unknown action, missing agent,
 * gate-refused write) flow through AS DATA; only transport/infra failures throw.
 */
const { parseUri } = require('./store.js');

const RESERVED = { id: true, graph: true, agent: true };
const SPECS = { string: 'string', number: 'number', boolean: 'boolean', array: 'array', object: 'object' };

/** 'string' / 'string?' / 'array' / … → { schema, required } (fail-closed on an unknown spec). */
function fieldSchema( spec, type, action, name ) {
	if ( RESERVED[name] )
		throw new Error('mcp-tools: type "' + type + '" action "' + action + '" input "' + name + '" collides with a reserved envelope key (id/graph/agent)');
	const optional = /\?$/.test(String(spec));
	const base = String(spec).replace(/\?$/, '');
	if ( !SPECS[base] )
		throw new Error('mcp-tools: type "' + type + '" action "' + action + '" input "' + name + '" has an unknown spec "' + spec + '"');
	return { schema: { type: SPECS[base] }, required: !optional };
}

/** Accept a bare id or a mindsmith:// uri; the uri's member suffix routes unless `graph` overrides. */
function normalizeId( raw, explicitGraph ) {
	const s = String(raw || '');
	if ( !/^mindsmith:\/\//.test(s) ) return { id: s, graph: explicitGraph };
	const u = parseUri(s);
	return { id: u.id, graph: explicitGraph || (u.graph !== 'master' ? u.graph : undefined) };
}

/** One typed tool for one descriptor action. */
function actionTool( runtime, type, name, a ) {
	const props = {
		id: { type: 'string', description: 'instance id, or its mindsmith:// uri (a member suffix routes the graph)' },
		graph: { type: 'string', description: 'optional member graph (default master)' }
	};
	const required = ['id'];
	if ( a.write ) { props.agent = { type: 'string', description: 'who writes — stamped as `by` on every fact (attribution is first-class)' }; required.push('agent'); }
	const inputKeys = Object.keys(a.input || {});
	inputKeys.forEach(( k ) => {
		const f = fieldSchema(a.input[k], type, name, k);
		props[k] = f.schema;
		if ( f.required ) required.push(k);
	});
	return {
		name: type + '_' + name,
		description: (a.description || (a.write ? 'WRITE' : 'READ') + ' action `' + name + '` of the `' + type + '` instance type')
			+ (a.write ? ' — attributed, sequenced through the typed-action door; a gate refusal is a typed answer.' : ' — a bounded projection off the settled instance; never the whole graph.'),
		inputSchema: { type: 'object', properties: props, required },
		call: async function ( args ) {
			args = args || {};
			const t = normalizeId(args.id, args.graph);
			const actionArgs = {};
			inputKeys.forEach(( k ) => { if ( args[k] !== undefined ) actionArgs[k] = args[k]; });
			return runtime.act(t.id, name, actionArgs, { agent: args.agent, graph: t.graph });
		}
	};
}

/** The generic socle over the runtime — create/search/fork/delete/revisions/sync. */
function socleTools( runtime, typeNames ) {
	return [
		{
			name: 'instances_create',
			description: 'Create a named persistent graph instance of a registered type (' + typeNames.join(', ') + ') — returns {id, uri}. Give findability metas (title/description/tags) so it can be retrieved later by text.',
			inputSchema: { type: 'object', properties: {
				type: { type: 'string', description: 'one of: ' + typeNames.join(', ') },
				seed: { type: 'object', description: 'the type\'s create(seed) payload' },
				title: { type: 'string' }, description: { type: 'string' },
				tags: { type: 'array', items: { type: 'string' } },
				agent: { type: 'string', description: 'who creates — attributed on the manifest' }
			}, required: ['type', 'agent'] },
			call: ( a ) => runtime.create(String(a.type), {
				seed: a.seed, agent: a.agent,
				meta: { title: a.title, description: a.description, tags: a.tags }
			})
		},
		{
			name: 'instances_search',
			description: 'List/search the instance catalogue (manifest-only, never inflates a graph): free-text `q` over id/title/description/tags, `tags` ANY-of filter, `type` filter. No filters = the full list. Rows carry description+tags so you can rank.',
			inputSchema: { type: 'object', properties: {
				q: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } },
				type: { type: 'string' }, includeDeleted: { type: 'boolean' }
			} },
			call: ( a ) => runtime.search(a || {})
		},
		{
			name: 'instances_fork',
			description: 'Fork an instance into a new parented instance (isolated work; merge policy is type-level, later). Returns {id, uri} of the child.',
			inputSchema: { type: 'object', properties: {
				id: { type: 'string' }, agent: { type: 'string' }
			}, required: ['id', 'agent'] },
			call: ( a ) => runtime.fork(normalizeId(a.id).id, { agent: a.agent })
		},
		{
			name: 'instances_delete',
			description: 'Tombstone an instance (attributed; the pack is NEVER erased — no silent loss of anything learned).',
			inputSchema: { type: 'object', properties: {
				id: { type: 'string' }, agent: { type: 'string' }
			}, required: ['id', 'agent'] },
			call: async ( a ) => { const id = normalizeId(a.id).id; await runtime.delete(id, { agent: a.agent }); return { deleted: id }; }
		},
		{
			name: 'instances_revisions',
			description: 'The bounded revision view of an instance member: current rev, snapshot revs, and the last N revision atoms with their AUTHORS (who wrote what, derived from the `by` facts).',
			inputSchema: { type: 'object', properties: {
				id: { type: 'string' }, graph: { type: 'string' },
				last: { type: 'number', description: 'how many trailing revisions (default 20)' }
			}, required: ['id'] },
			call: ( a ) => { const t = normalizeId(a.id, a.graph); return runtime.revisions(t.id, { graph: t.graph, last: a.last }); }
		},
		{
			name: 'instances_sync',
			description: 'Persist an instance\'s settled state to disk NOW (the managed residency otherwise persists on eviction/close).',
			inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
			call: async ( a ) => { const id = normalizeId(a.id).id; await runtime.sync(id); return { synced: id }; }
		}
	];
}

/**
 * Generate the full instance tool surface from a runtime's registered descriptors.
 * @param w.runtime  a createRuntime instance (owns the store; placement/persistence invisible here)
 * @returns [{ name, description, inputSchema, call }] — createMcpServer-ready
 */
function instanceTools( w ) {
	if ( !w || !w.runtime ) throw new Error('instanceTools: `runtime` is required');
	const descriptors = w.runtime.descriptors();
	const typeNames = Object.keys(descriptors).sort();
	const tools = [];
	typeNames.forEach(( type ) => {
		const d = descriptors[type];
		Object.keys(d.actions || {}).forEach(( name ) => tools.push(actionTool(w.runtime, type, name, d.actions[name])) );
	});
	return tools.concat(socleTools(w.runtime, typeNames));
}

module.exports = { instanceTools };
