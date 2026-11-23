// app/src/data/deviceStore/source.js — the BarStore's view of the on-device bar store.
//
// persist.js holds one of these (null while the switch is off) and asks it, for a key whose mem record
// is empty, for a LOCAL copy:
//   peek(sym, cacheTf) → {n, rows, through, savedAt, formingT} | null   SYNCHRONOUS (the client's recently-read cache)
//   read(sym, cacheTf, {urgent}?) → Promise<the same | null>   one worker round trip; never rejects.
//                       `urgent`: the member's own ask goes ahead of every background read (client.js, TWO LANES)
// `rows` are the cache's row shape ({t,o,h,l,c,v}, t unix seconds), what the reducer's local-copy
// action ingests. Only the keys the seed holds: 1/5/15/30/60 (the RTH session grid: '60e' is not in
// the seed) and D. ⛔ Never W or M (tfs.SERVED_TFS, review of #2537 H1): asked for one, every door here answers
// null ('tf' for the diagnostics) without loading or asking the client.
// `formingT`: the time of the copy's last row when that row is the bucket IN PROGRESS (the copy's `forming`,
// live.js / engine.js), else null. The store files that row as the developing bar whatever the clock says (M1).
//
// ⭐ LAZY: this file is tiny and imported statically by persist.js; the client (and through it the
// worker) is a dynamic import, started on the first ask. Until it has loaded, peek answers null and
// read waits for it.

import { deviceStoreEnabled, deviceStoreOffReason, deviceStoreKeyState } from './switch'
import { SERVED_TFS } from './tfs'
import { deviceFilesMayExist, deviceFilesStaleConfirmed, removeDeviceFiles, whenIdle } from './residue'
import { afterFirstChartPaint } from '../../lib/barsPackClient'

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
// `rows` is READ-ONLY (a getter with no setter: assigning to it throws in a module) and is built once per hit;
// every peek / read makes a new hit over the cached columns.
// ⛔ THE FORMING MARKER TRAVELS (review of #2537, M1). A copy may end with the bucket in progress (forming.js), in
// progress relative to the newest minute the DEVICE applied (`through`), not to the clock. Dropped here, the store
// judged that bucket by the clock alone: read just after the bucket's end, before the frame of its last minute had
// landed (~7-10 s), it was filed as a CLOSED bar one minute short, and the server's answer then changed the candle.
// So the hit names the bar the marker describes, by its time (`formingT`), and persist hands it to the reducer.
const _hit = (cols) => {
  const n = cols?.t?.length || 0
  if (!n) return null
  const through = Number.isFinite(cols.through) ? cols.through : null
  const formingT = cols.forming ? cols.t[n - 1] : null
  let rows = null
  return {
    n, through, savedAt: through != null ? through * 1000 : buildTimeMs(cols.build), formingT,
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
    // `newerThan`: a copy no newer than this `through` is not the answer (client.getBars; review of #2558, P4-L2)
    read(sym, tf, { urgent = false, newerThan = null } = {}) {
      if (!sym || !_TFS.has(String(tf))) return Promise.resolve(null)
      const newer = Number.isFinite(newerThan)
      const opts = urgent === true ? (newer ? { urgent: true, newerThan } : { urgent: true }) : (newer ? { newerThan } : null)
      return Promise.resolve(current() || load())
        .then((c) => (c ? (opts ? c.getBars(sym, String(tf), opts) : c.getBars(sym, String(tf))) : null))
        .then(_hit, () => null)
    },
    /** Diagnostics: the client's worker requests in flight (client.inFlight), 0 before it loaded. */
    inFlight() {
      const c = current()
      try { return c?.inFlight ? c.inFlight() : 0 } catch { return 0 }
    },
    /** Diagnostics: the worker's rule for (sym, tf) (client.why); 'no-client' when the store never loaded; 'tf' for a
     *  timeframe the device does not serve (W / M: asked nothing, loads nothing). */
    why(sym, tf) {
      if (!_TFS.has(String(tf))) return Promise.resolve('tf')
      return Promise.resolve(current() || load())
        .then((c) => (c?.why ? c.why(sym, String(tf)) : 'no-client'))
        .then((w) => w ?? 'no-engine', () => 'error')
    },
  }
}

/** navigator.storage, or null (no navigator / no StorageManager). */
function _navStorage() {
  try { return (typeof navigator !== 'undefined' && navigator.storage) || null } catch { return null }
}

let _offLooked = false
/** What an off page does with the packs, by why it is off (switch.deviceStoreOffReason; review of #2563): 'delete',
 *  'stale' (delete only once the store has not run here for 30 days), or null (keep). */
const _CLEANUP = Object.freeze({ 'device-purge': 'delete', 'member-off': 'delete', 'default-off': 'stale' })

/**
 * ⭐ OFF IS NOT ALWAYS "CLEAN UP" (review of #2537 M9, policy from the review of #2563 MEDIUM-1 / MEDIUM-2). A page whose
 * store is off looks ONCE, by WHY it is off:
 *   the member's own '0', the server's purge            -> the packs are removed
 *   off BY DEFAULT (no key)                             -> kept, unless the store has not run here for 30 days
 *   the chart-speed kill, the device kill (=0), any other stored value, an unreadable key -> kept, unused
 * so a default that reads OFF on one load and ON on the next (#2537: the window's width, the connection) or a kill
 * lifted after an hour costs no download. The whole cost for a browser that never ran the store: the switch's own read
 * (it was there before), one latched document.cookie read for both kills, and ONE localStorage read (the marker,
 * residue.deviceFilesMayExist): nothing scheduled, nothing imported, OPFS never asked. A removal runs after the page's
 * first chart paint, at idle, from the page (no client, no worker); a removal that fails is tried on the next load.
 */
function _offCleanup({ offReason, afterPaint, idle, storage, now }) {
  if (_offLooked) return
  _offLooked = true
  let rule = null
  let keyStored = false
  try {
    rule = _CLEANUP[(offReason || deviceStoreOffReason)()] || null
    if (!rule) return
    const k = deviceStoreKeyState()
    keyStored = k === 'on' || k === 'off' || k === 'not-a-choice'
  } catch { return }
  if (!deviceFilesMayExist(keyStored)) return
  if (rule === 'stale' && !deviceFilesStaleConfirmed((now || Date.now)())) return
  // (the defaults are taken only here, on the rare path: a page that never needs them never touches them)
  const paint = afterPaint || afterFirstChartPaint
  const whenFree = idle || whenIdle
  try { paint(() => whenFree(() => { removeDeviceFiles(storage === undefined ? _navStorage() : storage) })) } catch { /* the next load */ }
}

/** The app's source, or null while the switch is off (then nothing of the store ever loads, and the packs an earlier
 *  page load downloaded may be removed: _offCleanup). `offReason` / `afterPaint` / `idle` / `storage` / `now`: tests. */
export function deviceSource({ enabled = deviceStoreEnabled, offReason = null, afterPaint = null, idle = null, storage = undefined, now = null } = {}) {
  if (enabled()) return createDeviceSource()
  _offCleanup({ offReason, afterPaint, idle, storage, now })
  return null
}
