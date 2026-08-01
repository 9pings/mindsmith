/*
 * Copyright 2026 Nathanael Braun <pp9ping@gmail.com>
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * `mindsmith doctor` — the onboarding diagnostic (launch levier 4). Answers, in one screen,
 * the questions every cold-start stumbles on: is the engine there, can a gguf reach the GPU,
 * where is my room, is the port free, do I have an escalation?
 *
 * Doctrine: a check never guesses and never fixes — it REPORTS, and a non-ok check NAMES the
 * fix (the same contract as the tool refusals: data, not errors). Nothing here loads a model,
 * binds a public socket, or writes anything: doctor is safe to run anywhere, repeatedly.
 *
 * Statuses: 'ok' · 'warn' (works, but a named condition will bite later) · 'fail' (this run
 * cannot work until the named fix). Exit code: 1 iff any 'fail'.
 */
const fs = require('fs');
const net = require('net');
const path = require('path');
const { execFileSync } = require('child_process');

const WSL_LIB = '/usr/lib/wsl/lib';

function isWSL () {
	try { return /microsoft/i.test(fs.readFileSync('/proc/version', 'utf8')); }
	catch ( e ) { return false; }
}

function check ( id, status, detail, fix ) { return fix ? { id, status, detail, fix } : { id, status, detail }; }

/** every check; `opts` = { env, roomDir, port, escalation: {kind}|null, configPath, configError } */
function runChecks ( opts ) {
	const env = opts.env || process.env;
	const out = [];

	// node — the engine floor is 18
	const major = Number(process.versions.node.split('.')[0]);
	out.push(major >= 18
		? check('node', 'ok', 'node ' + process.versions.node)
		: check('node', 'fail', 'node ' + process.versions.node + ' — the engine needs >= 18', 'install Node 18+ (nodejs.org, nvm, or your distro)'));

	// engine — resolvable + version
	try {
		const eng = require('skynet-graph/package.json');
		out.push(check('engine', 'ok', 'skynet-graph ' + eng.version));
	}
	catch ( e ) {
		out.push(check('engine', 'fail', 'skynet-graph is not resolvable', 'npm install (mindsmith depends on it — a broken install is the usual cause)'));
	}

	// local runtime — only needed to LOAD a gguf in-process
	let hasLlama = false;
	try { require.resolve('node-llama-cpp'); hasLlama = true; }
	catch ( e ) {}
	out.push(hasLlama
		? check('local-runtime', 'ok', 'node-llama-cpp installed (embedded gguf available)')
		: check('local-runtime', 'warn', 'node-llama-cpp not installed — embedded gguf modes (--model, FRONTIER_MODEL=<gguf>, LOCAL_MODEL) will refuse',
			'npm install node-llama-cpp   (prebuilt, no compile; skip if you only use LLM_BASE / --routing endpoints)'));

	// gpu — WSL's silent-CPU trap first, then whether a GPU is visible at all
	const wsl = isWSL();
	if ( wsl ) {
		const ld = String(env.LD_LIBRARY_PATH || '');
		out.push(ld.split(':').indexOf(WSL_LIB) !== -1
			? check('gpu-wsl', 'ok', 'WSL detected, LD_LIBRARY_PATH carries ' + WSL_LIB)
			: check('gpu-wsl', 'warn', 'WSL detected and LD_LIBRARY_PATH misses ' + WSL_LIB + ' — a gguf will SILENTLY run on CPU',
				'export LD_LIBRARY_PATH=/usr/lib/wsl/lib:/usr/lib/x86_64-linux-gnu'));
	}
	try {
		const smi = execFileSync('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader'],
			{ encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n')[0];
		out.push(check('gpu', 'ok', smi));
	}
	catch ( e ) {
		out.push(check('gpu', 'warn', 'nvidia-smi not answering — no NVIDIA GPU visible from here',
			'CPU still works (slow); on WSL check the Windows driver; non-NVIDIA GPUs: --gpu metal|vulkan'));
	}

	// room — the same resolution as serve/mcp/rooms
	const roomDir = opts.roomDir;
	if ( fs.existsSync(roomDir) ) {
		let n = 0;
		try { n = fs.readdirSync(roomDir).filter(( f ) => /\.sgc$/.test(f) ).length; } catch ( e ) {}
		out.push(check('room', 'ok', path.resolve(roomDir) + ' — ' + n + ' .sgc stock' + (n === 1 ? '' : 's')
			+ (n ? '' : ' (empty is fine: import one, or forge one: sg forge …)')));
	}
	else out.push(check('room', 'warn', 'room dir ' + path.resolve(roomDir) + ' does not exist yet',
		'it is created on first import: mindsmith rooms import <f.sgc>  (or set rooms.dir in ~/.mindsmith/config.json)'));

	// config — absent is a clean default, broken is a fail
	if ( opts.configError )
		out.push(check('config', 'fail', opts.configPath + ' does not parse: ' + opts.configError, 'fix the JSON (or move the file away — defaults work without it)'));
	else if ( opts.configPath )
		out.push(check('config', 'ok', opts.configPath));
	else out.push(check('config', 'ok', 'no config file — built-in defaults (fine); ~/.mindsmith/config.json to pin models/rooms once'));

	// escalation — the serve/mcp precondition, resolved with the SAME precedence
	out.push(opts.escalation
		? check('escalation', 'ok', opts.escalation.detail || opts.escalation.kind)
		: check('escalation', 'warn', 'no escalation configured — `serve` and `mcp` will refuse at start',
			'one of: --routing <config.json> | FRONTIER_MODEL=<path.gguf> | LLM_BASE=<url> | defaults.escalation in ~/.mindsmith/config.json'));

	return out;
}

/** the port probe is async (a real bind on 127.0.0.1) — separated so runChecks stays sync. */
function checkPort ( port ) {
	return new Promise(( resolve ) => {
		const srv = net.createServer();
		srv.once('error', ( e ) => resolve(check('port', 'warn', 'port ' + port + ' is already in use (' + e.code + ')',
			'another serve is running there — pick one: --port <N>, or reuse the running instance')));
		srv.once('listening', () => srv.close(() => resolve(check('port', 'ok', 'port ' + port + ' is free'))));
		srv.listen(port, '127.0.0.1');
	});
}

const ICONS = { ok: '✓', warn: '!', fail: '✗' };

function render ( checks ) {
	const w = Math.max.apply(null, checks.map(( c ) => c.id.length ));
	return checks.map(( c ) => '  ' + ICONS[c.status] + ' ' + c.id.padEnd(w) + '  ' + c.detail
		+ (c.fix ? '\n    ' + ' '.repeat(w) + '→ ' + c.fix : '')).join('\n');
}

async function doctor ( opts ) {
	const checks = runChecks(opts);
	checks.push(await checkPort(opts.port));
	return { checks, ok: !checks.some(( c ) => c.status === 'fail' ) };
}

module.exports = { doctor, runChecks, checkPort, render, isWSL };
