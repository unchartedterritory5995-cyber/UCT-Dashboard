// ── Intraday deep history = LEFT-PREPEND windows (2026-11-11) ───────────────────────
//
// ⛔⛔ WHY THIS EXISTS. Scroll-back on intraday used to grow ONE number (`fetchDepth`
// 1199 → ×8 → 32000) and re-download the WHOLE series at the new depth from
// `/api/bars?bars=N`. That request takes the server's deep branch, which answers from
// what SQLite already holds within a 6 s budget and fills (if ever) in the background —
// measured on production 2026-11-11 across 21 names: `bars=32000` on 60m returned the
// SAME depth as the first paint for 14 of them (SNXX 30m began 2026-10-05 though it
// listed 2026-01-27), and the client, having reached its full target, never asked again.
// The member saw the chart end mid-screen with nothing to the left.
//
// ⭐ THE PRIMITIVE IS "THE N BARS BEFORE MY OLDEST BAR". `/api/bars/{sym}?tf&bars=N&to=D`
// (the replay pre-cutoff window, `bars_fetch._get_bars_to_response`) answers from SQLite
// when it holds the window and otherwise fetches EXACTLY that window from the provider
// (no lookback ceiling, bounded size) and persists it: measured 0.43-0.98 s cold and
// ~0.22 s warm for 2000 bars on production. Each answer is merged by `prependOlder`,
// which only ever adds bars strictly OLDER than the oldest bar held — the newest bar,
// the developing candle and every bar the tail poll owns are untouched, so a prepend can
// never move the right edge.
//
// This module is the BarStore's future `scroll-back` action (BARSTORE-SPEC.md): pure
// helpers + a small per-key loader (≤1 window in flight per key, cancelable, exhaustion
// memory). StockChart wires it today; the store absorbs it unchanged later.

import { _closeMismatch } from './barsMerge'

/** Bars per left window. Under the server's cold window cap (REPLAY_INTRADAY_COLD_BARS
 *  = 4000) so one window is one bounded provider call; ~10 screens at the default zoom. */
export const HISTORY_WINDOW_BARS = 2000

/** Windows fetched in the background right after first paint (before any scroll). */
export const PREFETCH_WINDOWS = 2

/** Start the next window while the left edge is still this many SCREENS away from the
 *  oldest loaded bar, so a member panning at normal speed never reaches blank space. */
export const LOOKAHEAD_SCREENS = 2

/** A key whose window came back with nothing older is not re-asked for this long. */
export const EXHAUSTED_TTL_MS = 15 * 60 * 1000

/** Per-key backoff after a failed window: 2 s, 4 s, 8 s … capped; a warming / `filling`
 *  answer waits its Retry-After. Panning at the oldest bar re-asks only after it. */
export const ERROR_BACKOFF_BASE_MS = 2000
export const ERROR_BACKOFF_MAX_MS = 60000

const _NATIVE_INTRADAY = new Set(['1', '5', '15', '30', '60'])
export function isHistoryPrependTf(tf) { return _NATIVE_INTRADAY.has(String(tf)) }

let _etFmt = null
/** ET calendar date (YYYY-MM-DD) of a unix-seconds bar time. DST-correct (Intl). */
export function etDateOf(unixSec) {
  if (typeof unixSec !== 'number' || !Number.isFinite(unixSec)) return null
  if (!_etFmt) {
    _etFmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    })
  }
  return _etFmt.format(new Date(unixSec * 1000))
}

/** The left-window URL: `bars` bars ending at the ET date of `oldestT` (inclusive day —
 *  a count-limited series that starts mid-day gets the rest of that day back too).
 *  `build` is the ONE `to=` URL builder (prefetchBars `barsBeforeUrl`), injected so this
 *  module imports no bar cache. */
export function historyWindowUrl(build, sym, tf, oldestT, sessQ = '', bars = HISTORY_WINDOW_BARS) {
  const d = etDateOf(oldestT)
  if (!sym || !d || typeof build !== 'function') return null
  return build(sym, tf, bars, d, sessQ || '')
}

/**
 * Merge a left window into `cur`. Returns `cur` ITSELF (identity) when nothing older
 * arrived, else a new array = (window bars strictly older than cur[0], ascending,
 * de-duplicated) + cur verbatim.
 *
 * Invariants (property-tested): the result ends with `cur` exactly (same objects, same
 * order) — so the right edge, the developing bar and every server-owned bar are
 * untouched; it is strictly increasing in `t`; and its length is ≥ cur's.
 *
 * ⛔ A window on a DIFFERENT BASIS is refused whole: the window carries cur's oldest day,
 * so it shares cur[0]'s timestamp, and a >2% close mismatch there (barsMerge
 * `_closeMismatch` — the same seam rule `mergeMonotonic` uses: a split or re-adjustment
 * since this series was cached) means splicing would draw a cliff that never traded.
 */
export function prependOlder(cur, win) {
  if (!Array.isArray(win) || !win.length) return cur
  if (!Array.isArray(cur) || !cur.length) return cur
  const first = cur[0]?.t
  if (typeof first !== 'number') return cur
  const seam = win.find(b => b?.t === first)
  if (seam && _closeMismatch(cur[0], seam)) return cur
  const older = []
  let last = -Infinity
  // Windows arrive ascending; sort defensively without trusting it.
  const src = win.every((b, i) => i === 0 || win[i - 1].t <= b.t) ? win : [...win].sort((a, b) => a.t - b.t)
  for (const b of src) {
    const t = b?.t
    if (typeof t !== 'number' || !(t < first) || !(t > last)) continue
    older.push(b)
    last = t
  }
  if (!older.length) return cur
  return older.concat(cur)
}

/**
 * Should the next window load now? True when the visible left edge is within
 * `screens` view-widths of the oldest loaded bar. Pure; `fromIndex` is LWC's logical
 * index of the left edge (0 = oldest loaded bar).
 */
export function wantsOlder({ fromIndex, toIndex, loadedCount }, screens = LOOKAHEAD_SCREENS) {
  if (!(loadedCount > 0)) return false
  const width = toIndex - fromIndex
  if (!(width > 0) || !Number.isFinite(fromIndex)) return false
  return fromIndex <= Math.max(50, width * screens)
}

/**
 * Per-key window loader. `urlFor` = prefetchBars `barsBeforeUrl`.
 * `fetchJson(url, { background })` → parsed JSON (throws with
 * `.warming`/`.retryAfterMs` on a warming 503, `.canceled` on abort).
 *
 * loadOlder(key, { sym, tf, sessQ, oldestT, background }) resolves to
 *   { bars, exhausted, retryAfterMs }
 * where `bars` is the window as served (the caller merges with `prependOlder`).
 * ≤1 request per key at a time (a second ask for the same key joins the first), and a
 * key whose window came back with nothing older than `oldestT` is remembered as
 * exhausted at that point for EXHAUSTED_TTL_MS (a listing date, or the provider floor).
 */
export function createHistoryLoader({ fetchJson, urlFor, now = () => Date.now() }) {
  const inflight = new Map()     // key -> { oldestT, promise }
  const exhausted = new Map()    // key -> { atT, until }
  const backoff = new Map()      // key -> { until, errors }

  function isExhausted(key, oldestT) {
    const e = exhausted.get(key)
    if (!e) return false
    if (now() > e.until) { exhausted.delete(key); return false }
    return typeof oldestT === 'number' ? oldestT >= e.atT : true
  }

  function _waitFor(key, ms, isError) {
    const prev = backoff.get(key)
    const errors = isError ? (prev?.errors || 0) + 1 : 0
    const wait = isError ? Math.min(ERROR_BACKOFF_MAX_MS, ERROR_BACKOFF_BASE_MS * 2 ** (errors - 1)) : ms
    backoff.set(key, { until: now() + wait, errors })
    return wait
  }

  function loadOlder(key, { sym, tf, sessQ = '', oldestT, background = false, bars = HISTORY_WINDOW_BARS, signal }) {
    if (isExhausted(key, oldestT)) return Promise.resolve({ bars: [], exhausted: true })
    const cur = inflight.get(key)
    if (cur) return cur.promise
    const bo = backoff.get(key)
    if (bo && now() < bo.until) return Promise.resolve({ bars: [], exhausted: false, backoff: true, retryAfterMs: bo.until - now() })
    const url = historyWindowUrl(urlFor, sym, tf, oldestT, sessQ, bars)
    if (!url) return Promise.resolve({ bars: [], exhausted: false })
    const promise = (async () => {
      try {
        const json = await fetchJson(url, { background, signal })
        const rows = Array.isArray(json?.bars) ? json.bars : []
        const anyOlder = rows.some(b => typeof b?.t === 'number' && b.t < oldestT)
        const filling = json?.filling === true
        if (!anyOlder && !filling) {
          backoff.delete(key)
          exhausted.set(key, { atT: oldestT, until: now() + EXHAUSTED_TTL_MS })
          return { bars: rows, exhausted: true }
        }
        if (filling) return { bars: rows, exhausted: false, retryAfterMs: _waitFor(key, 3000, false) }
        backoff.delete(key)
        return { bars: rows, exhausted: false, retryAfterMs: null }
      } catch (e) {
        if (e?.canceled || e?.name === 'AbortError') return { bars: [], exhausted: false, canceled: true }
        if (e?.warming) return { bars: [], exhausted: false, retryAfterMs: _waitFor(key, e.retryAfterMs || 3000, false) }
        return { bars: [], exhausted: false, error: e, retryAfterMs: _waitFor(key, 0, true) }
      } finally {
        inflight.delete(key)
      }
    })()
    inflight.set(key, { oldestT, promise })
    return promise
  }

  return {
    loadOlder,
    isExhausted,
    inFlight: (key) => inflight.has(key),
    reset: (key) => { exhausted.delete(key); backoff.delete(key) },
    _state: () => ({ inflight: inflight.size, exhausted: exhausted.size, backoff: backoff.size }),
  }
}

// ── The persisted deep-history segment (barsIDB `<key>@hist`): pure rules ─────────────
/** barsIDB INTRADAY_MAX_BARS (the capped tail entry). Restated here so this module imports
 *  no bar cache; historyPrepend.test asserts the two never drift. */
export const TAIL_ENTRY_MAX_BARS = 3000

/** Background prefetch after first paint stops once the series holds this many bars. */
export const HISTORY_PREFETCH_TARGET_BARS = TAIL_ENTRY_MAX_BARS + PREFETCH_WINDOWS * HISTORY_WINDOW_BARS

// ── DEEPER FROM THE LAKE (2026-11-17) ────────────────────────────────────────────────────────────
// The windows above were sized for the SERVER (one bounded provider call each; a deep read that
// misses bars-api's page cache is disk-bound: 20,000 rows ~0.5 s cold). The history lake answers
// from immutable pieces at the edge (a month of 1m, a quarter of 5m, a year of 15/30/60m per piece,
// cached by the browser for a year), so a lake window is as big as a piece and the background depth
// target is set by what the chart can hold, not by what one request should cost. Indicator plots
// draw at most the plot window (chart/engine/plotWindow.js), so a deeper series does not make a
// repaint dearer.
/** Bars per scroll-back window when the lake carries the key. */
export const LAKE_WINDOW_BARS = 6000
/** Background depth (the chart a member rests on, and the list rows next to it) when the lake carries
 *  the key. Under every intraday depth cap (data/barStore/registry DEFAULT_DEPTH_CAPS, 1m 20,000). */
export const LAKE_PREFETCH_TARGET_BARS = 20000
/** The deep-history segment persisted to IndexedDB holds at most this many of the newest bars: what
 *  the lake brings deeper comes back from the browser's HTTP cache, and a 20,000-row segment would be a
 *  large structured clone on the main thread each time it grows. Exactly today's background depth. */
export const HIST_PERSIST_MAX_BARS = HISTORY_PREFETCH_TARGET_BARS
// ⭐ ZOOMED ALL THE WAY OUT, AT ONCE (2026-11-18, owner: "on an hourly chart of Apple I can instantly
// zoom all the way out and scroll back"). A store bar of the lake is any bar the raw data has, pre- and
// after-hours included, so 20,000 store bars showed only ~10,000 regular-session bars: about 5 years of
// 60m and 2.5 years of 30m. Hourly and 30-minute are small per year (a lake piece is a whole year, ~10 B
// a bar over the wire), so they load deep: 60m about 15 years, 30m about 6. Every other intraday
// timeframe keeps 20,000. Each stays under its registry depth cap (DEFAULT_DEPTH_CAPS).
export const LAKE_TARGET_BARS_BY_TF = Object.freeze({ '60': 50000, '30': 40000 })
/** The lake depth (store bars) one load brings for a timeframe ('1', '5', '15', '30', '60'). */
export function lakeTargetBars(tf) {
  return LAKE_TARGET_BARS_BY_TF[String(tf)] ?? LAKE_PREFETCH_TARGET_BARS
}
/** The background depth target for a key: deeper when the lake carries it (and per timeframe there). */
export function prefetchTargetBars(lakeCarries, tf) {
  return lakeCarries ? lakeTargetBars(tf) : HISTORY_PREFETCH_TARGET_BARS
}

/** True when `hist` can be prepended to `tail` without drawing a hole: it holds bars
 *  older than the tail AND its newest bar reaches the tail's oldest. */
export function historyReachesTail(hist, tail) {
  if (!Array.isArray(hist) || !hist.length || !Array.isArray(tail) || !tail.length) return false
  const h0 = hist[0]?.t, hN = hist[hist.length - 1]?.t, t0 = tail[0]?.t
  if (typeof h0 !== 'number' || typeof hN !== 'number' || typeof t0 !== 'number') return false
  return h0 < t0 && hN >= t0
}

/** Re-write the segment when it would otherwise stop reaching the tail: the newest
 *  history bar has fallen behind the MIDDLE of the (capped) tail window. */
export function historyLagsTail(histLastT, series) {
  if (!Array.isArray(series) || series.length <= TAIL_ENTRY_MAX_BARS) return false
  if (typeof histLastT !== 'number') return true
  const tail0 = series.length - TAIL_ENTRY_MAX_BARS
  const mid = series[tail0 + Math.floor(TAIL_ENTRY_MAX_BARS / 2)]?.t
  return typeof mid === 'number' && histLastT < mid
}
