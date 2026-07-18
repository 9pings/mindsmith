'use strict';
/*
 * Copyright 2026 Nathanael Braun <pp9ping@gmail.com>
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
/**
 * Prompt-collection runner (see README.md here for the format + doctrine).
 *
 * The interface under test is the REAL MCP dispatcher — `createMcpServer({tools: defaultTools(wiring)})`
 * from skynet-graph, the exact assembly `bin/mindsmith mcp` serves — driven in-process via
 * `server.handle(jsonrpc)` (a pure function; no pipe, no sosie). Stub mode swaps ONLY the model
 * behind the wiring (`critiqueAsk`) for the file's scripted replies.
 */
const fs = require('fs');
const path = require('path');
const { createMcpServer, defaultTools } = require('skynet-graph/lib/sg/mcp.js');

/** Parse a prompt file: `---json\n{...}\n---\n<prose prompt>`. */
function parsePromptFile( file ) {
	const raw = fs.readFileSync(file, 'utf8');
	const m = raw.match(/^---json\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
	if ( !m ) throw new Error(file + ': missing ---json front-matter block');
	const meta = JSON.parse(m[1]);
	return { name: path.basename(file, '.md'), meta, prompt: m[2].trim(), file };
}

function listPromptFiles( dir ) {
	return fs.readdirSync(dir).filter(( f ) => f.endsWith('.md') && f !== 'README.md')
		.map(( f ) => path.join(dir, f)).sort();
}

/** critiqueAsk receives either a string or a {system, user, …} envelope — extract the text. */
function askText( prompt ) {
	if ( prompt == null ) return '';
	if ( typeof prompt === 'string' ) return prompt;
	return [prompt.system, prompt.user, prompt.prompt].filter(Boolean).join('\n');
}

/** The scripted model: ordered {match, reply}; first unconsumed match wins; no match = THROW. */
function scriptedAsk( replies ) {
	const pool = (replies || []).map(( r ) => ({ re: new RegExp(r.match), reply: r.reply, used: false }));
	const fn = async function ( prompt ) {
		const p = askText(prompt);
		const hit = pool.find(( r ) => !r.used && r.re.test(p));
		if ( !hit ) throw new Error('scripted model: no unconsumed reply matches this prompt (fail loud): ' + p.slice(0, 160));
		hit.used = true;
		return hit.reply;
	};
	fn.leftover = () => pool.filter(( r ) => !r.used).length;
	return fn;
}

function buildServer( wiring ) {
	return createMcpServer({ tools: defaultTools(wiring), serverInfo: { name: 'mindsmith-prompt-tests', version: '0' } });
}

/** Execute one tool call through the real JSON-RPC surface; returns the parsed result. */
async function callTool( server, id, tool, args ) {
	const resp = await server.handle({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: tool, arguments: args || {} } });
	if ( resp && resp.error ) return { __rpcError: resp.error };
	// MCP result: content[0].text carries the JSON payload for these tools
	const c = resp && resp.result && resp.result.content;
	const text = c && c[0] && c[0].text;
	try { return JSON.parse(text); } catch ( e ) { return { __text: text }; }
}

/** Assert the file's bars against a trace [{tool, result}] (+ finalText for live). Returns failures[]. */
function checkBars( bars, trace, finalText ) {
	const failures = [];
	const lastOf = ( tool ) => { const t = trace.filter(( x ) => x.tool === tool); return t.length ? t[t.length - 1] : null; };
	(bars || []).forEach(( b, i ) => {
		const label = 'bar#' + (i + 1) + (b.why ? ' (' + b.why + ')' : '');
		if ( b.never ) { if ( trace.some(( t ) => t.tool === b.never) ) failures.push(label + ': tool ' + b.never + ' was called'); return; }
		if ( b.final ) {
			if ( finalText == null ) return;                                  // live-only bar, ignored in stub
			if ( !new RegExp(b.final).test(finalText) ) failures.push(label + ': final does not match /' + b.final + '/');
			return;
		}
		const t = lastOf(b.call);
		if ( !t ) { failures.push(label + ': tool ' + b.call + ' was never called'); return; }
		const json = JSON.stringify(t.result);
		if ( b.match && !new RegExp(b.match).test(json) ) failures.push(label + ': /' + b.match + '/ not in ' + json.slice(0, 300));
		if ( b.absent && new RegExp(b.absent).test(json) ) failures.push(label + ': forbidden /' + b.absent + '/ present');
	});
	return failures;
}

/** Stub mode: run the file's declared call sequence on the real server + scripted model. */
async function runStub( parsed, extraWiring ) {
	if ( !(parsed.meta.modes || []).includes('stub') || !parsed.meta.stub )
		return { skipped: true, reason: parsed.meta['why-no-stub'] || 'no stub section' };
	const ask = scriptedAsk(parsed.meta.stub.replies);
	const server = buildServer({ critiqueAsk: ask, ...(extraWiring || {}) });
	const trace = [];
	let id = 0;
	for ( const c of (parsed.meta.stub.calls || []) )
		trace.push({ tool: c.tool, result: await callTool(server, ++id, c.tool, c.args) });
	const failures = checkBars(parsed.meta.bars, trace, null);
	if ( ask.leftover() ) failures.push('scripted model: ' + ask.leftover() + ' reply(ies) never consumed (the script over-declares)');
	return { skipped: false, trace, failures };
}

module.exports = { parsePromptFile, listPromptFiles, askText, scriptedAsk, buildServer, callTool, checkBars, runStub };
