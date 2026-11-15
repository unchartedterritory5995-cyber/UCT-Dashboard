// app/src/data/barStore/reducer.js — THE merge path of a BarStore entry (P2a).
//
// `reduce(state, action, ctx) -> state` is PURE: no clock, no IDB, no network. Everything
// time-dependent comes in on `ctx` ({ nowMs, streamLive, session, depthCap }). The state IS
// the Snapshot (types.js): frozen, and returned BY IDENTITY when an action changes nothing,
// so a subscriber can compare snapshots with `===`.
//
// ⭐ ONE OWNER PER RULE — every bar rule is IMPORTED, never re-encoded here:
//   bucket math        chart/barTime.bucketStartUnix, chart/liveBuckets.bucketEndUnix,
//                      barTime.computeBarTime (D/W/M period of a tick)
//   off-grid rows      chart/offGridBars.foldOffGridBars (once, at ingest)
//   developing bar     lib/liveBarMerge: mergePushBar (I1–I4 + I6 provisional opens +
//                      I7 auth provenance + final), reconcileWithServerTail (legacy server
//                      tail vs live, Writer D's rule), foldPrice + provisionalOpen (ticks)
//   tick sanity        chart/liveTickBaseline.isSaneLivePriceFor (baselines of THIS key's
//                      symbol only — a store never sees another symbol's closes)
//   liveBarMerge works on chart-shaped bars ({time, open…}); it only ORDERS times (the
//   bucket checks that need chart time are done here in unix and never passed to it), and
//   unix → chart time is order-preserving, so the store hands it unix `time` unchanged.
//
// ⭐ AUTHORITY MODEL (what makes any ordering of server answers / frames converge, S5)
//   • SEALED: each server answer seals the span it CARRIES — [its first row (delta: since),
//     its claim] — where the claim is P1 `complete_through`, or on a legacy answer (no
//     contract fields) liveBarMerge I8: "the response holds a LATER bucket". The union of
//     those spans is `sealedSpans`; a server row inside it is final and immutable until
//     history_rev changes (P1 I2), and an ABSENT row inside it is also the server's (no
//     trades): non-server rows are never inserted there and are removed when a span covers
//     them. `completeThrough` = the greatest claim. Only REST seals: a push FINAL is the
//     feed's close, not a seal (bar-contract.md §5); it ranks above live frames, below a seal.
//   • Closed but unsealed rows: the observation with the greater `rev` (P1 HLC ms — REST
//     rows carry the answer's series_rev, frames their own rev) wins; ties by source rank
//     rest > final > push > tick > local.
//   • Developing: one bar, `t` > every closed row. Frames merge into it with mergePushBar,
//     gated by rev (a frame with rev ≤ the held one is ignored, P1 §2 "greater rev wins").
//     Ticks fold in only while the stream is NOT delivering (ctx.streamLive false) and never
//     move an authoritative open (foldPrice) — S6.
//   • Identity: a payload/frame whose sym / cache_key ticker+tf name another series is
//     ignored (S7); a changed cache_key (grid), a changed adj_basis (P4: the price basis) or a
//     risen history_rev on a FULL answer resets the entry before applying it; on a DELTA it
//     invalidates + sets needsFull.
//   • BASIS (P4, bar-contract.md §2 adj_basis): every LOCAL row carries the adj_basis stamp of
//     the copy it came from (`ab`; absent = an unstamped legacy copy). A server answer keeps a
//     local row only when its basis is PROVEN — by its stamp, or (unstamped) by `basisVerdict`
//     over the rows the answer also carries — never by a single close compared to a tolerance.

import { bucketStartUnix, computeBarTime, isRthBar, etDateOf, etMinuteOfDay } from '../../components/chart/barTime'
import { isHolidayISO } from '../../utils/marketSession'
import { bucketEndUnix } from '../../components/chart/liveBuckets'
import { foldOffGridBars } from '../../components/chart/offGridBars'
import { isSaneLivePriceFor } from '../../components/chart/liveTickBaseline'
import {
  mergePushBar, reconcileWithServerTail, foldPrice, provisionalOpen, isCompleteOhlc,
} from '../../lib/liveBarMerge'
import {
  ACTION, DEV_SRC, isDateTf, parseKey, dateLabelToUnix,
} from './types'
import { deriveStatus } from './status'
import { historyReachesTail } from '../../utils/historyPrepend'

// ── source ranks (tie-break among equal revs) ────────────────────────────────
const RANK = Object.freeze({ local: 0, tick: 1, push: 2, final: 3, rest: 4 })

const finite = (x) => typeof x === 'number' && Number.isFinite(x)
const numOrNull = (x) => (x == null || x === '' ? null : (Number.isFinite(Number(x)) ? Number(x) : null))
const revOf = (x) => (finite(x) ? x : -Infinity)

// ── state ────────────────────────────────────────────────────────────────────

const EMPTY_BARS = Object.freeze([])
const EMPTY_SPANS = Object.freeze([])

/** A fresh, empty entry for `key`. */
export function initialState(key, ctx = {}) {
  const p = parseKey(key)
  if (!p) throw new Error(`barStore: bad key ${key}`)
  const s = {
    key, sym: p.sym, tf: p.tf,
    bars: EMPTY_BARS, developing: null,
    completeThrough: null, verifiedThrough: null, seriesRev: null, historyRev: null,
    cacheKey: null, adjBasis: null, grid: null, tailStatus: null, restFrom: null, sealedSpans: EMPTY_SPANS, deltaFrom: null,
    status: 'empty', baseRev: 0, devRev: 0, depth: 0,
    source: null, restSeen: false, needsFull: true, error: null, invalidatedFor: null,
    gen: 0, pendingHistoryRev: null, depthFloor: 0, localHoleFrom: null, liveGapFrom: null,
  }
  s.status = deriveStatus(s, { ...ctx, session: ctx.session ?? p.session ?? 'rth' })
  return Object.freeze(s)
}

// ── time helpers (unix seconds only) ─────────────────────────────────────────

const _keyGrid = new Map()
function _gridFor(state) {
  // 60m: the bucket grid of the key ('60e' → clock); the server's `grid` overrides it
  // when it says otherwise (the server owns the row identity).
  if (state.grid === 'eth-clock') return 'clock'
  if (state.grid === 'rth-tv') return 'session'
  let g = _keyGrid.get(state.key)
  if (g === undefined) {
    g = parseKey(state.key)?.grid || 'session'
    if (_keyGrid.size > 5000) _keyGrid.clear()
    _keyGrid.set(state.key, g)
  }
  return g
}

/** Normalize a wire `t` (unix s | unix ms | 'YYYY-MM-DD') to the store's unix seconds. */
export function normT(t, tf) {
  if (typeof t === 'string') {
    if (/^\d{4}-\d{2}-\d{2}/.test(t)) return dateLabelToUnix(t.slice(0, 10))
    t = Number(t)
  }
  if (!finite(t)) return NaN
  let s = t > 1e11 ? Math.floor(t / 1000) : Math.floor(t)
  if (isDateTf(tf) && s % 86400 !== 0) s = dateLabelToUnix(computeBarTime(tf, s))
  return s
}

/** The bucket (store `t`) a trade at unix second `sec` belongs to — THE tick bucket rule: the
 *  tick merge below and liveFeed's tick-source arbitration both read it. */
export function bucketOf(sec, state) {
  const tf = state.tf
  if (isDateTf(tf)) return dateLabelToUnix(computeBarTime(tf, sec))
  return bucketStartUnix(sec, Number(tf), { grid: _gridFor(state) })
}

/** Exclusive END (unix s) of the bucket starting at `t`. */
export function bucketEnd(t, state) {
  const tf = state.tf
  if (tf === 'D' || tf === 'W') return t + 86400
  if (tf === 'M') {
    const d = new Date(t * 1000)
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / 1000
  }
  return bucketEndUnix(t, Number(tf), { grid: _gridFor(state) })
}

// ── bar shapes ───────────────────────────────────────────────────────────────

function _vol(v) { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : 0 }

/** Wire / cache row → store bar (unfrozen), or null when malformed. */
function toBar(r, tf, extra) {
  if (!r || typeof r !== 'object') return null
  const t = normT(r.t ?? r.time, tf)
  const o = Number(r.o ?? r.open), h = Number(r.h ?? r.high), l = Number(r.l ?? r.low), c = Number(r.c ?? r.close)
  if (!finite(t) || !isCompleteOhlc({ open: o, high: h, low: l, close: c })) return null
  return { t, o, h, l, c, v: _vol(r.v ?? r.volume), ...extra }
}

const freezeBar = (b) => (Object.isFrozen(b) ? b : Object.freeze(b))

/** store bar → liveBarMerge chart shape (time stays UNIX — see header). */
function toChartBar(b, sym) {
  if (!b) return null
  const out = { time: b.t, open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v, sym }
  if (b.provisional) out.provisional = true
  if (b.final || b.fin) out.final = true
  if (finite(b.authHigh)) out.authHigh = b.authHigh
  if (finite(b.authLow)) out.authLow = b.authLow
  if (finite(b.tradeTs)) out.tradeTs = b.tradeTs
  return out
}

function fromChartDev(cb, rev, src, ticked = false) {
  const d = { t: cb.time, o: cb.open, h: cb.high, l: cb.low, c: cb.close, v: _vol(cb.volume), rev: finite(rev) ? rev : null, src }
  if (ticked) d.ticked = true
  if (cb.provisional) d.provisional = true
  if (finite(cb.authHigh)) d.authHigh = cb.authHigh
  if (finite(cb.authLow)) d.authLow = cb.authLow
  if (finite(cb.tradeTs)) d.tradeTs = cb.tradeTs
  return Object.freeze(d)
}

/** The developing bar as a CLOSED row (its bucket ended without a seal/final). */
function devToRow(d) {
  // A bar a tick has touched (or opened) ranks as a tick: its values are not the server's.
  // A forming row restored from the caches (LOCAL) closes as a local row: it never ranks 'rest'.
  const rank = d.src === DEV_SRC.TICK || d.provisional || d.ticked ? 'tick'
    : (d.src === DEV_SRC.SERVER ? 'rest' : (d.src === DEV_SRC.LOCAL ? 'local' : 'push'))
  return freezeBar({ t: d.t, o: d.o, h: d.h, l: d.l, c: d.c, v: d.v, rev: d.rev ?? null, fin: false, src: rank })
}

// ── closed-row merge (the one rule for `bars`) ───────────────────────────────

function _idx(bars, t) {  // first index with bars[i].t >= t
  let lo = 0, hi = bars.length
  while (lo < hi) { const m = (lo + hi) >> 1; if (bars[m].t < t) lo = m + 1; else hi = m }
  return lo
}

/** Is the bucket starting at `t` inside a sealed span? */
function _inSpans(state, t) {
  const sp = state.sealedSpans
  if (!sp || !sp.length) return false
  const e = bucketEnd(t, state)
  for (const [a, c] of sp) if (t >= a && e <= c) return true
  return false
}
/** A held row is sealed when the server sent it and a sealed span covers it. */
const _isSealed = (state, row) => row.src === 'rest' && _inSpans(state, row.t)
/** Public: is this closed row of `state` sealed (final)? */
export const isSealedRow = (state, row) => !!row && _isSealed(state, row)
/** Public: is the bucket at `t` inside a sealed span (server-final, incl. absences)? */
export const inSealedSpan = (state, t) => _inSpans(state, t)

/** Where the next `since=` delta must start: the first closed row after the newest sealed
 *  one (a delta from later would leave it un-re-read), else the developing / last bar. */
function computeDeltaFrom(st) {
  const d = _deltaFromHeld(st)
  // A live gap (below) must be re-read: the delta starts no later than its first missing bucket.
  return (finite(st.liveGapFrom) && (d == null || st.liveGapFrom < d)) ? st.liveGapFrom : d
}
function _deltaFromHeld(st) {
  const bars = st.bars
  let i = bars.length
  while (i > 0 && !_isSealed(st, bars[i - 1])) i--
  if (i < bars.length) return bars[i].t
  if (st.developing) return st.developing.t
  return bars.length ? bars[bars.length - 1].t : null
}

// ── the live gap (P3-S2b) ────────────────────────────────────────────────────
// A LIVE source (push frame / tick) can open a developing bucket while buckets the SERVER NEVER
// VOUCHED FOR lie between the newest closed row and it (the closed-bar read stalled, a cold or
// switched key, a dropped stream). A bucket is missing only if it starts at or after
// max(verifiedThrough, end of the newest row): a thin name's quiet buckets that the server's
// verified_through covers are proven EMPTY, not missing. The entry records the first missing
// bucket (`liveGapFrom`); the delta starts at it (computeDeltaFrom) and the store kicks ONE read
// (index.js). Nothing else: status is untouched and the forming candle still paints (the chart
// draws no slot for an absent bucket). ANY server answer clears it. Only a live action that OPENS
// a new bucket sets it.

/** Is `sec` a minute of the key's session on an exchange trading day? */
function _sessionMinute(state, sec) {
  const iso = etDateOf(sec)
  const dow = new Date(iso + 'T12:00:00Z').getUTCDay()
  if (dow === 0 || dow === 6 || isHolidayISO(iso)) return false
  if (_sessionOf(state) === 'eth') { const m = etMinuteOfDay(sec); return m >= 240 && m < 1200 }
  return isRthBar(sec)
}
function _sessionOf(state) {
  const p = parseKey(state.key)
  return p?.session === 'eth' ? 'eth' : 'rth'
}
/** First EXPECTED bucket start strictly between closed row `lastT` and bucket `devT`, or null. */
export function liveGapStart(state, lastT, devT) {
  if (isDateTf(state.tf) || !finite(lastT) || !finite(devT) || devT <= lastT) return null
  // ⭐ SERVER PROOF FIRST (bar-contract.md §verified_through). A bucket the server VOUCHED for is
  // not missing when it holds no row — it is a proven-empty bucket (a thin name's quiet minute).
  // So a bucket is missing only if it starts at or after max(verifiedThrough, end of the newest row).
  const vt = numOrNull(state.verifiedThrough)
  const floor = Math.max(bucketEnd(lastT, state), vt != null ? vt : -Infinity)
  let cur = floor
  // Bounded walk (a long weekend is ~6k minutes): out-of-session minutes step by one minute.
  for (let n = 0; cur < devT && n < 8000; n++) {
    if (_sessionMinute(state, cur)) {
      const b = bucketOf(cur, state)
      if (b < floor) { cur = bucketEnd(b, state); continue }   // vouched for by the server
      return b >= devT ? null : b
    }
    cur += 60
  }
  return null
}

const MAX_SPANS = 16
/** Union `[a, c]` into a sorted, disjoint span list (frozen). */
function addSpan(spans, a, c) {
  if (!finite(a) || !finite(c) || c <= a) return spans
  const all = [...spans, [a, c]].sort((x, y) => x[0] - y[0])
  const out = []
  for (const [x, y] of all) {
    const last = out[out.length - 1]
    if (last && x <= last[1]) last[1] = Math.max(last[1], y)
    else out.push([x, y])
  }
  const kept = out.length > MAX_SPANS ? out.slice(out.length - MAX_SPANS) : out
  const same = kept.length === spans.length && kept.every((s2, i) => s2[0] === spans[i][0] && s2[1] === spans[i][1])
  return same ? spans : Object.freeze(kept.map((x) => Object.freeze(x)))
}

/** Should `inc` replace `held` at the same t? */
function _wins(inc, held, state) {
  // A server row always replaces a LOCAL copy (persisted rows are re-read, never trusted
  // over the server — S8); otherwise a sealed row is immutable.
  if (inc.src === 'rest' && held.src === 'local') return true
  if (_isSealed(state, held)) return false
  if (inc._sealed) return true
  const ri = revOf(inc.rev), rh = revOf(held.rev)
  if (ri !== rh) return ri > rh
  return RANK[inc.src] >= RANK[held.src]
}

/**
 * Merge sorted, unique `rows` (store bars, each with `src`, optional `_sealed`) into
 * `state.bars`. `span` = [from, C] of a server answer: inside it, held non-server rows the
 * answer does not contain are removed (absence in the sealed region is the server's).
 * Returns the new bars array (the SAME array when nothing changed).
 */
function mergeRows(state, rows, span = null) {
  const held = state.bars
  if (!rows.length && !span) return held
  const out = []
  let changed = false
  let i = 0, j = 0
  const inSpan = (t) => span && t >= span[0] && finite(span[1]) && bucketEnd(t, state) <= span[1]
  const strip = (r) => { if (!('_sealed' in r)) return freezeBar(r); const { _sealed, ...b } = r; return freezeBar(b) }
  while (i < held.length || j < rows.length) {
    const h = held[i], r = rows[j]
    if (r === undefined || (h !== undefined && h.t < r.t)) {
      if (inSpan(h.t) && h.src !== 'rest') { changed = true } else out.push(h)
      i++
    } else if (h === undefined || r.t < h.t) {
      // A new bucket. Inside the sealed region only the server may add one.
      if (r.src !== 'rest' && _inSpans(state, r.t)) { j++; continue }
      out.push(strip(r)); changed = true; j++
    } else {
      if (_wins(r, h, state) && !_sameBar(r, h)) { out.push(strip(r)); changed = true } else out.push(h)
      i++; j++
    }
  }
  return changed ? out : held
}

function _sameBar(a, b) {
  return a.t === b.t && a.o === b.o && a.h === b.h && a.l === b.l && a.c === b.c && a.v === b.v &&
    (a.rev ?? null) === (b.rev ?? null) && !!a.fin === !!b.fin && a.src === b.src
}

/** Sort + dedupe (last wins) + fold off-grid strays (intraday) — ONCE, at ingest. */
function ingestRows(raw, state, extra) {
  if (!Array.isArray(raw) || raw.length === 0) return []
  const tf = state.tf
  let rows = []
  for (const r of raw) { const b = toBar(r, tf, extra); if (b) rows.push(b) }
  if (!isDateTf(tf)) {
    const p = parseKey(state.key)
    rows = foldOffGridBars(rows, tf, { showExtended: _gridFor(state) === 'clock' || p?.session === 'eth' })
  }
  rows.sort((a, b) => a.t - b.t)
  const out = []
  for (const r of rows) {
    if (out.length && out[out.length - 1].t === r.t) out[out.length - 1] = r
    else out.push(r)
  }
  return out
}

// ── identity (S7) ────────────────────────────────────────────────────────────

function _cacheKeyParts(ck) {
  if (typeof ck !== 'string') return null
  const parts = ck.split(':')
  if (parts.length < 4) return null
  return { ticker: parts[1].toUpperCase(), tf: parts[2], grid: parts.slice(3).join(':') }
}

/** True when `obj` (payload/frame) names a different series than `state.key`. */
function isForeign(state, obj) {
  const sym = obj?.sym ?? obj?.ticker ?? obj?.symbol
  if (sym != null && String(sym).toUpperCase() !== state.sym) return true
  if (obj?.tf != null && String(obj.tf).replace(/^60e$/, '60').toUpperCase() !== String(state.tf).toUpperCase()) return true
  const ck = _cacheKeyParts(obj?.cache_key ?? obj?.cacheKey)
  if (ck && (ck.ticker !== state.sym || ck.tf.toUpperCase() !== String(state.tf).toUpperCase())) return true
  return false
}

// ── snapshot finalize (identity-stable, frozen, status) ──────────────────────

const BASE_FIELDS = ['completeThrough', 'verifiedThrough', 'seriesRev', 'historyRev', 'cacheKey', 'adjBasis', 'grid', 'restFrom', 'sealedSpans']
const META_FIELDS = ['tailStatus', 'source', 'restSeen', 'needsFull', 'error', 'invalidatedFor', 'deltaFrom', 'gen', 'pendingHistoryRev', 'depthFloor', 'localHoleFrom', 'liveGapFrom']

function _sameFields(a, b) {
  if (!a || !b) return false
  const ka = Object.keys(a)
  if (ka.length !== Object.keys(b).length) return false
  return ka.every((k) => a[k] === b[k] || (Number.isNaN(a[k]) && Number.isNaN(b[k])))
}

function finalize(prev, next, ctx) {
  const n = { ...prev, ...next }
  let { bars } = n
  // Depth cap: trims the OLDEST rows on tail growth, but never below the depth the user
  // scrolled back to (`depthFloor`, raised by scroll-back) — deep history a scroll just
  // fetched is not thrown away again. Memory is bounded by the registry's bar budget.
  const cap = ctx?.depthCap
  if (finite(cap) && cap > 0) {
    const limit = Math.max(cap, n.depthFloor || 0)
    if (bars.length > limit) {
      bars = bars.slice(bars.length - limit)
      if (n.restFrom != null && bars.length && n.restFrom < bars[0].t) n.restFrom = bars[0].t
      n.bars = bars
    }
  }
  // Same rows (by identity) => same array: a no-op trim / merge never bumps baseRev.
  if (n.bars !== prev.bars && n.bars.length === prev.bars.length && n.bars.every((b, i) => b === prev.bars[i])) n.bars = prev.bars
  // ...and the same developing VALUES => the same developing object (S10: a re-applied answer
  // that rebuilds an identical bar is a no-op, never a devRev bump).
  if (n.developing !== prev.developing && _sameFields(n.developing, prev.developing)) n.developing = prev.developing
  const baseChanged = n.bars !== prev.bars || BASE_FIELDS.some((f) => n[f] !== prev[f])
  const devChanged = n.developing !== prev.developing
  if (baseChanged && n.bars !== prev.bars && !Object.isFrozen(n.bars)) Object.freeze(n.bars)
  n.baseRev = prev.baseRev + (baseChanged ? 1 : 0)
  n.devRev = prev.devRev + (devChanged ? 1 : 0)
  n.depth = n.bars.length
  // Live gap: checked only when a LIVE action opens a new developing bucket (a server answer
  // passes `liveGapFrom` explicitly — null — and so clears it; see liveGapStart).
  if (!('liveGapFrom' in next) && devChanged && n.developing && n.liveGapFrom == null
      && n.developing.src !== DEV_SRC.SERVER && n.developing.src !== DEV_SRC.LOCAL
      && (!prev.developing || prev.developing.t !== n.developing.t) && n.bars.length) {
    const g = liveGapStart(n, n.bars[n.bars.length - 1].t, n.developing.t)
    if (g != null) n.liveGapFrom = g
  }
  n.deltaFrom = computeDeltaFrom(n)
  // ⛔ A LOCAL HOLE OLDER THAN THE DELTA START IS NEVER RE-READ by a since= delta (it asks only
  // from deltaFrom): the next request must be a FULL read — a status rule on what is held, not
  // a timer. Cleared by the full answer (applyRest), which re-proves the region it carries.
  if (finite(n.localHoleFrom) && finite(n.deltaFrom) && n.localHoleFrom < n.deltaFrom) n.needsFull = true
  const p = parseKey(n.key)
  n.status = deriveStatus(n, { ...ctx, session: p?.session === 'eth' ? 'eth' : (ctx?.session ?? 'rth') })
  if (!baseChanged && !devChanged && n.status === prev.status && META_FIELDS.every((f) => n[f] === prev[f])) {
    return prev
  }
  return Object.freeze(n)
}

// ── developing helpers ───────────────────────────────────────────────────────

/** Close the developing bar into `bars` when a later bucket proves it ended. */
function closeDeveloping(state, bars) {
  const d = state.developing
  if (!d) return { bars, developing: null }
  const row = devToRow(d)
  return { bars: mergeRows({ ...state, bars }, [row]), developing: null }
}

/** Keep `developing` strictly after the newest closed row (S3). */
function settleDeveloping(state, bars, dev) {
  const last = bars.length ? bars[bars.length - 1] : null
  if (dev && last && dev.t <= last.t) {
    return { bars: mergeRows({ ...state, bars }, [devToRow(dev)]), developing: null }
  }
  return { bars, developing: dev }
}

// ── price basis (P4) ─────────────────────────────────────────────────────────

/** Relative tolerance of the basis test: a row pair's four price ratios must agree to it
 *  (one uniform rescale), and |r - 1| must exceed it for a rescale to count. Wide enough for
 *  4-decimal rounding on a cheap name, far below any split / re-adjustment. */
export const BASIS_EPS = 0.005
/** Volume tolerance of a rescaled pair: server v / local v ≈ 1/r (a split moves volume) or
 *  ≈ 1 (a price-only re-adjustment). */
export const BASIS_VOL_TOL = 0.05
const BASIS_MAX_PAIRS = 64

/**
 * THE client basis test for rows WITHOUT a usable stamp (legacy copies). `local` = held
 * rows, `ref` = the server's rows (array or Map t → row). Pairs rows by `t`, oldest first
 * (at most 64):
 *   • 'changed' — at least TWO pairs whose o/h/l/c ALL share one ratio r (to BASIS_EPS) with
 *     |r − 1| > BASIS_EPS, the same r on both, and volume ≈ 1/r (or unchanged): the copy is on
 *     another price basis (a split / re-adjustment since it was written);
 *   • 'same'    — no such rescale and at least one pair whose four prices agree (r ≈ 1);
 *   • 'unknown' — no evidence either way (no overlap, or only rows that differ non-uniformly:
 *     a bucket the copy caught while forming, a corrected print).
 * Why not the old "oldest overlap close differs > 2%" rule: a closed row the copy caught
 * while it was still forming differs on its close alone (a volatile name easily > 2%) — a
 * false positive that threw away the whole cache; and a uniform rescale is the ONLY shape a
 * basis change has. Pure.
 */
export function basisVerdict(local, ref) {
  const byT = ref instanceof Map ? ref : new Map((ref || []).map((r) => [r.t, r]))
  let same = 0, n = 0
  const scaled = []
  for (const a of local || []) {
    const b = byT.get(a.t)
    if (!b) continue
    if (++n > BASIS_MAX_PAIRS) break
    const rs = [b.o / a.o, b.h / a.h, b.l / a.l, b.c / a.c]
    if (!rs.every((x) => finite(x) && x > 0)) continue
    const lo = Math.min(...rs), hi = Math.max(...rs)
    if (hi / lo - 1 > BASIS_EPS) continue                // not ONE rescale of the row
    const r = Math.sqrt(lo * hi)
    if (Math.abs(r - 1) <= BASIS_EPS) { same++; continue }
    const va = Number(a.v), vb = Number(b.v)
    if (va > 0 && vb > 0) {
      const q = vb / va
      if (!(Math.abs(q * r - 1) <= BASIS_VOL_TOL || Math.abs(q - 1) <= BASIS_VOL_TOL)) continue
    }
    scaled.push(r)
  }
  scaled.sort((x, y) => x - y)
  for (let i = 1; i < scaled.length; i++) if (scaled[i] / scaled[i - 1] - 1 <= BASIS_EPS) return 'changed'
  return same > 0 ? 'same' : 'unknown'
}

const _stampOf = (p) => {
  const ab = p?.adj_basis ?? p?.adjBasis
  return typeof ab === 'string' && ab ? ab : null
}

// ── one guard for every server-sourced action ────────────────────────────────

/**
 * Why a server payload must be refused whole, or null. ONE rule for rest-full, rest-delta,
 * rest-error, scroll-back and local copies:
 *   • `gen`: it was requested before the entry's last invalidate (P2b stamps every request);
 *   • `history_rev` older than what we hold (or are waiting for): a late answer from before a
 *     correction / delete — merging it would resurrect rows the newer history removed.
 */
function staleReason(state, p, action) {
  if (action.gen != null && action.gen !== state.gen) return 'gen'
  const h = numOrNull(p.history_rev ?? p.historyRev)
  const held = Math.max(revOf(state.historyRev), revOf(state.pendingHistoryRev))
  if (h != null && finite(held) && h < held) return 'history_rev'
  return null
}

// ── REST answers ─────────────────────────────────────────────────────────────

const _hasContract = (p) => p && (p.contract != null || 'complete_through' in p || 'developing' in p)

function applyRest(state, action, ctx, kind) {
  const p = action.payload || {}
  if (isForeign(state, p) || staleReason(state, p, action)) return state
  const contract = _hasContract(p)
  const inCk = p.cache_key ?? null
  const inHist = numOrNull(p.history_rev)
  const inSeries = numOrNull(p.series_rev)
  const inGrid = p.grid ?? null
  const inAdj = _stampOf(p)

  // S8: seals RESTORED from a persisted copy (spans held before any server answer) are only
  // as good as the identity they were proven under. An answer that cannot confirm it — legacy
  // (no contract), a null history_rev / cache_key, or a different one — voids them: the rows
  // drop to local, a delta (asked on the strength of those seals) is refused and a full read
  // is required.
  if (!state.restSeen && state.sealedSpans.length) {
    const proven = contract && inHist != null && inCk != null && inHist === state.historyRev && inCk === state.cacheKey
    if (!proven) {
      const demoted = _unseal(state)
      if (kind === 'delta') {
        return finalize(state, { ...demoted, needsFull: true, invalidatedFor: 'restored_seal', gen: state.gen + 1 }, ctx)
      }
      state = Object.freeze({ ...state, ...demoted, baseRev: state.baseRev + 1, invalidatedFor: 'restored_seal' })
    }
  }

  // Identity / history change. A different price basis (P4 adj_basis) is a different row
  // series exactly like a different cache_key: nothing held on the old one is kept.
  const ckChanged = (inCk != null && state.cacheKey != null && inCk !== state.cacheKey) ||
    (inAdj != null && state.adjBasis != null && inAdj !== state.adjBasis)
  const ckWhy = inCk != null && state.cacheKey != null && inCk !== state.cacheKey ? 'cache_key' : 'adj_basis'
  const histRose = inHist != null && state.historyRev != null && inHist > state.historyRev
  if ((ckChanged || histRose) && kind === 'delta') {
    // The held window is no longer the server's history. Keep showing it (no blank chart)
    // while a FULL read is fetched; refuse further deltas until it lands, and bump the
    // generation so requests issued against the old history are dropped.
    if (state.pendingHistoryRev != null && !ckChanged && inHist <= state.pendingHistoryRev) return state
    return finalize(state, {
      needsFull: true, invalidatedFor: ckChanged ? ckWhy : 'history_rev',
      pendingHistoryRev: inHist ?? state.pendingHistoryRev, gen: state.gen + 1,
    }, ctx)
  }
  if (kind === 'delta' && state.pendingHistoryRev != null) return state   // only a full read now
  if (ckChanged || histRose) {
    // The full answer of the new history replaces the entry ATOMICALLY (one snapshot).
    state = Object.freeze({ ...initialState(state.key, ctx), baseRev: state.baseRev + 1, devRev: state.devRev + 1,
      gen: state.gen, depthFloor: state.depthFloor, invalidatedFor: ckChanged ? ckWhy : 'history_rev' })
  }
  // A grid the rows were not built on cannot merge (the server owns row identity).
  const stGrid = inGrid ?? state.grid
  const working = { ...state, grid: stGrid }

  const nowSec = Math.floor((ctx.nowMs ?? Date.now()) / 1000)
  const rev = inSeries
  let rows = ingestRows(p.bars, working, { rev, fin: false, src: 'rest' })

  // ⛔ SPLIT SAFETY (P4). LOCAL rows are a cache copy on the price basis of when it was written;
  // the server's answer is on today's. A local row stays only when its basis is PROVEN:
  //   • stamped (`ab`, the copy's adj_basis) — equal to the answer's adj_basis: kept, no test;
  //     another stamp: every local row is on an old basis;
  //   • unstamped (a legacy copy) or an answer without adj_basis — `basisVerdict` over the rows
  //     the answer also carries: 'changed' (≥ 2 rows uniformly rescaled) ⇒ every local row is on
  //     the old basis; 'same' ⇒ the copy is proven (re-stamped with the answer's basis);
  //     'unknown' (no overlap evidence) ⇒ a FULL answer that names its basis discards the
  //     unproven rows once (a delta keeps them for the next full read to judge).
  // Rows on an old basis LEFT of the answer would draw a cliff that never traded: all local rows
  // go (a full answer resets the entry, then applies; a delta asks for that full read).
  const localRows = rows.length ? state.bars.filter((b) => b.src === 'local') : EMPTY_BARS
  if (localRows.length) {
    const trusted = (b) => inAdj != null && b.ab === inAdj
    const unproven = localRows.filter((b) => !trusted(b))
    const verdict = (inAdj != null && localRows.some((b) => b.ab != null && b.ab !== inAdj)) ? 'changed'
      : (unproven.length ? basisVerdict(unproven, rows) : 'same')
    if (verdict === 'changed') {
      if (kind === 'delta') return finalize(state, { needsFull: true, invalidatedFor: 'basis', gen: state.gen + 1 }, ctx)
      const reset = Object.freeze({ ...initialState(state.key, ctx), baseRev: state.baseRev + 1, devRev: state.devRev + 1,
        gen: state.gen, invalidatedFor: 'basis' })
      return applyRest(reset, action, ctx, kind)
    }
    if (inAdj != null && unproven.length && (verdict === 'same' || kind === 'full')) {
      const keep = verdict === 'same'
      const bars = Object.freeze(state.bars.flatMap((b) => {
        if (b.src !== 'local' || trusted(b)) return [b]
        return keep ? [freezeBar({ ...b, ab: inAdj })] : []
      }))
      state = Object.freeze({ ...state, bars, baseRev: state.baseRev + 1, ...(keep ? {} : { invalidatedFor: 'basis' }) })
      working.bars = bars
    }
  }

  // The forming bar of this answer.
  let devIn = null
  if (contract) {
    if (p.developing) {
      const d = toBar(p.developing, state.tf, {})
      if (d) devIn = { ...d, rev: numOrNull(p.developing.rev) ?? rev }
    }
  } else if (rows.length) {
    const last = rows[rows.length - 1]
    if (bucketEnd(last.t, working) > nowSec) devIn = { ...last, rev, legacy: true }
  }
  if (devIn) rows = rows.filter((r) => r.t !== devIn.t)
  if (devIn && rows.length && devIn.t < rows[rows.length - 1].t) {
    // The answer's "developing" is older than its own closed rows — treat it as a row.
    rows = ingestRows([...rows, devIn], working, { rev, fin: false, src: 'rest' })
    devIn = null
  }

  // What this answer seals.
  // A contract answer seals exactly its `complete_through`; NULL means nothing is
  // guaranteed (bar-contract.md §2/§9: before a series' first tail repair; D/W/M, §8) — its
  // rows stay unsealed and ordered by rev, so a later correction (series_rev up, same
  // history_rev) still lands. Only a LEGACY answer (no contract fields) uses liveBarMerge
  // I8: a row is complete when the answer holds a LATER bucket.
  let sealedIn
  if (contract) sealedIn = numOrNull(p.complete_through)
  else {
    const all = devIn ? [...rows, devIn] : rows
    sealedIn = all.length >= 2 ? bucketEnd(all[all.length - 2].t, working) : null
  }
  const spanFrom = kind === 'delta' && finite(numOrNull(p.since)) ? normT(p.since, state.tf)
    : (rows.length ? rows[0].t : null)
  if (spanFrom == null) sealedIn = null   // an answer seals only what it carries
  if (finite(sealedIn)) for (const r of rows) if (bucketEnd(r.t, working) <= sealedIn) r._sealed = true

  const C = finite(sealedIn) && (!finite(state.completeThrough) || sealedIn > state.completeThrough)
    ? sealedIn : state.completeThrough
  const restFrom = rows.length
    ? (state.restFrom == null ? rows[0].t : Math.min(state.restFrom, rows[0].t)) : state.restFrom
  // Merge against the HELD seals (a held sealed row is immutable; an incoming sealed row
  // replaces any unsealed one), then extend the seal and apply this answer's absences.
  let bars = mergeRows(working, rows, null)
  const sealedSpans = finite(sealedIn) ? addSpan(state.sealedSpans, spanFrom, sealedIn) : state.sealedSpans
  const after = { ...working, bars, completeThrough: C, restFrom, sealedSpans }
  if (finite(sealedIn)) bars = mergeRows(after, [], [spanFrom, sealedIn])

  // Developing.
  let dev = state.developing
  let st = { ...after, bars }
  if (dev && bars.length && dev.t <= bars[bars.length - 1].t) {
    ({ bars, developing: dev } = closeDeveloping(st, bars)); st = { ...st, bars }
  }
  if (devIn) {
    if (!dev || devIn.t > dev.t) {
      if (dev) { ({ bars } = closeDeveloping(st, bars)); st = { ...st, bars } }
      const nb = mergePushBar(null, toChartBar(devIn, state.sym), { sym: state.sym })
      dev = nb.kind === 'drop' ? null : fromChartDev(nb.bar, devIn.rev, DEV_SRC.SERVER)
    } else if (devIn.t === dev.t) {
      if (dev.src === DEV_SRC.LOCAL && !dev.ticked) {
        // A forming bar RESTORED from the caches is a copy taken while the bucket was forming
        // (its close is as old as the copy), not a live observation. The server's answer takes
        // its open and close. Its EXTREMES replace the copy's only when the answer is
        // AUTHORITATIVE for everything the copy saw — `verified_through` (the provider was asked
        // and every row it returned had reached the store) at or after the copy's read time
        // (`seenAt`, the cache record's savedAt). Otherwise the answer may lag the copy (an
        // unverified / delta-deadline / stale-swr serve): H/L merge monotonically (S4 — a
        // developing bar's high never falls, its low never rises), volume never falls. Only a
        // bar live ticks have touched since (`ticked`) keeps its close (Writer D's rule below).
        const nb = mergePushBar(null, toChartBar(devIn, state.sym), { sym: state.sym })
        const srv = nb.kind === 'drop' ? null : fromChartDev(nb.bar, devIn.rev, DEV_SRC.SERVER)
        const vt = numOrNull(p.verified_through)
        const covers = finite(dev.seenAt) && vt != null && vt >= dev.seenAt
        dev = (!srv || covers) ? srv : Object.freeze({
          ...srv, h: Math.max(srv.h, dev.h), l: Math.min(srv.l, dev.l), v: Math.max(srv.v, dev.v),
        })
      } else if (devIn.legacy && !finite(dev.rev)) {
        // Writer D's rule (no revs to order by): server open, H/L union, live close stands.
        const r = reconcileWithServerTail(toChartBar(dev, state.sym), toChartBar(devIn, state.sym), { sym: state.sym })
        dev = fromChartDev(r.bar, dev.rev, dev.src === DEV_SRC.TICK || dev.src === DEV_SRC.LOCAL ? DEV_SRC.SERVER : dev.src)
      } else if (dev.provisional || dev.ticked || revOf(devIn.rev) > revOf(dev.rev)) {
        const m = mergePushBar(toChartBar(dev, state.sym), toChartBar(devIn, state.sym), { sym: state.sym })
        if (m.kind === 'update') dev = fromChartDev(m.bar, Math.max(revOf(dev.rev), revOf(devIn.rev)), DEV_SRC.SERVER)
      }
      // The server answered for this very bucket: a restored (LOCAL) forming bar is now its.
      if (dev && dev.src === DEV_SRC.LOCAL) dev = Object.freeze({ ...dev, src: DEV_SRC.SERVER })
    } else {
      // The push feed is already on a later bucket: the answer's forming bar is closed.
      bars = mergeRows(st, [{ ...devIn, src: 'rest', fin: false, legacy: undefined }].map(_clean))
      st = { ...st, bars }
    }
  }
  ;({ bars, developing: dev } = settleDeveloping(st, bars, dev))

  return finalize(state, {
    grid: stGrid,
    bars, developing: dev,
    completeThrough: C, restFrom, sealedSpans,
    verifiedThrough: _maxOrKeep(state.verifiedThrough, numOrNull(p.verified_through)),
    seriesRev: inSeries != null ? Math.max(inSeries, state.seriesRev ?? -Infinity) : state.seriesRev,
    historyRev: inHist != null ? Math.max(inHist, state.historyRev ?? -Infinity) : state.historyRev,
    cacheKey: inCk ?? state.cacheKey,
    // D4 (review of #1144): an answer that CARRIES rows but names no basis (an unhealed /
    // fallback store) leaves them unproven — the entry's stamp is NOT carried onto them (the
    // persisted copy is then unstamped and re-judged by basisVerdict). Row-less answers keep it.
    adjBasis: inAdj != null ? inAdj : (Array.isArray(p.bars) && p.bars.length ? null : state.adjBasis),
    // The tail judgement of the NEWEST answer (by series_rev) stands — order-independent.
    tailStatus: (p.tail_status != null && (inSeries == null || state.seriesRev == null || inSeries >= state.seriesRev))
      ? p.tail_status : state.tailStatus,
    source: 'rest', restSeen: true, needsFull: false, error: null,
    pendingHistoryRev: kind === 'full' ? null : state.pendingHistoryRev,
    // A full answer re-proves what it carries: a local hole it did not fill is the server's.
    localHoleFrom: kind === 'full' ? null : state.localHoleFrom,
    liveGapFrom: null,   // the server answered: what it still lacks is its truth (P3-S2b)
  }, ctx)
}

/** The fields of `state` without any seal: spans, claim and server provenance dropped. */
function _unseal(state) {
  const bars = Object.freeze(state.bars.map((b) => (b.src === 'rest' ? freezeBar({ ...b, src: 'local' }) : b)))
  return { bars, sealedSpans: EMPTY_SPANS, completeThrough: null, restFrom: null }
}

function _clean(r) { const { legacy: _legacy, ...b } = r; return b }

/** Is the hole after the held bar at `t` (up to the next held bar) inside ONE sealed span? */
function _absenceSealed(spans, bars, t) {
  if (!spans?.length) return false
  const next = bars.find((b) => b.t > t)
  if (!next) return false
  return spans.some(([a, c]) => a <= t && c >= next.t)
}
const _maxOrKeep = (held, inc) => (inc == null ? held : (held == null ? inc : Math.max(held, inc)))

// ── local hits (pack / IDB / mem) ────────────────────────────────────────────

function applyLocal(state, action, ctx, source) {
  const p = action.payload || {}
  if (isForeign(state, p)) return state
  const ck = p.cache_key ?? p.cacheKey ?? null
  const hist = numOrNull(p.history_rev ?? p.historyRev)
  const ab = _stampOf(p)
  // S8: a copy of another row series / of older sealed history / on another price basis
  // (P4 adj_basis — the same refusal as a cache_key mismatch) is discarded whole.
  if (ck != null && state.cacheKey != null && ck !== state.cacheKey) return state
  if (ab != null && state.adjBasis != null && ab !== state.adjBasis) return state
  if (staleReason(state, p, action)) return state
  const rev = numOrNull(p.series_rev ?? p.seriesRev)
  // Two local copies (mem, then IDB) before any server answer: one of a NEWER history replaces
  // the entry — the other's rows and seals belong to the history it superseded.
  if (!state.restSeen && hist != null && state.historyRev != null && hist > state.historyRev) {
    state = Object.freeze({ ...initialState(state.key, ctx), baseRev: state.baseRev + 1, devRev: state.devRev + 1,
      gen: state.gen, depthFloor: state.depthFloor, invalidatedFor: 'history_rev' })
  }
  // ... and one of the same history but an OLDER series_rev is an older snapshot: it may only
  // add deeper rows (never its seals, never its tail).
  const olderCopy = !state.restSeen && rev != null && state.seriesRev != null && rev < state.seriesRev
  const working = { ...state, grid: p.grid ?? state.grid }
  let rows = ingestRows(p.bars, working, { rev, fin: false, src: 'local', ...(ab != null ? { ab } : {}) })
  if (!rows.length) return state
  // The basis of what is held, and whether this copy is PROVEN to be on it: by its stamp, or
  // (unstamped) by `basisVerdict` over the rows it shares with what is held.
  const heldBasisProof = (held) => {
    if (ab != null && (state.adjBasis == null || ab === state.adjBasis)) return true
    return basisVerdict(rows, held) === 'same'
  }

  // ⭐ THE PERSISTED DEEP-HISTORY SEGMENT (persist.js `@hist`: scroll-back windows a reload kept).
  // It only PREPENDS — rows strictly older than everything held — and only when it reaches the
  // held oldest bar (historyReachesTail: a gap is never drawn as contiguous; persist cut it at
  // its newest interior hole) on the SAME basis: stamped (adj_basis / history_rev / cache_key,
  // refused above when another; a history_rev that is not EXACTLY the one held is another
  // history) or, unstamped, proven by `basisVerdict` over its overlap with the held rows.
  if (p.history) {
    const held = state.bars.length ? state.bars : (state.developing ? [state.developing] : [])
    if (!held.length || !historyReachesTail(rows, held)) return state
    if (hist != null && state.historyRev != null && hist !== state.historyRev) return state
    if (!heldBasisProof(held)) return state
    const older = rows.filter((r) => r.t < held[0].t)
    if (!older.length) return state
    const bars = mergeRows(state, older)
    if (bars === state.bars) return state
    return finalize(state, { bars, depthFloor: Math.max(state.depthFloor || 0, bars.length) }, ctx)
  }

  // S8 PROVENANCE: a persisted copy (persist.js) may carry the seals it held. They are
  // restored only before any server answer, only with the row-series identity and history
  // they were proven under (cache_key + history_rev; a mismatch was refused above), and
  // persist.js has already cut every span whose stored rows are not identical to the rows
  // the store sealed. A restored span means what a server span means: its rows are final,
  // absences inside it are the server's, and the next request can be a since= delta.
  const seals = !state.restSeen && !olderCopy && Array.isArray(p.sealed_spans) && ck != null && hist != null
    ? p.sealed_spans : null
  let spans = state.sealedSpans
  if (seals) {
    for (const sp of seals) if (Array.isArray(sp)) spans = addSpan(spans, Number(sp[0]), Number(sp[1]))
    const sealedSt = { ...working, sealedSpans: spans }
    for (const r of rows) if (_inSpans(sealedSt, r.t)) { r.src = 'rest'; r._sealed = true }
  }

  if (state.restSeen || olderCopy) {
    // A server answer (or a newer copy) is held: a local copy only adds DEEPER history, and
    // only on the held basis (stamped, or proven over its overlap with the held rows).
    const held = state.bars.length ? state.bars : (state.developing ? [state.developing] : [])
    if (state.restSeen && held.length && !heldBasisProof(held)) return state
    const first = Math.min(state.restFrom ?? Infinity, state.bars[0]?.t ?? Infinity, state.developing?.t ?? Infinity)
    rows = rows.filter((r) => r.t < first)
    if (!rows.length) return state
    return finalize(state, { bars: mergeRows(state, rows) }, ctx)
  }
  // No server answer yet: the local copy is the best we have. Its last row is the forming
  // bucket when the clock says that bucket has not ended.
  const nowSec = Math.floor((ctx.nowMs ?? Date.now()) / 1000)
  let devIn = null
  const lastRow = rows[rows.length - 1]
  if (!lastRow._sealed && bucketEnd(lastRow.t, working) > nowSec) { devIn = lastRow; rows = rows.slice(0, -1) }
  let bars = mergeRows(working, rows)
  if (spans !== state.sealedSpans) {
    // Absences inside a restored span are the server's: drop earlier local-only rows there.
    for (const sp of spans) bars = mergeRows({ ...working, bars, sealedSpans: spans }, [], sp)
  }
  let dev = state.developing
  let st = { ...working, bars, sealedSpans: spans }
  if (devIn && (!dev || devIn.t > dev.t)) {
    if (dev) { ({ bars } = closeDeveloping(st, bars)); st = { ...st, bars } }
    dev = fromChartDev(mergePushBar(null, toChartBar(devIn, state.sym), { sym: state.sym }).bar, devIn.rev, DEV_SRC.LOCAL)
    // When the copy was READ (the cache record's savedAt, unix s): what a server answer must be
    // verified through to replace its extremes (applyRest, restored forming bar).
    const seenMs = numOrNull(p.saved_at ?? p.savedAt)
    if (seenMs != null) dev = Object.freeze({ ...dev, seenAt: Math.floor(seenMs / 1000) })
  }
  ;({ bars, developing: dev } = settleDeveloping(st, bars, dev))
  // An interior HOLE in the copy (barsIDB `_intradayGapStart`, reported by persist as
  // `repair_from` = the bar before it) that no restored seal explains (a sealed absence is the
  // server's): remembered, so finalize's rule asks for a full read when a delta could not reach it.
  const holeIn = numOrNull(p.repair_from)
  const localHoleFrom = (holeIn != null && !_absenceSealed(spans, bars, holeIn))
    ? Math.min(state.localHoleFrom ?? Infinity, holeIn) : state.localHoleFrom
  // A persisted contract (hydrate ∘ persist = base, S8) restores its claims.
  const C = numOrNull(p.complete_through ?? p.completeThrough)
  return finalize(state, {
    grid: working.grid, bars, developing: dev,
    completeThrough: _maxOrKeep(state.completeThrough, C),
    restFrom: C != null ? (state.restFrom ?? (bars[0]?.t ?? null)) : state.restFrom,
    verifiedThrough: _maxOrKeep(state.verifiedThrough, numOrNull(p.verified_through ?? p.verifiedThrough)),
    seriesRev: rev != null ? Math.max(rev, state.seriesRev ?? -Infinity) : state.seriesRev,
    historyRev: hist ?? state.historyRev,
    cacheKey: ck ?? state.cacheKey,
    adjBasis: ab ?? state.adjBasis,
    sealedSpans: spans,
    localHoleFrom,
    // Restored seals make a since= delta sound (deltaFrom starts after the newest seal).
    ...(spans !== state.sealedSpans ? { needsFull: false } : {}),
    source,
  }, ctx)
}

// ── push frames ──────────────────────────────────────────────────────────────

/** Accept a raw /api/stream/bars frame ({sym, tf, bar:{t ms,…}, rev, final, t_s, cache_key…})
 *  or a flat {t, o, h, l, c, v, rev, final, trade_ts}. */
function normFrame(ev, state) {
  if (!ev || typeof ev !== 'object') return null
  const bar = ev.bar && typeof ev.bar === 'object' ? ev.bar : ev
  const t = ev.t_s ?? bar.t ?? bar.time
  const b = toBar({ ...bar, t }, state.tf, {})
  if (!b) return null
  const tradeTs = numOrNull(bar.trade_ts ?? ev.trade_ts ?? bar.tradeTs)
  return {
    ...b,
    rev: numOrNull(ev.rev ?? bar.rev),
    final: !!(ev.final ?? bar.final),
    tradeTs: tradeTs != null ? (tradeTs > 1e11 ? tradeTs : tradeTs * 1000) : null,   // ms
  }
}

function applyPush(state, action, ctx, isFinal) {
  const ev = action.event ?? action.payload
  if (isForeign(state, ev)) return state
  if (ev?.grid && state.grid && ev.grid !== state.grid) return state
  const f = normFrame(ev, state)
  if (!f) return state
  // A bar's `t` is its bucket start; a frame off the grid is malformed (folding is the
  // ingest's job for stored rows — a live frame is never re-keyed).
  if (!isDateTf(state.tf) && bucketOf(f.t, state) !== f.t) return state
  // I4 by trade time, in unix: the newest trade must lie inside the frame's own bucket.
  if (f.tradeTs != null) {
    const ts = Math.floor(f.tradeTs / 1000)
    if (ts < f.t || ts >= bucketEnd(f.t, state)) return state
  }
  const final = isFinal || f.final
  const sym = state.sym
  let bars = state.bars
  let dev = state.developing
  const last = bars.length ? bars[bars.length - 1] : null

  // A frame for a bucket at or before the newest closed row, or before the developing
  // bar: never the developing candle (I4) — it competes as a CLOSED row (rev order; never
  // inside the sealed region).
  if ((last && f.t <= last.t) || (dev && f.t < dev.t)) {
    if (_inSpans(state, f.t)) return state
    const row = { t: f.t, o: f.o, h: f.h, l: f.l, c: f.c, v: f.v, rev: f.rev, fin: final, src: final ? 'final' : 'push' }
    return finalize(state, { bars: mergeRows(state, [row]) }, ctx)
  }

  let st = state
  if (dev && f.t > dev.t) { ({ bars, developing: dev } = closeDeveloping(st, bars)); st = { ...st, bars } }

  const inc = { time: f.t, open: f.o, high: f.h, low: f.l, close: f.c, volume: f.v }
  if (dev && f.t === dev.t) {
    if (!dev.provisional && !dev.ticked && dev.src !== DEV_SRC.TICK && f.rev != null && dev.rev != null && f.rev <= dev.rev) {
      if (!final) return state
      // An older FINAL still CLOSES the bucket (the feed moved on); its values compete with
      // the newer observation we hold as closed rows, by rev.
      const row = { t: f.t, o: f.o, h: f.h, l: f.l, c: f.c, v: f.v, rev: f.rev, fin: true, src: 'final' }
      const closed = closeDeveloping(st, bars)
      return finalize(state, { bars: mergeRows({ ...st, bars: closed.bars }, [row]), developing: null }, ctx)
    }
    const m = mergePushBar(toChartBar(dev, sym), inc, { sym, final, tradeTs: f.tradeTs })
    if (m.kind !== 'update') return state
    const rev = Math.max(revOf(dev.rev), revOf(f.rev))
    if (final) {
      const b = m.bar
      const row = { t: f.t, o: b.open, h: b.high, l: b.low, c: b.close, v: _vol(b.volume), rev: finite(rev) ? rev : null, fin: true, src: 'final' }
      return finalize(state, { bars: mergeRows({ ...st, bars }, [row]), developing: null }, ctx)
    }
    dev = fromChartDev(m.bar, rev, DEV_SRC.PUSH)
    return finalize(state, { bars, developing: dev }, ctx)
  }
  // A new (later) bucket.
  if (final) {
    const row = { t: f.t, o: f.o, h: f.h, l: f.l, c: f.c, v: f.v, rev: f.rev, fin: true, src: 'final' }
    return finalize(state, { bars: mergeRows({ ...st, bars }, [row]), developing: null }, ctx)
  }
  const m = mergePushBar(null, inc, { sym, tradeTs: f.tradeTs })
  if (m.kind !== 'new') return state
  return finalize(state, { bars, developing: fromChartDev(m.bar, f.rev, DEV_SRC.PUSH) }, ctx)
}

// ── tick fallback ────────────────────────────────────────────────────────────

/**
 * ⭐ WOULD THIS TICK APPLY? — the one admission rule of the tick fallback (applyTick below and
 * liveFeed's source arbitration both read it, so a print the reducer refuses can never hold a
 * bucket or keep a source "live"). Sanity against THIS key's own closes, a finite bucket, never a
 * closed / sealed bucket, never earlier than the developing one. Pure. Returns
 * {price, ts (unix s), t (bucket)} or null.
 */
export function tickAdmission(state, ev) {
  if (!state || !ev) return null
  const price = Number(ev.price ?? ev.p ?? ev.c)
  let ts = numOrNull(ev.ts ?? ev.t ?? ev.time)
  if (!finite(price) || ts == null) return null
  if (ts > 1e11) ts = Math.floor(ts / 1000)
  const bars = state.bars || []
  const last = bars.length ? bars[bars.length - 1] : null
  const dev = state.developing
  // Baselines of THIS key's symbol only (a store never holds another symbol's closes).
  const ref = dev || last
  const sane = isSaneLivePriceFor(state.sym, price, {
    lastBar: ref ? { close: ref.c } : null, lastBarSym: state.sym,
    serverClose: last ? last.c : null, serverCloseSym: state.sym,
  })
  if (!sane) return null
  const t = bucketOf(ts, state)
  if (!finite(t)) return null
  if ((last && t <= last.t) || (dev && t < dev.t)) return null
  return { price, ts, t }
}

function applyTick(state, action, ctx) {
  // S6: the fallback runs only while the push stream is NOT delivering.
  if (ctx.streamLive) return state
  const ev = action.event ?? action.payload ?? {}
  if (isForeign(state, ev)) return state
  const adm = tickAdmission(state, ev)
  if (!adm) return state
  const { price, t } = adm
  const bars = state.bars
  let dev = state.developing
  // D/W/M (P3-S2b): the live DAY-volume source rides on the tick (liveFeed.periodTickVolume —
  // the one owner); the period bar's volume only ever rises from it.
  const tickV = isDateTf(state.tf) ? numOrNull(ev.v) : null
  if (dev && t === dev.t) {
    const r = foldPrice(toChartBar(dev, state.sym), price, null, state.tf)
    if (r.kind !== 'update') return state
    if (tickV != null && tickV > (Number(r.bar.volume) || 0)) r.bar = { ...r.bar, volume: tickV }
    const nd = fromChartDev(r.bar, dev.rev, dev.src, true)
    if (_sameDev(nd, dev)) return state
    return finalize(state, { developing: nd }, ctx)
  }
  let st = state, nb = bars
  if (dev) { ({ bars: nb } = closeDeveloping(st, nb)); st = { ...st, bars: nb } }
  const po = provisionalOpen(t, price)
  if (tickV != null) po.volume = tickV
  return finalize(state, { bars: nb, developing: fromChartDev(po, null, DEV_SRC.TICK) }, ctx)
}

function _sameDev(a, b) {
  return a.t === b.t && a.o === b.o && a.h === b.h && a.l === b.l && a.c === b.c && a.v === b.v
}

// ── scroll-back / invalidate / error ─────────────────────────────────────────

function applyScrollBack(state, action, ctx) {
  const p = action.payload || {}
  if (isForeign(state, p)) return state
  const ck = p.cache_key ?? null
  if (ck != null && state.cacheKey != null && ck !== state.cacheKey) return state
  if (staleReason(state, p, action)) return state
  const h = numOrNull(p.history_rev)
  const ab = _stampOf(p)
  if (ab != null && state.adjBasis != null && ab !== state.adjBasis) {
    // Deeper history on ANOTHER price basis (P4): what we hold is on an old one — re-read it.
    return finalize(state, { needsFull: true, invalidatedFor: 'adj_basis', gen: state.gen + 1 }, ctx)
  }
  if (h != null && state.historyRev != null && h > state.historyRev) {
    // Deeper history from a NEWER history: the window we hold is stale — re-read it whole.
    if (state.pendingHistoryRev != null && h <= state.pendingHistoryRev) return state
    return finalize(state, {
      needsFull: true, invalidatedFor: 'history_rev',
      pendingHistoryRev: Math.max(h, revOf(state.pendingHistoryRev)), gen: state.gen + 1,
    }, ctx)
  }
  const first = Math.min(state.bars.length ? state.bars[0].t : Infinity, state.developing?.t ?? Infinity)
  const rows = ingestRows(p.bars, state, { rev: numOrNull(p.series_rev), fin: false, src: 'rest' })
    .filter((r) => r.t < first)
  if (!rows.length) return state
  const bars = mergeRows(state, rows)
  const restFrom = state.restFrom == null ? null : Math.min(state.restFrom, rows[0].t)
  return finalize(state, { bars, restFrom, depthFloor: Math.max(state.depthFloor || 0, bars.length) }, ctx)
}

/** Drop everything held for the key (the one exception to S2's monotonicity). */
export function invalidate(state, reason, ctx = {}) {
  const fresh = initialState(state.key, ctx)
  return finalize(state, {
    ...fresh, baseRev: state.baseRev, devRev: state.devRev,
    needsFull: true, invalidatedFor: reason || 'invalidate', gen: state.gen + 1,
  }, ctx)
}

function applyError(state, action, ctx) {
  const p = action.payload || {}
  if (action.gen != null && action.gen !== state.gen) return state
  const error = p.terminal || p.error === 'no_data' ? 'no_data' : String(p.error || p.status || 'error')
  if (error === state.error) return state
  // A terminal no-data answer IS a server answer (the entry never returns to local-only).
  return finalize(state, error === 'no_data' ? { error, restSeen: true } : { error }, ctx)
}

// ── the reducer ──────────────────────────────────────────────────────────────

/**
 * @param {import('./types').Snapshot} state
 * @param {{type:string, key?:string, payload?:object, event?:object, reason?:string}} action
 * @param {{nowMs?:number, streamLive?:boolean, session?:'rth'|'eth', depthCap?:number}} [ctx]
 * @returns {import('./types').Snapshot}  `state` itself when nothing changed
 */
export function reduce(state, action, ctx = {}) {
  if (!state || !action) return state
  // S7: an action addressed to another key never touches this one.
  if (action.key != null && action.key !== state.key) return state
  switch (action.type) {
    case ACTION.SEED_FROM_PACK: return applyLocal(state, action, ctx, 'pack')
    case ACTION.IDB_HIT: return applyLocal(state, action, ctx, 'idb')
    case ACTION.MEM_HIT: return applyLocal(state, action, ctx, 'mem')
    case ACTION.REST_FULL: return applyRest(state, action, ctx, 'full')
    case ACTION.REST_DELTA: return applyRest(state, action, ctx, 'delta')
    case ACTION.REST_ERROR: return applyError(state, action, ctx)
    case ACTION.PUSH_BAR: return applyPush(state, action, ctx, false)
    case ACTION.PUSH_FINAL: return applyPush(state, action, ctx, true)
    case ACTION.TICK_FALLBACK: return applyTick(state, action, ctx)
    case ACTION.SCROLL_BACK: return applyScrollBack(state, action, ctx)
    case ACTION.INVALIDATE: return invalidate(state, action.reason, ctx)
    default: return state
  }
}

/** Re-derive only the time-dependent status (a clock tick, no data change). */
export function refreshStatus(state, ctx = {}) {
  return finalize(state, {}, ctx)
}

/**
 * True when `next` differs from `prev` ONLY in the developing bar (`developing` / `devRev`):
 * no closed row, seal, identity, status or meta field moved. The registry's split notify keys
 * on it — a subscriber that renders the BASE (setData, indicators, resample) is not woken by
 * it; the developing-bar channel (series.update) is. Generic over every snapshot field, so a
 * field added later is base by default.
 * ⭐ ONLY WITHIN ONE BUCKET. A developing bar that OPENS a bucket (none before, or another `t`)
 * or goes away is a BASE change: the base view's newest bar is always the developing bar's
 * bucket. Every reader of the base (the legend's newest bar, prevBarsRef, the render plan) can
 * then trust that the developing channel only ever moves the bar it already holds. (2026-11-13
 * NVDA 1m: a REST answer closed 09:50 with no developing bar; the tick that opened 09:51 was a
 * "dev-only" change, so the candle painted 09:51 by update() while the base — and the legend
 * reading it — stayed on 09:50 until the next base change jumped it to 09:52.)
 */
export function isDevOnlyChange(prev, next) {
  if (!prev || !next || prev === next || prev.developing === next.developing) return false
  if (!prev.developing || !next.developing || prev.developing.t !== next.developing.t) return false
  for (const k of Object.keys(next)) {
    if (k === 'developing' || k === 'devRev') continue
    if (next[k] !== prev[k]) return false
  }
  return Object.keys(prev).length === Object.keys(next).length
}
