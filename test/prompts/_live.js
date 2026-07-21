#!/usr/bin/env node
'use strict';
/*
 * Copyright 2026 Nathanael Braun <pp9ping@gmail.com>
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
/**
 * LIVE prompt-collection driver (GPU/model = owner-gated; see README.md here).
 *
 *   LLM_BASE=http://127.0.0.1:8080/v1 node test/prompts/_live.js [file.md ...] [--max-turns 8]
 *
 * A minimal react-style loop: the model (any OpenAI-compatible endpoint — llama-server, or
 * `mindsmith serve` itself) receives the tool list + the file's prose prompt, answers each turn
 * with EITHER a tool call (last line `TOOL: {"tool":"...","args":{...}}`) or `FINISH: <answer>`;
 * tool calls execute against the REAL in-process MCP dispatcher (the same assembly `mindsmith mcp`
 * serves, wired to the same LLM_BASE for critiqueAsk), and the file's bars are asserted on the
 * live trace + final text. Reason-first parse (the LAST matching line wins) — small models think
 * out loud above the line. A live pass is a SMOKE of the surface, never a benchmark.
 */
const path = require('path');
const { parsePromptFile, listPromptFiles, askText, buildServer, callTool, checkBars } = require('./_runner.js');

const BASE = process.env.LLM_BASE;
const MODEL = process.env.LLM_MODEL || 'default';
const args = process.argv.slice(2);
const maxTurns = Number((args.find(( a, i ) => args[i - 1] === '--max-turns')) || 8);
const files = args.filter(( a ) => a.endsWith('.md'));

async function chat( messages, opts ) {
	// forward the ask envelope's decode params — a tool that requests temperature 0.7 (sc path
	// diversity) or a token budget DESIGNED those values; flattening them to the driver's defaults
	// changes the tool's semantics (paid live 07-21: temp0-greedy fell into a no-ANSWER-line basin,
	// which the C6 answer cache then pinned for every later run).
	opts = opts || {};
	const body = { model: MODEL, messages, temperature: opts.temperature != null ? opts.temperature : 0 };
	if ( opts.maxTokens != null ) body.max_tokens = opts.maxTokens;
	const res = await fetch(BASE.replace(/\/$/, '') + '/chat/completions', {
		method: 'POST', headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	});
	if ( !res.ok ) throw new Error('LLM_BASE ' + res.status + ': ' + (await res.text()).slice(0, 200));
	const j = await res.json();
	return j.choices[0].message.content || '';
}

function lastDirective( text ) {
	const lines = String(text).split('\n').map(( l ) => l.trim()).filter(Boolean);
	for ( let i = lines.length - 1; i >= 0; i-- ) {
		if ( /^FINISH:/.test(lines[i]) ) return { finish: lines[i].replace(/^FINISH:\s*/, '') };
		if ( /^TOOL:/.test(lines[i]) ) {
			try { return { tool: JSON.parse(lines[i].replace(/^TOOL:\s*/, '')) }; }
			catch ( e ) { return { parseError: lines[i] }; }
		}
	}
	return { none: true };                                            // no directive — the loop re-asks (never a silent fake FINISH)
}

async function runLive( parsed ) {
	const ask = async ( p ) => chat([{ role: 'user', content: askText(p) }], { temperature: p && p.temperature, maxTokens: p && p.maxTokens });
	const server = buildServer({ critiqueAsk: ask });
	const toolDocs = server.tools.map(( t ) => '- ' + t.name + ' ' + JSON.stringify(t.inputSchema && t.inputSchema.properties || {})).join('\n');
	const messages = [{
		role: 'user',
		content: 'You can call these tools. To call one, end your message with exactly one line:\n' +
			'TOOL: {"tool":"<name>","args":{<the tool\'s input fields>}}\n' +
			'Example: TOOL: {"tool":"some_tool","args":{"question":"what is 6*7?"}}\n' +
			'Keep TOOL args COMPACT (required fields only — one short line; tools fill in the rest themselves).\n' +
			'If a TOOL RESULT is an error or a refusal, FIX the call and try again — never FINISH with the error.\n' +
			'When you have the answer, end with one line: FINISH: <your answer>\n\nTools:\n' + toolDocs +
			'\n\nTask:\n' + parsed.prompt
	}];
	const trace = [];
	let finalText = null, id = 0, noneCount = 0;
	for ( let turn = 0; turn < maxTurns && finalText == null; turn++ ) {
		// generous EXPLICIT turn budget — a critique/plan TOOL line legitimately carries long args; an
		// implicit backend default silently truncating the JSON mid-line is the no-silent-caps bug class
		// (paid live 07-21: a perfect critique call was cut → "unparsable" → the model spiraled).
		const reply = await chat(messages, { maxTokens: 1600 });
		messages.push({ role: 'assistant', content: reply });
		if ( process.env.LIVE_DEBUG ) console.error('   [turn] ' + JSON.stringify(reply).slice(0, 500));
		const d = lastDirective(reply);
		if ( d.finish !== undefined ) { finalText = d.finish; break; }
		if ( d.none ) {
			// the smoke tests the SURFACE, not the host model's prefix discipline (paid both ways live
			// 07-21: a silent fake-FINISH on garbage, THEN a nudge loop that derailed a perfect answer).
			// If work was already done (≥1 tool call) — or the model ignored one concrete nudge — the
			// free-text reply IS its answer: accept it as final, provenance ANNOUNCED.
			if ( trace.length || noneCount++ ) {
				finalText = reply.trim();
				console.error('   [fallback] no FINISH directive — free-text reply accepted as final (announced)');
				break;
			}
			messages.push({ role: 'user', content: 'Reply now with one line: FINISH: <your answer>' });
			continue;
		}
		// the feedback must NOT contain a TOOL-shaped string — a small host model PARROTS it into its
		// next call (paid live 07-21: an example with braces spawned an 8-turn "search" loop).
		if ( d.parseError ) { messages.push({ role: 'user', content: 'Your TOOL line was invalid JSON — it was probably cut mid-line. Call the tool again with SHORTER args: required fields only.' }); continue; }
		const r = await callTool(server, ++id, d.tool.tool, d.tool.args);
		trace.push({ tool: d.tool.tool, args: d.tool.args, result: r });   // args IN the trace (§3.6 : la trace montre l'appel — payé : « Question: undefined » invisible)
		messages.push({ role: 'user', content: 'TOOL RESULT (' + d.tool.tool + '):\n' + JSON.stringify(r).slice(0, 4000) });
	}
	if ( finalText == null ) return { failures: ['no FINISH within ' + maxTurns + ' turns'], trace };
	return { failures: checkBars(parsed.meta.bars, trace, finalText), trace, finalText };
}

(async function main() {
	if ( !BASE ) { console.error('LLM_BASE is required (an OpenAI-compatible endpoint). This driver is model-live by design.'); process.exit(2); }
	const targets = (files.length ? files : listPromptFiles(__dirname)).map(parsePromptFile)
		.filter(( p ) => (p.meta.modes || []).includes('live'));
	let red = 0;
	for ( const parsed of targets ) {
		console.error('── live: ' + parsed.name);
		const r = await runLive(parsed);
		(r.trace || []).forEach(( t ) => console.error('   call ' + t.tool + ' ' + JSON.stringify(t.args) + ' → ' + JSON.stringify(t.result).slice(0, 160)));
		if ( r.finalText != null ) console.error('   final: ' + String(r.finalText).slice(0, 200));
		if ( r.failures.length ) { red++; r.failures.forEach(( f ) => console.error('   ✗ ' + f)); }
		else console.error('   ✓ all bars pass');
	}
	console.error(red ? 'LIVE: ' + red + ' file(s) red' : 'LIVE: all green');
	process.exit(red ? 1 : 0);
})().catch(( e ) => { console.error('DRIVER ERROR: ' + e.message); process.exit(2); });
