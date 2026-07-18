'use strict';
/*
 * Copyright 2026 Nathanael Braun <pp9ping@gmail.com>
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
/**
 * The instance HTTP endpoints (roadmap R5) — SHARING lives OUT OF the LLM context: the pack rides
 * the wire, never a tool result. Composable route handler for the serve surface:
 *
 *   GET  /instances/<type>/<id>     the `.sgp` file TEL QUEL (application/zip, byte-identical —
 *                                   the pack IS the wire artifact; a hot dirty instance is synced
 *                                   first so the download always carries the settled latest)
 *   POST /instances/import          swallow a `.sgp` (raw bytes) → {id, uri} — imports mint a NEW
 *                                   id (never clobber); the manifest gate runs BEFORE any Graph
 *                                   boot, so a corrupted/unknown/incompatible pack is a typed 400,
 *                                   fail-closed, nothing written. `x-sg-agent` header = attribution.
 *
 * Returns `null` for any other route (the caller falls through to its next handler). Errors are
 * typed JSON — never a stack, never a silent 200.
 */
const { readEntry } = require('./zip.js');

const JSON_H = { 'content-type': 'application/json' };
const err = ( status, message ) => ({ status, headers: JSON_H, body: { error: { message, type: 'instances_error' } } });

/** @param w.runtime  a createRuntime instance. @returns async (reqd) => resd | null */
function instancesRoutes( w ) {
	if ( !w || !w.runtime ) throw new Error('instancesRoutes: `runtime` is required');
	const rt = w.runtime;
	return async function ( reqd ) {
		const url = String(reqd.url || '').split('?')[0];

		if ( reqd.method === 'GET' ) {
			const m = url.match(/^\/instances\/([^/]+)\/([^/]+)$/);
			if ( !m ) return null;
			const type = m[1], id = m[2];
			let bytes;
			try {
				await rt.sync(id);                               // hot+dirty → persist the settled state first
				bytes = rt.export(id);
			}
			catch ( e ) { return err(404, 'no instance "' + id + '"'); }
			let man;
			try { man = JSON.parse(readEntry(bytes, 'manifest.json')); }
			catch ( e ) { return err(500, 'pack unreadable: ' + e.message); }
			if ( man.type !== type ) return err(404, 'no instance "' + id + '" of type "' + type + '" (it is "' + man.type + '")');
			return { status: 200, headers: {
				'content-type': 'application/zip',
				'content-disposition': 'attachment; filename="' + id + '.sgp"'
			}, raw: bytes };
		}

		if ( reqd.method === 'POST' && url === '/instances/import' ) {
			const bytes = reqd.rawBody;
			if ( !bytes || !bytes.length ) return err(400, 'empty body — POST the .sgp bytes');
			try {
				const r = await rt.import(bytes, { agent: reqd.headers && reqd.headers['x-sg-agent'] });
				return { status: 200, headers: JSON_H, body: r };
			}
			catch ( e ) { return err(400, 'import refused (fail-closed): ' + e.message); }
		}

		return null;
	};
}

module.exports = { instancesRoutes };
