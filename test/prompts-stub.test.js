'use strict';
/**
 * The prompt collection, scripted mode (0-GPU CI coverage — see test/prompts/README.md).
 * Every prompts/*.md with a `stub` section runs its declared call sequence against the REAL
 * in-process MCP dispatcher (the same `defaultTools` assembly `mindsmith mcp` serves) with the
 * file's scripted model, and its bars are asserted on the real results. Files without a stub
 * section are SKIPPED with their declared reason printed — never silently.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { parsePromptFile, listPromptFiles, runStub } = require('./prompts/_runner.js');

const DIR = path.join(__dirname, 'prompts');
const files = listPromptFiles(DIR);

test('the collection is not empty and every file parses (front-matter + prompt + bars)', () => {
	assert.ok(files.length >= 2, 'at least two prompt files');
	for ( const f of files ) {
		const p = parsePromptFile(f);
		assert.ok(p.prompt.length > 10, p.name + ': carries a real prose prompt');
		assert.ok(Array.isArray(p.meta.bars) && p.meta.bars.length, p.name + ': declares bars');
		assert.ok(Array.isArray(p.meta.modes) && p.meta.modes.length, p.name + ': declares modes');
	}
});

for ( const f of files ) {
	const parsed = parsePromptFile(f);
	test('prompt: ' + parsed.name + ' [' + (parsed.meta.modes || []).join('+') + ']', async () => {
		const r = await runStub(parsed);
		if ( r.skipped ) {
			assert.ok(r.reason, parsed.name + ': a skipped file must declare why');
			console.error('  SKIPPED (live-only): ' + parsed.name + ' — ' + String(r.reason).slice(0, 120));
			return;
		}
		assert.deepEqual(r.failures, [], parsed.name + ': all bars pass');
	});
}

test('NEGATIVE (the checker is not vacuous): a wrong bar fails, an unmatched scripted prompt throws', async () => {
	const parsed = parsePromptFile(path.join(DIR, 'self-consistency-vote.md'));
	// sabotage 1: flip a bar to an impossible expectation → must FAIL
	const bad = JSON.parse(JSON.stringify(parsed));
	bad.meta.bars = [{ call: 'self_consistency', match: '"verdict":"999"' }];
	const r = await runStub(bad);
	assert.ok(r.failures.length === 1 && /verdict.*999/.test(r.failures[0]), 'the impossible bar is RED');
	// sabotage 2: remove the scripted replies. The sc tool CATCHES ask rejections by design
	// (a failed path = a counted abstention, never a wedge) — so the run resolves, but the
	// starved script can never silently pass: the pool is all-abstained/typed-error and the
	// file's real bars go RED.
	const starved = JSON.parse(JSON.stringify(parsed));
	starved.meta.stub.replies = [];
	const s = await runStub(starved);
	assert.ok(s.failures.length >= 1, 'a starved script cannot pass the real bars');
	assert.match(JSON.stringify(s.trace), /"abstained":5/, 'every path is a COUNTED abstention (typed, never silent)');
});
