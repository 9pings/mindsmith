'use strict';
/*
 * Copyright 2026 Nathanael Braun <pp9ping@gmail.com>
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
/**
 * The `.sgp` zip brick — a zero-dep zip writer/reader over `zlib.deflateRawSync` (owner decisions
 * 07-18: metas separate from the serialized graph at save; one pack carrying everything for
 * export/import; zipped). Plain pkzip 2.0, deflate method, no zip64 (packs stay far under 4 GB):
 * per-entry random access lets the store read `manifest.json` WITHOUT inflating `graph.json`,
 * and any OS tool opens the file. Every read verifies size + CRC32 — corruption fails CLOSED.
 */
const zlib = require('zlib');

// ---- CRC32 (standard table) -----------------------------------------------------------------
const CRC_TABLE = (() => {
	const t = new Int32Array(256);
	for ( let n = 0; n < 256; n++ ) {
		let c = n;
		for ( let k = 0; k < 8; k++ ) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
		t[n] = c;
	}
	return t;
})();
function crc32( buf ) {
	let c = 0xffffffff;
	for ( let i = 0; i < buf.length; i++ ) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

const SIG_LOCAL = 0x04034b50, SIG_CENTRAL = 0x02014b50, SIG_EOCD = 0x06054b50;

/**
 * Build a zip from ordered entries [{name, data:Buffer|string}] → Buffer.
 * Deterministic: fixed timestamps (0), deflate level default, order preserved.
 */
function packEntries( entries ) {
	const locals = [], centrals = [];
	let offset = 0;
	for ( const e of entries ) {
		const name = Buffer.from(String(e.name), 'utf8');
		const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(String(e.data), 'utf8');
		const crc = crc32(data);
		const deflated = zlib.deflateRawSync(data);
		const method = deflated.length < data.length ? 8 : 0;            // store tiny/incompressible as-is
		const payload = method === 8 ? deflated : data;

		const local = Buffer.alloc(30);
		local.writeUInt32LE(SIG_LOCAL, 0);
		local.writeUInt16LE(20, 4);                                       // version needed
		local.writeUInt16LE(0, 6);                                        // flags
		local.writeUInt16LE(method, 8);
		local.writeUInt16LE(0, 10); local.writeUInt16LE(0x21, 12);        // time 0 / date 1980-01-01
		local.writeUInt32LE(crc, 14);
		local.writeUInt32LE(payload.length, 18);
		local.writeUInt32LE(data.length, 22);
		local.writeUInt16LE(name.length, 26);
		local.writeUInt16LE(0, 28);                                       // extra len
		locals.push(local, name, payload);

		const cen = Buffer.alloc(46);
		cen.writeUInt32LE(SIG_CENTRAL, 0);
		cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6);
		cen.writeUInt16LE(0, 8);                                          // flags
		cen.writeUInt16LE(method, 10);
		cen.writeUInt16LE(0, 12); cen.writeUInt16LE(0x21, 14);
		cen.writeUInt32LE(crc, 16);
		cen.writeUInt32LE(payload.length, 20);
		cen.writeUInt32LE(data.length, 24);
		cen.writeUInt16LE(name.length, 28);
		// extra/comment/disk/internal-attrs/external-attrs all 0 (bytes 30-41)
		cen.writeUInt32LE(offset, 42);                                    // local header offset
		centrals.push(Buffer.concat([cen, name]));

		offset += local.length + name.length + payload.length;
	}
	const cd = Buffer.concat(centrals);
	const eocd = Buffer.alloc(22);
	eocd.writeUInt32LE(SIG_EOCD, 0);
	eocd.writeUInt16LE(entries.length, 8);                              // entries on this disk
	eocd.writeUInt16LE(entries.length, 10);                             // entries total
	eocd.writeUInt32LE(cd.length, 12);
	eocd.writeUInt32LE(offset, 16);                                     // cd offset
	return Buffer.concat([...locals, cd, eocd]);
}

/** Parse the central directory → [{name, method, crc, compSize, size, offset}] in cd order. */
function parseCentral( zip ) {
	if ( !Buffer.isBuffer(zip) || zip.length < 22 ) throw new Error('.sgp: truncated (not a zip / no EOCD)');
	// EOCD: scan back over a possible comment (we write none, but stay tolerant)
	let at = -1;
	for ( let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i-- )
		if ( zip.readUInt32LE(i) === SIG_EOCD ) { at = i; break; }
	if ( at < 0 ) throw new Error('.sgp: no EOCD signature (not a zip / truncated)');
	const count = zip.readUInt16LE(at + 10), cdOfs = zip.readUInt32LE(at + 16);
	const out = [];
	let p = cdOfs;
	for ( let n = 0; n < count; n++ ) {
		if ( p + 46 > zip.length || zip.readUInt32LE(p) !== SIG_CENTRAL ) throw new Error('.sgp: corrupt central directory');
		const nameLen = zip.readUInt16LE(p + 28), extraLen = zip.readUInt16LE(p + 30), cmtLen = zip.readUInt16LE(p + 32);
		out.push({
			name: zip.toString('utf8', p + 46, p + 46 + nameLen),
			method: zip.readUInt16LE(p + 10),
			crc: zip.readUInt32LE(p + 16),
			compSize: zip.readUInt32LE(p + 20),
			size: zip.readUInt32LE(p + 24),
			offset: zip.readUInt32LE(p + 42),
		});
		p += 46 + nameLen + extraLen + cmtLen;
	}
	return out;
}

function listEntries( zip ) { return parseCentral(zip).map(( e ) => e.name); }

/** Read ONE entry (verified size + CRC32, fail-closed) without touching any other entry's bytes. */
function readEntry( zip, name ) {
	const entries = parseCentral(zip);
	const e = entries.find(( x ) => x.name === name );
	if ( !e ) throw new Error('.sgp: no entry "' + name + '" (has: ' + entries.map(( x ) => x.name).join(', ') + ')');
	if ( e.offset + 30 > zip.length || zip.readUInt32LE(e.offset) !== SIG_LOCAL ) throw new Error('.sgp: corrupt local header for "' + name + '"');
	const nameLen = zip.readUInt16LE(e.offset + 26), extraLen = zip.readUInt16LE(e.offset + 28);
	const start = e.offset + 30 + nameLen + extraLen;
	const raw = zip.subarray(start, start + e.compSize);
	let data;
	if ( e.method === 8 ) {
		try { data = zlib.inflateRawSync(raw); }
		catch ( err ) { throw new Error('.sgp: inflate failed for "' + name + '" (corrupt): ' + err.message); }
	}
	else if ( e.method === 0 ) data = Buffer.from(raw);
	else throw new Error('.sgp: unsupported method ' + e.method + ' for "' + name + '"');
	if ( data.length !== e.size ) throw new Error('.sgp: size mismatch for "' + name + '" (corrupt)');
	if ( crc32(data) !== e.crc ) throw new Error('.sgp: crc mismatch for "' + name + '" (corrupt)');
	return data;
}

module.exports = { packEntries, readEntry, listEntries, crc32 };
