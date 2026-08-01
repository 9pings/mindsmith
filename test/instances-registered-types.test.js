'use strict';
/**
 * The REGISTERED instance types — the bin registers five descriptors (notepad, dialectic, plan,
 * debate, theme); this pins the promise the README makes: every advertised `<type>_<action>` tool
 * actually generates (the doc-corrosive family: a tool named in the docs must exist). Uses the same
 * require.resolve list as bin/mindsmith.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os'), path = require('path'), fs = require('fs');
const { createRuntime } = require('../lib/instances/runtime.js');
const { instanceTools } = require('../lib/instances/mcp-tools.js');

const DESCRIPTORS = {
	notepad  : require.resolve('skynet-graph/plugins/notepad/descriptor.js'),
	dialectic: require.resolve('skynet-graph/plugins/critical-mind/descriptor.js'),
	plan     : require.resolve('skynet-graph/plugins/planner/descriptor.js'),
	debate   : require.resolve('skynet-graph/plugins/debate/descriptor.js'),
	theme    : require.resolve('skynet-graph/plugins/theme/descriptor.js'),
};

test('the five registered types generate their advertised tools (40 = 34 typed + 6 socle)', async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-types-'));
	const rt = createRuntime({ dir, descriptors: DESCRIPTORS });
	try {
		const names = instanceTools({ runtime: rt }).map(( t ) => t.name );
		assert.equal(names.length, 40, 'the full surface: 34 generated + the 6-socle');
		// the tools the README advertises by name — each must exist (doc-corrosive guard)
		for ( const t of [
			'notepad_note', 'dialectic_brief', 'plan_setGivens',
			'debate_cut', 'debate_mergeInto', 'debate_disputeMerge', 'debate_prevalence',
			'theme_attach', 'theme_mergeStories', 'theme_disputeMerge', 'theme_membership', 'theme_orphans',
			'instances_create', 'instances_revisions',
		] ) assert.ok(names.includes(t), t + ' generated');
	}
	finally { await rt.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('theme e2e through the runtime — attach witnessed, merge non-destructive, dispute reverts, pack persists', async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-theme-'));
	const rt = createRuntime({ dir, descriptors: { theme: DESCRIPTORS.theme } });
	try {
		const { id } = await rt.create('theme', { seed: { label: 'newsroom', stories: [
			{ id: 'st-a', label: 'A' }, { id: 'st-b', label: 'B' },
		] }, agent: 'boot' });
		// the witnessed gate holds through the service too
		const bare = await rt.act(id, 'attach', { subject: 's1', story: 'st-a', reason: 'r' }, { agent: 'pipeline' });
		assert.equal(bare.refused, true);
		assert.match(bare.reason, /witness/);
		await rt.act(id, 'attach', { subject: 's1', story: 'st-a', witness: { sim: 0.9 }, reason: 'r' }, { agent: 'pipeline' });
		await rt.act(id, 'mergeStories', { from: 'st-a', to: 'st-b', witness: { sim: 0.95 }, reason: 'dup' }, { agent: 'merger' });
		assert.equal((await rt.act(id, 'membership', { subject: 's1' })).effectiveStory, 'st-b', 'follows the chain');
		await rt.act(id, 'disputeMerge', { story: 'st-a', reason: 'distinct' }, { agent: 'editor' });
		assert.equal((await rt.act(id, 'membership', { subject: 's1' })).effectiveStory, 'st-a', 'reverted through the readout');
		// the pack persists — a FRESH runtime on the same dir (a true cold boot) reads the same state
		await rt.sync(id);
		await rt.close();
		const rt2 = createRuntime({ dir, descriptors: { theme: DESCRIPTORS.theme } });
		try { assert.equal((await rt2.act(id, 'membership', { subject: 's1' })).effectiveStory, 'st-a', 'cold reopen: same state'); }
		finally { await rt2.close(); }
	}
	finally { await rt.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
