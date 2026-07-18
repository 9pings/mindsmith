'use strict';
/*
 * Copyright 2026 Nathanael Braun <pp9ping@gmail.com>
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
/**
 * The bounded REVISIONS view of one member graph — shared by the store (in-proc) and the worker
 * (its own thread requires this file itself), so both placements project the SAME shape.
 *
 * Rides the engine's public revision surface only: `getCurrentRevision` / `getRevisions`
 * (snapshot numbers) / `getRevisionsRange` (the atoms — whose template items carry the `by`
 * passenger fact, the R0-proven attribution surface). The catalogue stays DERIVED: authors are
 * read off the atoms, never off a side index.
 */

/** @returns {{current, snapshots: number[], revisions: [{rev, atoms, by: string[]}]}} (last `last` revs, default 20) */
function revisionsOf( g, last ) {
	const current = g.getCurrentRevision();
	const n = last == null ? 20 : Math.max(1, last | 0);
	const from = Math.max(0, current + 1 - n);
	const rows = [];
	(g.getRevisionsRange(from, current + 1) || []).forEach(( r, i ) => {
		if ( !r || !r.tpl ) return;
		const by = [...new Set(r.tpl.map(( t ) => t && t.by ).filter(Boolean))];
		rows.push({ rev: from + i, atoms: r.tpl.length, by });
	});
	return { current, snapshots: g.getRevisions(), revisions: rows };
}

module.exports = { revisionsOf };
