'use strict';
/**
 * R4 — the MCP tools GENERATED from the type descriptors (lib/instances/mcp-tools.js), riding
 * the RUNTIME (residency, managed persistence) — never the raw store.
 *
 * PRE-REGISTERED BARS (roadmap R4):
 *  GO        one tool per typed action (`<type>_<action>`, inputSchema derived from `input`,
 *            + id/graph envelope, + agent REQUIRED on writes) + the generic socle
 *            `instances_{create,search,fork,delete,revisions,sync}`; dispatch works through the
 *            REAL MCP JSON-RPC server; `by` attribution propagates end-to-end (a note written
 *            via the tool surfaces its writer in recall AND in revisions' atom authors).
 *  NEGATIVE  a type without a registered descriptor exposes NO tool (no phantom endpoint);
 *            a write call without `agent` is a TYPED refusal (data, not a throw);
 *            a descriptor whose `input` collides with the envelope keys (id/graph/agent) is
 *            REFUSED at generation time (fail-closed, named).
 *  WORKER    the same dispatch works under placement:'worker' (the MCP layer is placement-
 *            agnostic by construction — it only talks to the runtime).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRuntime } = require('../lib/instances/runtime.js');
const { instanceTools } = require('../lib/instances/mcp-tools.js');
const { createMcpServer } = require('skynet-graph/lib/sg/mcp.js');

const NOTEPAD_PATH = require.resolve('skynet-graph/plugins/notepad/descriptor.js');
const DIALECTIC_PATH = require.resolve('skynet-graph/plugins/critical-mind/descriptor.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sgp-mcp-'));
const CLOCK = () => 1750000000000;
const mkRuntime = ( opts ) => createRuntime({
	dir: tmp(), descriptors: { notepad: NOTEPAD_PATH }, clock: CLOCK, sweepIntervalMs: 0, ...(opts || {})
});

/** Drive one tool through the REAL JSON-RPC dispatcher (the exact surface `mindsmith mcp` serves). */
async function call( server, id, tool, args ) {
	const resp = await server.handle({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: tool, arguments: args || {} } });
	if ( resp.result && resp.result.isError ) return { __toolError: resp.result.content[0].text };
	return resp.result.structuredContent;
}

test('GO generation: one typed tool per action + the socle; schemas derive from `input`; agent required on writes only', () => {
	const rt = mkRuntime({ descriptors: { notepad: NOTEPAD_PATH, dialectic: DIALECTIC_PATH } });
	const tools = instanceTools({ runtime: rt });
	const names = tools.map(( t ) => t.name );

	for ( const n of ['notepad_note', 'notepad_recall',
		'dialectic_addArguments', 'dialectic_addViewpoint', 'dialectic_verdict', 'dialectic_state', 'dialectic_brief',
		'instances_create', 'instances_search', 'instances_fork', 'instances_delete', 'instances_revisions', 'instances_sync'] )
		assert.ok(names.includes(n), n + ' is exposed');

	const note = tools.find(( t ) => t.name === 'notepad_note' );
	assert.deepEqual(note.inputSchema.required.sort(), ['agent', 'id', 'text'], 'write: id + agent + the action input are required');
	assert.equal(note.inputSchema.properties.text.type, 'string', 'the input spec drives the schema');
	const recall = tools.find(( t ) => t.name === 'notepad_recall' );
	assert.deepEqual(recall.inputSchema.required, ['id'], 'read: no agent required');
	const vp = tools.find(( t ) => t.name === 'dialectic_addViewpoint' );
	assert.ok(vp.inputSchema.required.includes('text') && !vp.inputSchema.required.includes('side'),
		"'string?' input spec = optional field");
	rt.close();
});

test('GO dispatch through the real MCP server: create → note[A] → note[B] → recall — `by` propagates; search/fork/revisions/delete work', async () => {
	const rt = mkRuntime();
	const server = createMcpServer({ tools: instanceTools({ runtime: rt }), serverInfo: { name: 't', version: '0' } });
	let n = 0;

	const made = await call(server, ++n, 'instances_create', { type: 'notepad', seed: { title: 'debate log' }, agent: 'agentA', title: 'Coffee notes', tags: ['debate'] });
	assert.equal(made.id, 'notepad-1');
	assert.equal(made.uri, 'mindsmith://notepad/notepad-1');

	assert.deepEqual(await call(server, ++n, 'notepad_note', { id: made.id, text: 'sweet+salty works', agent: 'agentA' }),
		{ ok: true, action: 'note', by: 'agentA' }, 'the write acks its attribution');
	await call(server, ++n, 'notepad_note', { id: made.uri, text: 'texture is the issue', agent: 'agentB' });   // uri form accepted
	const r = await call(server, ++n, 'notepad_recall', { id: made.id });
	assert.deepEqual(r.notes.map(( x ) => x.by ), ['agentA', 'agentB'], 'BY PROPAGATED end-to-end (the R4 GO)');

	const rows = await call(server, ++n, 'instances_search', { q: 'coffee' });
	assert.equal(rows.length, 1, 'findable by text through the tool');
	assert.equal(rows[0].id, 'notepad-1');

	const revs = await call(server, ++n, 'instances_revisions', { id: made.id });
	assert.ok(revs.current >= 1, 'revisions expose the current rev');
	const authors = new Set(revs.revisions.flatMap(( x ) => x.by ));
	assert.ok(authors.has('agentA') && authors.has('agentB'), 'the atom authors surface in revisions');

	const fk = await call(server, ++n, 'instances_fork', { id: made.id, agent: 'agentC' });
	assert.equal(fk.id, 'notepad-2', 'fork mints a parented instance');

	await call(server, ++n, 'instances_sync', { id: made.id });
	const del = await call(server, ++n, 'instances_delete', { id: fk.id, agent: 'agentA' });
	assert.equal(del.deleted, fk.id);
	assert.equal((await call(server, ++n, 'instances_search', {})).length, 1, 'the tombstoned fork is hidden');
	await rt.close();
});

test('NEGATIVE: no phantom endpoint — only registered descriptors generate tools', () => {
	const rt = mkRuntime();                                  // notepad ONLY
	const names = instanceTools({ runtime: rt }).map(( t ) => t.name );
	assert.ok(!names.some(( x ) => /^dialectic_/.test(x) ), 'an unregistered type exposes nothing');
	rt.close();
});

test('NEGATIVE: a write without agent is a TYPED refusal (data), not a throw', async () => {
	const rt = mkRuntime();
	const server = createMcpServer({ tools: instanceTools({ runtime: rt }), serverInfo: { name: 't', version: '0' } });
	const made = await call(server, 1, 'instances_create', { type: 'notepad', seed: {}, agent: 'A' });
	const r = await call(server, 2, 'notepad_note', { id: made.id, text: 'anonymous' });
	assert.equal(r.refused, true);
	assert.match(r.reason, /agent/i, 'the refusal names the missing attribution');
	await rt.close();
});

test('NEGATIVE: an input spec colliding with the envelope keys is refused at GENERATION (fail-closed, named)', () => {
	const bad = {
		type: 'clash', version: '1.0.0', conceptSets: [],
		create: () => [{ $$_id: 'x', X: true }],
		actions: { hit: { write: true, input: { agent: 'string' }, apply: () => [{ $$_id: 'x', hit: true }] } }
	};
	const rt = mkRuntime({ descriptors: { notepad: NOTEPAD_PATH, clash: bad } });
	assert.throws(() => instanceTools({ runtime: rt }), /clash.*hit.*agent.*reserved/s);
	rt.close();
});

test('WORKER: the same dispatch under placement:worker — the MCP layer is placement-agnostic', async () => {
	const rt = mkRuntime({ placement: 'worker' });
	const server = createMcpServer({ tools: instanceTools({ runtime: rt }), serverInfo: { name: 't', version: '0' } });
	const made = await call(server, 1, 'instances_create', { type: 'notepad', seed: { title: 'w' }, agent: 'A' });
	await call(server, 2, 'notepad_note', { id: made.id, text: 'from the worker', agent: 'agentW' });
	const r = await call(server, 3, 'notepad_recall', { id: made.id });
	assert.deepEqual(r.notes.map(( x ) => [x.text, x.by] ), [['from the worker', 'agentW']]);
	const revs = await call(server, 4, 'instances_revisions', { id: made.id });
	assert.ok(revs.revisions.some(( x ) => x.by.includes('agentW') ), 'revision authors cross the thread boundary');
	await rt.close();
});
