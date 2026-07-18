'use strict';
/*
 * Copyright 2026 Nathanael Braun <pp9ping@gmail.com>
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
/**
 * Main-side handle over an instance worker (see worker.js): spawn + ready handshake +
 * id-correlated RPC + death tracking. A dead handle rejects every pending and future call with
 * a typed message — the store treats death as COLD (self-healing: the next open respawns from
 * the last persisted pack).
 */
const { Worker } = require('worker_threads');
const path = require('path');

function spawnInstanceWorker( data ) {
	return new Promise(( resolveReady, rejectReady ) => {
		const w = new Worker(path.join(__dirname, 'worker.js'), { workerData: data });
		const pending = new Map();
		let nextId = 1, ready = false;
		const handle = {
			threadId: null,
			dead: false,
			_exitCbs: [],
			onExit( cb ) { this._exitCbs.push(cb); },
			call( op, payload ) {
				if ( handle.dead ) return Promise.reject(new Error('instance worker is dead (crashed or terminated) — reopen the instance'));
				return new Promise(( resolve, reject ) => {
					const id = nextId++;
					pending.set(id, { resolve, reject });
					w.postMessage({ id, op, payload });
				});
			},
			async terminate() { handle.dead = true; await w.terminate(); }
		};
		const die = ( why ) => {
			if ( handle.dead && !pending.size ) return;
			handle.dead = true;
			for ( const p of pending.values() ) p.reject(new Error('instance worker died: ' + why));
			pending.clear();
			handle._exitCbs.forEach(( cb ) => { try { cb(); } catch ( e ) { /* observer */ } });
			if ( !ready ) rejectReady(new Error('instance worker died during boot: ' + why));
		};
		w.on('message', ( m ) => {
			if ( m && m.ready ) { ready = true; handle.threadId = m.threadId; return resolveReady(handle); }
			if ( m && m.bootError ) return die(m.bootError);
			const p = pending.get(m.id);
			if ( !p ) return;
			pending.delete(m.id);
			m.ok ? p.resolve(m.result) : p.reject(new Error(m.error));
		});
		w.on('error', ( e ) => die(e.message));
		w.on('exit', ( code ) => die('exit ' + code));
	});
}

module.exports = { spawnInstanceWorker };
