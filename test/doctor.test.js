'use strict';
/**
 * `mindsmith doctor` — the checks are DATA and every non-ok check NAMES its fix.
 * Real probes only (a real bind for the port, a real dir for the room): no stubs of the
 * thing measured — a doctor that mocks its patient certifies nothing.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { doctor, runChecks, checkPort, render, isWSL } = require('../lib/doctor.js');

const byId = ( checks, id ) => checks.find(( c ) => c.id === id );

test('runChecks — this very environment: node + engine resolve, and every non-ok carries a fix', () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-'));
	fs.writeFileSync(path.join(dir, 'stock.sgc'), 'x');
	const checks = runChecks({ env: {}, roomDir: dir });
	assert.equal(byId(checks, 'node').status, 'ok');
	assert.equal(byId(checks, 'engine').status, 'ok');
	assert.match(byId(checks, 'engine').detail, /skynet-graph \d/);
	assert.match(byId(checks, 'room').detail, /1 \.sgc stock/);
	for ( const c of checks ) if ( c.status !== 'ok' ) assert.ok(c.fix, c.id + ' names its fix');
	fs.rmSync(dir, { recursive: true, force: true });
});

test('runChecks — a missing room warns with the import path; a corrupt config FAILS', () => {
	const checks = runChecks({ env: {}, roomDir: path.join(os.tmpdir(), 'doctor-none-' + process.pid),
		configPath: '/tmp/broken.json', configError: 'parse error' });
	assert.equal(byId(checks, 'room').status, 'warn');
	assert.match(byId(checks, 'room').fix, /rooms import/);
	assert.equal(byId(checks, 'config').status, 'fail');
	assert.equal(byId(checks, 'escalation').status, 'warn', 'no escalation given → serve/mcp will refuse, said here');
});

test('runChecks — on WSL, LD_LIBRARY_PATH without the wsl lib is the SILENT-CPU trap, named', ( t ) => {
	if ( !isWSL() ) return t.skip('not WSL');
	const bare = runChecks({ env: { LD_LIBRARY_PATH: '' }, roomDir: '.' });
	assert.equal(byId(bare, 'gpu-wsl').status, 'warn');
	assert.match(byId(bare, 'gpu-wsl').fix, /LD_LIBRARY_PATH=\/usr\/lib\/wsl\/lib/);
	const good = runChecks({ env: { LD_LIBRARY_PATH: '/usr/lib/wsl/lib:/usr/lib/x86_64-linux-gnu' }, roomDir: '.' });
	assert.equal(byId(good, 'gpu-wsl').status, 'ok');
});

test('checkPort — a really-bound port warns (with the flag to change it); a free one is ok', async () => {
	const srv = net.createServer();
	await new Promise(( res ) => srv.listen(0, '127.0.0.1', res));
	const busy = srv.address().port;
	const c = await checkPort(busy);
	assert.equal(c.status, 'warn');
	assert.match(c.fix, /--port/);
	await new Promise(( res ) => srv.close(res));
	assert.equal((await checkPort(busy)).status, 'ok');
});

test('doctor — ok iff no fail; render prints the → fix arrow on non-ok lines', async () => {
	const clean = await doctor({ env: {}, roomDir: '.', port: 0, escalation: { kind: 'server', detail: 'LLM_BASE=x' } });
	assert.equal(clean.ok, true, 'warns do not block');
	const broken = await doctor({ env: {}, roomDir: '.', port: 0, escalation: null,
		configPath: 'x.json', configError: 'boom' });
	assert.equal(broken.ok, false);
	assert.match(render(broken.checks), /→ /);
});
