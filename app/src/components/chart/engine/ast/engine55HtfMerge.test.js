// app/src/components/chart/engine/ast/engine55HtfMerge.test.js
//
// ─── ⭐⭐ ENGINE 55 — `tf_merge`: PINE'S LOOK-AHEAD-OFF `request.security(…, 'W'|'M')` ───
//     AS TRADINGVIEW DRAWS IT, AND FORMULA `tf` LEFT EXACTLY AS IT WAS
//
// TradingView, on historical bars: the higher-timeframe value appears on the chart bar where
// that period CLOSES; every other bar reads the last closed period. Measured on the
// `support-and-resistance-multi-time-frame-{rddt,spy}-1d-2026-10-02` captures (0 mismatches
// over 598 + 1,799 bars, 8 weekly / monthly plots) and graded MATCH in
// `vendorHarness.e55HtfMerge.test.js`. Here, on hand-written dates, every rule is pinned by a
// case that only that rule passes:
//   * the period end is read off the NEXT bar — the Good Friday week closes on a Thursday,
//     and May 2026 ends on a Sunday, so its last bar is Friday the 29th (a weekday or
//     calendar rule draws both one bar late or early);
//   * mid-period bars read the PREVIOUS period (`b - 1`), never the forming one;
//   * the newest bar: forming → the forming period; finished or unknown → WITHHELD and named
//     (`request:htf-newest-unconfirmed`), at the ROOT (`nz(…)` must not turn it into 0);
//   * formula `tf` still reads `b - 1` on every bar.
// Expected values are written out by hand below; nothing is derived from the evaluator.
import { describe, it, expect } from 'vitest'
import { interpret, TF_MERGE, TF_MERGE_NEWEST_CODE, CHART_CLOCK_WITHHELD } from './interpret'
import { parseFormula } from './parse'
import { translatePine, printFormula } from './pine'
import { lintDefinition } from './lint'
import { evaluability, LANES } from '../evaluability'

const DATES = [
  // week A — closes Friday 03-27
  '2026-03-23', '2026-03-24', '2026-03-25', '2026-03-26', '2026-03-27',
  // week B — the Good Friday week (2026-04-03 closed): closes THURSDAY 04-02; March ends Tuesday 03-31
  '2026-03-30', '2026-03-31', '2026-04-01', '2026-04-02',
  // week C — closes Friday 04-10 (the next bar is weeks later)
  '2026-04-06', '2026-04-07', '2026-04-08', '2026-04-09', '2026-04-10',
  // May 2026 ends on a SUNDAY: its last bar is Friday 05-29
  '2026-05-27', '2026-05-28', '2026-05-29',
  // June — the newest bar is Tuesday 06-02
  '2026-06-01', '2026-06-02',
]
const BARS = DATES.map((t, i) => ({ t, o: i + 1, h: i + 1.5, l: i + 0.5, c: i + 1, v: 100 }))
const N = BARS.length
const NA = null
const col = (tree, opts) => Array.from(interpret(tree, BARS, {}, undefined, undefined, { tf: 'D', ...(opts || {}) }))
  .map((v) => (Number.isFinite(v) ? v : null))
const node = (type, code, child = { type: 'series', name: 'close' }) => ({ type, value: code, args: [child] })

// hand-written: closes are 1..19 in date order
const W_MERGE = [NA, NA, NA, NA, 5, 5, 5, 5, 9, 9, 9, 9, 9, 14, 14, 14, 17, 17]
const M_MERGE = [NA, NA, NA, NA, NA, NA, 7, 7, 7, 7, 7, 7, 7, 14, 14, 14, 17, 17]
const W_TF = [NA, NA, NA, NA, NA, 5, 5, 5, 5, 9, 9, 9, 9, 9, 14, 14, 14, 17, 17]

describe('⭐⭐ tf_merge — the period end is read off the NEXT bar, the rest reads the last closed period', () => {
  it('weekly: Friday closes its week, the Good Friday week closes on THURSDAY 04-02, mid-week bars read last week', () => {
    const c = col(node(TF_MERGE, 'W'))
    expect(c.slice(0, N - 1)).toEqual(W_MERGE)
    expect(c[DATES.indexOf('2026-04-02')]).toBe(9)       // Thursday: its own week's close
    expect(c[DATES.indexOf('2026-04-01')]).toBe(5)       // Wednesday: last week's
  })

  it('monthly: March closes on Tuesday 03-31, May (ends on a Sunday) on Friday 05-29', () => {
    const c = col(node(TF_MERGE, 'M'))
    expect(c.slice(0, N - 1)).toEqual(M_MERGE)
    expect(c[DATES.indexOf('2026-05-29')]).toBe(17)
    expect(c[DATES.indexOf('2026-05-28')]).toBe(14)
  })

  it('the child is evaluated on the higher-timeframe bars (a weekly HIGH, not a daily one)', () => {
    const c = col(node(TF_MERGE, 'W', { type: 'series', name: 'high' }))
    expect(c[DATES.indexOf('2026-04-02')]).toBe(9.5)     // week B's high, on the bar that closes it
  })
})

describe('⛔ the newest bar — forming reads the forming period; finished or unknown is WITHHELD by name', () => {
  for (const forming of [false, null, undefined]) {
    it(`newestBarIsForming = ${String(forming)}: withheld, and named request:htf-newest-unconfirmed`, () => {
      const sink = new Map()
      const c = col(node(TF_MERGE, 'W'), { newestBarIsForming: forming, chartClockSink: sink })
      expect(c[N - 1]).toBe(null)
      expect([...sink.keys()]).toEqual([TF_MERGE_NEWEST_CODE])
      expect(sink.get(TF_MERGE_NEWEST_CODE)).toBe(CHART_CLOCK_WITHHELD[TF_MERGE_NEWEST_CODE]())
      expect(c.slice(0, N - 1)).toEqual(W_MERGE)           // every earlier bar is drawn
    })
  }

  it('newestBarIsForming = true: the forming week (Tuesday 06-02 reads its own week so far), nothing named', () => {
    const sink = new Map()
    const c = col(node(TF_MERGE, 'W'), { newestBarIsForming: true, chartClockSink: sink })
    expect(c[N - 1]).toBe(19)
    expect(sink.size).toBe(0)
  })

  it('⛔ withheld at the ROOT: `nz(tf_merge(…), 0)` does not turn the withheld bar into a confident 0', () => {
    const tree = { type: 'call', name: 'nz', args: [node(TF_MERGE, 'W'), { type: 'num', value: 0 }] }
    const c = col(tree, { newestBarIsForming: false })
    expect(c[N - 1]).toBe(null)
    expect(c[0]).toBe(0)                                     // an honest leading `na`, nz'd as Pine does
  })

  it('under another symbol the merge withholds from that series\' newest bar on (a series that ends early)', () => {
    const other = BARS.slice(0, N - 2).map((b) => ({ ...b, c: b.c * 10 }))
    const tree = { type: 'sym', value: 'SPY', args: [node(TF_MERGE, 'W')] }
    const c = col(tree, { newestBarIsForming: true, symbols: { SPY: other } })
    expect(c[N - 3]).toBe(null)                              // SPY's own newest bar: its period end is unknown
    expect(c[DATES.indexOf('2026-05-28')]).toBe(140)       // mid-week: SPY's last closed week (week C, 14 x 10)
    expect(c[DATES.indexOf('2026-04-02')]).toBe(90)          // SPY's Good Friday week, on its closing bar
  })
})

describe('⛔ formula `tf` is UNCHANGED — the last closed period on every bar', () => {
  it('`tf(close, "W")` from a typed formula reads b - 1 everywhere, the period-end bar included', () => {
    const tree = parseFormula('tf(close, "W")').ast
    expect(tree.type).toBe('tf')
    const c = col(tree, { newestBarIsForming: false })
    expect(c).toEqual(W_TF)
    expect(c[DATES.indexOf('2026-04-02')]).toBe(5)          // Thursday still reads LAST week
  })

  it('the Pine door writes `tf_merge`, and its printed formula round-trips through the parser', () => {
    const t = translatePine('//@version=5\nindicator("e55")\nplot(request.security(syminfo.tickerid, "W", close))', { strict: true })
    expect(t.ok).toBe(true)
    expect(t.outputs[0].formula).toContain("tf_merge(close, 'W')")
    const back = parseFormula("tf_merge(close, 'W')")
    expect(back.ok).toBe(true)
    expect(printFormula(back.ast)).toBe("tf_merge(close, 'W')")
  })

  it('look-ahead ON is still `tf_live`, never `tf_merge`', () => {
    const t = translatePine('//@version=5\nindicator("e55")\nplot(request.security(syminfo.tickerid, "W", close, lookahead=barmerge.lookahead_on))', { strict: true })
    expect(t.outputs[0].formula).toContain("tf_live(close, 'W')")
    expect(t.outputs[0].formula).not.toContain('tf_merge')
  })
})

describe('the badge and the lanes', () => {
  const doc = (tree, pine) => ({
    id: 'u_e55', version: 1, plots: [{ key: 'value', style: 'line' }],
    compute: { kind: 'ast', fn: 'u_e55', source: 'x', ast: tree },
    meta: pine ? { recurrenceOrigin: 'pine' } : {},
  })
  it('`tf_merge` badges `preview-repaints` (a forming newest bar moves once it closes mid-period); `tf` stays non-repainting', () => {
    expect(lintDefinition(doc(node(TF_MERGE, 'W'), true)).plots[0].mode).toBe('preview-repaints')
    expect(lintDefinition(doc(node('tf', 'W'), true)).plots[0].mode).toBe('non-repainting')
  })
  it('a FORMULA document that spells `tf_merge` is refused by name on the chart; a Pine translation is not', () => {
    const f = evaluability(doc(node(TF_MERGE, 'W'), false), 'value', LANES.CHART, { tf: 'D' })
    expect(f.status).toBe('refused')
    expect(f.guard).toBe('request:formula-unsupported')
    expect(evaluability(doc(node(TF_MERGE, 'W'), true), 'value', LANES.CHART, { tf: 'D' }).status).toBe('supported')
  })
  it('the alert lane refuses `tf_merge` by name (gate `withheld`, code request:htf-newest-unconfirmed)', () => {
    const a = evaluability(doc(node(TF_MERGE, 'W'), true), 'value', LANES.ALERT)
    expect(a.status).toBe('refused')
    expect(a.gate).toBe('withheld')
    expect(a.codes).toEqual([TF_MERGE_NEWEST_CODE])
    expect(evaluability(doc(node('tf', 'W'), true), 'value', LANES.ALERT).status).toBe('supported')
  })
})
