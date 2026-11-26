// app/src/components/chart/engine/secondaryBars.js
//
// ─── BARS FOR A SYMBOL THAT IS NOT THE CHART'S OWN ──────────────────────────
//
// ⭐⭐ THE SIBLING OF `serverCompute.js`, AND DELIBERATELY THE SAME SHAPE. That
// lane solved this exact problem for server-computed columns: the binder is
// SYNCHRONOUS — it computes inside a paint — while data arrives from a fetch. Its
// answer is a module cache plus an in-flight map keyed by URL, a synchronous
// read that never fetches, an `ensure` that does, and a `subscribe` so a host can
// repaint when an entry lands. Everything below is that pattern with `bars`
// where it had `columns`.
//
// ⛔⛔ AND IT IS WHY THIS IS NOT A HOOK. `useSWR` cannot be called a varying
// number of times, and a chart needs N secondary symbols where N changes as the
// member adds and removes series. A composite key over the whole set would work
// for one chart and defeat sharing between charts — nine grid cells all watching
// QQQ would fetch it nine times. Keying the cache on the URL instead means the
// dedup is a property of WHAT THE DATA IS, not of who asked: the same sentence
// `serverCompute` states as "sixteen grid cells on one symbol cost one".
//
// ⛔ NO FAMILY BRANCH LIVES HERE. `QQQ`, `SPY` and `UCTA50` are one code path;
// `api/routers/bars.py` is where breadth is intercepted, and that is the right
// place because it is the layer that knows what a symbol IS. This module knows
// only that it was given a canonical symbol string.

/** The canonical bars route — the SAME endpoint the primary chart and Compare
 *  Symbols already use. A second browser bars client would be a second answer to
 *  "what are QQQ's bars", and the two would drift. */
const BARS_PATH = '/api/bars/'

// ─── ⭐⭐ (e95, 2026-11-22) A CUSTOM TIMEFRAME IS BUILT HERE, THE WAY THE CHART BUILDS ITS OWN ─────────────────────────────
// ⚰️ Measured on production 2026-11-22 (the every-timeframe Fred RS run): on a 4h chart the Fred RS legend was ABSENT.
// `/api/bars/SPX?tf=240` answers `bars: []` with no note: the route serves the NATIVE timeframes only, and the chart
// builds every other one (2 / 3 / 10 / 45 / 65 / 195 minutes, 2h, 4h, 2D, 3D, 5D, 2W, 3M, 6M, 12M) in the browser:
// `useLegacyChartBars` fetches `fetchTf(tf)` and resamples with `resampleForSpec(resampleSpec(tf))`. This lane asked the
// route for the custom code itself, so every `request.security` of another symbol on a custom timeframe read nothing.
// So a custom timeframe's entry is FETCHED at its native base (`fetchTf`, at the depth x the ratio, `baseAskOf`) and
// RESAMPLED by the SAME `resampleForSpec` the chart's own bars go through: one rule, so the other symbol's rows land on
// the chart's grid and project by exact time. The CACHE KEY stays the custom code's URL (`secondaryBarsUrl`): a 4h
// entry and a 60m entry of one symbol are different answers. Native timeframes are untouched (fetch URL = key).
// ⛔ THE OTHER SYMBOL'S OWN SESSION (coordinator ruling 2026-11-22): TradingView builds the other symbol's bars on ITS
// session, then projects by time. The chart's rule anchors the US equity session (09:30 ET, weekdays). A base row
// off that session (a weekend, outside 04:00-20:00 ET, or an intraday row off the base grid anchored at 09:30: crypto,
// futures, a clock-hour series) is REFUSED by name (`UNSUPPORTED` + note), never resampled on a grid it does not have,
// until a capture witnesses how TradingView builds it.
import { baseBarsFor, fetchTf, resampleSpec } from '../timeframes'
import { resampleForSpec, isRegularSessionSpec } from '../../../utils/resampleBars'
import { isRthBar, toChartTime, etMinuteOfDay } from '../barTime'
import { viewShowExtended } from '../../../utils/viewSession'
import { takeBootSecondaryBars } from '../../../lib/bootSecondaryBars'

/**
 * The request URL for one (symbol, timeframe, count).
 *
 * ⭐⭐ THE FETCH KEY IS THE CACHE KEY, DERIVED FROM ONE FUNCTION. A key that can
 * disagree with the URL it stands for is a cache that serves the wrong symbol —
 * the rule `serverColumnsUrl` states, and the reason both are built here.
 *
 * ⛔ AND SESSION IS NOT A DIMENSION, because the endpoint does not have one.
 * `GET /api/bars/{ticker}` accepts `(tf, bars, since, to, warm)`; extended-hours
 * handling is a CLIENT concern driven by the single `cs.extendedHoursShading`
 * setting. Inventing a `session=` parameter here would put a dimension in the key
 * that changes nothing about the bytes, and a cache keyed on fiction misses for
 * no reason. Exact-`t` projection (`projectSymbolField`) is what actually makes a
 * session mismatch safe: a secondary bar with no primary counterpart is ignored,
 * so the answer can be ABSENT but never WRONG.
 *
 * @returns {string|null} null when there is nothing to ask for.
 */
export function secondaryBarsUrl(symbol, tf, bars, { session = null, extended } = {}) {
  const s = typeof symbol === 'string' ? symbol.trim().toUpperCase() : ''
  if (!s) return null
  const count = askedBarsOf(bars)
  const code = tf == null || tf === '' ? 'D' : String(tf)
  // ⭐ (2026-11-25) a CUSTOM intraday code on the extended view is its own answer (its buckets start at 04:00 ET, not
  // 09:30): keyed with the session, and its base asked on the extended grid where that grid differs (`secondaryFetchOf`)
  const sess = session ?? (_extendedCustom(code, extended) ? 'eth' : null)
  return `${BARS_PATH}${encodeURIComponent(s)}?tf=${encodeURIComponent(code)}&bars=${count}${sess ? `&session=${sess}` : ''}`
}

/** Is `code` a custom intraday timeframe drawn on the extended view? `extended`: the CHART's own session (review of
 *  #2753: two charts of one board can differ); a caller that names none reads the page's view (utils/viewSession). */
function _extendedCustom(code, extended) {
  if (!(extended ?? viewShowExtended())) return false
  return resampleSpec(code)?.kind === 'intradaySession'
}

/** The `bars=` a window asks for (what `secondaryBarsUrl` puts in its URL). */
function askedBarsOf(bars) {
  return Number.isFinite(bars) && bars > 0 ? Math.floor(bars) : 200
}

/** ⛔ The deepest window `/api/bars` answers (`otherSymbols.js::BARS_ASK_MAX`, repeated here as a literal only because
 *  this client module may not import the run's closure; `secondaryBars.customTf.test.js` holds the two equal). */
const BASE_ASK_MAX = 60000

/** The native base rows a custom timeframe's window of `bars` rows asks for: an upper bound of base rows per output
 *  row (a 4h bucket holds at most four 60m rows; an N-day window at most N daily rows), capped at the route's limit. */
export function baseAskOf(tf, bars) {
  return baseBarsFor(tf == null || tf === '' ? 'D' : String(tf), askedBarsOf(bars), BASE_ASK_MAX)
}

/**
 * ⭐ (e95) WHERE a window is fetched: the key itself for a native timeframe; for a custom one, its native base at
 * `baseAskOf` rows. One function, so the fetch and the tail fetch can never disagree about the base.
 * @returns {{url: string, fetchUrl: string, spec: object|null, baseAsk: number}|null}
 */
export function secondaryFetchOf(symbol, tf, bars, { extended } = {}) {
  const url = secondaryBarsUrl(symbol, tf, bars, { extended })
  if (!url) return null
  const code = tf == null || tf === '' ? 'D' : String(tf)
  const ext = _extendedCustom(code, extended)
  const spec = resampleSpec(code, { extended: ext })
  if (!spec) return { url, fetchUrl: url, spec: null, baseAsk: askedBarsOf(bars) }
  const baseAsk = baseAskOf(code, bars)
  // (the base asks the extended grid only where it differs: 60m's clock grid; 1/5/15/30m are one grid in both views)
  return { url, fetchUrl: secondaryBarsUrl(symbol, fetchTf(code), baseAsk, { session: ext && spec.base === '60' ? 'eth' : null, extended: false }), spec, baseAsk }
}

// ET weekday names by ET calendar day (chart time / 86400): day 0 of the epoch, 1970-01-01, was a Thursday.
const _ET_WEEKDAY = ['Thu', 'Fri', 'Sat', 'Sun', 'Mon', 'Tue', 'Wed']
/** ET weekday + minutes after midnight of unix seconds.
 *  ⭐ (2026-11-26, #2801's upgrade capture) one `formatToParts` PER ROW was 29 ms of a 19,200-row benchmark page's
 *  landing task. It now reads barTime's ET offset, memoised per UTC day (`toChartTime` / `etMinuteOfDay`): the same
 *  weekday and minute (the formatter's `hour12: false` midnight 24 already read as 0 here), at most two Intl reads a day. */
function _etWhen(t) {
  const day = Math.floor(Math.floor(toChartTime(t)) / 86400)
  return { wd: _ET_WEEKDAY[((day % 7) + 7) % 7], min: etMinuteOfDay(t) }
}
const _WEEKEND = new Set(['Sat', 'Sun'])

/** The intraday judgement's state over a page, so it can be run over the whole page at once or over its slices in
 *  turn (`_readCustomIdle`) with the same answer: ONE scan, `_offSessionScan`. */
function _offSessionState(spec) {
  return {
    step: Number(spec.base),
    regular: isRegularSessionSpec(spec),
    anchor: Number.isFinite(spec.anchorMin) ? spec.anchorMin : 570,   // the spec's session start (09:30 / 04:00 ET)
    pending: null,      // a regular spec's first off-session EXTENDED weekday row: refuses only a page with no regular row
    sawRegular: false,
    words: null,        // the first row that refuses the page outright
  }
}
function _offSessionScan(rows, st) {
  const { step, regular, anchor } = st
  for (const b of rows) {
    if (st.words) return st
    if (!b || typeof b.t !== 'number') continue
    const { wd, min } = _etWhen(b.t)
    if (_WEEKEND.has(wd) || min < 240 || min >= 1200 || (((min - anchor) % step) + step) % step !== 0) {
      const words = `a ${step}-minute bar at ${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')} ET on a ${wd}`
      if (regular && !_WEEKEND.has(wd) && !isRthBar(b.t)) { if (st.pending === null) st.pending = words; continue }
      st.words = words
      return st
    }
    if (regular && isRthBar(b.t)) st.sawRegular = true
  }
  return st
}
const _offSessionWords = (st) => st.words || (st.regular && !st.sawRegular ? st.pending : null)

/** The first base row OFF the US equity session the chart's resample anchors (above), as words, or null. */
export function offSessionRowOf(baseBars, spec) {
  if (!spec || !Array.isArray(baseBars)) return null
  if (spec.kind === 'intradaySession') {
    // ⭐ (2026-11-26) A REGULAR spec is built from the regular-session rows only (resampleForSpec). On a page that holds
    // regular-session rows on the grid (a US stock's), the weekday extended rows beside them (on the 60m session grid,
    // 04:00-09:00 and 16:00-20:00 clock hours, off the 09:30 grid) are never resampled, so they cannot make the window
    // unbuildable: they are not judged. A regular-session row off the grid, or any weekend row, still refuses it; and a
    // page with NO regular-session row on the grid is judged on its extended rows as before (a lone clock-hour or
    // overnight row is another session, coordinator ruling 2026-11-22). An extended spec judges every row, as before.
    return _offSessionWords(_offSessionScan(baseBars, _offSessionState(spec)))
  }
  for (const b of baseBars) {
    const day = b && typeof b.t === 'string' ? b.t.slice(0, 10) : null
    if (!day) continue
    const wd = new Date(`${day}T00:00:00Z`).getUTCDay()
    if (wd === 0 || wd === 6) return `a daily bar on ${day}, a ${wd === 0 ? 'Sunday' : 'Saturday'}`
  }
  return null
}

/**
 * ⭐ (e95) A custom timeframe's entry from its BASE payload: the base rows resampled by the chart's own rule.
 * - A base page that FILLED its ask (as many rows as asked, below the route's limit) may begin inside a bucket: its
 *   first output row is dropped (never a partial period shown as whole), and the entry names `askedBars` = its own
 *   row count, so the run knows a deeper page can reach older rows (`otherSymbols.js::filledPageOf`).
 * - A page that did not fill (the store's whole depth), or one at the route's limit, names no ask: nothing deeper is
 *   coming, and the run's depth rule keeps its `knownFrom`.
 * - A base row off the US equity session refuses the window by name (`offSessionRowOf`).
 */
function _readCustom(payload, symbol, tf, wire, trimFirst = true) {
  const base = payload && Array.isArray(payload.bars) ? payload.bars : []
  const off = offSessionRowOf(base, wire.spec)
  return _customEntry(payload, symbol, tf, wire, base, off, off ? null : resampleForSpec(base, wire.spec), trimFirst)
}

/** `_readCustom`'s entry, from the page's judgement (`off`) and its resampled rows. */
function _customEntry(payload, symbol, tf, wire, base, off, resampled, trimFirst) {
  if (off) {
    return {
      bars: [],
      status: SOURCE_STATUS.UNSUPPORTED,
      note: `${String(symbol).toUpperCase()}'s ${tf} bars are not built here: its own session is not the US equity `
        + `session the chart's ${tf} bars are built on (${off}), and how TradingView builds them is not yet witnessed`,
    }
  }
  const filled = base.length >= wire.baseAsk && wire.baseAsk < BASE_ASK_MAX
  let rows = resampled
  if (filled && trimFirst && rows.length) rows = rows.slice(1)
  const entry = _read({ ...(payload || {}), bars: rows })
  if (filled && entry.status === SOURCE_STATUS.AVAILABLE) entry.askedBars = rows.length
  return entry
}

// ─── ⭐ (2026-11-26, #2801) A DEEP PAGE NEVER COSTS A FRAME ─────────────────────────────────────────────────────────
// A benchmark page for a deep custom-timeframe line can hold ~19,000 base rows (the 4h ladder's top rung). Judged and
// resampled in one go that is one long task in the fetch's continuation, whatever the per-row cost. `idleRead` (asked
// by `serverCompute`'s deep lane) does the same two steps in slices of whole ET days, one slice per idle callback, and
// lands only after the last. The SAME answer: the judgement is one resumable scan (`_offSessionScan`), and a session
// bucket never spans an ET day on a page it accepts (an extended page's rows are 04:00-20:00, a regular spec takes
// regular-session rows only), so resampling whole days apart and joining them in order is resampling the page.
export const IDLE_READ_SLICE_ROWS = 2000
const _idleTurn = () => new Promise((resolve) => {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(() => resolve(), { timeout: 1000 })
  else setTimeout(resolve, 0)
})
const _etDayOf = (t) => Math.floor(Math.floor(toChartTime(t)) / 86400)
/** An ascending page's slices of at least `n` rows (the last may hold fewer), each ending where an ET day does. */
function _daySlices(base, n) {
  const out = []
  let i = 0
  while (i < base.length) {
    let j = Math.min(base.length, i + n)
    if (j < base.length) {
      let k = j - 1
      while (k > i && typeof (base[k] && base[k].t) !== 'number') k--
      const day = typeof (base[k] && base[k].t) === 'number' ? _etDayOf(base[k].t) : null
      while (j < base.length && (typeof (base[j] && base[j].t) !== 'number' || _etDayOf(base[j].t) === day)) j++
    }
    out.push(base.slice(i, j))
    i = j
  }
  return out
}
function _ascendingTimes(base) {
  let last = -Infinity
  for (const b of base) {
    if (!b || typeof b.t !== 'number') continue
    if (b.t < last) return false
    last = b.t
  }
  return true
}
/** `_readCustom`'s entry, built off the landing task: the judgement, then the resample, one ET-day slice per idle
 *  callback. A page that is not intraday, small, or not ascending is read whole, in one idle callback. */
async function _readCustomIdle(payload, symbol, tf, wire, trimFirst = true) {
  await _idleTurn()
  const base = payload && Array.isArray(payload.bars) ? payload.bars : []
  const spec = wire.spec
  if (!spec || spec.kind !== 'intradaySession' || base.length <= IDLE_READ_SLICE_ROWS || !_ascendingTimes(base)) {
    return _readCustom(payload, symbol, tf, wire, trimFirst)
  }
  const slices = _daySlices(base, IDLE_READ_SLICE_ROWS)
  const st = _offSessionState(spec)
  for (const s of slices) {
    await _idleTurn()
    if (_offSessionScan(s, st).words) break
  }
  const off = _offSessionWords(st)
  if (off) return _customEntry(payload, symbol, tf, wire, base, off, null, trimFirst)
  const rows = []
  for (const s of slices) {
    await _idleTurn()
    for (const r of resampleForSpec(s, spec)) rows.push(r)
  }
  return _customEntry(payload, symbol, tf, wire, base, null, rows, trimFirst)
}

// ─── ⭐⭐ (e90, the e88 live capture, 2026-11-20) — WHAT DEPTH AN ENTRY WAS ASKED AT ───────────────────────────────────
// Every AVAILABLE entry records the `bars=` its fetch asked (`askedBars`), a plain field, so it crosses the worker with
// the rest of the entry (`runtimeAsync.js`, `plainFieldsOf`). An answer holding as many rows as it asked FILLED its ask:
// the store may hold older rows, which only a deeper ask reaches. ⚰️ Fred RS on RDDT 30m / 5m: SP:SPX's first page (600
// rows, asked when the chart held 600) began mid-session (30m: 09-16 15:00 ET; 5m: 11-10 11:30 ET), the chart had
// grown to 3,002 / 20,008 rows, and the run refused the chart for that session's opening bars ("`SPX` has no bar on
// <09:30>, after its history began") until the deeper page (780 / 4,680 rows, from a session open) landed. Seen on
// e81, e85, e86 and e88. The run decides from this field whether those bars are still coming (`requestSupply.js`).

// ─── The cache ──────────────────────────────────────────────────────────────

const _cache = new Map()      // url -> {bars, status}
const _inflight = new Map()   // url -> Promise
const _subscribers = new Set()
/** url -> {entry, attempt, retryAt, ready, timer} — the failure ledger, NOT a
 *  cache. `_cache` holds facts about the DATA; this holds a fact about the last
 *  ATTEMPT: how many have failed in a row, and whether the wait is over. */
const _retry = new Map()

/**
 * Why a source has no numbers — kept BESIDE the bars, never folded into them.
 *
 * ⭐⭐ THE EVALUATOR'S ANSWER IS NaN AND THAT IS CORRECT; the PRODUCT'S answer
 * must not be. "Not computable" is one word for six different situations, and a
 * member told only that a line is missing cannot tell a symbol we do not serve
 * from a symbol that is still loading. The warm-up phase settled the underlying
 * principle — UNKNOWN IS NOT FALSE — and this is the same distinction one layer
 * out: unknown is not all the same unknown.
 */
export const SOURCE_STATUS = Object.freeze({
  LOADING: 'loading',
  AVAILABLE: 'available',
  NO_DATA: 'no_data',
  UNSUPPORTED: 'unsupported',
  ERROR: 'error',
  // ⭐⭐ DENIED IS TERMINAL, AND THAT IS THE WHOLE POINT OF ADDING IT.
  // Every other status here is a fact about the DATA; this one is a fact about
  // the CALLER, and it is the only one that will not change by asking again.
  // ⛔ IT IS NOT `NO_DATA`. A member who is told "no data" for QQQ learns
  // something false about QQQ — the series exists, their plan does not include
  // it. Nor is it `ERROR`: an error is a thing that might work next time, and
  // treating a permanent refusal as one is exactly the retry storm below.
  DENIED: 'denied',
})

/** HTTP statuses that mean "asking again will not help": not signed in, or
 *  signed in without the entitlement. Everything else is transient by default —
 *  the safe direction, because a wrongly-terminal status is a chart that stays
 *  blank until reload. */
const DENIED_STATUSES = new Set([401, 403])

/**
 * The HTTP status of a rejected fetch — WHICHEVER FETCHER THREW IT.
 *
 * ⛔⛔ TWO SUPPLIERS, TWO SPELLINGS, AND THE MEMBERSHIP TEST SAW ONLY ONE.
 * `_defaultFetch` below stamps `err.httpStatus`. The chart does not use
 * `_defaultFetch`: it passes its OWN fetcher — the one with the concurrency gate
 * and the switch-abort — and that one stamps `err.status` and never
 * `httpStatus`. Reading a single field therefore answered `undefined` on the
 * only path a member is ever on, `undefined` is not in `DENIED_STATUSES`, and a
 * permanent 401/403 was filed as a transient error and re-requested on every
 * paint. The whole defect is one missing spelling.
 *
 * ⭐ SO THE READ LIVES HERE, ONCE. Teaching either call site to stamp the other
 * field would put a second authority on "what status was that" and the next
 * fetcher would arrive with a third spelling
 * (`lesson_a_second_authority_over_one_value`).
 *
 * @returns {number|null} null for a failure that carries no numeric status at
 *   all — a network error, a 25s abort — which is transient by default, the
 *   safe direction this module already chose.
 */
function _statusOf(err) {
  if (!err || typeof err !== 'object') return null
  if (Number.isFinite(err.httpStatus)) return err.httpStatus
  if (Number.isFinite(err.status)) return err.status
  return null
}

/**
 * A Retry-After the FETCHER read, in milliseconds, or 0 when there is none.
 *
 * ⚠️ READ WHAT THE FETCHERS ACTUALLY ATTACH, NOT WHAT THE HEADER IS CALLED.
 * The chart's fetcher parses `Retry-After` on a warming 503 and stamps
 * `err.retryAfterMs` — already milliseconds, already validated finite-and-
 * positive. `_defaultFetch` never looks at the header and attaches nothing. So
 * there is exactly ONE field to honour here, and a reader that went looking for
 * a `retryAfter` in seconds would find neither supplier and still look correct.
 */
function _retryAfterMs(err) {
  const ms = err && typeof err === 'object' ? err.retryAfterMs : null
  return Number.isFinite(ms) && ms > 0 ? ms : 0
}

/** The first wait after a failure, and the ceiling the doubling stops at.
 *
 *  ⭐ EXPORTED BECAUSE THE RAILS ASSERT THE SCHEDULE. A test that retyped `2000`
 *  would keep passing through a change to the constant it claims to pin — the
 *  hand-typed-number-beside-its-source defect this codebase keeps paying for. */
export const RETRY_BASE_MS = 2000
export const RETRY_MAX_MS = 60000

/** How long to wait after `attempt` consecutive failures of one URL. */
function _backoffMs(attempt, floorMs) {
  const grown = Math.min(RETRY_BASE_MS * (2 ** Math.max(0, attempt - 1)), RETRY_MAX_MS)
  // ⭐ THE SERVER'S OWN NUMBER IS A FLOOR, NEVER TRIMMED BY OUR CEILING. The
  // ceiling bounds a GUESS about a server that has told us nothing; a
  // `Retry-After` is the only party that knows when it will be ready. Clamping
  // it would put our guess above its instruction, which is backwards.
  return Math.max(grown, floorMs)
}

/**
 * Record that this URL failed, and when it may be asked again.
 *
 * ⭐⭐ THE ENTRY IS THE ANSWER AND THE TIMER IS THE WAKE-UP. `ensure` hands the
 * stored entry back on every paint — the SAME object each time, so
 * `useSecondarySources`'s identity check sees no change and the chart does not
 * repaint — and the timer fires ONE notification when the wait is over, which is
 * what makes consumers re-ensure and put exactly one request back on the wire.
 *
 * ⛔ AND IT IS STILL NOT A CACHED FAILURE. Once the wait elapses the record
 * stops answering — it keeps only how many attempts have failed in a row, which
 * is what makes the next wait longer than the last — so nothing here is ever
 * remembered as an answer about the data. A success deletes it outright.
 */
function _armRetry(url, err) {
  const prev = _retry.get(url)
  if (prev && prev.timer) clearTimeout(prev.timer)
  // ⛔⛔ THE COUNT SURVIVES THE WAIT; ONLY A SUCCESS RESETS IT. An elapsed
  // record that deleted itself would hand the next failure `attempt = 1` again,
  // so every wait would be the base one and the curve would never grow — a
  // backoff that reads as implemented and is a fixed 2s retry loop.
  const attempt = (prev ? prev.attempt : 0) + 1
  const delay = _backoffMs(attempt, _retryAfterMs(err))
  // One clock read, shared by the record and the entry it hands out: two reads
  // of `Date.now()` can differ by a millisecond, and a schedule that disagrees
  // with the status it publishes is a second authority over one value.
  const retryAt = Date.now() + delay
  const record = {
    entry: { bars: [], status: SOURCE_STATUS.ERROR, retryAt },
    attempt,
    retryAt,
    ready: false,
    timer: null,
  }
  record.timer = setTimeout(() => {
    // ⭐ THE TIMER IS THE AUTHORITY ON "THE WAIT IS OVER", not a clock read at
    // the call site. One source of truth, and a consumer cannot be told to look
    // again a millisecond before the lane is willing to ask.
    const held = _retry.get(url)
    if (held === record) { held.ready = true; held.timer = null }
    _notify(url)
  }, delay)
  // ⚠️ A pending retry must never hold a process open — a browser has no
  // `unref`, a node test runner does, and a lane that keeps a runner alive for a
  // minute after its last assertion reads as a hang.
  if (record.timer && typeof record.timer.unref === 'function') record.timer.unref()
  _retry.set(url, record)
  return record.entry
}

/** Forget a URL's failure history. A success ends it, and so does a denial —
 *  which is terminal and needs no schedule. */
function _clearRetry(url) {
  const held = _retry.get(url)
  if (!held) return
  if (held.timer) clearTimeout(held.timer)
  _retry.delete(url)
}

/** Notified whenever an entry lands, so a host can repaint. @returns {() => void} */
export function subscribe(fn) {
  if (typeof fn !== 'function') return () => {}
  _subscribers.add(fn)
  return () => { _subscribers.delete(fn) }
}

function _notify(url) {
  for (const fn of [..._subscribers]) {
    try { fn(url) } catch { /* a bad subscriber must not break the lane */ }
  }
}

/** Test seam, and the escape hatch for a timeframe change. */
export function clearSecondaryBars() {
  _cache.clear()
  _inflight.clear()
  _lastRefresh.clear()
  // ⛔ AND EVERY PENDING RETRY. A timer armed against a cache that no longer
  // exists notifies subscribers about a URL nobody holds — and inside a test
  // file it arrives during the NEXT case as a request nothing asked for.
  for (const held of _retry.values()) if (held.timer) clearTimeout(held.timer)
  _retry.clear()
}

/**
 * Read the response the bars route actually returns.
 *
 * ⚠️ THE `note` FIELD IS THE UNSUPPORTED SIGNAL, and it is the route's own
 * words. A cash index answers `{bars: [], sealed: false, note: "index history not
 * served by /api/bars-history"}` — an empty list WITH a reason. An ordinary
 * symbol that simply has nothing stored answers an empty list with no note. Those
 * are different facts and a member deserves to be told which one happened.
 */
function _read(payload, asked) {
  const bars = payload && Array.isArray(payload.bars) ? payload.bars : []
  if (bars.length) {
    // ⭐ (e90) the depth this window asked (`askedBars`, above), on an entry that holds rows; a tail read
    // (`refreshSecondaryTail`) names none: its rows are merged into the held entry, which keeps its own
    const asks = asked === undefined ? {} : { askedBars: askedBarsOf(asked) }
    // ⭐ (2026-11-23, the index-history disclosure) the route's own `deep` record, when it sent one: an index series whose
    // older sessions come from our data vendor's settled history (FMP) before Yahoo's own window. Plain fields only (it
    // crosses the worker with the entry); `indexHistoryNotice.js` reads it, nothing else does.
    const d = payload && payload.deep && typeof payload.deep === 'object' ? payload.deep : null
    if (d) asks.indexDeep = { src: d.src || null, joined: d.joined === true, from: d.from || null, through: d.through || null }
    // ⭐ 2026-09-28 — THE NEWEST BAR'S CLOSE STATE TRAVELS WITH THE BARS IT
    // DESCRIBES. A calculation-timeframe frame (`mtfProjection.js`) may only treat
    // its newest bar as a COMPLETED period when the server said so; dropping the
    // tri-state here would make every forming weekly bar look final. `null` stays
    // `null` (unknown) — never coerced to `false` (settled).
    // Attached only when the payload carries the field at all, so an entry built
    // from a payload that predates it keeps its exact old shape.
    if (!Object.prototype.hasOwnProperty.call(payload, 'newest_bar_is_forming')) {
      return { bars, status: SOURCE_STATUS.AVAILABLE, ...asks }
    }
    const forming = payload.newest_bar_is_forming
    return {
      bars,
      status: SOURCE_STATUS.AVAILABLE,
      newestBarIsForming: typeof forming === 'boolean' ? forming : null,
      ...asks,
    }
  }
  const note = payload && typeof payload.note === 'string' ? payload.note : ''
  return { bars, status: note ? SOURCE_STATUS.UNSUPPORTED : SOURCE_STATUS.NO_DATA, note: note || undefined }
}

/**
 * The SYNCHRONOUS read the binder uses. Never fetches.
 *
 * Deliberately side-effect free, for the reason `cachedColumns` gives: a read
 * that fetches cannot be called from a test or a probe without paying for a
 * request.
 */
export function cachedBars(symbol, tf, bars, opts = {}) {
  const url = secondaryBarsUrl(symbol, tf, bars, { extended: opts.extended })
  if (!url) return null
  const hit = _cache.get(url)
  return hit === undefined ? null : hit
}

/**
 * ANY entry we hold for this symbol, whatever window it was fetched for.
 *
 * ⭐⭐ FOR A SURFACE THAT KNOWS THE SYMBOL AND NOT THE WINDOW. The settings tab
 * has to answer "may this series be drawn as candles?" and it knows the
 * instance's source — but the timeframe and bar count belong to the CHART, and
 * threading them into a modal would put a rendering concern in a form. The
 * question this answers is "what do we hold for this instrument", which is the
 * honest one for a capability probe.
 *
 * ⛔ IT NEVER FETCHES, for the reason `cachedBars` states: a read that fetches
 * cannot be called from a probe without paying for a request. It reads what the
 * chart has already loaded, and answers `null` before that lands — which the
 * capability gate treats as "not yet", the fail-closed direction.
 *
 * ⚠️ FIRST MATCH WINS. Two windows of one symbol are the same instrument and the
 * same o/h/l/c shape; a capability answer cannot differ between them.
 */
export function anyCachedBars(symbol) {
  const s = typeof symbol === 'string' ? symbol.trim().toUpperCase() : ''
  if (!s) return null
  const prefix = `${BARS_PATH}${encodeURIComponent(s)}?`
  for (const [url, entry] of _cache) if (url.startsWith(prefix)) return entry
  return null
}

/**
 * The fetch. Deduped per URL, so every consumer of one symbol costs one request.
 *
 * ⛔ A FAILURE IS NOT CACHED. An absent entry can be asked for again; a cached
 * failure would be remembered as "no data" for the life of the chart. Same rule,
 * same reason, as the server lane. What IS remembered is WHEN it may be asked
 * again — see `_armRetry`, which is a schedule, not an answer.
 *
 * ⚠️ THIS FUNCTION ALWAYS ASKS. The backoff gate is in `ensure`/`ensureAll`,
 * which is the PAINT path and runs on every tick; this is the primitive that
 * means "ask now", and a caller reaching for it directly has already decided to.
 */
export function fetchSecondaryBars(symbol, tf, bars, fetcher, opts = {}) {
  const wire = secondaryFetchOf(symbol, tf, bars, opts)
  if (!wire) return Promise.resolve(null)
  const { url } = wire
  const existing = _inflight.get(url)
  if (existing) return existing

  const get = typeof fetcher === 'function' ? fetcher : _defaultFetch
  // ⭐⭐ (2026-11-26, Fred RS load time) the request this page started as it loaded, when it remembered needing this
  // window (`lib/bootSecondaryBars.js`); a failed boot request ("no answer") is asked again here, as before
  const boot = takeBootSecondaryBars(wire.fetchUrl)
  const p = Promise.resolve()
    .then(() => (boot ? boot.then((payload) => payload || get(wire.fetchUrl)) : get(wire.fetchUrl)))
    .then((payload) => {
      // ⭐ (2026-11-26, #2801) `opts.idleRead`: a custom-timeframe page is judged and resampled OFF this landing task,
      // in ET-day slices across idle callbacks (`_readCustomIdle`), and lands (cache, notification) only then
      if (wire.spec && opts.idleRead) {
        return _readCustomIdle(payload, symbol, tf, wire).then((entry) => {
          _cache.set(url, entry)
          _clearRetry(url)
          return entry
        })
      }
      const entry = wire.spec ? _readCustom(payload, symbol, tf, wire) : _read(payload, bars)
      _cache.set(url, entry)
      // ⭐ A SUCCESS RESETS THE BACKOFF. Otherwise one bad afternoon leaves the
      // rest of the session waiting a minute for every later blip.
      _clearRetry(url)
      return entry
    })
    .catch((err) => {
      // ⭐⭐ A DENIAL IS CACHED; AN ERROR IS NOT. The difference is whether asking
      // again could change the answer.
      //
      // ⚰️ MEASURED 2026-09-13, during the bars entitlement pass: every failure
      // deleted its entry so "the next paint asks again", which is right for a
      // transient 503 and catastrophic for a permanent 401/403. A live chart
      // repaints on every tick, so an unentitled member would have driven an
      // unbounded request storm at an endpoint that can only ever refuse — the
      // client half of the very amplification the server-side gate just closed.
      //
      // ⚰️⚰️ AND IT DID NOT FIRE ON THE REAL CHART, MEASURED 2026-09-19. This read
      // `err.httpStatus`, which only `_defaultFetch` sets; the chart passes its
      // own fetcher, which sets `err.status`. So the branch below answered
      // `undefined` on every member's chart, every 401/403 fell through to the
      // transient path, and the storm this comment forbids ran anyway. `_statusOf`
      // reads either spelling, in one place.
      const status = _statusOf(err)
      if (DENIED_STATUSES.has(status)) {
        const entry = { bars: [], status: SOURCE_STATUS.DENIED, httpStatus: status }
        _cache.set(url, entry)
        _clearRetry(url)
        return entry
      }
      // ⚠️ AN ERROR IS A STATUS, NOT A SILENCE — but it is not CACHED either.
      // The entry is removed so the source can be asked for again; the status is
      // handed back to the caller that asked.
      //
      // ⛔⛔ AND "AGAIN" IS NOT "NOW". Deleting the entry and notifying made the
      // subscriber re-ensure in the same tick, so a 503 during a deploy, a
      // network blip or a 25s abort was re-requested immediately and forever —
      // the same amplification as the denial above, from the other half of the
      // `.catch`. The ledger says when; until then `ensure` answers ERROR
      // without asking.
      // ⭐ (2026-10-10) A SWITCH-ABORT IS NOT A FAILURE. The chart's fetcher tags a fetch the
      // member scanned past `canceled`; arming the backoff for it left a breadth/indicator
      // pane blank for 2 s+ (doubling) after every quick ticker switch. Forget it and let the
      // next ensure ask again at once.
      if (err && err.canceled) {
        _cache.delete(url)
        _clearRetry(url)
        return { bars: [], status: SOURCE_STATUS.LOADING }
      }
      _cache.delete(url)
      return _armRetry(url, err)
    })
    .finally(() => {
      _inflight.delete(url)
      _notify(url)
    })

  _inflight.set(url, p)
  return p
}

function _defaultFetch(url) {
  return fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) {
      const err = new Error(`HTTP ${r.status}`)
      // ⚠️ THE STATUS RIDES ON THE ERROR, because by the time the `.catch`
      // below sees it the Response is gone. A thrown string would have made the
      // two failure KINDS indistinguishable at the only place that can tell them
      // apart — which is how a permanent 403 became an every-paint retry.
      err.httpStatus = r.status
      throw err
    }
    return r.json()
  })
}

/**
 * Read the cache, and ask for the entry if it is not there.
 *
 * What the binder calls: a synchronous answer now — possibly `{status: loading}`
 * — and a request in flight for the next paint.
 *
 * ⛔⛔ AND IT IS THE PAINT PATH, WHICH IS WHY THE BACKOFF GATE IS HERE. A live
 * chart runs this on every tick, so "ask again next time" and "ask again
 * hundreds of times a minute" are the same sentence written twice.
 */
export function ensureSecondaryBars(symbol, tf, bars, fetcher, opts = {}) {
  const hit = cachedBars(symbol, tf, bars, opts)
  if (hit) return hit
  const url = secondaryBarsUrl(symbol, tf, bars, { extended: opts.extended })
  if (!url) return null
  // ⭐ A FAILING URL ANSWERS ERROR AND ASKS FOR NOTHING until its wait elapses —
  // the same object every paint, so the hook's identity check sees no change.
  // The wake-up is the ONE notification `_armRetry`'s timer fires.
  const waiting = _retry.get(url)
  if (waiting && !waiting.ready && !_inflight.has(url)) return waiting.entry
  if (!_inflight.has(url)) fetchSecondaryBars(symbol, tf, bars, fetcher, opts)
  return { bars: [], status: SOURCE_STATUS.LOADING }
}

/**
 * Ask for every symbol a chart needs, in one pass.
 *
 * ⭐ THE LIST IS ALREADY DEDUPED by `symbolsNeeded`, and the per-URL in-flight
 * map catches anything it missed — the same belt-and-braces the scan evaluator
 * uses when it loads benchmarks once outside the per-symbol loop.
 *
 * @returns {Map<string, {bars, status}>} keyed by canonical symbol
 */
export function ensureAll(symbols, tf, bars, fetcher, opts = {}) {
  const out = new Map()
  for (const symbol of (Array.isArray(symbols) ? symbols : [])) {
    const entry = ensureSecondaryBars(symbol, tf, bars, fetcher, opts)
    if (entry) out.set(symbol, entry)
  }
  return out
}

/**
 * Seed the cache from a payload somebody else already fetched.
 *
 * ⭐ THE COMPARE-SYMBOLS BRIDGE. Compare has fetched a second symbol's bars
 * through SWR since long before this lane existed. Priming here means a member
 * comparing QQQ and plotting QQQ pays for ONE request rather than two — and, just
 * as importantly, means this lane does not have to take Compare's fetch away from
 * it to get that saving. `primeServerColumns` exists for exactly this reason and
 * for exactly these stakes.
 */
export function primeSecondaryBars(symbol, tf, bars, payload, opts = {}) {
  const wire = secondaryFetchOf(symbol, tf, bars, opts)
  if (!wire) return null
  const { url } = wire
  // ⛔ (e95) a custom timeframe is never primed: the payload a caller holds is not known to be this window's base page
  if (wire.spec) return _cache.get(url) || null
  const entry = _read(payload, bars)
  // ⛔ An empty prime does NOT overwrite a good entry: Compare's SWR hands back
  // `undefined` on its first render, and caching that would blank a series that
  // is already drawing.
  if (!entry.bars.length && _cache.has(url)) return _cache.get(url)
  _cache.set(url, entry)
  return entry
}

/** ⭐⭐ RS RATING L11 PR 2 — HOW MANY NEWEST ROWS A TAIL REFRESH ASKS FOR: enough to overlap held rows a
 *  fortnight old, a sliver of the 12,500-session SP:SPX history the chart holds. */
export const TAIL_BARS = 10

/** Bar times compare as numbers (intraday, an index's daily key) or as ISO dates (a daily stock bar). */
function _timeBefore(a, b) {
  return typeof a === 'number' && typeof b === 'number' ? a < b : String(a) < String(b)
}
function _sameRow(a, b) {
  return !!a && !!b && a.t === b.t && a.o === b.o && a.h === b.h && a.l === b.l && a.c === b.c && a.v === b.v
}

/**
 * The held rows with a fetched TAIL (the series' newest rows, ascending) laid over them: every held row
 * before the tail's first, then the tail. `null` when the tail does not OVERLAP the held rows (its first
 * row is not one of them): the sessions between are unknown and only a full fetch can supply them.
 */
export function mergeTail(held, tail) {
  if (!Array.isArray(held) || !held.length || !Array.isArray(tail) || !tail.length) return null
  const first = tail[0] && tail[0].t
  let i = held.length - 1
  while (i >= 0 && _timeBefore(first, held[i].t)) i -= 1
  if (i < 0 || held[i].t !== first) return null
  return held.slice(0, i).concat(tail)
}

/**
 * ⭐⭐ RS RATING L11 PR 2 — KEEP A FORMING SERIES CURRENT: re-read its newest rows (`TAIL_BARS`) and lay
 * them over the held entry, carrying the route's `newest_bar_is_forming` for its newest bar.
 *
 * WHY: `ensureSecondaryBars` caches one fetch per window for the page's life, right for a history and
 * wrong for a series whose session is in progress. SP:SPX fetched at 10:00 kept 10:00's forming row (and
 * `forming: true`) all day; fetched before the open it never held today's row at all. What the chart's
 * newest bar reads of it (`otherSymbols.newestOwnPeriodOf`) is only as current as this entry.
 *
 * ⛔ The held entry stays until the merged one replaces it, and it is REPLACED ONLY WHEN SOMETHING MOVED
 * (a row or the flag): an unchanged answer keeps the very same object, so nothing recomputes.
 * ⛔ A tail that does not overlap (a page held open past `TAIL_BARS` sessions) is a FULL refetch.
 * ⛔ Throttled per window (`REFRESH_MIN_MS`, shared with `refreshSecondaryBars`) and deduped in flight.
 * @returns {boolean} whether a fetch was started
 */
export function refreshSecondaryTail(symbol, tf, bars, fetcher, opts = {}) {
  const wire = secondaryFetchOf(symbol, tf, bars, opts)
  const tailWire = secondaryFetchOf(symbol, tf, TAIL_BARS, opts)
  const url = wire && wire.url
  // ⭐ (e95) a custom timeframe's tail is its base's newest rows, resampled: its first bucket may be partial and is
  // dropped (`_readCustom`), so the merged tail starts on a whole bucket the held rows already hold
  const tailUrl = tailWire && tailWire.fetchUrl
  if (!url || !tailUrl || url === tailUrl || _inflight.has(url) || _inflight.has(tailUrl)) return false
  const held = _cache.get(url)
  if (!held || held.status !== SOURCE_STATUS.AVAILABLE || !held.bars.length) return false
  const now = Date.now()
  if (now - (_lastRefresh.get(url) || 0) < REFRESH_MIN_MS) return false
  _lastRefresh.set(url, now)
  const get = typeof fetcher === 'function' ? fetcher : _defaultFetch
  let moved = false
  const p = Promise.resolve()
    .then(() => get(tailUrl))
    .then((payload) => {
      const tail = tailWire.spec ? _readCustomTail(payload, symbol, tf, tailWire) : _read(payload)
      const cur = _cache.get(url) || held
      if (!tail.bars.length) return cur
      const merged = mergeTail(cur.bars, tail.bars)
      if (!merged) {
        _lastRefresh.delete(url)
        refreshSecondaryBars(symbol, tf, bars, fetcher, opts)   // the same chart's session (review of #2753, round 2)
        return cur
      }
      const flagged = Object.prototype.hasOwnProperty.call(tail, 'newestBarIsForming')
      const sameFlag = flagged ? cur.newestBarIsForming === tail.newestBarIsForming
        : !Object.prototype.hasOwnProperty.call(cur, 'newestBarIsForming')
      const from = merged.length - tail.bars.length
      const sameRows = merged.length === cur.bars.length
        && tail.bars.every((row, k) => _sameRow(row, cur.bars[from + k]))
      if (sameFlag && sameRows) return cur
      const next = { ...cur, bars: merged, status: SOURCE_STATUS.AVAILABLE }
      if (flagged) next.newestBarIsForming = tail.newestBarIsForming
      else delete next.newestBarIsForming
      _cache.set(url, next)
      moved = true
      return next
    })
    .catch(() => _cache.get(url) || held)
    .finally(() => {
      _inflight.delete(tailUrl)
      if (moved) _notify(url)
    })
  _inflight.set(tailUrl, p)
  return true
}

/** ⭐ (e95) a custom timeframe's TAIL: its base's newest rows resampled, the first (maybe partial) bucket dropped, and
 *  no ask named (a tail is merged into the held entry, which keeps its own). An off-session base refuses as above. */
function _readCustomTail(payload, symbol, tf, wire) {
  const entry = _readCustom(payload, symbol, tf, { ...wire, baseAsk: 0 }, false)
  if (entry.status !== SOURCE_STATUS.AVAILABLE) return entry
  const rows = entry.bars.slice(1)
  const out = { ...entry, bars: rows }
  delete out.askedBars
  return rows.length ? out : { bars: [], status: SOURCE_STATUS.NO_DATA }
}

/** How many requests are in flight — a test seam for the dedup rail. */
export function inflightCount() {
  return _inflight.size
}

/** The minimum spacing between two refreshes of one window — a frame that stays
 *  behind (a provider lag) must not turn into a request per paint. */
export const REFRESH_MIN_MS = 20000
const _lastRefresh = new Map()   // url -> ms

/**
 * RE-FETCH one window whose cached snapshot has gone BEHIND the chart.
 *
 * ⭐⭐ WHY THIS EXISTS. `ensureSecondaryBars` caches one fetch per window for the
 * session, which is right for a secondary SYMBOL's history and wrong for a
 * calculation-timeframe FRAME: a 1h frame fetched at 10:05 does not know the 10:30
 * bar has closed at 11:31. `mtfProjection` detects that (the chart's own bars are
 * the witness) and reports it; this is the one door that answers it.
 *
 * ⛔ THE OLD ENTRY STAYS UNTIL THE NEW ONE LANDS. The projection already refuses to
 * show anything the old snapshot cannot prove, so keeping it costs nothing and
 * dropping it would blank every correct historical value for the length of a fetch.
 * ⛔ THROTTLED PER WINDOW (`REFRESH_MIN_MS`) and deduped with an in-flight fetch.
 *
 * @returns {boolean} whether a fetch was started
 */
export function refreshSecondaryBars(symbol, tf, bars, fetcher, opts = {}) {
  const wire = secondaryFetchOf(symbol, tf, bars, opts)
  const url = wire && wire.url
  if (!url || _inflight.has(url)) return false
  const now = Date.now()
  const last = _lastRefresh.get(url) || 0
  if (now - last < REFRESH_MIN_MS) return false
  _lastRefresh.set(url, now)
  const keep = _cache.get(url)
  const get = typeof fetcher === 'function' ? fetcher : _defaultFetch
  const p = Promise.resolve()
    .then(() => get(wire.fetchUrl))
    .then((payload) => {
      const entry = wire.spec ? _readCustom(payload, symbol, tf, wire) : _read(payload, bars)
      // ⛔ AN EMPTY ANSWER DOES NOT REPLACE BARS WE HAVE — same rule as
      // `primeSecondaryBars`: a transient empty payload is not "no history".
      if (!entry.bars.length && keep && keep.bars && keep.bars.length) return keep
      _cache.set(url, entry)
      return entry
    })
    .catch(() => keep || null)
    .finally(() => {
      _inflight.delete(url)
      _notify(url)
    })
  _inflight.set(url, p)
  return true
}
