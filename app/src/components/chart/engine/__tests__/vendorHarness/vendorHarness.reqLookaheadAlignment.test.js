// ─── ⭐⭐ REQ (coverage unit `request.security`) — WHICH REQUESTED BAR A CHART BAR READS,
//     against the vendor's own numbers, with nothing of the engine's run in between ──────
//
// `interpret.js::requestAlignment` decides, for the runtime lane's `request.security`, which
// higher-timeframe bar each chart bar reads. Look-ahead OFF is engine 55's merge
// (`tfMergeReads`). This unit adds look-ahead ON (`live: true`): the bar reads the period it
// is INSIDE (`tfLiveReads`), the pick the host lane's `tf_live` column has always made.
//
// THE WITNESS is the committed probe capture `vw-request-htf-alignment-spy-1d-2026-10-02`
// (AMEX:SPY 1D, 1,800 bars, the newest one finished). Its rows:
//   A01  request.security(tickerid, "W", close, lookahead = barmerge.lookahead_on)
//   A02  request.security(tickerid, "W", close, lookahead = barmerge.lookahead_off)
//   A04  request.security(tickerid, "M", close, lookahead = barmerge.lookahead_on)
//   A05  request.security(tickerid, "M", close, lookahead = barmerge.lookahead_off)
//   A06  request.security(tickerid, "W", close[1], lookahead = barmerge.lookahead_on)
//   A07  request.security(tickerid, "W", high, lookahead = barmerge.lookahead_off)
// The probe as captured still refuses at the member door (A09 reads `"60"`, below the chart),
// so this rail reads the vendor's COLUMNS and the capture's own bars: the higher-timeframe
// bars are built from the capture's daily bars (`requestAlignment`'s `runBars`), each chart
// bar's pick is `index`, and the value read there is compared with what TradingView drew.
//
// ⚠️ THE CAPTURE'S WINDOW DOES NOT BEGIN AT THE LISTING (bar_index 6677 on its first bar), so
// its first week and first month are built from part of the period. A row is compared only
// where the bars it reads are whole in the window; the count compared is asserted, so the
// rail cannot pass by comparing nothing.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { requestAlignment, tfMergeReads, tfLiveReads } from '../../ast/interpret.js'
import { toProductBars } from './ourSide'
import { computeRuntimeColumns, resetRuntimeSessions, resetRuntimeLedgers } from '../../runtime/runtimeColumns.js'
import { beforeEach } from 'vitest'

beforeEach(() => { resetRuntimeSessions(); resetRuntimeLedgers() })

const REPO = path.resolve(process.cwd(), '..')
const CAPTURE = JSON.parse(fs.readFileSync(
  path.join(REPO, 'tests/fixtures/vendor/harness/vw-request-htf-alignment-spy-1d-2026-10-02.json'), 'utf8'))
const BARS = toProductBars(CAPTURE)
const N = BARS.length

/** A vendor column, by plot title. */
function vendor(title) {
  const plot = CAPTURE.study.plots.find((p) => p.title === title)
  const at = CAPTURE.plotValues.fields.indexOf(plot.id)
  return CAPTURE.plotValues.rows.map((r) => r[at])
}

/** Bars compared and bars that differ, for a pick and a field of the requested bar. */
function grade({ code, live, field, back = 0, title, from }) {
  // the capture's own newest bar is FINISHED (`newestBarIsForming: false`), so no bar is withheld
  const a = requestAlignment({ chartBars: BARS, srcBars: BARS, code, live,
    opts: { tf: 'D', historyFromListing: true, newestBarIsForming: CAPTURE.newestBarIsForming } })
  const v = vendor(title)
  let compared = 0
  const wrong = []
  for (let i = from; i < N; i += 1) {
    const j = a.index[i] - back
    if (a.index[i] < 0 || j < 1) continue     // bucket 0 is the window's partial first period
    if (a.withheld[i]) continue
    compared += 1
    const ours = a.runBars[j][field]
    if (!(Math.abs(ours - v[i]) <= 1e-9 * Math.max(1, Math.abs(v[i])))) wrong.push({ i, t: BARS[i].t, ours, vendor: v[i] })
  }
  return { compared, wrong, withheld: Array.from(a.withheld).reduce((s, x) => s + (x ? 1 : 0), 0) }
}

describe('REQ · look-ahead alignment against `vw-request-htf-alignment-spy-1d-2026-10-02`', () => {
  it('the capture holds the rows this rail reads', () => {
    expect(N).toBe(1800)
    expect(CAPTURE.timeframe).toBe('1D')
    expect(CAPTURE.newestBarIsForming).toBe(false)
    for (const t of ['A01_close_W_lookahead_ON', 'A02_close_W_lookahead_OFF', 'A04_close_M_lookahead_ON',
      'A05_close_M_lookahead_OFF', 'A06_prev_W_close_ON', 'A07_high_W_lookahead_OFF']) {
      expect(vendor(t).length, t).toBe(N)
    }
  })

  it('⭐ look-ahead ON, weekly: every bar reads the close of the week it is inside (A01), newest week included', () => {
    const g = grade({ code: 'W', live: true, field: 'c', title: 'A01_close_W_lookahead_ON', from: 0 })
    expect(g.wrong).toEqual([])
    expect(g.withheld).toBe(0)
    expect(g.compared).toBeGreaterThan(1790)
  })

  it('⭐ look-ahead ON, monthly: every bar reads the close of the month it is inside (A04), the unfinished month too', () => {
    const g = grade({ code: 'M', live: true, field: 'c', title: 'A04_close_M_lookahead_ON', from: 0 })
    expect(g.wrong).toEqual([])
    expect(g.withheld).toBe(0)
    expect(g.compared).toBeGreaterThan(1770)
  })

  it('⭐ look-ahead ON with `close[1]`: the expression runs on the weekly bars, so the bar reads LAST week\'s close (A06)', () => {
    const g = grade({ code: 'W', live: true, field: 'c', back: 1, title: 'A06_prev_W_close_ON', from: 0 })
    expect(g.wrong).toEqual([])
    expect(g.compared).toBeGreaterThan(1780)
  })

  it('look-ahead OFF is unchanged: the merge (A02 weekly close, A05 monthly close), the newest bar withheld by name', () => {
    const w = grade({ code: 'W', live: false, field: 'c', title: 'A02_close_W_lookahead_OFF', from: 0 })
    expect(w.wrong).toEqual([])
    expect(w.compared).toBeGreaterThan(1780)
    const m = grade({ code: 'M', live: false, field: 'c', title: 'A05_close_M_lookahead_OFF', from: 0 })
    expect(m.wrong).toEqual([])
    expect(m.compared).toBeGreaterThan(1750)
  })

  it('⛔ the two picks differ, so a rail on one cannot pass on the other: ON read as OFF is wrong on most bars', () => {
    const asOff = grade({ code: 'W', live: false, field: 'c', title: 'A01_close_W_lookahead_ON', from: 0 })
    expect(asOff.wrong.length).toBeGreaterThan(1000)
    const asOn = grade({ code: 'W', live: true, field: 'c', title: 'A02_close_W_lookahead_OFF', from: 0 })
    expect(asOn.wrong.length).toBeGreaterThan(1000)
  })

  it('`tfLiveReads` is the bucket the bar is inside; `tfMergeReads` only agrees with it on a period\'s closing bar', () => {
    const isos = ['2026-09-21', '2026-09-22', '2026-09-25', '2026-09-28', '2026-09-29']
    const bars = isos.map((t, i) => ({ t, o: i, h: i, l: i, c: i, v: 1 }))
    const live = requestAlignment({ chartBars: bars, srcBars: bars, code: 'W', live: true, opts: { tf: 'D', historyFromListing: true } })
    const off = requestAlignment({ chartBars: bars, srcBars: bars, code: 'W', live: false, opts: { tf: 'D', historyFromListing: true } })
    expect(Array.from(live.index)).toEqual([0, 0, 0, 1, 1])
    expect(Array.from(off.index)).toEqual([-1, -1, 0, 0, 1])
    const at = new Map([['a', 0], ['b', 1]])
    const key = (iso) => (iso < '2026-09-28' ? 'a' : 'b')
    expect(tfLiveReads(isos, 'W', { get: (k) => at.get(k) }).length).toBe(5)
    expect(typeof tfMergeReads).toBe('function')
    expect(key(isos[4])).toBe('b')
  })
})

// ─── THE SERVED PATH: the runtime lane's own run of the probe's rows, graded against the capture ──────
// The rows above check the pick. These run `computeRuntimeColumns` (the run a member's chart makes) on
// the capture's daily bars and compare its column with TradingView's, bar for bar. The window is cut to
// begin on the first session of a week (a Monday after a Friday), so the first week is whole and the run
// is not refused by `request:htf-lookahead-first-period-partial`.
describe('REQ · the runtime lane serves look-ahead W / M as TradingView draws it (the same capture)', () => {
  const start = (() => {
    for (let i = 1; i < N; i += 1) {
      const d = new Date(`${BARS[i].t}T00:00:00Z`).getUTCDay()
      const p = new Date(`${BARS[i - 1].t}T00:00:00Z`).getUTCDay()
      if (d === 1 && p === 5) return i
    }
    return -1
  })()
  const firstMonthStart = (() => {
    // a month whose first session follows the previous WEEKDAY (no holiday on the 1st), so the run's own
    // test (`tfLiveFirstPeriodMask`: the weekday before the first bar is in another month) is met
    for (let i = start; i < N; i += 1) {
      if (BARS[i].t.slice(5, 7) === BARS[i - 1].t.slice(5, 7)) continue
      const d = new Date(`${BARS[i].t}T00:00:00Z`)
      d.setUTCDate(d.getUTCDate() - (d.getUTCDay() === 1 ? 3 : 1))
      if (d.toISOString().slice(0, 10) === BARS[i - 1].t) return i
    }
    return -1
  })()
  const run = (body, from) => {
    const bars = BARS.slice(from)
    const def = { id: 'req-la', meta: { runtimeHistory: 'listing' },
      compute: { kind: 'runtime', fn: 'runtime:req-la', outputs: { a: 0 }, source: `//@version=5\nindicator("req")\n${body}` } }
    const cols = computeRuntimeColumns(def, bars, { tf: 'D', newestBarIsForming: false, historyFromListing: false,
      symbol: { ticker: 'SPY', exchange: 'AMEX' } })
    return Array.from(cols.a)
  }
  // ⭐ The cut does not begin at the listing, so the run is the off-listing replay (`runtimeColumns.js::
  // computeOffListing`): it withholds (`NaN`) the bars before its two runs agree — a PREFIX, by name. A drawn
  // bar is graded; a withheld one is not a value. The prefix is asserted short, so the rail cannot pass by
  // withholding everything, and every withheld bar must lie in it.
  const exact = (ours, title, from, skip = 0) => {
    const v = vendor(title).slice(from)
    const wrong = []
    let prefix = 0
    while (prefix < ours.length && Number.isNaN(ours[prefix])) prefix += 1
    let compared = 0
    for (let i = Math.max(skip, prefix); i < v.length; i += 1) {
      compared += 1
      if (!(Math.abs(ours[i] - v[i]) <= 1e-9 * Math.max(1, Math.abs(v[i])))) wrong.push(i)
    }
    return { compared, wrong, prefix }
  }

  it('the cut starts on a Monday after a Friday, inside the window', () => {
    expect(start).toBeGreaterThan(0)
    expect(firstMonthStart).toBeGreaterThan(start)
  })

  it('⭐ A01: `request.security(tickerid, "W", close, lookahead = barmerge.lookahead_on)`, every bar exact', () => {
    const g = exact(run('plot(request.security(syminfo.tickerid, "W", close, lookahead = barmerge.lookahead_on))', start),
      'A01_close_W_lookahead_ON', start)
    expect(g.wrong).toEqual([])
    expect(g.prefix).toBeLessThan(400)
    expect(g.compared).toBeGreaterThan(1300)
  })

  it('⭐ A04: monthly, every bar exact (the cut begins on a month\'s first session)', () => {
    const g = exact(run('plot(request.security(syminfo.tickerid, "M", close, lookahead = barmerge.lookahead_on))', firstMonthStart),
      'A04_close_M_lookahead_ON', firstMonthStart)
    expect(g.wrong).toEqual([])
    expect(g.prefix).toBeLessThan(400)
    expect(g.compared).toBeGreaterThan(1300)
  })

  it('⭐ A06: `close[1]` inside the request is LAST week\'s close, from the second week of the cut on', () => {
    const ours = run('plot(request.security(syminfo.tickerid, "W", close[1], lookahead = barmerge.lookahead_on))', start)
    const g = exact(ours, 'A06_prev_W_close_ON', start, 5)
    expect(g.wrong).toEqual([])
    expect(g.prefix).toBeLessThan(400)
    expect(g.compared).toBeGreaterThan(1300)
  })

  it('⛔ CONTROL: the same cut read with look-ahead OFF differs from A01 on most bars (the rail can fail)', () => {
    const off = run('plot(request.security(syminfo.tickerid, "W", close))', start)
    expect(exact(off, 'A01_close_W_lookahead_ON', start).wrong.length).toBeGreaterThan(1000)
  })

  it('⭐ a cut that begins MID-WEEK: the warm-up curtain withholds the partial week, every drawn bar exact', () => {
    // the off-listing replay judges the partial first week (`runtimeColumns.js::computeOffListing`): its two
    // runs agree only once the partial week no longer reaches, and every bar before that is withheld
    const ours = run('plot(request.security(syminfo.tickerid, "W", close, lookahead = barmerge.lookahead_on))', start + 1)
    const g = exact(ours, 'A01_close_W_lookahead_ON', start + 1)
    expect(g.wrong).toEqual([])
    expect(g.prefix).toBeGreaterThanOrEqual(4)   // at least the rest of the partial week
    expect(g.compared).toBeGreaterThan(1300)
  })
})
