// app/src/data/deviceStore/source.js — the BarStore's view of the on-device bar store.
//
// persist.js holds one of these (null while the switch is off) and asks it, for a key whose mem record
// is empty, for a LOCAL copy:
//   peek(sym, cacheTf) → {rows, savedAt} | null   SYNCHRONOUS (the client's recently-read cache)
//   read(sym, cacheTf) → Promise<{rows, savedAt} | null>   one worker round trip; never rejects
// `rows` are the cache's row shape ({t,o,h,l,c,v}, t unix seconds), what the reducer's local-copy
// action ingests. Only the keys the seed holds: 1/5/15/30/60 (the RTH session grid: '60e' is not in
// the seed), D, and W/M derived from D.
//
// ⭐ LAZY: this file is tiny and imported statically by persist.js; the client (and through it the
// worker) is a dynamic import, started on the first ask. Until it has loaded, peek answers null and
// read waits for it.

import { deviceStoreEnabled } from './switch'
import { SERVED_TFS } from './tfs'

const _TFS = new Set(SERVED_TFS)

let _clientP = null
let _client = null
function _load() {
  if (!_clientP) {
    _clientP = import('./client')
      .then((m) => { _client = m.getDeviceClient().start(); return _client })
      .catch(() => null)
  }
  return _clientP
}

/** Columns → the cache's row shape. */
export function columnsToRows(cols) {
  const n = cols?.t?.length || 0
  const rows = new Array(n)
  for (let i = 0; i < n; i++) rows[i] = { t: cols.t[i], o: cols.o[i], h: cols.h[i], l: cols.l[i], c: cols.c[i], v: cols.v[i] }
  return rows
}

const _hit = (cols) => {
  if (!cols?.t?.length) return null
  const at = typeof cols.build === 'string' ? Date.parse(cols.build) : NaN
  return { rows: columnsToRows(cols), savedAt: Number.isFinite(at) ? at : null }
}

/** A source over any client-shaped object ({peekBars, getBars}); `load` resolves it. */
export function createDeviceSource({ load = _load, current = () => _client } = {}) {
  return {
    peek(sym, tf) {
      if (!sym || !_TFS.has(String(tf))) return null
      const c = current()
      if (!c) { load(); return null }
      try { return _hit(c.peekBars(sym, String(tf))) } catch { return null }
    },
    read(sym, tf) {
      if (!sym || !_TFS.has(String(tf))) return Promise.resolve(null)
      return Promise.resolve(current() || load())
        .then((c) => (c ? c.getBars(sym, String(tf)) : null))
        .then(_hit, () => null)
    },
  }
}

/** The app's source, or null while the switch is off (then nothing of the store ever loads). */
export function deviceSource({ enabled = deviceStoreEnabled } = {}) {
  return enabled() ? createDeviceSource() : null
}
