'use strict';
/**
 * Test fixture — a notepad-like type with a CPU-BURN action (sync busy-loop): the saturation
 * probe for worker placement. Loadable BY PATH (worker placement requires descriptor paths).
 */
module.exports = {
	type: 'burnpad',
	version: '1.0.0',
	conceptSets: [],
	concurrency: ['shared-sequenced'],
	create: ( seed ) => [{ $$_id: 'pad', Burnpad: true, title: (seed && seed.title) || '', nextNote: 1 }],
	actions: {
		note: {
			write: true, input: { text: 'string' },
			apply: ( g, args ) => {
				const n = g.getEtty('pad').get('nextNote') || 1;
				return [
					{ $$_id: 'note-' + n, NoteEntry: true, seq: n, text: String(args.text) },
					{ $$_id: 'pad', nextNote: n + 1 }
				];
			}
		},
		burn: {
			write: true, input: { ms: 'number' },
			apply: ( g, args ) => {                              // SYNC busy-loop — saturates ITS thread
				const until = Date.now() + (args.ms || 150);
				while ( Date.now() < until ) { /* burn */ }
				const n = g.getEtty('pad').get('nextNote') || 1;
				return [{ $$_id: 'note-' + n, NoteEntry: true, seq: n, text: 'burned' }, { $$_id: 'pad', nextNote: n + 1 }];
			}
		},
		recall: {
			write: false, input: {},
			project: ( g ) => {
				const notes = Object.keys(g._objById)
					.filter(( id ) => { const e = g.getEtty(id); return e && e.get('NoteEntry'); })
					.map(( id ) => { const e = g.getEtty(id); return { id, seq: e.get('seq'), text: e.get('text'), by: e.get('by') }; })
					.sort(( a, b ) => a.seq - b.seq);
				return { notes, count: notes.length };
			}
		}
	},
	projections: { summary: ( g ) => ({ title: g.getEtty('pad') && g.getEtty('pad').get('title') }) }
};
