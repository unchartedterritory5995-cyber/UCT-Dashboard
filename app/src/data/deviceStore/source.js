// app/src/data/deviceStore/source.js — the BarStore's view of the on-device bar store.
//
// persist.js holds one of these (null while the switch is off) and asks it, for a key whose mem record
// is empty, for a LOCAL copy:
//   peek(sym, cacheTf) → {n, rows, through, savedAt} | null   SYNCHRONOUS (the client's recently-read cache)
//   read(sym, cacheTf, {urgent}?) → Promise<{rows, savedAt} | null>   one worker round trip; never rejects.
//                       `urgent`: the member's own ask goes ahead of every background read (client.js, TWO LANES)
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

/** A seed build id ('YYYYMMDDTHHMMZ', the build's UTC time) → epoch ms, or null. */
export function buildTimeMs(build) {
  const m = typeof build === 'string' ? /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})Z$/.exec(build) : null
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : null
}

// A device copy's saved time is the moment it is COMPLETE up to (`through`, live.js / engine.js), the
// age every local-copy rule reads (the daily paint gate in particular); the build time only when an older
// worker sends no stamp.
// ⭐ THE ROWS ARE BUILT WHEN THEY ARE READ, ONCE (2026-11-22). The bar store asks for a held key's copy on every
// warm of that key (persist.refreshDevice: the rows around the selection and the rows on screen, on every linked
// timeframe, on every press), and nearly every time it drops the copy after one look at `through`: no newer than
// the one it holds. Building one object per bar first cost 20 ms of main-thread work around a next-row press and
// made the press 4 ms slower with the store on (devgates4). `n` is the row count, for a caller that needs no row.
const _hit = (cols) => {
  const n = cols?.t?.length || 0
  if (!n) return null
  const through = Number.isFinite(cols.through) ? cols.through : null
  let rows = null
  return {
    n, through, savedAt: through != null ? through * 1000 : buildTimeMs(cols.build),
    get rows() { return rows || (rows = columnsToRows(cols)) },
  }
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
    read(sym, tf, { urgent = false } = {}) {
      if (!sym || !_TFS.has(String(tf))) return Promise.resolve(null)
      return Promise.resolve(current() || load())
        .then((c) => (c ? (urgent === true ? c.getBars(sym, String(tf), { urgent: true }) : c.getBars(sym, String(tf))) : null))
        .then(_hit, () => null)
    },
    /** Diagnostics: the client's worker requests in flight (client.inFlight), 0 before it loaded. */
    inFlight() {
      const c = current()
      try { return c?.inFlight ? c.inFlight() : 0 } catch { return 0 }
    },
    /** Diagnostics: the worker's rule for (sym, tf) (client.why); 'no-client' when the store never loaded. */
    why(sym, tf) {
      return Promise.resolve(current() || load())
        .then((c) => (c?.why ? c.why(sym, String(tf)) : 'no-client'))
        .then((w) => w ?? 'no-engine', () => 'error')
    },
  }
}

/** The app's source, or null while the switch is off (then nothing of the store ever loads). */
export function deviceSource({ enabled = deviceStoreEnabled } = {}) {
  return enabled() ? createDeviceSource() : null
}
