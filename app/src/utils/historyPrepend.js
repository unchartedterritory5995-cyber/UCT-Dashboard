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
 *  a count-limited series that starts mid-day gets the rest of that day back too). */
export function historyWindowUrl(sym, tf, oldestT, sessQ = '', bars = HISTORY_WINDOW_BARS) {
  const d = etDateOf(oldestT)
  if (!sym || !d) return null
  return `/api/bars/${encodeURIComponent(sym)}?tf=${tf}&bars=${bars}&to=${d}${sessQ || ''}`
}

/**
 * Merge a left window into `cur`. Returns `cur` ITSELF (identity) when nothing older
 * arrived, else a new array = (window bars strictly older than cur[0], ascending,
 * de-duplicated) + cur verbatim.
 *
 * Invariants (property-tested): the result ends with `cur` exactly (same objects, same
 * order) — so the right edge, the developing bar and every server-owned bar are
 * untouched; it is strictly increasing in `t`; and its length is ≥ cur's.
 */
export function prependOlder(cur, win) {
  if (!Array.isArray(win) || !win.length) return cur
  if (!Array.isArray(cur) || !cur.length) return cur
  const first = cur[0]?.t
  if (typeof first !== 'number') return cur
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
 * Per-key window loader. `fetchJson(url, { background })` → parsed JSON (throws with
 * `.warming`/`.retryAfterMs` on a warming 503, `.canceled` on abort).
 *
 * loadOlder(key, { sym, tf, sessQ, oldestT, background }) resolves to
 *   { bars, exhausted, retryAfterMs }
 * where `bars` is the window as served (the caller merges with `prependOlder`).
 * ≤1 request per key at a time (a second ask for the same key joins the first), and a
 * key whose window came back with nothing older than `oldestT` is remembered as
 * exhausted at that point for EXHAUSTED_TTL_MS (a listing date, or the provider floor).
 */
export function createHistoryLoader({ fetchJson, now = () => Date.now() }) {
  const inflight = new Map()     // key -> { oldestT, promise }
  const exhausted = new Map()    // key -> { atT, until }

  function isExhausted(key, oldestT) {
    const e = exhausted.get(key)
    if (!e) return false
    if (now() > e.until) { exhausted.delete(key); return false }
    return typeof oldestT === 'number' ? oldestT >= e.atT : true
  }

  function loadOlder(key, { sym, tf, sessQ = '', oldestT, background = false, bars = HISTORY_WINDOW_BARS }) {
    if (isExhausted(key, oldestT)) return Promise.resolve({ bars: [], exhausted: true })
    const cur = inflight.get(key)
    if (cur) return cur.promise
    const url = historyWindowUrl(sym, tf, oldestT, sessQ, bars)
    if (!url) return Promise.resolve({ bars: [], exhausted: false })
    const promise = (async () => {
      try {
        const json = await fetchJson(url, { background })
        const rows = Array.isArray(json?.bars) ? json.bars : []
        const anyOlder = rows.some(b => typeof b?.t === 'number' && b.t < oldestT)
        const filling = json?.filling === true
        if (!anyOlder && !filling) {
          exhausted.set(key, { atT: oldestT, until: now() + EXHAUSTED_TTL_MS })
          return { bars: rows, exhausted: true }
        }
        return { bars: rows, exhausted: false, retryAfterMs: filling ? 3000 : null }
      } catch (e) {
        if (e?.canceled) return { bars: [], exhausted: false, canceled: true }
        if (e?.warming) return { bars: [], exhausted: false, retryAfterMs: e.retryAfterMs || 3000 }
        return { bars: [], exhausted: false, error: e }
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
    reset: (key) => { exhausted.delete(key) },
    _state: () => ({ inflight: inflight.size, exhausted: exhausted.size }),
  }
}
