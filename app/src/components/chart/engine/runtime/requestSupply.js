// app/src/components/chart/engine/runtime/requestSupply.js
//
// ─── ⭐⭐ RS RATING L5 — THE BARS A RUN'S `request.security` READS, AND WHERE ─────
//
// The per-bar lane already EXECUTES a request (`vm.js` `OP.REQUEST` → `runRequest`:
// the program from the request's entry, over another series). What it never had is
// a supply, and its alignment was its own (strictly BEFORE the chart bar, so a
// same-timeframe other symbol read yesterday). This module is the supply, and it
// owns no rule of its own:
//
//   * WHICH SYMBOL a request names is the host translator's reading
//     (`pine.js::requestTargetOf`, recorded on each request at lowering as
//     `target`), never the run's string;
//   * WHETHER that symbol is served on this chart is the host bind's decision
//     (`otherSymbols.js::resolveOtherSymbols`, the same function every host plot
//     asks, over the same `secondary` cache), so the runtime lane serves exactly the
//     symbols the host lane serves, and refuses the rest with the host's sentence;
//   * WHICH requested bar each chart bar reads, and which chart bars are withheld,
//     is the host evaluator's answer (`interpret.js::requestAlignment`, built on
//     `tfMergeReads` / `tfMergeMask` / `symAlignmentMask`).
//
// ⛔ A RUN CARRIES STATE FROM BAR TO BAR, so a read withheld on one bar can reach
// every later bar. A request withheld anywhere but the newest bar refuses the whole
// run by name; the newest bar alone is withheld by the caller (its outputs `NaN`,
// its drawings not drawn), as the host withholds that bar.

import { requestAlignment, TF_RESAMPLABLE, TF_LADDER } from '../ast/interpret.js'
import { resolveOtherSymbols, otherSymbolPending, periodSampleOf, belowChartSeriesOf, withChartNewestDay,
  OWN_DAILY_KEY, SERIES_NEWEST_FORMING, etSessionDayOf, sessionCloseOf, sessionKeyedRowsOf, WITNESS_PERIOD_READS } from '../otherSymbols.js'
import { isTradingDay, covers } from '../../../../lib/marketClock/sessionCalendar.js'
import { overnightTailFrom, overnightSentence, REQUEST_OVERNIGHT_GUARD } from './overnightTail.js'

/** ⭐⭐ (2026-11-19, no carried value) The exchange session strictly before `day` ('YYYY-MM-DD') by the published
 *  calendar, or null where the calendar does not cover it: no guess. */
function prevSessionDay(day) {
  let t = Date.parse(`${day}T00:00:00Z`)
  for (let k = 0; k < 14; k += 1) {
    t -= 86400000
    const d = new Date(t).toISOString().slice(0, 10)
    if (!covers(d)) return null
    if (isTradingDay(d)) return d
  }
  return null
}

export const REQUEST_GUARD = 'runtime:request'

// ─── ⭐⭐ (the e85 live capture, 2026-11-19) — ANOTHER SERIES' NEWEST BARS NOT ARRIVED YET: A WAIT, NOT A REFUSAL ──────
// ⚰️ CAPTURED (patrick-54, engine 85, Fred RS on RDDT 5m in market hours, the runtime worker's own messages): most
// replies were REFUSED. Our SP:SPX 5m series ran 1-2 bars behind the chart's newest (4,653 rows refused, the same
// chart served at 4,655; `/api/bars/SPX?tf=5` a minute later had the bar and no gap): never a hole, only "not arrived
// yet". A withheld bar before the newest refused the whole chart, and with the DEPTH sentence of the first withheld
// bar ("this chart's history reaches X, and the `SPX` bars we hold begin at Y"), which was not the cause.
// THE RULE (coordinator ruling, 2026-11-19):
//   * ⛔ NO VALUE IS CARRIED FORWARD: TradingView's feed is synchronised, so a carried SPX close is a value it never
//     shows, and cutting the run at SPX's last bar would move Fred RS's last-bar labels onto the wrong bar;
//   * a gap STRICTLY AFTER the series' last held bar, at the chart's live tail, makes the run PENDING (`waiting`): it
//     runs again when the series updates (the store's own update moves the run's key, `runtimeColumns.js::
//     requestSupplyKey`; no timer here), and the pane keeps its last served picture meanwhile (`binder.js`);
//   * a lag past `TAIL_LAG_BOUND_INTERVALS` of the chart's bar intervals, measured back from the chart's newest bar
//     (or any lag on a chart whose newest bar is known finished: no live tail there), is REFUSED by name
//     (`REQUEST_LAG_GUARD`), with a sentence that says the newest bars have not arrived;
//   * a gap INSIDE the series' history (a hole) keeps its rule, and a DEPTH gap its `knownFrom`; each refusal names
//     ITS cause, never the first withheld bar's (`tailLag.test.js` holds every class).
/** The guard a request carries when another series' newest bars have not arrived within the wait. */
export const REQUEST_LAG_GUARD = 'runtime:request-lag'
/** How many of the chart's bar intervals another series may lag the chart's newest bar while the run waits. */
export const TAIL_LAG_BOUND_INTERVALS = 2
/** One bar interval of an intraday chart, in seconds (a D / W / M chart counts its bars instead). */
const INTRADAY_STEP_S = Object.freeze({ 1: 60, 5: 300, 15: 900, 30: 1800, 60: 3600 })

/** ⭐ REQ — the one sentence for a look-ahead read the run does not serve (the door and the bind say it). */
const LOOKAHEAD_UNSERVED = 'a `request.security` looks ahead (`barmerge.lookahead_on`) at a timeframe the run does not '
  + 'read ahead on: look-ahead is served for a weekly or monthly period above the chart’s own, the reading '
  + 'TradingView was captured giving (`vw-request-htf-alignment-spy-1d-2026-10-02`)'

/** The chart's timeframe code as the ladder spells it (`'1D'` → `'D'`). */
function ladderCode(tf) {
  const s = String(tf == null ? '' : tf).trim().toUpperCase()
  if (s === '1D') return 'D'
  if (s === '1W') return 'W'
  if (s === '1M') return 'M'
  return s
}

/** Where a request was written, for a sentence. */
const at = (site) => (site && site.target && Number.isInteger(site.target.line) ? ` (line ${site.target.line})` : '')

/** The earliest bar time of a supplied series (number or ISO date, whichever the series holds), or null. */
function firstHeldTime(series) {
  if (!Array.isArray(series)) return null
  let first = null
  for (const b of series) {
    const t = b && typeof b === 'object' ? b.t : undefined
    if (t === undefined || t === null) continue
    if (first === null || (typeof t === typeof first && t < first)) first = t
  }
  return first
}

/** ⭐ (e85) The newest bar time of a supplied series AT OR BEFORE `until` (the chart's newest bar: of the kind the series
 *  holds), or null. ⛔ Not its newest row outright: the intraday SP:SPX grid holds the NEXT session's pre-market rows
 *  (the previous close, read before the open, `otherSymbols.js::atOrBeforeGridOf`), which lie after every chart bar and
 *  say nothing about how far its bars have arrived for this chart. */
function lastHeldTime(series, until) {
  if (!Array.isArray(series)) return null
  let last = null
  for (const b of series) {
    const t = b && typeof b === 'object' ? b.t : undefined
    if (t === undefined || t === null || typeof t !== typeof until || t > until) continue
    if (last === null || t > last) last = t
  }
  return last
}

/** ⭐ (e85) How far the chart's newest bar runs past `lastHeld`, in the chart's bar intervals: the time between them
 *  over one interval on an intraday chart (the chart's own clock: a chart with no bar in a slot still counts it), else
 *  the chart bars after it (a D / W / M chart, whose bars are its intervals). */
export function tailLagIntervals(rows, lastHeld, tf) {
  const n = Array.isArray(rows) ? rows.length : 0
  const newest = n ? rows[n - 1] && rows[n - 1].t : undefined
  const step = INTRADAY_STEP_S[ladderCode(tf)]
  if (step && typeof newest === 'number' && typeof lastHeld === 'number') return (newest - lastHeld) / step
  let k = 0
  for (let i = n - 1; i >= 0; i -= 1) {
    const t = rows[i] && rows[i].t
    if (typeof t !== typeof lastHeld || !(t > lastHeld)) break
    k += 1
  }
  return k
}

/** ⭐⭐ (coordinator ruling 2026-11-20) What a run waiting for this symbol's listing date says (`aboveChartRead`). */
export const LISTING_DATE_WAITING = "this script is waiting for this symbol's listing date: this chart starts on the first "
  + 'session of the daily bars it reads, and whether that is the first trading day decides its first bars; it is drawn '
  + 'once the date arrives'

/** ⭐ (e85) What a run waiting for other series' newest bars says (its pending error's message), for the series named. */
/** ⭐⭐ (e91, coordinator ruling 2026-11-20 (2b)) What a run CUT at another series' newest held bar says while its newest
 *  bars have not arrived: the bars up to them are drawn, the rest named, never the whole pane blank. */
export function tailCutSentence(series) {
  const names = [...new Set(series)].map((s) => `\`${s}\``)
  const who = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0] || 'another symbol'
  return `this script reads ${who}, whose newest bars have not arrived yet: it is drawn up to them, and the newest bars `
    + 'are drawn when they arrive'
}
/** Tests: a tail lag waits (within the bound) or refuses (past it) the WHOLE run, as before the cut (the mutants' control). */
let _tailCutOff = false
export function __tailCutOffForTests(off) { _tailCutOff = !!off }
/** Whether the tail cut is switched off (tests only), read by the run's newest-tail cut (`runtimeColumns.js`). */
export function tailCutIsOff() { return _tailCutOff }

export function requestWaitingSentence(series) {
  const names = [...new Set(series)].map((s) => `\`${s}\``)
  const who = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0] || 'another symbol'
  return `this script reads ${who}, whose newest bars have not arrived yet (this chart's newest bar is ahead of `
    + 'the bars we hold of it); it is drawn when they arrive'
}

/** The clause every whole-run request refusal ends with. */
const CARRIES = ' A script drawn bar by bar carries its values forward from bar to bar, so one unknown read '
  + 'reaches every later bar; nothing is drawn rather than a guess'

/** ⭐ (e85) The refusal for a series whose newest bars stayed behind the chart's (`REQUEST_LAG_GUARD`): past the wait on a
 *  live chart, or at all on a chart whose newest bar is finished (`live` false). */
function lagMessage(site, other, lastHeld, rows, live = true) {
  const n = Array.isArray(rows) ? rows.length : 0
  const newest = String(n ? rows[n - 1].t : '')
  return `a \`request.security\`${at(site)} cannot be read on every bar — \`${other}\`'s newest bars have not arrived: `
    + `the bars we hold of it end at ${String(lastHeld)}, `
    + (live ? `and this chart's newest bar, ${newest}, is more than ${TAIL_LAG_BOUND_INTERVALS} of its bar intervals later`
      : `before this chart's finished newest bar, ${newest}`)
    + `, so what the request reads after them is not known.${CARRIES} until they arrive`
}

/** ⭐⭐ RS RATING L8 (4b) — WHY THE CHART'S OWN SYMBOL AT THIS TIMEFRAME IS NOT READ. The
 *  front end records such a request `{own: true, unread: true, code: <the literal>}` where the
 *  host's reader has no reading of it (a daily read on a weekly or an intraday chart): the
 *  symbol is this chart's, the TIMEFRAME is what no lane reads bar by bar. ⚰️ It refused
 *  `interpret:bind-time-text` on `syminfo.tickerid`, blaming the symbol. */
function unreadOwnSentence(target, chartTf, where = '') {
  const on = chartTf ? ` on a \`${chartTf}\` chart` : ''
  return `a \`request.security\`${where} reads this chart's own symbol at the \`${target.code}\` timeframe${on}, `
    + 'in a form the host lane does not read either (a timeframe below or beside the chart\'s own, or an argument '
    + 'such as `gaps` it does not honour), so nothing is drawn bar by bar rather than a guess'
}

/** The host bind's decision for ONE other-symbol read: a document holding just that
 *  read, spelled as the script spelled it, decided against this chart's supply.
 *  ⭐ RS RATING L11 — the request's own timeframe rides along (`requestCode`; `below` for a daily
 *  read on a weekly chart), so a witness row is read the way its block witnessed THAT read
 *  (`otherSymbols.js::witnessReadOf`); a daily chart's rows have no block and ignore it. */
function decideOther(target, ctx) {
  const ticker = String(target.ticker).trim().toUpperCase()
  const def = {
    compute: { kind: 'ast', ast: { type: 'sym', value: ticker, args: [{ type: 'num', value: 0 }] } },
    meta: { recurrenceOrigin: 'pine', otherSymbols: [{ ticker, spellings: [target.venue == null ? '?' : target.venue] }] },
  }
  return { ticker, decision: resolveOtherSymbols(def, {
    secondary: ctx && ctx.secondary,
    exchangeOf: ctx && ctx.exchangeOf,
    symbol: ctx && ctx.symbol,
    framed: !!(ctx && ctx.framed),
    tf: ctx && ctx.tf,
    // ⭐ RS RATING L11 PR 2 — the chart's newest bar reads its own period (`newestOwnPeriodOf`)
    chartNewestDay: ctx && ctx.chartNewestDay,
    // ⭐ RS RATING L12 PR 2 (Q-L12-2) — the chart's bars, for a seed's intraday fold (`utcMidnightAtOrAfterOf`)
    chartBars: ctx && ctx.chartBars,
    requestCode: target.code == null ? null : String(target.code),
    ...(target.below === true ? { below: true } : {}),
  }) }
}

/** ⭐⭐ RS RATING L11 (Q-RS7 R2 / R4) — A DAILY READ OF ANOTHER SYMBOL BELOW A WEEKLY CHART (⭐ L13: or a
 *  MONTHLY one, Q-RS-M): the host bind's decision for that read (a witness row whose block names a daily
 *  read, else refused by name), the request's expression run on the HELD daily series (`runBars`: for a
 *  `*-last-row` sample, with the newest row on its next session, `belowChartSeriesOf`), and each chart
 *  period reading the row its block's sample picks (`otherSymbols.js::periodSampleOf`).
 *  @returns {{refusal?: string, pending?: true, runBars?: object[], index?: number[],
 *             withheld?: Float64Array, other?: string}} */
function belowChartRead(target, rows, ctx) {
  const { ticker, decision } = decideOther(target, ctx)
  const hit = (decision.refused || [])[0]
  if (hit) {
    if (otherSymbolPending(hit)) return { pending: true }
    return { refusal: `This indicator reads \`${hit.ticker}\`: ${hit.code} — ${hit.reason}` }
  }
  const series = decision.symbols[ticker]
  const sample = decision.samples ? decision.samples[ticker] : null
  if (!Array.isArray(series) || !sample) {
    return { refusal: `This indicator reads \`${ticker}\` at \`"D"\` below this chart, and no daily read of it `
      + 'is witnessed here, so nothing is drawn bar by bar rather than a guess' }
  }
  const runBars = belowChartSeriesOf(series, sample)
  const { index, withheld } = periodSampleOf(runBars, rows, sample)
  return { runBars, index, withheld, other: ticker }
}

const INTRADAY_CODES = new Set(['1', '5', '15', '30', '60'])

// ─── ⭐ PERF (Fred RS filled chart, coordinator ruling 2026-11-19) — A CHART BAR'S ET SESSION DAY, ONCE ────────────
// `aboveChartRead` needs the ET session day of every chart bar, for each daily read. Fred RS's run half has three, and
// the warm-up curtain runs it twice (B's rows are the same bar OBJECTS: `rows.slice(shift)`), so each bar's day was
// formatted six times (`Intl.DateTimeFormat`, ~0.8 us a bar: ~28 ms a run on 11,520 5m bars). The day is a pure
// function of the bar's `t` (`otherSymbols.js::etSessionDayOf`), so it is kept per bar object, with the `t` it was
// computed from: a bar whose `t` is not that one is computed again. Exact by construction.
const _sessionDays = new WeakMap()
let _sessionDayMemoOff = false
/** Tests: compute every bar's day afresh, as before (the identity rail compares both). */
export function __sessionDayMemoOffForTests(off) { _sessionDayMemoOff = !!off }
/** The ET session day of each of `rows` (`etSessionDayOf`), or null for a bar without a numeric `t`. */
export function sessionDaysOf(rows) {
  const out = new Array(rows.length)
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i]
    if (!r || typeof r.t !== 'number') { out[i] = null; continue }
    if (_sessionDayMemoOff) { out[i] = etSessionDayOf(r.t); continue }
    const hit = _sessionDays.get(r)
    if (hit !== undefined && Object.is(hit.t, r.t)) { out[i] = hit.day; continue }
    const day = etSessionDayOf(r.t)
    _sessionDays.set(r, { t: r.t, day })
    out[i] = day
  }
  return out
}

/** ⭐⭐ RS RATING L12 PR 2 (U-DAILY) — A DAILY READ ABOVE AN INTRADAY CHART (`pine.js`: `above`, a bare
 *  open / high / low / close, look-ahead off). The request's expression runs on the symbol's HELD daily rows
 *  (`runBars`) and each chart bar reads one of them (`index`), as TradingView reads them (`l12-is-2026-11-18`):
 *    * ANOTHER SYMBOL (a witness row whose intraday block names `D: session-completed`, SP:SPX): the row its
 *      session had COMPLETED: a bar opening before its session's close the previous session's row, a bar from
 *      the close the session's own (once that row is settled: `SERIES_NEWEST_FORMING`).
 *    * THIS CHART'S OWN SYMBOL (its daily rows under `OWN_DAILY_KEY`, fetched by the chart for a run that reads
 *      them): the previous session's row on every bar of a session except its LAST chart bar, which reads the
 *      session's own (the daily bar closes on the chart's last bar of the day: 5m 19:55 on 95 of 95 days, 60m
 *      19:00 on 656), and the newest bar, which reads the session's own (in progress: the developing day).
 *  A bar whose row is not held is withheld (`withheld`), and the supply's rules below apply.
 *  @returns {{refusal?: string, pending?: true, runBars?: object[], index?: Int32Array, withheld?: Float64Array, other?: string|null}} */
function aboveChartRead(target, rows, ctx) {
  const n = Array.isArray(rows) ? rows.length : 0
  let daily = null
  let other = null
  let ownRead = false
  let forming = false
  if (target.ticker) {
    const { ticker, decision } = decideOther(target, ctx)
    const hit = (decision.refused || [])[0]
    if (hit) {
      if (otherSymbolPending(hit)) return { pending: true }
      return { refusal: `This indicator reads \`${hit.ticker}\`: ${hit.code} — ${hit.reason}` }
    }
    daily = decision.symbols[ticker]
    other = ticker
    const sample = decision.samples ? decision.samples[ticker] : null
    if (Array.isArray(daily) && sample === WITNESS_PERIOD_READS.UTC_MIDNIGHT_AT_OR_AFTER) {
      // ⭐⭐ RS RATING L12 PR 2 (Q-L12-2) — a Pine SEED: the bind already landed each row on one of THIS chart's bars
      // (`otherSymbols.js::utcMidnightAtOrAfterOf`, keyed by that bar's `t`); a bar no row landed on reads `na`, a
      // known gap (index -1, nothing withheld), exactly as the seed's daily read does (`same-date-gaps-na`)
      const at = new Map(daily.map((r, j) => [r.t, j]))
      const index = new Int32Array(n).fill(-1)
      for (let i = 0; i < n; i += 1) {
        const j = rows[i] ? at.get(rows[i].t) : undefined
        if (j !== undefined) index[i] = j
      }
      return { runBars: daily, index, withheld: new Float64Array(n), other: ticker }
    }
    if (!Array.isArray(daily) || sample !== WITNESS_PERIOD_READS.SESSION_COMPLETED) {
      return { refusal: `This indicator reads \`${ticker}\` at \`"D"\` above this chart, and no daily read of it `
        + 'is witnessed here, so nothing is drawn bar by bar rather than a guess' }
    }
    forming = daily[SERIES_NEWEST_FORMING] === true
  } else {
    const e = ctx && ctx.secondary && typeof ctx.secondary.get === 'function' ? ctx.secondary.get(OWN_DAILY_KEY) : null
    if (!e) {
      return { refusal: `a \`request.security\` reads this chart's own symbol at the \`D\` timeframe above this \`${ctx && ctx.tf}\` `
        + 'chart, and this run is not handed that symbol\'s daily bars, so nothing is drawn bar by bar rather than a guess' }
    }
    if (e.status !== 'available' || !Array.isArray(e.bars) || !e.bars.length) {
      if (!e.status || e.status === 'loading') return { pending: true }
      return { refusal: `this chart symbol's daily bars, read at \`"D"\` by a \`request.security\`, are not in hand (${e.status})` }
    }
    daily = sessionKeyedRowsOf(e.bars)
    ownRead = true
  }
  const at = new Map(daily.map((r, j) => [r.t, j]))
  const days = daily.map((r) => r.t)
  // the newest held row's index whose session is strictly before `day` (binary search over ISO days)
  const before = (day) => {
    let lo = 0
    let hi = days.length - 1
    let ans = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (days[mid] < day) { ans = mid; lo = mid + 1 } else hi = mid - 1
    }
    return ans
  }
  const index = new Int32Array(n).fill(-1)
  const withheld = new Float64Array(n)
  const dayOf = sessionDaysOf(rows)
  // ⭐⭐ RS RATING (2026-11-19, the e85 live capture: RDDT 1h refused at 1711040400, the listing day's second bar) — THE
  // OWN SERIES' FIRST SESSION ON A CHART THAT STARTS THERE. When this chart's own first bar is on the first session its
  // own daily rows hold, the symbol has no earlier day: before that session's close a look-ahead-off read has no
  // confirmed day to read, so it is na BY HISTORY (known), not unknown. TradingView's witness (RDDT 60, startsAtBar0)
  // draws Fred RS from that bar. ⛔ Only that session, only for the chart's OWN symbol, only when the chart starts on it,
  // and ONLY when that first held row IS the symbol's FIRST TRADE (`ctx.symbol.firstTradeDate`, the app's
  // `/api/ticker-ipo` answer, final only): a store's first row is not a listing. MEASURED 2026-11-19 (smoke@ GETs):
  // /api/bars/IBM?tf=D serves from 1962-01-02 (IBM listed 1949-01-28) and KO from 1976-12-14; RDDT from 2024-03-21 =
  // its first_trade_date. A series cut short by the asked depth or by the store is unknown before its first row
  // (rsIntradayDaily's "a bar before the held daily rows is unknown"); a missing row inside history still withholds.
  const firstTrade = ctx && ctx.symbol && typeof ctx.symbol.firstTradeDate === 'string' ? ctx.symbol.firstTradeDate : null
  const firstSessionNa = ownRead && firstTrade !== null && days.length > 0 && days[0] === firstTrade
    && dayOf.find(Boolean) === days[0]
  // ⭐⭐ (coordinator ruling 2026-11-20) THE LISTING DATE IN FLIGHT. ⚰️ CAPTURED (ipocold-bgin, production e87): with
  // `/api/ticker-ipo/BGIN` not answered yet, NASDAQ:BGIN 1h's listing-day bar read as a HOLE and the whole chart was
  // refused ("`this symbol's daily bars` has no bar on 1761055200, after its history began"), where the answer, once in,
  // makes it na by history. On the chart that starts on the own daily rows' first session, the date decides it: the run
  // WAITS for it (`ctx.symbol.firstTradeDatePending`, `StockChart` / `useTickerIpo`), never refuses meanwhile. The wait
  // ends with the lookup: a final date settles it as above, no date keeps today's rule.
  if (ownRead && firstTrade === null && ctx && ctx.symbol && ctx.symbol.firstTradeDatePending === true
      && days.length > 0 && dayOf.find(Boolean) === days[0]) {
    return { pending: true, waiting: { series: [], sentence: LISTING_DATE_WAITING } }
  }
  // ⭐⭐ (coordinator, 2026-11-19: NEVER A CARRIED VALUE) — EACH BAR READS THE ROW IT READS, OR NOTHING. `before(d)` is the
  // newest HELD row before `d`: with the previous session's row missing it is an OLDER row, a value TradingView never
  // shows on that bar (`dailyReadNoCarry.test.js`). The row a bar reads is named first, then looked up; a row that is
  // not held is withheld (the supply's rules below name it), never replaced by the one before it.
  //   * ANOTHER SYMBOL (SP:SPX, an exchange-calendar series): the calendar's previous session, or the session's own from
  //     its close; outside the calendar's coverage the session is not known (withheld).
  //   * THE OWN SYMBOL: the latest of the chart's own previous session (the chart is this symbol's sessions: a 24/7
  //     chart keeps its weekends) and, on a chart whose every session is an exchange session, the calendar's previous
  //     session (a chart missing a day still reads the day before). With neither (a 24/7 chart's first session) there is
  //     nothing to check the held row against, and `before(d)` stands. The day's own row on its last bar is that row.
  const onCalendar = dayOf.every((d) => !d || isTradingDay(d))
  const prevOf = new Map()
  const calendarPrev = (d) => {
    if (!prevOf.has(d)) prevOf.set(d, prevSessionDay(d))
    return prevOf.get(d)
  }
  const rowOf = (day) => (day !== null && at.has(day) ? at.get(day) : -1)
  let curDay = null
  let chartPrev = null
  for (let i = 0; i < n; i += 1) {
    const d = dayOf[i]
    if (!d) { withheld[i] = 1; continue }
    if (d !== curDay) { if (curDay !== null) chartPrev = curDay; curDay = d }
    let j = -1
    if (ownRead) {
      const lastOfDay = i === n - 1 || dayOf[i + 1] !== d
      if (lastOfDay) {
        j = rowOf(d)
      } else {
        const want = [chartPrev, onCalendar ? calendarPrev(d) : null].filter(Boolean).sort().pop() || null
        j = want === null ? before(d) : rowOf(want)
      }
      if (j < 0 && firstSessionNa && d === days[0]) continue   // na by history, never withheld
    } else {
      const close = isTradingDay(d) ? sessionCloseOf(d) : null
      const fromClose = close !== null && rows[i].t >= close
      if (fromClose && at.has(d) && !(forming && at.get(d) === daily.length - 1)) j = at.get(d)
      else if (fromClose && !at.has(d)) j = -1                // the session's own row is the read, and it is not held
      else j = rowOf(calendarPrev(d))
    }
    if (j < 0) withheld[i] = 1
    else index[i] = j
  }
  // ⭐⭐ (e91, the e88 in-session capture) the first session these daily rows hold: a chart bar at or before it reads a
  // session the rows do not reach (DEPTH, `runtimeRequestSupply`), never a hole in their history
  // `depthEnd`: the first chart bar whose session (as THIS read assigns sessions, `sessionDaysOf`) lies after that one
  let depthEnd = 0
  if (days.length) {
    depthEnd = dayOf.findIndex((d) => !!d && d > days[0])
    if (depthEnd < 0) depthEnd = n
  }
  return { runBars: daily, index, withheld, other, heldFrom: days.length ? days[0] : null, depthEnd }
}

/** ⭐⭐ RS RATING L5 (d) — WHY A RUN'S REQUESTS CAN NOT BE SERVED ON ANY CHART, decided from
 *  the targets alone (the member door mints before any chart is known), or null. The same
 *  rules `runtimeRequestSupply` applies first: a request the host could not read, a look-ahead
 *  one, a timeframe other than the chart's own or a weekly / monthly merge. Everything else
 *  (is the symbol held, are its bars in hand, is the merge above THIS chart) is the bind's,
 *  per chart, and refuses there by name.
 *  @param {Array<object|null>} targets  `probeRuntimeProgram(...).requestTargets`
 *  @param {number} count                how many requests the run makes */
export function requestTargetsUnservable(targets, count) {
  const list = Array.isArray(targets) ? targets : []
  if (list.length !== count) {
    return `${count} \`request.security\` ${count === 1 ? 'reads' : 'read'} another symbol or timeframe, and which `
      + 'bars they need was not recorded'
  }
  for (const target of list) {
    if (!target) {
      return 'a `request.security` names a symbol or timeframe that cannot be read before the script runs, '
        + 'so which bars it needs is unknown'
    }
    if (target.unread === true) return unreadOwnSentence(target, null)
    // ⭐ RS RATING L11 — a daily read of another symbol below a weekly chart is the supply's, per chart
    if (target.below === true && ladderCode(target.code) === 'D' && target.ticker) continue
    // ⭐ RS RATING L12 PR 2 — a daily read above an intraday chart is the supply's, per chart
    if (target.above === true && ladderCode(target.code) === 'D') continue
    const code = target.code == null ? null : ladderCode(target.code)
    // ⭐ REQ (coverage unit, 2026-11-16) — a look-ahead read of a WEEKLY / MONTHLY period is served
    // (`requestAlignment`, `live`). Look-ahead at any other code (the quarter, which the object pass
    // alone reads) keeps its refusal; look-ahead at the chart's own period never reaches here (the
    // host's reader answers `live: false` for it, and the lowering folds it).
    if (target.live === true && (code === null || !TF_RESAMPLABLE.includes(code))) return LOOKAHEAD_UNSERVED
    if (code !== null && !TF_RESAMPLABLE.includes(code)) {
      return `a \`request.security\` reads the \`${target.code}\` timeframe; the run reads another timeframe only `
        + 'as a weekly or monthly merge'
    }
  }
  return null
}

/**
 * The per-site supply for a program's requests over these chart bars.
 *
 * @param {object[]} requests  `program.requests` (each `{timeframe, entry, results, target}`)
 * @param {object[]} rows      the chart's bars
 * @param {object}   ctx       `{tf, symbol, secondary, exchangeOf, framed, newestBarIsForming,
 *                              historyFromListing}`
 * @returns {{supply: object[]|null, refusal: {guard, message}|null, pending: boolean,
 *            newestWithheld: boolean, newestWithheldSites: number[], codes: string[], sentences: string[],
 *            waiting: {series: string[], sentence: string}|null,
 *            newestTail: {site: number, series: string, within: boolean, message: string|null}[]}}
 *   ⭐ (e85) `waiting`: set with `pending` when the run waits for other series' newest bars (a live-tail lag within
 *   `TAIL_LAG_BOUND_INTERVALS`); `newestTail`: each newest-withheld site whose newest bar lies after its series' last
 *   held bar (the run, which knows what that bar's withholding reaches, decides whether it waits).
 */
export function runtimeRequestSupply(requests, rows, ctx = {}) {
  ctx = withChartNewestDay(ctx, rows)   // ⭐ RS RATING L11 PR 2: the bind reads no bars
  const out = { supply: null, refusal: null, pending: false, newestWithheld: false, newestWithheldSites: [], codes: [],
    sentences: [], waiting: null, newestTail: [] }
  const sites = Array.isArray(requests) ? requests : []
  if (!sites.length) return out
  const n = Array.isArray(rows) ? rows.length : 0
  const chartCode = ladderCode(ctx && ctx.tf)
  const supply = []
  // ⭐⭐ (e85) the series whose newest bars a site waits for (a live-tail lag within the bound, below). ⛔ A wait never
  // hides a later site's refusal: every site is read, and the run waits only when none refuses.
  const waits = []
  // ⭐ `knownFrom` (a DEPTH gap only, below): the first chart bar from which every read of this site is known
  const refuse = (message, knownFrom) => {
    out.refusal = { guard: REQUEST_GUARD, message, ...(Number.isInteger(knownFrom) && knownFrom > 0 ? { knownFrom } : {}) }
    return out
  }
  for (let s = 0; s < sites.length; s += 1) {
    const site = sites[s]
    const target = site && site.target
    // ⛔ The host's reader could not settle this request (a computed symbol or timeframe,
    // a symbol argument that reaches a slot the host cannot see): nothing to fetch.
    if (!target) {
      return refuse(`a \`request.security\`${at(site)} names a symbol or timeframe that cannot be read before `
        + 'the script runs, so which bars it needs is unknown and nothing is drawn rather than a blank line')
    }
    // ⭐ RS RATING L8 (4b) — the chart's own symbol at a timeframe the host does not read
    if (target.unread === true) return refuse(unreadOwnSentence(target, ctx && ctx.tf, at(site)))
    // ⭐⭐ RS RATING L11 (Q-RS7) — a daily read of ANOTHER symbol below a weekly chart (`pine.js::
    // dailyOnWeeklyTargetOf`): held and sampled per week (`belowChartRead`), withheld by the rules below
    let aligned = null
    let other = null
    let srcBars = rows
    const sink = new Map()
    if (target.below === true) {
      if (ctx && ctx.otherSymbolSupply === false) {
        return refuse(`This indicator reads \`${target.ticker}\`${at(site)}, and this run is not handed another `
          + 'symbol\'s bars (a server run holds only the chart symbol\'s own), so nothing is drawn rather than a blank line')
      }
      if (!['W', 'M'].includes(ladderCode(ctx && ctx.tf)) || ladderCode(target.code) !== 'D' || !target.ticker) {
        return refuse(`a \`request.security\`${at(site)} reads the \`${target.code}\` timeframe on a \`${ctx && ctx.tf}\` `
          + 'chart, and a read below the chart is served only as a daily read on a weekly or monthly chart, so nothing is drawn bar by bar')
      }
      const read = belowChartRead(target, rows, ctx)
      if (read.pending) { out.pending = true; return out }
      if (read.refusal) return refuse(read.refusal)
      aligned = { runBars: read.runBars, index: read.index, withheld: read.withheld }
      other = read.other
    } else if (target.above === true) {
      // ⭐⭐ RS RATING L12 PR 2 (U-DAILY) — a daily read ABOVE an intraday chart (`aboveChartRead`)
      if (target.ticker && ctx && ctx.otherSymbolSupply === false) {
        return refuse(`This indicator reads \`${target.ticker}\`${at(site)}, and this run is not handed another `
          + 'symbol\'s bars (a server run holds only the chart symbol\'s own), so nothing is drawn rather than a blank line')
      }
      if (!INTRADAY_CODES.has(chartCode) || ladderCode(target.code) !== 'D') {
        return refuse(`a \`request.security\`${at(site)} reads the \`${target.code}\` timeframe on a \`${ctx && ctx.tf}\` `
          + 'chart, and a daily read above the chart is served only on a 1, 5, 15, 30 or 60 minute chart, so nothing is drawn bar by bar')
      }
      const read = aboveChartRead(target, rows, ctx)
      if (read.pending) {
        out.pending = true
        // ⭐⭐ (2026-11-20) a wait that names what it waits for (the listing date) says so
        if (read.waiting) out.waiting = read.waiting
        return out
      }
      if (read.refusal) return refuse(read.refusal)
      aligned = { runBars: read.runBars, index: read.index, withheld: read.withheld, heldFrom: read.heldFrom,
        depthEnd: read.depthEnd }
      other = read.other || 'this symbol\'s daily bars'
    }
    const code = aligned ? null : (target.code == null ? null : ladderCode(target.code))
    // ⭐⭐ REQ (coverage unit, 2026-11-16) — LOOK-AHEAD ON IS SERVED FOR A WEEKLY / MONTHLY PERIOD, by the
    // pick the host's `tf_live` column makes (`interpret.js::tfLiveReads`: the period the bar is INSIDE),
    // witnessed bar for bar on `vw-request-htf-alignment-spy-1d-2026-10-02` (A01 / A04 / A06). ⚰️ It was
    // refused whatever the code ("the realtime half of that alignment is not measured yet") while the host
    // lane drew the same request as a column. Any other look-ahead read keeps the refusal, by name.
    if (target.live === true && (code === null || !TF_RESAMPLABLE.includes(code))) {
      return refuse(`a \`request.security\`${at(site)} ${LOOKAHEAD_UNSERVED.slice('a `request.security` '.length)}, `
        + 'so nothing is drawn bar by bar')
    }
    if (code !== null) {
      // ⭐ ONLY THE MERGE THE HOST SERVES: a weekly or monthly read ABOVE the chart's own
      // timeframe (`TF_RESAMPLABLE`, the host `tf_merge` codes).
      const above = TF_LADDER.indexOf(code) > TF_LADDER.indexOf(chartCode) && TF_LADDER.indexOf(chartCode) >= 0
      if (!TF_RESAMPLABLE.includes(code) || !above) {
        return refuse(`a \`request.security\`${at(site)} reads the \`${target.code}\` timeframe on a \`${ctx && ctx.tf}\` `
          + 'chart; the run reads another timeframe only as a weekly or monthly merge above the chart\'s own, '
          + 'the one the host lane draws, so nothing is drawn bar by bar')
      }
    }
    if (aligned) {
      // ⭐ RS RATING L11 — read above (`belowChartRead`)
    } else if (target.ticker) {
      // ⭐ RS RATING L5 — A LANE THAT IS NEVER HANDED ANOTHER SYMBOL'S BARS (the server
      // service, `job.mjs::DECLARED_DIFFERENCES.ctxServerOnly`) refuses by name BEFORE the bind
      // is asked: the bind decides from the chart's other-symbol cache, which a server run never
      // has, so its answer there ("not a listing our bar store holds", "still loading") would be
      // false. ⚰️ The deploy gate's hostile corpus caught `NASDAQ:MSFT` refused as not held.
      if (ctx && ctx.otherSymbolSupply === false) {
        return refuse(`This indicator reads \`${target.ticker}\`${at(site)}, and this run is not handed another `
          + 'symbol\'s bars (a server run holds only the chart symbol\'s own), so nothing is drawn rather than a blank line')
      }
      const { ticker, decision } = decideOther(target, ctx)
      const hit = (decision.refused || [])[0]
      if (hit) {
        if (otherSymbolPending(hit)) {
          out.pending = true
          return out
        }
        return refuse(`This indicator reads \`${hit.ticker}\`: ${hit.code} — ${hit.reason}`)
      }
      srcBars = decision.symbols[ticker]
      other = ticker
    } else if (code === null) {
      // the chart's own bars at the chart's own period: the identity (the lowering folds it)
      supply.push({ runBars: rows, index: Int32Array.from({ length: n }, (_, i) => i) })
      continue
    }
    if (!aligned) {
      aligned = requestAlignment({
        chartBars: rows, srcBars, code, other, live: target.live === true,
        opts: {
          tf: ctx && ctx.tf,
          newestBarIsForming: ctx ? ctx.newestBarIsForming : undefined,
          historyFromListing: !!(ctx && ctx.historyFromListing === true),
          curtained: !!(ctx && ctx.curtained === true),
          chartClockSink: sink,
        },
      })
    }
    const named = [...sink.entries()]
    // ⭐⭐ (e85) WHERE EACH WITHHELD BAR LIES AGAINST THE SERIES AS HELD — before its first row (a DEPTH gap), after its
    // last (the chart's live TAIL: not arrived yet), or between them (a HOLE). Asked only of another symbol's series
    // (`srcBars`), and only where no chart-clock rule named the bar (`named`): those keep their own sentences.
    // ⭐⭐ (e91, the e88 in-session capture) — A DAILY READ ABOVE AN INTRADAY CHART HAS A FIRST SESSION TOO. ⚰️ CAPTURED
    // (Fred RS on RDDT 5m regular hours, production engine 88, 14:46Z, the worker's own replies): the chart's 18,749 rows
    // began 2025-10-21 09:30 ET, RDDT's own daily rows were held from 2025-10-30 (267 rows: sized at 78 bars a session,
    // RDDT averages ~69), and `srcBars` is the chart's own rows for an above read, so no first-held time was known and every
    // withheld bar was a "hole": the whole run refused ("`this symbol's daily bars` has no bar on 1761053400, after its
    // history began") and the 5m pane stayed blank all session. A bar whose session is at or before the held rows' first
    // session reads a session they do not reach: DEPTH (`knownFrom`: the run starts where every read is known), as another
    // series' intraday depth is. A row missing INSIDE the held sessions keeps the hole's refusal.
    const aboveFrom = aligned && typeof aligned.heldFrom === 'string' ? aligned.heldFrom : null
    const aboveDepthEnd = aboveFrom !== null && Number.isInteger(aligned.depthEnd) ? aligned.depthEnd : -1
    const firstHeld = srcBars !== rows ? firstHeldTime(srcBars) : aboveFrom
    const lastHeld = srcBars !== rows && !named.length && n ? lastHeldTime(srcBars, rows[n - 1] && rows[n - 1].t) : null
    // ⭐ (e85) the chart's LIVE tail: its newest bar is forming, or not known to be finished. A gap after the series' last
    // bar on a chart whose newest bar is finished is no wait: it is refused by name, and runs again on the series' update
    const live = !(ctx && ctx.newestBarIsForming === false)
    const placeOf = (i) => {
      const t = rows[i] && rows[i].t
      if (aboveDepthEnd >= 0) return i < aboveDepthEnd ? 'depth' : 'hole'
      if (firstHeld !== null && typeof t === typeof firstHeld && t < firstHeld) return 'depth'
      if (lastHeld !== null && typeof t === typeof lastHeld && t > lastHeld) return 'tail'
      return 'hole'
    }
    // ⭐⭐ (coordinator ruling 2026-11-20) THE OVERNIGHT TAIL (`overnightTail.js`): every chart bar past this series' last
    // held bar is an overnight bar (outside 04:00-20:00 ET, or a closed day). Not a lag (those bars never arrive) and not
    // a whole-run refusal: the run is CUT at the first of them (`cutAt`, `runtimeColumns.js::computeRuntimeColumns`)
    // and they are withheld by name. ⛔ A tail holding ANY bar inside 04:00-20:00 keeps the wait / lag rule below.
    if (INTRADAY_CODES.has(chartCode) && typeof lastHeld === 'number') {
      const cutAt = overnightTailFrom(rows, lastHeld)
      if (cutAt > 0) {
        out.refusal = { guard: REQUEST_OVERNIGHT_GUARD, message: overnightSentence([other]), cutAt, series: [other] }
        return out
      }
    }
    let early = -1
    for (let i = 0; i < n - 1; i += 1) if (aligned.withheld[i]) { early = i; break }
    if (early >= 0) {
      out.codes.push(...sink.keys())
      if (named.length) {
        return refuse(`a \`request.security\`${at(site)} cannot be read on every bar — `
          + `${named.map(([c, text]) => `${c}: ${text}`).join(' ')}${CARRIES}`)
      }
      // ⭐ WHICH UNKNOWN, BY NAME (2026-11-19), and (e85) THE ONE THAT DECIDES: a hole refuses whatever lies around it;
      // else a tail waits (a depth gap waits with it: the run starts at `knownFrom` once the tail lands); else the depth.
      // ⚰️ The first withheld bar named the cause: the e85 tail lag was refused under the depth sentence of bar 0.
      let hole = -1
      let tail = -1
      let lastDepth = -1
      for (let i = early; i < n - 1; i += 1) {
        if (!aligned.withheld[i]) continue
        const place = placeOf(i)
        if (place === 'hole') { hole = i; break }
        if (place === 'tail') { if (tail < 0) tail = i } else lastDepth = i
      }
      if (hole >= 0) {
        // ⛔ A bar missing AFTER the series began and before its newest (a hole TradingView holds): a guess, not a
        // depth and not a wait, so no `knownFrom`
        return refuse(`a \`request.security\`${at(site)} cannot be read on every bar — \`${other}\` has no bar on `
          + `${String(rows[hole].t)}, after its history began, so what the request reads there is not known.${CARRIES}`)
      }
      if (tail >= 0) {
        // ⭐⭐ (e85) THE LIVE TAIL: every bar the series lacks before the newest lies after its last held bar. A wait
        // within the bound; past it, refused by name (never the depth sentence, never `knownFrom`: no cut reaches it)
        const lag = tailLagIntervals(rows, lastHeld, ctx && ctx.tf)
        const within = live && lag <= TAIL_LAG_BOUND_INTERVALS
        // ⭐⭐ (e91, coordinator ruling 2026-11-20 (2b)) — NEVER THE WHOLE PANE BLANK FOR A TAIL LAG. ⚰️ CAPTURED (production
        // e88 in session, Fred RS on RDDT 5m, 28,050 rows): /api/bars/SPX answered 0-2 bars behind and every reply WAITED,
        // so a freshly opened 5m pane stayed blank all session. The run is CUT at the first bar past the series' newest held
        // bar (`cutAt`, `runtimeColumns.js::computeRuntimeColumns`, #2135's overnight shape): every bar before it, all of
        // whose reads are known, is drawn; the bars from it are withheld BY NAME (within the bound: pending, "have not
        // arrived yet"; past it: the lag's sentence). A run that draws keeps its drawings waiting (ruling (A): never on the
        // cut bar, which TradingView never draws them on). Never a carried value: the cut bars read nothing.
        if (!_tailCutOff) {
          out.refusal = { guard: within ? REQUEST_GUARD : REQUEST_LAG_GUARD,
            message: within ? tailCutSentence([other]) : lagMessage(site, other, lastHeld, rows, live),
            cutAt: tail, series: [other], tailWait: true, tailPending: within }
          return out
        }
        if (!within) {
          out.refusal = { guard: REQUEST_LAG_GUARD, message: lagMessage(site, other, lastHeld, rows, live) }
          return out
        }
        waits.push(other)
        continue
      }
      // ⭐⭐ (the e81 live capture, 2026-11-19) — A DEPTH GAP ONLY: every withheld bar before the newest lies BEFORE
      // the first row we hold of the series (an intraday index: our store holds ~60 days of 5m, 730 of 60m, and a
      // member's chart fills far deeper). The run need not refuse the whole chart for bars our data cannot reach: it
      // starts where every read is known (`knownFrom`, `runtimeColumns.js::computeRuntimeColumns`), under the off-listing
      // two-start proof. ⚰️ The sentence said "after its history began" for Fred RS's 5m bar 0 (2026-04-27), four
      // months before our first SPX 5m row (2026-08-26), and the cause was first misread as an extended-hours gap.
      const earlyT = rows[early] && rows[early].t
      return refuse(`a \`request.security\`${at(site)} cannot be read on every bar — this chart's history reaches `
        + `${String(earlyT)}, and the \`${other}\` bars we hold begin at ${String(firstHeld)}, so what the request `
        + `reads before them is not known (a shorter chart history draws it).${CARRIES}`, lastDepth + 1)
    }
    if (n && aligned.withheld[n - 1]) {
      out.newestWithheld = true
      // ⭐⭐ HTF-NEWEST-NARROW — WHICH sites: the run withholds only what each one reaches (`runtimeColumns.js`)
      out.newestWithheldSites.push(s)
      for (const [c, text] of sink) {
        if (!out.codes.includes(c)) { out.codes.push(c); out.sentences.push(text) }
      }
      // a missing counterpart names no chart-clock code: say which series and which session
      if (!sink.size) {
        out.codes.push(REQUEST_GUARD)
        out.sentences.push(`\`${other}\` has no bar for ${String(rows[n - 1] && rows[n - 1].t)} yet, so what the `
          + "script reads from it on the newest bar is not known; that bar's values and drawings are withheld")
        // ⭐⭐ (e85) …and when that bar lies after the series' last held bar, it is the live tail too: the run decides
        // whether withholding it would take every drawing, and waits instead (`runtimeColumns.js`, `newestTail`)
        if (placeOf(n - 1) === 'tail') {
          const within = live && tailLagIntervals(rows, lastHeld, ctx && ctx.tf) <= TAIL_LAG_BOUND_INTERVALS
          out.newestTail.push({ site: s, series: other, within,
            message: within ? null : lagMessage(site, other, lastHeld, rows, live) })
        }
      }
    }
    supply.push({ runBars: aligned.runBars, index: aligned.index })
  }
  if (waits.length) {
    // ⭐⭐ (e85) PENDING, NOT REFUSED: nothing is supplied, and the run says which series it waits for
    out.pending = true
    out.waiting = { series: [...new Set(waits)], sentence: requestWaitingSentence(waits) }
    return out
  }
  out.supply = supply
  return out
}
