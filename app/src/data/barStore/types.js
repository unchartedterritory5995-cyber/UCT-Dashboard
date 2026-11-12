// app/src/data/barStore/types.js — the BarStore's identity + shapes (P2 of the chart-data
// consolidation program; docs/architecture/barstore.md).
//
// ⭐ ONE KEY FUNCTION. A store entry is keyed `${SYM}_${seriesCacheTf(tf)}` (+ `@to=<unix>`
// for a windowed / replay series) — exactly the identity the IDB / mem caches already use
// (chart/barTime.seriesCacheTf: only 60m on the clock grid differs between sessions, as
// '60e'). The server-issued `cache_key` (P1, docs/architecture/bar-contract.md) is the
// identity of the ROW SERIES and is checked against `expectedServerCacheKey(key)`; a
// payload or frame whose cache_key names another series is foreign and never applied (S7).
//
// ⭐ TIME UNIT. Every bar `t` in the store is UNIX SECONDS. Intraday: the bucket start.
// D/W/M: 00:00 UTC of the period's label date (D: the session date, W: the week's Friday,
// M: the 1st) — so `new Date(t*1000).toISOString().slice(0,10)` is the server's
// "YYYY-MM-DD". Chart-time conversion happens ONCE, in the adapter — never here.
//
// This module is pure and dependency-light; no runtime module imports the BarStore yet.

import { seriesCacheTf, logicTfOf } from '../../components/chart/barTime'

/** Timeframes a store can hold. */
export const TFS = Object.freeze(['1', '5', '15', '30', '60', 'D', 'W', 'M'])
export const INTRADAY_TFS = Object.freeze(['1', '5', '15', '30', '60'])
export const DATE_TFS = Object.freeze(['D', 'W', 'M'])
const _INTRADAY = new Set(INTRADAY_TFS)
const _DATE = new Set(DATE_TFS)
const _ALL = new Set(TFS)

export const isIntradayTf = (tf) => _INTRADAY.has(String(tf))
export const isDateTf = (tf) => _DATE.has(String(tf))

/** Bucket length in seconds of the native intraday tfs (60m buckets may be cut short by
 *  the session anchors — use liveBuckets.bucketEndUnix for a bucket's real end). */
export const PERIOD_SEC = Object.freeze({ '1': 60, '5': 300, '15': 900, '30': 1800, '60': 3600 })

/** Snapshot.status values (status.js owns derivation + the transition table). */
export const STATUS = Object.freeze({
  EMPTY: 'empty',             // nothing held
  PROVISIONAL: 'provisional', // local copy only, tail behind / gapped: paint history, live BUFFERED
  CONTEXT: 'context',         // local (or legacy server) copy current enough, unverified
  CURRENT: 'current',         // server-verified current
  UPDATING: 'updating',       // server answered but behind / unverified: fast catch-up
  UNAVAILABLE: 'unavailable', // terminal: no data
})

/** reduce() action types (reducer.js). */
export const ACTION = Object.freeze({
  SEED_FROM_PACK: 'seed-from-pack',
  IDB_HIT: 'idb-hit',
  MEM_HIT: 'mem-hit',
  REST_FULL: 'rest-full',
  REST_DELTA: 'rest-delta',
  REST_ERROR: 'rest-error',
  PUSH_BAR: 'push-bar',
  PUSH_FINAL: 'push-final',
  TICK_FALLBACK: 'tick-fallback',
  SCROLL_BACK: 'scroll-back',
  INVALIDATE: 'invalidate',
})

/** Where the developing bar's current value came from. */
export const DEV_SRC = Object.freeze({ SERVER: 'server', PUSH: 'push', TICK: 'tick', LOCAL: 'local' })

/**
 * @typedef {'1'|'5'|'15'|'30'|'60'|'D'|'W'|'M'} Tf
 * @typedef {'rth'|'eth'} Session
 *
 * @typedef {Object} KeySpec
 * @property {string} sym
 * @property {Tf|string|number} tf
 * @property {Session} [session]          default 'rth'
 * @property {{to:number}|null} [window]   windowed (replay / `to=`) series: unix s
 *
 * @typedef {Object} ParsedKey
 * @property {string} key
 * @property {string} sym                 upper-case
 * @property {Tf} tf                      the LOGIC tf ('60' for '60e')
 * @property {string} cacheTf             as in the key ('60e' for the clock grid)
 * @property {Session|null} session       'eth' for '60e', 'rth' for '60', null where the
 *                                        rows are shared by both sessions
 * @property {'session'|'clock'|null} grid  bucket grid (barTime names) for tf 60; null else
 * @property {'eth-clock'|'rth-tv'|'plain'} serverGrid  P1 `grid` the rows must carry
 * @property {{to:number}|null} window
 *
 * @typedef {Object} Bar      one bar, unix seconds (see TIME UNIT above). Frozen in a snapshot.
 * @property {number} t
 * @property {number} o
 * @property {number} h
 * @property {number} l
 * @property {number} c
 * @property {number} v
 * @property {number|null} [rev]   as-of revision (ms, P1 HLC) of the observation held
 * @property {boolean} [fin]       a push FINAL supplied it
 * @property {string} [src]        rest | final | push | tick | local (closed-row precedence)
 *
 * @typedef {Object} Developing  the forming bucket (never in `bars`)
 * @property {number} t
 * @property {number} o
 * @property {number} h
 * @property {number} l
 * @property {number} c
 * @property {number} v
 * @property {number|null} rev
 * @property {'server'|'push'|'tick'|'local'} src   'local': restored from mem / IDB, never the server's
 * @property {boolean} [provisional]  I6: opened from a tick; O/H/L do not lock
 * @property {number|null} [authHigh] I7: extremes vouched for by authoritative sources
 * @property {number|null} [authLow]
 *
 * @typedef {Object} Snapshot   frozen; identity changes iff content changes
 * @property {string} key
 * @property {string} sym
 * @property {Tf} tf
 * @property {readonly Bar[]} bars        closed buckets, strictly increasing unique `t`.
 *   Rows ending at or before `completeThrough` are SEALED (final); later rows are
 *   closed-but-provisional (P1 I3: shown, re-read).
 * @property {Developing|null} developing
 * @property {number|null} completeThrough  unix s END of the newest sealed bucket
 * @property {number|null} verifiedThrough  P1 verified_through (null on legacy answers)
 * @property {number|null} seriesRev        P1 series_rev
 * @property {number|null} historyRev       P1 history_rev
 * @property {string|null} cacheKey         P1 cache_key (server-issued)
 * @property {string|null} grid             P1 grid of the rows held
 * @property {string|null} tailStatus       server `tail_status` of the newest answer (by series_rev)
 * @property {ReadonlyArray<readonly [number, number]>} sealedSpans  union of [first row carried,
 *   claim] over server answers; a `src:'rest'` row inside it is final (reducer.isSealedRow)
 * @property {number|null} restFrom   oldest `t` a server answer has covered
 * @property {number|null} deltaFrom  where the next `since=` delta must start
 * @property {'empty'|'provisional'|'context'|'current'|'updating'|'unavailable'} status
 * @property {number} baseRev   +1 whenever bars / completeThrough / verifiedThrough change
 * @property {number} devRev    +1 whenever developing changes
 * @property {number} depth     bars.length
 * @property {'pack'|'idb'|'mem'|'rest'|null} source  the newest source that changed base
 * @property {boolean} restSeen   a server answer has been applied since the last invalidate
 * @property {boolean} needsFull  the next request must be a FULL read (delta refused)
 * @property {string|null} error
 * @property {string|null} invalidatedFor  reason of the last invalidate
 * @property {number} gen   bumped by every invalidate / history change; network actions carry it
 * @property {number|null} pendingHistoryRev  a newer history_rev seen on a delta; full read pending
 * @property {number} depthFloor  depth a scroll-back reached (the depth cap never trims below)
 */

/** Normalize any accepted tf spelling ('5', 5, '60e', 'd') to a logic Tf, or null. */
export function normTf(tf) {
  if (tf == null) return null
  let s = String(tf).trim()
  if (s === '60e') s = '60'
  const up = s.toUpperCase()
  if (up === 'D' || up === 'W' || up === 'M') return up
  return _ALL.has(s) ? s : null
}

const _normSession = (s) => (s === 'eth' || s === 'extended' ? 'eth' : 'rth')

/**
 * THE key of a store entry. Throws on an unknown tf / empty symbol (a malformed key would
 * silently share or split cache entries — fail loudly instead).
 * @param {KeySpec} spec
 */
export function keyOf({ sym, tf, session = 'rth', window = null } = {}) {
  const S = String(sym ?? '').trim().toUpperCase()
  const T = normTf(tf)
  if (!S) throw new Error('barStore.keyOf: empty symbol')
  if (!T) throw new Error(`barStore.keyOf: unknown tf ${tf}`)
  const cacheTf = isIntradayTf(T) ? seriesCacheTf(T, _normSession(session) === 'eth') : T
  let key = `${S}_${cacheTf}`
  const to = window && window.to
  if (to != null) {
    if (!Number.isFinite(Number(to))) throw new Error(`barStore.keyOf: bad window.to ${to}`)
    key += `@to=${Math.floor(Number(to))}`
  }
  return key
}

/**
 * Inverse of keyOf. Returns null for anything keyOf could not have produced.
 * @param {string} key
 * @returns {ParsedKey|null}
 */
export function parseKey(key) {
  if (typeof key !== 'string' || !key) return null
  let base = key
  let window = null
  const at = key.indexOf('@to=')
  if (at >= 0) {
    const to = key.slice(at + 4)
    if (!/^-?\d+$/.test(to)) return null
    window = { to: Number(to) }
    base = key.slice(0, at)
  }
  const us = base.lastIndexOf('_')
  if (us <= 0) return null
  const sym = base.slice(0, us)
  const cacheTf = base.slice(us + 1)
  if (sym !== sym.toUpperCase().trim()) return null
  const tf = normTf(cacheTf)
  if (!tf || (cacheTf !== tf && cacheTf !== '60e')) return null
  const session = cacheTf === '60e' ? 'eth' : (tf === '60' ? 'rth' : null)
  const grid = tf === '60' ? (cacheTf === '60e' ? 'clock' : 'session') : null
  const serverGrid = isDateTf(tf) ? 'plain' : (grid === 'session' ? 'rth-tv' : 'eth-clock')
  if (logicTfOf(cacheTf) !== tf) return null
  return { key, sym, tf, cacheTf, session, grid, serverGrid, window }
}

/** The P1 `cache_key` the server issues for the row series of `key` (bar_contract.cache_key). */
export function expectedServerCacheKey(key) {
  const p = typeof key === 'string' ? parseKey(key) : key
  if (!p) return null
  return `b1:${p.sym}:${p.tf}:${p.serverGrid}`
}

/** P1 grid name → the barTime bucket-grid name ('session' | 'clock'), for tf 60. */
export function bucketGridOf(serverGrid) {
  if (serverGrid === 'rth-tv' || serverGrid === 'session' || serverGrid === 'rth') return 'session'
  if (serverGrid === 'eth-clock' || serverGrid === 'clock' || serverGrid === 'eth') return 'clock'
  return null
}

/** Unix seconds of 00:00 UTC on 'YYYY-MM-DD' (the D/W/M `t`), or NaN. */
export function dateLabelToUnix(iso) {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return NaN
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y, m - 1, d) / 1000
}

/** The D/W/M label of a store `t`. */
export function unixToDateLabel(t) {
  return new Date(t * 1000).toISOString().slice(0, 10)
}
