'use strict';
/**
 * The `.sgp` zip brick (lib/instances/zip.js) — zero-dep writer/reader over zlib.deflateRawSync.
 *
 * Why zip (owner decisions 07-18): metas SEPARATE from the serialized graph at save; one pack that
 * can carry everything for export/import; zipped. Zip gives per-entry random access — the store
 * lists/gates on `manifest.json` WITHOUT inflating `graph.json` — and any OS tool can open it.
 *
 * The decisive proof of per-entry independence doubles as the fail-closed negative: corrupt the
 * graph entry's bytes in place → manifest still reads fine (it was never inflated), the graph
 * entry throws TYPED (crc), nothing silently returns garbage.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { packEntries, readEntry, listEntries } = require('../lib/instances/zip.js');

// deterministic "binary" payload covering all byte values
const BIN = Buffer.from(Array.from({ length: 4096 }, ( _, i ) => (i * 7 + (i >> 3)) & 0xff));
const MANIFEST = Buffer.from(JSON.stringify({ formatVersion: 1, type: 'notepad', typeVersion: '1.0.0', title: 't' }));
const GRAPH = Buffer.from(JSON.stringify({ lastRev: 3, graph: JSON.stringify({ conceptMaps: Array.from({ length: 50 }, ( _, i ) => ({ _id: 'n' + i, text: 'note text ' + i }) ) }) }));

function pack() {
	return packEntries([
		{ name: 'manifest.json', data: MANIFEST },
		{ name: 'graph.json', data: GRAPH },
		{ name: 'blob.bin', data: BIN }
	]);
}

test('round-trip: every entry reads back byte-identical; listEntries names them in order', () => {
	const zip = pack();
	assert.ok(Buffer.isBuffer(zip));
	assert.deepEqual(listEntries(zip), ['manifest.json', 'graph.json', 'blob.bin']);
	assert.deepEqual(readEntry(zip, 'manifest.json'), MANIFEST);
	assert.deepEqual(readEntry(zip, 'graph.json'), GRAPH);
	assert.deepEqual(readEntry(zip, 'blob.bin'), BIN);
});

test('compressible entries are actually deflated (the pack is smaller than its payload)', () => {
	const zip = pack();
	assert.ok(zip.length < MANIFEST.length + GRAPH.length + BIN.length, 'deflate did its job on the JSON entries');
});

test('DECISIVE: a corrupted graph entry leaves manifest.json readable (never inflated) and throws TYPED on itself', () => {
	const zip = pack();
	// find the graph entry's compressed bytes and flip some — the local header name is plain in the buffer
	const at = zip.indexOf(Buffer.from('graph.json')) + 'graph.json'.length;
	for ( let i = 12; i < 24; i++ ) zip[at + i] ^= 0xff;                 // stomp inside its data
	assert.deepEqual(readEntry(zip, 'manifest.json'), MANIFEST, 'manifest reads without touching the corrupted entry');
	assert.throws(() => readEntry(zip, 'graph.json'), /crc|inflate|corrupt/i, 'the corrupted entry fails CLOSED, typed');
});

test('fail-closed: truncated/garbage buffers and unknown entries throw typed errors', () => {
	const zip = pack();
	assert.throws(() => readEntry(zip.subarray(0, 40), 'manifest.json'), /eocd|not a zip|truncated/i);
	assert.throws(() => readEntry(Buffer.from('this is not a zip at all'), 'x'), /eocd|not a zip|truncated/i);
	assert.throws(() => readEntry(zip, 'nope.json'), /no entry .*nope\.json.*manifest\.json/s, 'the unknown-entry error NAMES what exists');
});

test('determinism: same entries -> byte-identical pack', () => {
	assert.deepEqual(pack(), pack());
});

test('real-world compat: python3 zipfile (if present) lists and verifies the pack', () => {
	const py = spawnSync('python3', ['--version']);
	if ( py.error || py.status !== 0 ) { console.error('  SKIPPED: python3 not available'); return; }
	const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sgp-')), 't.sgp');
	fs.writeFileSync(f, pack());
	const r = spawnSync('python3', ['-c',
		'import zipfile,sys\nz=zipfile.ZipFile(sys.argv[1])\nprint(",".join(z.namelist()))\nbad=z.testzip()\nsys.exit(1 if bad else 0)', f],
		{ encoding: 'utf8' });
	assert.equal(r.status, 0, 'python zipfile verifies all CRCs: ' + r.stderr);
	assert.equal(r.stdout.trim(), 'manifest.json,graph.json,blob.bin');
});
