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
import { interpret, TF_MERGE, TF_MERGE_NEWEST_CODE, TF_MERGE_FIRST_CODE, CHART_CLOCK_WITHHELD } from './interpret'
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
// ⭐ review L2 — these hand-written dates stand for a series FROM ITS LISTING (its first period is
// whole, as TradingView draws it); the off-listing case has its own block below.
const col = (tree, opts) => Array.from(interpret(tree, BARS, {}, undefined, undefined, { tf: 'D', historyFromListing: true, ...(opts || {}) }))
  .map((v) => (Number.isFinite(v) ? v : null))
const node = (type, code, child = { type: 'series', name: 'close' }) => ({ type, value: code, args: [child] })
const HIGH = { type: 'series', name: 'high' }

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

// ⭐⭐ REVIEW L3 — a FINISHED newest daily bar that CERTAINLY closes its period is served:
// the next weekday after it falls in another period (W: a Friday; M: the month's last
// weekday), on a daily chart with no weekend bars, never under another request. Positive-only.
describe('⭐⭐ review L3 — a finished newest bar that certainly closes its period is SERVED (positive-only)', () => {
  const upTo = (iso) => BARS.slice(0, DATES.indexOf(iso) + 1)
  const colOn = (tree, bars, opts) => Array.from(interpret(tree, bars, {}, undefined, undefined, { tf: 'D', newestBarIsForming: false, historyFromListing: true, ...(opts || {}) }))
    .map((v) => (Number.isFinite(v) ? v : null))
  const named = (tree, bars, opts) => {
    const sink = new Map()
    const c = colOn(tree, bars, { ...(opts || {}), chartClockSink: sink })
    return { last: c[c.length - 1], codes: [...sink.keys()], c }
  }

  it('W: a finished FRIDAY newest bar reads its own week, nothing named', () => {
    const r = named(node(TF_MERGE, 'W'), upTo('2026-03-27'))
    expect(r.last).toBe(5)
    expect(r.codes).toEqual([])
  })

  it('⛔ W: the THURSDAY before Good Friday (a holiday ends the week early) stays withheld by name', () => {
    const r = named(node(TF_MERGE, 'W'), upTo('2026-04-02'))
    expect(r.last).toBe(null)
    expect(r.codes).toEqual([TF_MERGE_NEWEST_CODE])
  })

  it('M: the month\'s last weekday (Tue 03-31; Fri 05-29, May ending on a Sunday) is served; Thu 05-28 is withheld', () => {
    expect(named(node(TF_MERGE, 'M'), upTo('2026-03-31')).last).toBe(7)
    const may = named(node(TF_MERGE, 'M'), upTo('2026-05-29'))
    expect(may.last).toBe(17)
    expect(may.codes).toEqual([])
    const thu = named(node(TF_MERGE, 'M'), upTo('2026-05-28'))
    expect(thu.last).toBe(null)
    expect(thu.codes).toEqual([TF_MERGE_NEWEST_CODE])
  })

  it('⛔ M: a THURSDAY whose next weekday (Friday 01-30) is still in the month does not close it, though three days on is February', () => {
    const jan = ['2026-01-26', '2026-01-27', '2026-01-28', '2026-01-29'].map((t, i) => ({ t, o: i + 1, h: i + 1.5, l: i + 0.5, c: i + 1, v: 100 }))
    const r = named(node(TF_MERGE, 'M'), jan)
    expect(r.last).toBe(null)
    expect(r.codes).toEqual([TF_MERGE_NEWEST_CODE])
  })

  it('W and M in one tree: served only when the bar closes BOTH (Fri 05-29), withheld on a Friday mid-month (03-27)', () => {
    const tree = parseFormula("tf_merge(close, 'W') + tf_merge(close, 'M')").ast
    expect(named(tree, upTo('2026-05-29')).last).toBe(17 + 17)
    expect(named(tree, upTo('2026-03-27')).last).toBe(null)
  })

  it('⛔ not on an intraday chart, not on a series that trades weekends, never under another request', () => {
    expect(named(node(TF_MERGE, 'W'), upTo('2026-03-27'), { tf: '5' }).last).toBe(null)
    const weekend = [{ t: '2026-03-21', o: 1, h: 1, l: 1, c: 1, v: 1 }, ...upTo('2026-03-27')]
    expect(named(node(TF_MERGE, 'W'), weekend).last).toBe(null)
    const bars = upTo('2026-03-27')
    const under = { type: 'sym', value: 'SPY', args: [node(TF_MERGE, 'W')] }
    expect(named(under, bars, { symbols: { SPY: bars } }).last).toBe(null)
  })
})

// ⭐⭐ REVIEW L2 — off the listing, a chart that starts mid-period would build the FIRST period's
// value from part of it: the bars that would show it are withheld by name, unless the first bar
// certainly opens its period. Formula `tf` keeps its own behaviour.
describe('⭐⭐ review L2 — off the listing, the first period\'s value is never drawn from part of it', () => {
  const off = (tree, bars, opts) => {
    const sink = new Map()
    const c = Array.from(interpret(tree, bars, {}, undefined, undefined, { tf: 'D', newestBarIsForming: false, historyFromListing: false, chartClockSink: sink, ...(opts || {}) }))
      .map((v) => (Number.isFinite(v) ? v : null))
    return { c, codes: [...sink.keys()] }
  }

  // ⭐⭐ HTF-MERGE-FIELD-AWARE (items 2 + 3): these read the merge's HIGH, a field the partial period gets wrong; a merge of
  // close alone is the period's own close and is drawn (the item 3 test below, and `htfMergeFieldAware.test.js`)
  it('M, starting mid-March: March\'s closing bar and April\'s other bars are withheld by name; April\'s high is drawn', () => {
    const r = off(node(TF_MERGE, 'M', HIGH), BARS)
    for (const d of ['2026-03-31', '2026-04-01', '2026-04-06', '2026-04-09']) expect(r.c[DATES.indexOf(d)], d).toBe(null)
    expect(r.c[DATES.indexOf('2026-04-10')]).toBe(14.5)
    expect(r.c[DATES.indexOf('2026-05-28')]).toBe(14.5)
    expect(r.codes).toContain(TF_MERGE_FIRST_CODE)
    expect(CHART_CLOCK_WITHHELD[TF_MERGE_FIRST_CODE]()).toMatch(/part of a period/)
  })

  it('W, starting on a MONDAY (the week\'s first session): nothing is withheld for the first period', () => {
    const r = off(node(TF_MERGE, 'W'), BARS)
    expect(r.c.slice(0, N - 1)).toEqual(W_MERGE)
    expect(r.codes).not.toContain(TF_MERGE_FIRST_CODE)
  })

  it('W, starting on a WEDNESDAY: week A\'s closing bar and week B\'s other bars are withheld; week B\'s close is drawn', () => {
    const bars = BARS.slice(DATES.indexOf('2026-03-25'))
    const days = DATES.slice(DATES.indexOf('2026-03-25'))
    const r = off(node(TF_MERGE, 'W', HIGH), bars)
    for (const d of ['2026-03-27', '2026-03-30', '2026-04-01']) expect(r.c[days.indexOf(d)], d).toBe(null)
    expect(r.c[days.indexOf('2026-04-02')]).toBe(9.5)
    expect(r.codes).toContain(TF_MERGE_FIRST_CODE)
  })

  it('⛔ on an intraday chart the first bar is never certainly its period\'s first: withheld even from a Monday', () => {
    const r = off(node(TF_MERGE, 'W', HIGH), BARS, { tf: '5' })
    expect(r.c[DATES.indexOf('2026-03-27')]).toBe(null)
    expect(r.codes).toContain(TF_MERGE_FIRST_CODE)
  })

  it('⭐ item 3: a merge of CLOSE draws the partial period\'s close (the period\'s own) and names nothing for it', () => {
    const bars = BARS.slice(DATES.indexOf('2026-03-25'))
    const days = DATES.slice(DATES.indexOf('2026-03-25'))
    const r = off(node(TF_MERGE, 'W'), bars)
    // week A (03-25..03-27, partial) closes at 5 on Friday 03-27, and week B's other bars read it
    for (const d of ['2026-03-27', '2026-03-30', '2026-04-01']) expect(r.c[days.indexOf(d)], d).toBe(5)
    expect(r.codes).not.toContain(TF_MERGE_FIRST_CODE)
  })

  it('formula `tf` keeps its behaviour off the listing (nothing named)', () => {
    const r = off(node('tf', 'M'), BARS)
    expect(r.codes).not.toContain(TF_MERGE_FIRST_CODE)
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
