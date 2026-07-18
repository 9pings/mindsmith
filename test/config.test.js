'use strict';
/**
 * The persistent config (owner 07-18): ~/.mindsmith/config.json + `--config <file>` /
 * $MINDSMITH_CONFIG — default ggufs / LLM servers under COMMON NORMALIZED ALIASES (local,
 * frontier, judge, …) + timeouts and other confs. Pure resolver (lib/config.js), the bin wires it
 * as the LOWEST precedence source: flags > env > config file > built-in defaults.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadConfig } = require('../lib/config.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ms-cfg-'));
function homeWith( cfg ) {
	const home = tmp();
	fs.mkdirSync(path.join(home, '.mindsmith'));
	fs.writeFileSync(path.join(home, '.mindsmith', 'config.json'), JSON.stringify(cfg));
	return home;
}

test('resolution order: --config > $MINDSMITH_CONFIG > ~/.mindsmith/config.json; missing home file = empty config', () => {
	const home = homeWith({ timeouts: { askMs: 111 } });
	const envFile = path.join(tmp(), 'env.json');
	fs.writeFileSync(envFile, JSON.stringify({ timeouts: { askMs: 222 } }));
	const flagFile = path.join(tmp(), 'flag.json');
	fs.writeFileSync(flagFile, JSON.stringify({ timeouts: { askMs: 333 } }));

	assert.equal(loadConfig({ argv: [], env: {}, homedir: home }).get('timeouts.askMs'), 111, 'home file');
	assert.equal(loadConfig({ argv: [], env: { MINDSMITH_CONFIG: envFile }, homedir: home }).get('timeouts.askMs'), 222, 'env wins over home');
	assert.equal(loadConfig({ argv: ['--config', flagFile], env: { MINDSMITH_CONFIG: envFile }, homedir: home }).get('timeouts.askMs'), 333, 'flag wins over env');
	assert.equal(loadConfig({ argv: [], env: {}, homedir: tmp() }).get('timeouts.askMs', 999), 999, 'no file anywhere = empty config, fallback answers');
});

test('fail-closed: an EXPLICIT config that is missing or corrupt is a typed error (a written config is never silently ignored)', () => {
	assert.throws(() => loadConfig({ argv: ['--config', '/nope/missing.json'], env: {}, homedir: tmp() }), /config.*\/nope\/missing\.json/);
	const bad = path.join(tmp(), 'bad.json');
	fs.writeFileSync(bad, '{ not json');
	assert.throws(() => loadConfig({ argv: ['--config', bad], env: {}, homedir: tmp() }), /config.*parse/i);
	const home = tmp();
	fs.mkdirSync(path.join(home, '.mindsmith'));
	fs.writeFileSync(path.join(home, '.mindsmith', 'config.json'), '{ broken');
	assert.throws(() => loadConfig({ argv: [], env: {}, homedir: home }), /config.*parse/i, 'a CORRUPT home config also fails closed');
});

test('model aliases: normalized names resolve to gguf or server specs; alias links follow; cycles and unknowns are typed', () => {
	const home = homeWith({
		models: {
			local: { model: '~/models/q2.gguf' },
			frontier: { base: 'http://127.0.0.1:8080/v1', model: 'qwen', key: 'k' },
			judge: { alias: 'local' },
			loop1: { alias: 'loop2' }, loop2: { alias: 'loop1' }
		},
		defaults: { escalation: 'frontier' }
	});
	const cfg = loadConfig({ argv: [], env: {}, homedir: home });

	const local = cfg.resolveModel('local');
	assert.equal(local.kind, 'gguf');
	assert.equal(local.modelPath, path.join(home, 'models', 'q2.gguf'), '~ expands against the SAME home');
	const frontier = cfg.resolveModel('frontier');
	assert.deepEqual(frontier, { kind: 'server', base: 'http://127.0.0.1:8080/v1', model: 'qwen', key: 'k' });
	assert.equal(cfg.resolveModel('judge').modelPath, local.modelPath, 'alias links follow');
	assert.equal(cfg.resolveModel('nope'), null, 'unknown alias = null (callers decide their own fallback)');
	assert.throws(() => cfg.resolveModel('loop1'), /alias cycle/i);
	assert.equal(cfg.get('defaults.escalation'), 'frontier');
});

test('get(path) walks dotted keys with a fallback and never throws on absent branches', () => {
	const cfg = loadConfig({ argv: [], env: {}, homedir: homeWith({ instances: { placement: 'worker' } }) });
	assert.equal(cfg.get('instances.placement'), 'worker');
	assert.equal(cfg.get('instances.dir', '/d'), '/d');
	assert.equal(cfg.get('a.b.c.d', 42), 42);
});
