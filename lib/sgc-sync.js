'use strict';
/**
 * SGC sync — pull validated bundles from a skynet-server catalog, INTEGRITY-CHECKED (sha256 from the
 * index must match the received bytes — a tampered/truncated bundle is rejected, never written), into a
 * local dir the appliance loads THROUGH THE ENGINE'S GATES (version-gated, confluence-checked — see
 * app.js#loadBundles). Network surface: this module is the ONLY outbound path of the appliance besides
 * the declared frontier — and it only ever SENDS the token header, never query content (GDPR boundary).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const sha256 = ( buf ) => crypto.createHash('sha256').update(buf).digest('hex');

async function fetchJson( url, token ) {
	const r = await fetch(url, { headers: token ? { authorization: 'Bearer ' + token } : {} });
	if ( !r.ok ) throw new Error('catalog ' + r.status + ' on ' + url);
	return r.json();
}

/** The catalog index. @param o { url, token? } */
async function fetchIndex( o ) {
	return fetchJson(String(o.url).replace(/\/$/, '') + '/catalog/index.json', o.token);
}

/**
 * Pull every bundle of the index into `dir` (skip when the local copy already matches the sha256).
 * @param o { url, token?, dir }
 * @returns { pulled:[name], skipped:[name], rejected:[{name,reason}] } — a sha mismatch REJECTS (not written).
 */
async function pullAll( o ) {
	const base = String(o.url).replace(/\/$/, '');
	const dir = path.resolve(o.dir || 'sgc');
	fs.mkdirSync(dir, { recursive: true });
	const idx = await fetchIndex(o);
	const report = { pulled: [], skipped: [], rejected: [] };
	for ( const b of idx.bundles ) {
		const local = path.join(dir, b.file);
		if ( fs.existsSync(local) && sha256(fs.readFileSync(local)) === b.sha256 ) { report.skipped.push(b.name); continue; }
		const r = await fetch(base + '/catalog/bundles/' + encodeURIComponent(b.file), { headers: o.token ? { authorization: 'Bearer ' + o.token } : {} });
		if ( !r.ok ) { report.rejected.push({ name: b.name, reason: 'http ' + r.status }); continue; }
		const buf = Buffer.from(await r.arrayBuffer());
		if ( sha256(buf) !== b.sha256 ) { report.rejected.push({ name: b.name, reason: 'sha256 mismatch — tampered or truncated, NOT written' }); continue; }
		fs.writeFileSync(local, buf);
		report.pulled.push(b.name);
	}
	return report;
}

module.exports = { fetchIndex, pullAll, sha256 };
