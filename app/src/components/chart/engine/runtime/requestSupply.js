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
import { isTradingDay } from '../../../../lib/marketClock/sessionCalendar.js'

export const REQUEST_GUARD = 'runtime:request'

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
  const dayOf = rows.map((r) => (r && typeof r.t === 'number' ? etSessionDayOf(r.t) : null))
  for (let i = 0; i < n; i += 1) {
    const d = dayOf[i]
    if (!d) { withheld[i] = 1; continue }
    let j = -1
    if (ownRead) {
      const lastOfDay = i === n - 1 || dayOf[i + 1] !== d
      j = lastOfDay && at.has(d) ? at.get(d) : before(d)
    } else {
      const close = isTradingDay(d) ? sessionCloseOf(d) : null
      const ownDone = close !== null && rows[i].t >= close && at.has(d) && !(forming && at.get(d) === daily.length - 1)
      j = ownDone ? at.get(d) : before(d)
    }
    if (j < 0) withheld[i] = 1
    else index[i] = j
  }
  return { runBars: daily, index, withheld, other }
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
 *            newestWithheld: boolean, codes: string[], sentences: string[]}}
 */
export function runtimeRequestSupply(requests, rows, ctx = {}) {
  ctx = withChartNewestDay(ctx, rows)   // ⭐ RS RATING L11 PR 2: the bind reads no bars
  const out = { supply: null, refusal: null, pending: false, newestWithheld: false, codes: [], sentences: [] }
  const sites = Array.isArray(requests) ? requests : []
  if (!sites.length) return out
  const n = Array.isArray(rows) ? rows.length : 0
  const chartCode = ladderCode(ctx && ctx.tf)
  const supply = []
  const refuse = (message) => { out.refusal = { guard: REQUEST_GUARD, message }; return out }
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
      if (read.pending) { out.pending = true; return out }
      if (read.refusal) return refuse(read.refusal)
      aligned = { runBars: read.runBars, index: read.index, withheld: read.withheld }
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
    let early = -1
    for (let i = 0; i < n - 1; i += 1) if (aligned.withheld[i]) { early = i; break }
    if (early >= 0) {
      const named = [...sink.entries()]
      const why = named.length ? named.map(([c, text]) => `${c}: ${text}`).join(' ')
        : `\`${other}\` has no bar on ${String(rows[early] && rows[early].t)}, after its history began, so what the `
          + 'request reads there is not known'
      out.codes.push(...sink.keys())
      return refuse(`a \`request.security\`${at(site)} cannot be read on every bar — ${why} A script drawn bar by `
        + 'bar carries its values forward from bar to bar, so one unknown read reaches every later bar; '
        + 'nothing is drawn rather than a guess')
    }
    if (n && aligned.withheld[n - 1]) {
      out.newestWithheld = true
      for (const [c, text] of sink) {
        if (!out.codes.includes(c)) { out.codes.push(c); out.sentences.push(text) }
      }
      // a missing counterpart names no chart-clock code: say which series and which session
      if (!sink.size) {
        out.codes.push(REQUEST_GUARD)
        out.sentences.push(`\`${other}\` has no bar for ${String(rows[n - 1] && rows[n - 1].t)} yet, so what the `
          + "script reads from it on the newest bar is not known; that bar's values and drawings are withheld")
      }
    }
    supply.push({ runBars: aligned.runBars, index: aligned.index })
  }
  out.supply = supply
  return out
}
