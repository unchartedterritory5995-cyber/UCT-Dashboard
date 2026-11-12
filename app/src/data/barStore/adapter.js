// BarStore adapter — snapshot → chart series. P2 of the chart-data consolidation
// program (BARSTORE-SPEC "adapter.js"). NOT WIRED into StockChart yet.
//
// ⭐ ONE OWNER PER CONCERN. This is the only place a BarStore snapshot (bars in UNIX
// seconds for intraday) becomes chart time, and it reuses — never re-implements — the
// helpers StockChart's memos use today, so the output is byte-identical to today's
// `ohlcData` / `volData` / `closeData` shaping (golden-tested in adapter.golden.test.jsx):
//   • chart time   — barTime.toChartTime, per bar, DST-correct (intraday); D/W/M keep
//                    their business-day 'YYYY-MM-DD' strings as-is (StockChart's adjustTime)
//   • off-grid     — chart/offGridBars.foldOffGridBars (intraday only)
//   • RTH filter   — 09:30 ≤ ET minute < the day's close (half-day aware) when extended hours are off
//   • replay       — replayIndex slice, then replayCutoff calendar-day filter
//   • session      — chart/sessionPreview.applySessionCandle (D/W/M extended preview)
//   • Heikin-Ashi  — the toHeikinAshi recurrence (indicators.js), continued onto the tail
//
// ⭐ BASE vs TAIL. A result splits into `base` (derived ONLY from sealed bars + the view;
// memoized on (key, baseRev, viewTransformId)) and `tail` (0..2 points: the developing
// bar and/or the session-preview candle, recomputed per call — cheap). The diff renderer
// setData()s base+tail when the base identity changes and update()s only the tail
// otherwise. A tail point's time is ≥ the last base time; equal means it REPLACES the
// last base point (session preview extending yesterday's daily bar).
//
// Invalidation rule (the memo is a cache): entries are keyed by `${key}|${baseRev}|${vtid}`.
// The store bumps baseRev on every change to sealed bars, so a stale entry can never be
// served; the LRU bound (BASE_MEMO_MAX) only limits memory. Tested in adapter.test.js.

import { toChartTime, isRthBar } from '../../components/chart/barTime'
import { foldOffGridBars } from '../../components/chart/offGridBars'
import { applySessionCandle } from '../../components/chart/sessionPreview'
import { unixToDateLabel } from './types'
import { toHeikinAshi } from '../../components/chart/indicators'

const INTRADAY = new Set(['1', '5', '15', '30', '60'])
const DWM = new Set(['D', 'W', 'M'])

export const BASE_MEMO_MAX = 32

/** The chart time of a legacy-shaped bar `t` — StockChart's `adjustTime`. */
export function chartTimeOf(t) {
  return typeof t === 'number' ? toChartTime(t) : t
}

/** Canonical id of every view input that changes the BASE series shape. Two views with
 *  the same id produce identical base series for the same (key, baseRev). The session
 *  candle's live inputs are tail-only and deliberately NOT part of it. */
export function viewTransformId(view = {}) {
  const tf = String(view.tf ?? '')
  return [
    tf,
    view.showExtended ? 'eth' : 'rth',
    view.heikinAshi ? 'ha' : 'std',
    view.replayIndex == null ? 'r-' : `r${view.replayIndex}`,
    view.replayCutoff ? `c${view.replayCutoff}` : 'c-',
  ].join('|')
}

// ── legacy shape ──────────────────────────────────────────────────────────────
// Today's downstream bar shape: {t,o,h,l,c,v}; intraday t = unix seconds; D/W/M t =
// 'YYYY-MM-DD'. The store (P2a types.js TIME UNIT) holds a D/W/M t as UNIX SECONDS at
// 00:00 UTC of the server's label date (D session date, W Friday, M the 1st), so the
// label is the UTC date of t — NOT the ET date (00:00 UTC is the previous ET evening).
// types.unixToDateLabel owns that rule (one owner). A date-string t passes through untouched.
// (barTime.etWeekCloseLabel labels a raw TICK time; a store W t already IS the label date.)
function legacyT(t, tf) {
  if (typeof t !== 'number' || !DWM.has(tf)) return t
  return unixToDateLabel(t)
}
function toLegacyBar(b, tf) {
  const t = legacyT(b.t, tf)
  if (t === b.t && !('rev' in b) && !('src' in b) && !('fin' in b)) return b
  return { t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }
}
function tfOfSnapshot(snapshot, view) {
  if (view?.tf != null) return String(view.tf)
  if (snapshot?.tf != null) return String(snapshot.tf)
  const k = String(snapshot?.key ?? '')
  const m = /_([^_@]+)(?:@|$)/.exec(k)
  return m ? (m[1] === '60e' ? '60' : m[1]) : ''
}

const _legacyBaseMemo = new Map()   // `${key}|${baseRev}|${tf}` → legacy sealed bars
function lruGet(map, k) {
  if (!map.has(k)) return undefined
  const v = map.get(k)
  map.delete(k); map.set(k, v)   // refresh recency
  return v
}
function lruSet(map, k, v) {
  map.set(k, v)
  while (map.size > BASE_MEMO_MAX) map.delete(map.keys().next().value)
  return v
}

function legacySealed(snapshot, tf) {
  const bars = snapshot?.bars || []
  const k = `${snapshot?.key}|${snapshot?.baseRev}|${tf}`
  const hit = lruGet(_legacyBaseMemo, k)
  if (hit && hit.src === bars) return hit.out
  let out = bars
  for (let i = 0; i < bars.length; i++) {
    if (toLegacyBar(bars[i], tf) !== bars[i]) { out = bars.map(b => toLegacyBar(b, tf)); break }
  }
  lruSet(_legacyBaseMemo, k, { src: bars, out })
  return out
}

function legacyDeveloping(snapshot, tf, sealed) {
  const d = snapshot?.developing
  if (!d) return null
  const dev = toLegacyBar({ t: d.t, o: d.o, h: d.h, l: d.l, c: d.c, v: d.v }, tf)
  // Store invariant S3: developing.t > last sealed t. A violating developing bar is not
  // a distinct candle; dropping it here keeps the renderer's monotonic contract.
  const last = sealed[sealed.length - 1]
  if (!last) return dev
  const newer = (typeof dev.t === 'number' && typeof last.t === 'number') ? dev.t > last.t : String(dev.t) > String(last.t)
  return newer ? dev : null
}

/** The snapshot's developing bar in the legacy shape ({t,o,h,l,c,v}; D/W/M t = label), or
 *  null — exactly the bar `legacyBars` appends. O(1) on a memo hit (the dev channel's read). */
export function legacyDevelopingOf(snapshot, tf = tfOfSnapshot(snapshot, null)) {
  if (!snapshot?.developing) return null
  return legacyDeveloping(snapshot, tf, legacySealed(snapshot, tf))
}

const _legacyBarsMemo = new WeakMap()
/** Today's downstream `bars` array for a snapshot: sealed + developing appended, legacy
 *  shape. Memoized per (frozen, identity-stable) snapshot, so indicators / drawings /
 *  engine keep receiving a stable array between store revisions. */
export function legacyBars(snapshot, tf = tfOfSnapshot(snapshot, null)) {
  if (!snapshot) return null
  // Keyed per (snapshot, tf): the same snapshot read under another tf labels D/W/M
  // differently. legacyBars depends on no view input, so the view is not part of the key.
  let byTf = _legacyBarsMemo.get(snapshot)
  if (!byTf) { byTf = new Map(); _legacyBarsMemo.set(snapshot, byTf) }
  const hit = byTf.get(tf)
  if (hit) return hit
  const sealed = legacySealed(snapshot, tf)
  const dev = legacyDeveloping(snapshot, tf, sealed)
  const out = dev ? [...sealed, dev] : sealed
  byTf.set(tf, out)
  return out
}

// ── static snapshots (barsOverride consumers: Model Book, Setup Library, …) ──────
let _staticRev = 0
const _staticMemo = new WeakMap()
/** A frozen, identity-stable snapshot around a caller-owned bar array (legacy shape).
 *  Same array → same snapshot; a new array → a new baseRev (so the renderer repaints). */
export function staticSnapshot(bars, { key = 'static', tf } = {}) {
  const arr = Array.isArray(bars) ? bars : []
  const id = tf ? `${key}_${tf}` : key
  const memo = _staticMemo.get(arr)
  if (memo && memo.key === id) return memo
  const last = arr[arr.length - 1]
  const snap = Object.freeze({
    key: id,
    bars: arr,
    developing: null,
    completeThrough: last ? last.t : null,
    verifiedThrough: null,
    seriesRev: null,
    cacheKey: null,
    grid: null,
    status: 'current',
    baseRev: ++_staticRev,
    devRev: 0,
    depth: arr.length,
    static: true,
  })
  _staticMemo.set(arr, snap)
  return snap
}

// ── points ───────────────────────────────────────────────────────────────────
function candlePoint(b) { return { time: chartTimeOf(b.t), open: b.o, high: b.h, low: b.l, close: b.c } }
function volumePoint(b) { return { time: chartTimeOf(b.t), value: b.v } }
function closePoint(b) { return { time: chartTimeOf(b.t), value: b.c } }

/** base points + tail points as ONE series array (a tail point at the last base time
 *  replaces it). The only place the two halves are joined. */
export function composePoints(base, tail) {
  if (!tail?.length) return base
  let cut = base.length
  while (cut > 0 && base[cut - 1].time >= tail[0].time) cut--
  return cut === base.length ? [...base, ...tail] : [...base.slice(0, cut), ...tail]
}

// Heikin-Ashi continued from a previous HA bar: the same recurrence as toHeikinAshi.
function haContinue(bars, prev) {
  const out = []
  let pO = prev ? prev.o : (bars[0].o + bars[0].c) / 2
  let pC = prev ? prev.c : (bars[0].o + bars[0].h + bars[0].l + bars[0].c) / 4
  for (const bar of bars) {
    const c = (bar.o + bar.h + bar.l + bar.c) / 4
    const o = (pO + pC) / 2
    out.push({ ...bar, o, h: Math.max(bar.h, o, c), l: Math.min(bar.l, o, c), c })
    pO = o; pC = c
  }
  return out
}

// The regular-hours view: barTime.isRthBar — the one RTH test (half-day aware), the same one
// StockChart's sessionBars filter uses.
function rthKeep(b) {
  return typeof b.t !== 'number' || isRthBar(b.t)
}
function cutoffKeep(cutoff) {
  return (b) => (typeof b.t === 'number'
    ? new Date(b.t * 1000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }) <= cutoff
    : String(b.t).slice(0, 10) <= cutoff)
}

const _baseMemo = new Map()
function computeBase(snapshot, view, tf, vtid) {
  const sealed = legacySealed(snapshot, tf)
  const k = `${snapshot?.key}|${snapshot?.baseRev}|${vtid}`
  const hit = lruGet(_baseMemo, k)
  if (hit && hit.src === sealed) return hit
  const intraday = INTRADAY.has(tf)
  let session = intraday ? foldOffGridBars(sealed, tf, { showExtended: !!view.showExtended }) : sealed
  if (intraday && !view.showExtended) session = session.filter(rthKeep)
  const sessionCount = session.length
  let filtered = view.replayIndex != null ? session.slice(0, view.replayIndex + 1) : session
  if (view.replayCutoff && filtered.length) filtered = filtered.filter(cutoffKeep(view.replayCutoff))
  const display = view.heikinAshi && filtered.length ? toHeikinAshi(filtered) : filtered
  const out = {
    src: sealed, sessionCount, filtered, display,
    candles: display.map(candlePoint),
    volume: filtered.map(volumePoint),   // volume rides sessionAppliedBars (pre-HA) today
    closes: display.map(closePoint),
  }
  return lruSet(_baseMemo, k, out)
}

/**
 * snapshot → series. `view`: { tf, showExtended, heikinAshi, replayIndex (null = off),
 * replayCutoff ('YYYY-MM-DD' | null), sessionCandle ({curTime, extAgg, extPrice} | null —
 * pass only when StockChart's sessionCandleActive && sessionExtReady hold) }.
 */
export function toSeries(snapshot, view = {}) {
  const tf = tfOfSnapshot(snapshot, view)
  const vtid = viewTransformId({ ...view, tf })
  const base = computeBase(snapshot, view, tf, vtid)
  const sealed = base.src
  // ── tail: developing bar (+ session preview candle) ────────────────────────
  let tailBars = []
  let dev = legacyDeveloping(snapshot, tf, sealed)
  if (dev && INTRADAY.has(tf)) {
    // Developing is on-grid by store contract (off-grid folded once at ingest).
    if (!view.showExtended && !rthKeep(dev)) dev = null
  }
  if (dev && view.replayIndex != null && view.replayIndex < base.sessionCount) dev = null
  if (dev && view.replayCutoff && !cutoffKeep(view.replayCutoff)(dev)) dev = null
  if (dev) tailBars = [dev]
  let sessionApplied = false
  if (view.sessionCandle && (dev || base.filtered.length)) {
    const anchor = dev || base.filtered[base.filtered.length - 1]
    const out = applySessionCandle([anchor], view.sessionCandle)
    if (out.length !== 1 || out[0] !== anchor) {
      sessionApplied = true
      // With a developing bar the whole result is tail. Without one the anchor is the
      // last BASE bar: a merged anchor replaces it (same time); an appended candle is
      // the only tail point and the untouched anchor stays in base.
      tailBars = dev ? out : (out.length === 2 ? [out[1]] : [out[0]])
    }
  }
  let tailDisplay = tailBars
  if (view.heikinAshi && tailBars.length) {
    const d = base.display, f = base.filtered
    // A tail point at the last base time replaces it → continue from the bar before.
    const replaces = f.length && String(tailBars[0].t) === String(f[f.length - 1].t)
    const prev = replaces ? d[d.length - 2] : d[d.length - 1]
    tailDisplay = haContinue(tailBars, prev || null)
  }
  const tail = {
    bars: tailBars,
    candles: tailDisplay.map(candlePoint),
    volume: tailBars.map(volumePoint),
    closes: tailDisplay.map(closePoint),
  }
  return {
    key: snapshot?.key ?? null,
    baseRev: snapshot?.baseRev ?? null,
    devRev: snapshot?.devRev ?? null,
    vtid,
    // Framing identity: a change here is a KEY CHANGE for framing K1 (symbol / tf / session).
    frameId: `${snapshot?.key ?? ''}|${tf}|${view.showExtended ? 'eth' : 'rth'}`,
    tf,
    sessionApplied,
    base: { filtered: base.filtered, display: base.display, candles: base.candles, volume: base.volume, closes: base.closes },
    tail,
    /** today's `filteredBars` (base + developing), legacy shape — O(n), call sparingly */
    filteredBars: () => composeBars(base.filtered, dev ? [dev] : []),
    /** today's `sessionAppliedBars` */
    sessionAppliedBars: () => composeBars(base.filtered, tailBars),
    /** today's `displayBars` */
    displayBars: () => composeBars(base.display, tailDisplay),
  }
}

function composeBars(base, tail) {
  if (!tail?.length) return base
  let cut = base.length
  const t0 = tail[0].t
  while (cut > 0 && (typeof t0 === 'number' ? base[cut - 1].t >= t0 : String(base[cut - 1].t) >= String(t0))) cut--
  return [...base.slice(0, cut), ...tail]
}

/** Test-only: drop the memos (they are bounded caches; never needed for correctness). */
export function _resetAdapterMemos() { _baseMemo.clear(); _legacyBaseMemo.clear() }
