// app/src/components/chart/engine/tvRunWindow.js
//
// ─── ⭐⭐ HISTORY PARITY, PHASE 2 — A LISTING DOCUMENT ON AN INTRADAY CHART RUNS FROM TRADINGVIEW'S FIRST BAR ──────
//
// A runtime document that needs its run to start at TradingView's bar 0 (`meta.runtimeHistory === 'listing'`) was
// refused by name on every intraday chart (`runtime:history-start`): our first bar is not TradingView's. TradingView's
// intraday run starts at the first bar of the calendar chunk that holds the 20,000th newest bar of the chart's session
// (`tvRunStart.js`, the rule and its evidence; `docs/pine/HISTORY-PARITY.md`). Where the chart holds that bar and the
// rule PROVES it, the run is computed from it, exactly as a run from the listing is (`historyFromListing: true`, the
// VM's [B-START]: bar 0 is TradingView's bar 0), and widened back to the chart (`NaN` before it: TradingView has no
// bars there). Everywhere else the refusal stands, and says WHY by name: the start is not loaded yet, it sits on a chunk
// boundary the cap's range cannot decide, the timeframe is unmeasured.
//
// Two halves, both pure:
//   • `tvRunStartStampOf` (the chart's half, `StockChart.jsx`): the stamp `ctx.tvRunStart`, keyed by the start bar's
//     TIME, LATCHED for the life of the chart's series: a scroll-back prepend, a new bar or a whole-chunk move of the
//     cap-th newest bar never moves a start already proven (TradingView moves it only on a reload). It is recomputed
//     only when the latched bar is no longer held, or was never proven.
//   • `tvRunWindowOf` / `computeTvRunWindow` (the lane's half, `runtimeColumns.js::computeRuntimeColumns`).
//
// ⛔ POPULATION. `proven` assumes our session bars are TradingView's. On a liquid name they are (measured 2026-11-27
// against the capture fixture: SPY 5m / 15m / 30m ETH, TradingView's count from its first bar lies inside ours over
// the same span); on a thin name's extended hours they are not (RDDT 5m ETH ours +1,580, 15m +750), which moves the
// cap-th newest bar by up to a chunk. So the cap's range is widened by the session slots our own series leaves EMPTY
// over the cap window (`missingSessionSlots`): a vendor that holds bars where we hold none can differ by at most about
// that many. SPY 5m ETH: 136 empty slots (a week is 960 bars: proven); RDDT 5m ETH: 5,128 (ambiguous: withheld).

import { tvRunStart, TV_CHUNK_BY_TF, TV_INTRADAY_CAP, TV_INTRADAY_CAP_BOUNDS } from './tvRunStart.js'
import { widenToChart } from './calcBarsWindow.js'
import { RUNTIME_OBJECTS_KEY, RUNTIME_WARMUP_KEY } from './runtime/runtimeObjects.js'

/** The exchange timezone the stamp is computed in. Only plain US tickers are stamped (`isUsTicker`). */
export const TV_RUN_TZ = 'America/New_York'
/** Session minutes per day: extended hours 04:00-20:00 ET, regular 09:30-16:00 ET. */
const ETH_MINUTES = 960
const RTH_MINUTES = 390
const DAY = 86400

let _served = true
/** Tests (the mutant's control), and the one switch back: is a proven TradingView start served? */
export function setTvRunStartServed(on) { _served = on !== false }
export function tvRunStartServed() { return _served }

/** A plain US ticker (the exchange timezone is New York): `SPY`, `BRK.B`, `RDDT`. Index, crypto and forex
 *  spellings (`I:SPX`, `X:BTCUSD`) and anything else are not stamped: their session and timezone are not this one. */
export function isUsTicker(sym) {
  return typeof sym === 'string' && /^[A-Z][A-Z0-9.-]{0,9}$/.test(sym)
}

const secondsOf = (t) => (typeof t === 'number' && Number.isFinite(t) ? (t > 1e11 ? t / 1000 : t) : NaN)

// The New York UTC offset of each UTC day, read at 05:00 UTC: before any US transition that day (06:00 / 07:00 UTC),
// so it is the offset in force for every bar of that UTC day that could fall on the previous New York date.
const _offsetByUtcDay = new Map()
const _offFmt = new Intl.DateTimeFormat('en-US', { timeZone: TV_RUN_TZ, hour: 'numeric', hourCycle: 'h23' })
function nyOffsetHours(utcDay) {
  let off = _offsetByUtcDay.get(utcDay)
  if (off === undefined) {
    const h = +_offFmt.formatToParts(new Date((utcDay * DAY + 5 * 3600) * 1000)).find((p) => p.type === 'hour').value
    off = 5 - h   // 05:00 UTC is 00:00 EST (offset 5) or 01:00 EDT (offset 4)
    _offsetByUtcDay.set(utcDay, off)
  }
  return off
}

/** The New York calendar day number (days since 1970-01-01) of an instant in unix seconds. */
export function nyDayNumber(tSec) {
  const utcDay = Math.floor(tSec / DAY)
  return Math.floor((tSec - nyOffsetHours(utcDay) * 3600) / DAY)
}

/** `YYYY-MM-DD` of a New York day number. */
const isoOfDay = (d) => new Date(d * DAY * 1000).toISOString().slice(0, 10)

/** Bars a full session day holds on `tf` (minutes): extended hours 960 min, regular 390. */
export function sessionSlotsPerDay(tf, extended) {
  const m = Number(tf)
  if (!(m > 0)) return 0
  return Math.ceil((extended ? ETH_MINUTES : RTH_MINUTES) / m)
}

/**
 * How many of the session's slots the series leaves EMPTY over `times[from..]`: for each New York day it holds a bar
 * on, the day's slots minus the bars it holds (an early close counts its lost slots too: the bound only widens). A day
 * that `from` cuts in two is not counted (the window cut it, not the session).
 */
export function missingSessionSlots(times, tf, extended, from = 0) {
  const per = sessionSlotsPerDay(tf, extended)
  if (!per) return 0
  let missing = 0
  let day = null
  let count = 0
  let i0 = Math.max(0, from)
  // the window's first day is cut by the window, not by the session: counting starts on the next whole day
  if (i0 > 0 && i0 < times.length) {
    const cutDay = nyDayNumber(times[i0 - 1])
    while (i0 < times.length && nyDayNumber(times[i0]) === cutDay) i0 += 1
  }
  for (let i = i0; i < times.length; i += 1) {
    const d = nyDayNumber(times[i])
    if (d !== day) {
      if (day !== null) missing += Math.max(0, per - count)
      day = d
      count = 0
    }
    count += 1
  }
  if (day !== null) missing += Math.max(0, per - count)
  return missing
}

/** The index of the row whose time is `t` (unix seconds) in `rows` (`{t}` or numbers, ascending), or -1. */
export function indexOfTime(rows, t) {
  let lo = 0
  let hi = (rows ? rows.length : 0) - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const r = rows[mid]
    const v = secondsOf(r && typeof r === 'object' ? r.t : r)
    if (v === t) return mid
    if (v < t) lo = mid + 1
    else hi = mid - 1
  }
  return -1
}

/**
 * ⭐ THE CHART'S STAMP: where TradingView's run of a listing document starts on this chart, or null where the
 * question does not arise (a daily / weekly / monthly chart: the listing statement answers there; not a plain US
 * ticker; no intraday bars).
 *
 * @param {object} a
 * @param {Array<{t:number}>} a.bars  the chart's session bars, oldest first (what the binder computes on)
 * @param {string} a.tf               the chart's timeframe code
 * @param {boolean} a.extended        extended hours on (the chart's session)
 * @param {string} a.sym              the chart's ticker
 * @param {string|null} [a.listDate]  the symbol's first trading day (`listingReferenceDate`), `YYYY-MM-DD`
 * @param {object|null} [a.prev]      the stamp this chart computed last (the latch)
 * @returns {null | {key, t, index, proven, rule, chunk, ambiguous, why, tolerance, held, heldFrom}}
 */
export function tvRunStartStampOf({ bars, tf, extended, sym, listDate = null, prev = null } = {}) {
  const code = String(tf == null ? '' : tf)
  if (!/^\d+$/.test(code)) return null
  if (!isUsTicker(sym)) return null
  if (!Array.isArray(bars) || !bars.length) return null
  const key = `${sym}|${code}|${extended ? 'eth' : 'rth'}`
  // ⭐ THE LATCH: a start already proven on this series stays while the chart still holds its bar
  if (prev && prev.key === key && prev.proven === true && indexOfTime(bars, prev.t) >= 0) return prev
  const n = bars.length
  const times = new Array(n)
  for (let i = 0; i < n; i += 1) {
    const t = secondsOf(bars[i] && bars[i].t)
    if (!Number.isFinite(t)) return null
    times[i] = t
  }
  const tolerance = TV_CHUNK_BY_TF[code]
    ? missingSessionSlots(times, code, !!extended, n - TV_INTRADAY_CAP_BOUNDS[1]) : 0
  const startsAtListing = typeof listDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(listDate.trim())
    && isoOfDay(nyDayNumber(times[0])) === listDate.trim()
  const r = tvRunStart(code, times, TV_RUN_TZ, { toleranceBars: tolerance, startsAtListing })
  return Object.freeze({
    key,
    t: Number.isInteger(r.index) ? times[r.index] : null,
    index: r.index,
    proven: r.proven === true && Number.isInteger(r.index),
    rule: r.rule,
    chunk: r.chunk,
    ambiguous: r.ambiguous === true,
    why: r.why,
    tolerance,
    held: n,
    heldFrom: times[0],
  })
}

/** The plain form of a stamp that crosses the runtime worker's message (and keys a run). */
export function tvRunStartSignature(stamp) {
  if (!stamp || typeof stamp !== 'object') return ''
  return `${stamp.proven === true ? 'p' : 'u'}${stamp.t === null || stamp.t === undefined ? '-' : stamp.t}`
    + `${stamp.proven === true ? '' : `:${stamp.rule}:${stamp.held}`}`
}

const CHUNK_WORD = { week: 'week', month: 'calendar month', year: 'calendar year' }
const fmtCount = (v) => Number(v).toLocaleString('en-US')
const dateOf = (tSec) => (Number.isFinite(tSec) ? isoOfDay(nyDayNumber(tSec)) : 'an unknown day')

/** The sentence a listing document reads where TradingView's first bar is NOT proven on this chart. */
export function tvRunStartRefusalSentence(stamp) {
  const head = 'this script is drawn bar by bar from its first bar, and on an intraday chart TradingView starts that '
    + 'run at the first bar of the '
  const tail = ' Nothing is drawn rather than values carried from a different first bar. TO UNBLOCK: a daily chart '
    + "of a symbol whose history reaches its listing draws it, and so does this chart once it holds TradingView's first bar."
  if (!stamp || typeof stamp !== 'object') return `${head}chunk that holds the chart's ${fmtCount(TV_INTRADAY_CAP)}th newest bar.${tail}`
  if (stamp.rule === 'unmeasured-timeframe') {
    return 'this script is drawn bar by bar from its first bar, and where TradingView starts that run on this '
      + 'timeframe has not been measured yet, so its values here cannot be known to be TradingView\'s.' + tail
  }
  const chunk = CHUNK_WORD[stamp.chunk] || 'period'
  const lead = `${head}${chunk} that holds the chart's ${fmtCount(TV_INTRADAY_CAP)}th newest bar.`
  const [lo, hi] = TV_INTRADAY_CAP_BOUNDS
  const tol = Number.isInteger(stamp.tolerance) ? stamp.tolerance : 0
  const short = stamp.held < hi + tol || (stamp.index === 0 && !stamp.ambiguous)
  if (short && !(stamp.ambiguous && stamp.held >= hi + tol)) {
    return `${lead} This chart holds ${fmtCount(stamp.held)} bars, from ${dateOf(stamp.heldFrom)}, and that first bar `
      + 'is further back than its loaded history.' + tail
  }
  if (stamp.ambiguous) {
    return `${lead} Here that bar falls so close to the start of a ${chunk} that the first bar cannot be decided: `
      + `TradingView's bar count is known only to within ${fmtCount(lo)}-${fmtCount(hi)}`
      + (tol ? `, and this symbol's session leaves ${fmtCount(tol)} bar slots empty that another data vendor may fill.` : '.')
      + tail
  }
  return `${lead} ${stamp.why ? `${String(stamp.why).replace(/^./, (c) => c.toUpperCase())}.` : 'It is not proven on this chart.'}${tail}`
}

/**
 * The lane's question: does this run take TradingView's start? null (the run is unchanged), `{cut, ctx, stamp}` (run
 * `rows.slice(cut)` from the listing, widened back), or `{unproven, ctx}` (run as before; a listing refusal says why).
 */
export function tvRunWindowOf(def, rows, ctx) {
  const stamp = ctx && ctx.tvRunStart
  if (!stamp || typeof stamp !== 'object') return null
  if (!(def && def.meta && def.meta.runtimeHistory === 'listing')) return null
  if (ctx.historyFromListing === true) return null
  // eslint-disable-next-line no-unused-vars -- the stamp is the outer run's, never the inner's
  const { tvRunStart: _stamp, ...rest } = ctx
  if (_served && stamp.proven === true && Number.isFinite(stamp.t)) {
    const cut = indexOfTime(rows, stamp.t)
    if (cut >= 0 && cut < rows.length) return { cut, stamp, ctx: { ...rest, historyFromListing: true } }
  }
  return { unproven: stamp, ctx: rest }
}

function renamed(err, message) {
  const out = new Error(message)
  for (const [k, v] of Object.entries(err || {})) if (k !== 'message' && k !== 'stack') out[k] = v
  if (err && err.name) out.name = err.name
  return out
}

/**
 * Run `run(rows, ctx)` as `tvRunWindowOf` decided (`tv`), and answer as the chart reads it.
 * @param {object[]} rows   the chart's rows
 * @param {object} tv       `tvRunWindowOf`'s answer
 * @param {(rows: object[], ctx: object) => object} run  the lane's run (`computeRuntimeColumns` itself)
 * @param {string} historyGuard  the lane's listing guard (`RUNTIME_HISTORY_GUARD`)
 */
export function computeTvRunWindow(rows, tv, run, historyGuard) {
  if (!Number.isInteger(tv.cut)) {
    try {
      return run(rows, tv.ctx)
    } catch (err) {
      if (err && err.guard === historyGuard) throw renamed(err, tvRunStartRefusalSentence(tv.unproven))
      throw err
    }
  }
  const { cut, stamp } = tv
  let cols
  try {
    cols = run(cut ? rows.slice(cut) : rows, tv.ctx)
  } catch (err) {
    if (err && Number.isInteger(err.bar)) err.bar += cut
    if (err && Number.isInteger(err.cutAt)) err.cutAt += cut
    throw err
  }
  if (!cut) return cols
  const out = widenToChart(cols, cut, RUNTIME_OBJECTS_KEY)
  // the record of the bars before the start: the warm-up record's shape (it crosses the runtime worker's message, and
  // the run half's column rail compares from `withheldBars` on), marked as TradingView's start, never a curtain
  const warm = cols && cols[RUNTIME_WARMUP_KEY]
  const record = {
    ...(warm && typeof warm === 'object' ? warm : {}),
    withheldBars: cut + (warm && Number.isInteger(warm.withheldBars) ? warm.withheldBars : 0),
    ...(warm && Number.isInteger(warm.knownFrom) ? { knownFrom: warm.knownFrom + cut } : {}),
    tvRunStart: Object.freeze({ cut, t: stamp.t, rule: stamp.rule, chunk: stamp.chunk }),
  }
  Object.defineProperty(out, RUNTIME_WARMUP_KEY, { value: record, enumerable: false, configurable: true })
  return out
}
