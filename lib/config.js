'use strict';
/*
 * Copyright 2026 Nathanael Braun <pp9ping@gmail.com>
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
/**
 * The persistent config (owner 07-18) — default ggufs / LLM servers under COMMON NORMALIZED
 * ALIASES + timeouts and other confs, so a machine is configured ONCE and every `mindsmith`
 * invocation (and MCP registration) finds its models without flags.
 *
 *   ~/.mindsmith/config.json          the persistent home config
 *   --config <file> | $MINDSMITH_CONFIG   explicit override of WHICH file (typed error if
 *                                     missing/corrupt — a written config is never silently ignored;
 *                                     an ABSENT home file is simply an empty config)
 *
 * Value precedence stays: CLI flags > env > this file > built-in defaults (the bin wires it as
 * the lowest source; this module is pure — file in, resolver out).
 *
 *   { "models": {                                  // the normalized aliases
 *       "local":    { "model": "~/models/q2.gguf" },              // a gguf on disk
 *       "frontier": { "base": "http://…/v1", "model": "…", "key": "…" },   // an OpenAI-compatible server
 *       "judge":    { "alias": "local" } },                       // links follow (bounded, cycle = typed error)
 *     "defaults":  { "model": "local", "escalation": "frontier", "local": "local" },
 *     "timeouts":  { "askMs": 120000, "idleTTLMs": 300000, "thinkBudget": 1024 },
 *     "instances": { "dir": "~/.mindsmith/instances", "placement": "worker" },
 *     "rooms":     { "dir": "~/.mindsmith/rooms" } }
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

function loadConfig( o ) {
	o = o || {};
	const argv = o.argv || [];
	const env = o.env || process.env;
	const homedir = o.homedir || os.homedir();
	const i = argv.indexOf('--config');
	const explicit = (i !== -1 ? argv[i + 1] : undefined) || env.MINDSMITH_CONFIG;
	const file = explicit || path.join(homedir, '.mindsmith', 'config.json');

	let raw = {};
	if ( explicit && !fs.existsSync(file) )
		throw new Error('mindsmith config: ' + file + ' does not exist (explicitly requested via --config/$MINDSMITH_CONFIG)');
	if ( fs.existsSync(file) ) {
		try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); }
		catch ( e ) { throw new Error('mindsmith config: parse error in ' + file + ' — ' + e.message); }
	}

	const untilde = ( p ) => (typeof p === 'string' && p[0] === '~') ? path.join(homedir, p.slice(2 - (p[1] === '/' ? 1 : 1))) : p;

	function get( dotted, fallback ) {
		let cur = raw;
		for ( const k of String(dotted).split('.') ) {
			if ( cur == null || typeof cur !== 'object' ) return fallback;
			cur = cur[k];
		}
		return cur === undefined ? fallback : cur;
	}

	/**
	 * Resolve a model alias to a normalized backend spec:
	 *   { kind:'gguf', modelPath }  |  { kind:'server', base, model, key }  |  null (unknown alias)
	 */
	function resolveModel( alias ) {
		const models = raw.models || {};
		const seen = new Set();
		let cur = alias;
		while ( true ) {
			if ( seen.has(cur) ) throw new Error('mindsmith config: model alias cycle at "' + cur + '" (' + [...seen].join(' → ') + ')');
			seen.add(cur);
			const m = models[cur];
			if ( !m ) return null;
			if ( m.alias ) { cur = m.alias; continue; }
			if ( m.model && !m.base ) return { kind: 'gguf', modelPath: untilde(m.model) };
			if ( m.base ) return { kind: 'server', base: m.base, model: m.model || 'default', key: m.key };
			throw new Error('mindsmith config: model "' + cur + '" needs `model` (gguf path) or `base` (server url)');
		}
	}

	return { raw, file, get, resolveModel, untilde };
}

module.exports = { loadConfig };
