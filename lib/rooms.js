'use strict';
/**
 * SGC rooms — LOCAL bundle management (the community model: no central catalog, no subscription — anyone
 * builds, freezes, shares and imports their own `.sgc` mini-repos). A room is just a directory of
 * self-verifiable bundles: each `.sgc`/`.json` carries its manifest, and `freeze` writes the companion
 * dossier (`<base>.dossier.md`: sha256 + inventory) that makes the bundle a fixed, auditable reference.
 *
 * Everything content-bearing stays engine-gated: `import` DRY-LOADS the bundle through the same gates the
 * appliance uses (a malformed or empty bundle is REJECTED, never written into the room), and the appliance
 * itself re-loads the room through `loadBundles` (kind-dispatched, version-gated) at boot.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const sha256 = ( buf ) => crypto.createHash('sha256').update(buf).digest('hex');
const baseOf = ( f ) => f.replace(/\.(json|sgc)$/, '');

/** Parse + shape-check one bundle file. → { art, kind, name, version, classes } — throws on a non-bundle. */
function inspectBundle( file ) {
	const bytes = fs.readFileSync(file);
	const art = JSON.parse(bytes.toString('utf8'));
	if ( !art || art.format !== 'sgc' ) throw new Error('not an sgc bundle (format!=="sgc")');
	const man = art.manifest || {};
	let classes = [];
	if ( art.kind === 'methods' ) {
		// the same admission surface the assistant lanes use — throws on an EMPTY certified vocabulary
		const { stockWiring } = require('skynet-graph/lib/sg/mcp.js');
		classes = stockWiring(art).hints.certifiedShapes;
	} else if ( art.kind === 'lattice' ) {
		const keys = (art.registry && art.registry.keys) || {};
		classes = Object.keys(keys).sort();
		if ( !classes.length ) throw new Error('empty lattice bundle (no registry keys)');
	} else {
		throw new Error('unknown sgc kind "' + art.kind + '" (methods|lattice)');
	}
	return { art, kind: art.kind, name: man.name || baseOf(path.basename(file)), version: man.version || '?',
		classes, sha256: sha256(bytes) };
}

/** Inventory of a room. → [{ file, kind, name, version, classes, sha256, frozen, dossier }] (invalid files flagged). */
function list( dir ) {
	if ( !fs.existsSync(dir) ) return [];
	const rows = [];
	for ( const f of fs.readdirSync(dir).sort() ) {
		if ( !/\.(json|sgc)$/.test(f) ) continue;
		const full = path.join(dir, f);
		const dossier = ['.dossier.md', '.md'].map(( e ) => baseOf(f) + e ).find(( d ) => fs.existsSync(path.join(dir, d)) );
		try {
			const b = inspectBundle(full);
			rows.push({ file: f, kind: b.kind, name: b.name, version: b.version, classes: b.classes.length,
				sha256: b.sha256, frozen: !!dossier, dossier: dossier || null });
		} catch ( e ) { rows.push({ file: f, invalid: e.message }); }
	}
	return rows;
}

/** Import a bundle INTO the room — gate-checked first (fail-closed: a bad bundle is never written). */
function importBundle( dir, srcFile ) {
	const b = inspectBundle(srcFile);   // throws → nothing written
	fs.mkdirSync(dir, { recursive: true });
	const dest = path.join(dir, path.basename(srcFile));
	fs.copyFileSync(srcFile, dest);
	return { file: path.basename(dest), kind: b.kind, name: b.name, version: b.version, classes: b.classes.length, sha256: b.sha256 };
}

/** Export a bundle (+ its dossier when present) OUT of the room. */
function exportBundle( dir, fileOrName, destDir ) {
	const rows = list(dir).filter(( r ) => !r.invalid );
	const row = rows.find(( r ) => r.file === fileOrName || r.name === fileOrName );
	if ( !row ) throw new Error('bundle "' + fileOrName + '" not in the room (' + rows.map(( r ) => r.name ).join(', ') + ')');
	fs.mkdirSync(destDir, { recursive: true });
	fs.copyFileSync(path.join(dir, row.file), path.join(destDir, row.file));
	const out = { exported: [row.file] };
	if ( row.dossier ) { fs.copyFileSync(path.join(dir, row.dossier), path.join(destDir, row.dossier)); out.exported.push(row.dossier); }
	return out;
}

/** Freeze a bundle: write its dossier (sha256 + inventory) — the fixed, auditable reference for sharing. */
function freeze( dir, fileOrName ) {
	const rows = list(dir).filter(( r ) => !r.invalid );
	const row = rows.find(( r ) => r.file === fileOrName || r.name === fileOrName );
	if ( !row ) throw new Error('bundle "' + fileOrName + '" not in the room');
	const b = inspectBundle(path.join(dir, row.file));
	const dossierFile = baseOf(row.file) + '.dossier.md';
	const md = [
		'# ' + b.name + '@' + b.version + ' — dossier (frozen reference)',
		'',
		'- file: `' + row.file + '`',
		'- kind: `' + b.kind + '`',
		'- sha256: `' + b.sha256 + '`',
		'- frozen: ' + new Date().toISOString(),
		'',
		'## ' + (b.kind === 'methods' ? 'Certified classes (' + b.classes.length + ')' : 'Registry keys (' + b.classes.length + ')'),
		'',
		...b.classes.map(( c ) => '- `' + c + '`' ),
		'',
		'A consumer verifies the bytes against the sha256 above; the appliance re-verifies the content',
		'through the engine gates at load. A bundle whose bytes no longer match its dossier is NOT the',
		'frozen reference anymore.',
		''
	].join('\n');
	fs.writeFileSync(path.join(dir, dossierFile), md);
	return { dossier: dossierFile, sha256: b.sha256, classes: b.classes.length };
}

module.exports = { list, importBundle, exportBundle, freeze, inspectBundle };
