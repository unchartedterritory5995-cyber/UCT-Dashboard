// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.c34ChartSeries.test.js
//
// ─── C34 — WHOSE HISTORY A CONDITIONAL CALL READS, AGAINST TRADINGVIEW ───────
//
// Pine keeps one history per CALL SITE for what a function owns (its locals, its
// parameters, the state of a `ta.*` it calls), advanced only on the bars the call
// runs — which is why a drawing helper called under a guard that varies, and
// reading history, is refused (`fn:conditional-history`). The chart's OWN series
// are not the call's: `low[k]` inside the body is the chart's low `k` bars ago.
//
// ⭐ THE WITNESS (committed capture, NYSE:RDDT 1D, 632 bars from the listing):
// `trend-lines-supports-and-resistances` calls `f_drawSupport` / `f_drawResistance`
// ONLY on the last bar (`if barstate.islast`, inside a `while`), and each reads
// `low[historyReference]` / `high[…]` / `open[…]` / `close[…]` 40 to 257 bars back.
// If those reads were the call's history — one execution, nothing before it —
// every one would be `na`. TradingView drew four boxes and four labels whose
// prices are exactly the chart's values at the pivot bars.
//
// ⭐ WHAT IS PINNED:
//   1. the capture itself says so (each vendor box edge is that bar's
//      low / min(open, close) or high / max(open, close));
//   2. OUR object lane, running the same helper bodies under the same
//      `barstate.islast` guard on the vendor's bars, draws those four boxes and
//      four label texts, value for value;
//   3. REFUSED BY NAME, with the capture that would settle each: a chart series
//      no capture witnesses (`time_close[k]`), and a body-local series read at an
//      offset under a guard that varies — the call's own history. ⭐ C42: the
//      capture this section named was taken (`vw-fn-series-history-rddt-1d-
//      2026-09-30`); `volume` / `time` / `hl2` / `hlc3` / `ohlc4` are witnessed
//      the chart's, and a call that runs ONCE reads its own history as `na`
//      (`vendorHarness.c42OneExecution`);
//   4. CONTROL: the same probe's boxes are ABSENT when the helper is called under
//      a guard that also reads a `ta.*` — so rail 2 cannot pass by drawing boxes
//      whatever the body reads.
import { describe, it, expect, vi, afterEach } from 'vitest'
import path from 'node:path'

import { loadCapture } from './harness'
import { toProductBars } from './ourSide'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'
import { objectReaderFor } from '../../objectColumns'
import { evaluateObjects } from '../../objectRuntime'
import { toRenderState } from '../../objectRenderState'
import { translatePine } from '../../ast/pine'

const DIR = path.resolve(process.cwd(), '..', 'tests/fixtures/vendor/harness')
const TSR = 'trend-lines-supports-and-resistances-rddt-1d-2026-09-28.json'

afterEach(() => { vi.unstubAllEnvs() })

const capture = () => loadCapture(path.join(DIR, TSR)).capture
const barsOf = (cap) => {
  const ix = Object.fromEntries(cap.bars.fields.map((f, i) => [f, i]))
  return cap.bars.rows.map((r) => ({ o: r[ix.open], h: r[ix.high], l: r[ix.low], c: r[ix.close] }))
}
const near = (a, b) => Math.abs(a - b) < 1e-6

/** The vendor's four levels, each located on the capture's own bars — the bar
 *  whose low (support) or high (resistance) is the box's edge. */
function vendorLevels(cap) {
  const bars = barsOf(cap)
  return cap.objects.records.boxes.map((bx) => {
    const lo = Math.min(bx.y1, bx.y2)
    const hi = Math.max(bx.y1, bx.y2)
    const sup = bars.findIndex((b) => near(b.l, lo) && near(Math.min(b.o, b.c), hi))
    const res = bars.findIndex((b) => near(b.h, hi) && near(Math.max(b.o, b.c), lo))
    return sup >= 0 ? { kind: 'Support', index: sup, top: hi, bottom: lo }
      : { kind: 'Resistance', index: res, top: hi, bottom: lo }
  })
}

/** The capture's helper shape (lines 201-220): a body local holding the bar
 *  count back, and the chart's series read at it. ⚠️ Each read is written as a
 *  WHOLE coordinate — a line at that price — because that is the form the object
 *  runtime reads a per-bar offset in (C9, `{v:'at'}`); the capture's own
 *  `lowValue = low[…]` binding and `math.min(open[…], close[…])` are not
 *  addresses it reads yet (named in § C34 of the triage doc). The box edges are
 *  then computed from the three lines exactly as the capture's body computes
 *  them, so what is compared is the vendor's number. */
const HELPERS = [
  'f_drawSupport(int index) =>',
  '    historyReference = bar_index - index',
  '    line.new(index, low[historyReference], bar_index, low[historyReference])',
  '    line.new(index, open[historyReference], bar_index, open[historyReference])',
  '    line.new(index, close[historyReference], bar_index, close[historyReference])',
  'f_drawResistance(int index) =>',
  '    historyReference = bar_index - index',
  '    line.new(index, high[historyReference], bar_index, high[historyReference])',
  '    line.new(index, open[historyReference], bar_index, open[historyReference])',
  '    line.new(index, close[historyReference], bar_index, close[historyReference])',
]

/** Called under the capture's own guard, at the vendor's pivot bars. */
const probe = (levels, guard = 'barstate.islast') => [
  '//@version=5',
  'indicator("C34 probe", overlay = true, max_bars_back = 5000)',
  ...HELPERS,
  `if ${guard}`,
  ...levels.map((v) => `    f_draw${v.kind}(${v.index})`),
].join('\n')

/** Our lines, three per call in creation order → the box each call's body
 *  would have drawn: support (low, min(open, close)), resistance (high,
 *  max(open, close)). */
const boxesFromLines = (levels, lines) => {
  const byId = [...lines].sort((a, b) => a.id - b.id)
  return levels.map((v, i) => {
    const [edge, o, c] = byId.slice(3 * i, 3 * i + 3).map((l) => l.y1)
    const other = v.kind === 'Support' ? Math.min(o, c) : Math.max(o, c)
    return { top: Math.max(edge, other), bottom: Math.min(edge, other) }
  })
}

function ourObjects(cap, source) {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  const bars = toProductBars(cap)
  const d = memberPaneDefinition({ source, id: 'u_c34_series', name: 'c34' })
  if (!d.ok || !d.definition.objects) return { d, lines: [] }
  const reader = objectReaderFor(d.definition, bars, {
    tf: 'D', symbol: { ticker: 'RDDT', exchange: 'NYSE' }, newestBarIsForming: cap.newestBarIsForming ?? null,
    historyFromListing: true,
  })
  const run = evaluateObjects(reader.program, {
    barCount: bars.length, readNode: reader.readNode, readTime: reader.readTime, readUnknown: reader.readUnknown,
  })
  const state = toRenderState(run.live, { bars, tf: 'D' })
  return { d, lines: state.lines }
}

describe('C34 — a chart series read from inside a last-bar helper is the chart\'s', () => {
  it('⭐ the capture: four vendor boxes sit on the chart\'s own bars, 40 to 257 bars back', () => {
    const cap = capture()
    const levels = vendorLevels(cap)
    expect(levels).toHaveLength(4)
    for (const v of levels) expect(v.index, JSON.stringify(v)).toBeGreaterThan(0)
    const back = levels.map((v) => cap.bars.rows.length - 1 - v.index).sort((a, b) => a - b)
    expect(back).toEqual([40, 125, 179, 257])
    expect(levels.filter((v) => v.kind === 'Support')).toHaveLength(2)
    // …and the vendor PRINTED those prices, so the reads were not `na`
    const texts = cap.objects.texts.labels
    for (const v of levels) {
      const price = v.kind === 'Support' ? v.bottom : v.top
      expect(texts, `${v.kind} ${price}`).toContain(`${v.kind} : ${price.toFixed(2)}`)
    }
  })

  it("⭐ our object lane reads TradingView's four box edges, value for value", () => {
    const cap = capture()
    const levels = vendorLevels(cap)
    const { d, lines } = ourObjects(cap, probe(levels))
    expect(d.ok, d.reason || '').toBe(true)
    expect(d.translation.objectDiagnostics.dropReasons).toEqual({})
    expect(lines).toHaveLength(12)
    // every line is drawn from the pivot bar to the last bar, flat
    for (const l of lines) expect(l.y1).toBe(l.y2)
    const ours = boxesFromLines(levels, lines).map((b) => `${b.top.toFixed(4)}|${b.bottom.toFixed(4)}`).sort()
    const theirs = cap.objects.records.boxes
      .map((b) => `${Math.max(b.y1, b.y2).toFixed(4)}|${Math.min(b.y1, b.y2).toFixed(4)}`).sort()
    expect(ours).toEqual(theirs)
  })

  it("🔴 CONTROL: a helper that ALSO reads the call's own history (`ta.vwma`) is refused, and draws nothing", () => {
    const cap = capture()
    const levels = vendorLevels(cap)
    // ⭐ C42 — `ta.ema`: what `ta.sma` answers on a call's one run is witnessed now
    // ⭐ C48 re-pin — and `ta.ema`'s (`vw-call-site-history`, B05); `ta.wma` has no row
    const src = probe(levels).replace(/ {4}historyReference = bar_index - index/g,
      // ⭐ F1 re-pin — `ta.wma` is witnessed now (`vw-once-ta-helper` T06); `ta.vwma` has no row
      '    historyReference = bar_index - index + int(ta.vwma(close, 3) * 0)')
    const { d, lines } = ourObjects(cap, src)
    expect(d.translation.objectDiagnostics.dropReasons['fn:conditional-history']).toBe(4)
    expect(lines).toHaveLength(0)
  })
})

describe('C34 — what stays refused, by name', () => {
  const refusalsOf = (body, guard = 'barstate.islast') => {
    const src = [
      '//@version=5',
      'indicator("C34 refusal", overlay = true)',
      'f(int k) =>',
      ...body,
      `if ${guard}`,
      '    f(5)',
    ].join('\n')
    const t = translatePine(src, {})
    return (t.objectDiagnostics && t.objectDiagnostics.refusedCalls) || []
  }

  // ⭐ C48 re-pin — `time_close[k]` was refused here, naming `vw-call-site-history`.
  // That capture is committed (rows B02 / B03): the read is the chart's, and
  // `vendorHarness.c48CallSite` grades it. Nothing is refused for it now.
  it('⭐ C48 — `time_close[k]` / `hlcc4[k]` inside a last-bar helper are no longer refused', () => {
    expect(refusalsOf(['    label.new(bar_index, low, str.tostring(time_close[k]))'])).toHaveLength(0)
    expect(refusalsOf(['    label.new(bar_index, low, str.tostring(hlcc4[k]))'])).toHaveLength(0)
  })

  it('⛔ the call\'s OWN history — a body local read at an offset — is still refused under a guard that varies', () => {
    const r = refusalsOf(['    x = close * 2', '    label.new(bar_index, x[1], "v")'], 'close > open')
    expect(r).toHaveLength(1)
    expect(r[0]).toMatch(/^f:conditional-history@.*history read `\[…\]`/)
  })

  it('⛔ a parameter read at an offset is the call\'s history too', () => {
    const src = [
      '//@version=5',
      'indicator("C34 param", overlay = true)',
      'f(float src) =>',
      '    label.new(bar_index, src[1], "v")',
      'if close > open',
      '    f(close)',
    ].join('\n')
    const r = translatePine(src, {}).objectDiagnostics.refusedCalls || []
    expect(r).toHaveLength(1)
    expect(r[0]).toMatch(/^f:conditional-history@/)
  })

  it('⛔ a script that binds the name `low` itself reads its own series, and is refused', () => {
    const src = [
      '//@version=5',
      'indicator("C34 shadow", overlay = true)',
      'low = close * 0.9',
      'f(int k) =>',
      '    label.new(bar_index, low[k], "v")',
      'if barstate.islast',
      '    f(5)',
    ].join('\n')
    const r = translatePine(src, {}).objectDiagnostics.refusedCalls || []
    expect(r).toHaveLength(1)
    expect(r[0]).toMatch(/^f:conditional-history@/)
  })
})
