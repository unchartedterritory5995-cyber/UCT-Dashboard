// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.h6Obv.test.js
//
// ─── H6 (step 90) — `ta.obv` on the host lane, and withheld off the listing ─────
//
// Pine's own definition (v4 reference manual, `obv`): `cum(sign(change(close)) *
// volume)`. A bar adds its volume when the close rose, subtracts it when the close
// fell, adds 0 when the close is unchanged; bar 0 has no change, so its term is
// `na` and `cum`'s measured na rule applies. The host lane now writes exactly that
// tree for `ta.obv` / v4 `obv` (`pine.js::obvLevelTree`).
//
// ⛔ It is a running total from the symbol's FIRST bar. On a series that starts at
// the listing it is TradingView's number; off the listing it is TradingView's minus
// a constant nobody here knows, which never decays — so `interpret.js::
// cumulativeLevelMask` withholds every bar of a tree that reads it, by name
// (`cum:window`), in both lanes.
//
// ⭐ GRADED against TradingView's own text: multicator-table prints
// `str.tostring(ta.obv, format.volume)` in a table cell (H5 recorded both):
//   NYSE:RDDT 1D, 636 bars FROM THE LISTING  → "-29.984M"
//   AMEX:SPY  1D, 1,800 bars from 2019-08-06 → "10.801B"  (not reachable here)
import { describe, it, expect, vi, afterEach } from 'vitest'
import path from 'node:path'

import { loadCapture, HARNESS_DIR } from './harness'
import { runOurSide } from './ourSide'
import { sha256Hex, sealCapture } from '../../../../../../../tools/vendor_harness/schema.mjs'
import { translatePine } from '../../ast/pine'
import { interpret, cumulativeLevelMask, isObvLevelNode, CHART_CLOCK_WITHHELD, CHART_CLOCK_WHOLE } from '../../ast/interpret'
import { parseFormula } from '../../ast/parse'
import { volumeNumberText } from '../../pineTextFormat'

afterEach(() => { vi.unstubAllEnvs() })
const cap = (sym) => loadCapture(path.join(HARNESS_DIR, `multicator-table-${sym}-1d-2026-10-02.json`)).capture

function door(capture, text, history) {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '')
  return runOurSide(sealCapture({ ...capture, source: { ...capture.source, text, sha256: sha256Hex(text) },
    ...(history ? { history: { ...capture.history, ...history } } : {}) }))
}
const PLOT = ['//@version=5', 'indicator("UCTPROBE H6 obv", overlay = false)', 'plot(ta.obv, "OBV")', ''].join('\n')
const CELL = ['//@version=6', "indicator('Multicator Table', overlay = true)", 'v0 = ta.obv',
  'var table t = table.new(position.top_right, 1, 1)', 'if barstate.islast',
  '    table.cell(t, 0, 0, str.tostring(v0, format.volume))', ''].join('\n')
const last = (col) => { for (let i = col.length - 1; i >= 0; i--) if (Number.isFinite(col[i])) return col[i]; return NaN }

describe('⭐ H6 — `ta.obv` is Pine\'s definition, on the host lane only', () => {
  it('the host lane writes `cum(sign(change(close)) * volume)` for v5 `ta.obv` and v4 bare `obv`', () => {
    for (const src of ['//@version=5\nindicator("x")\nplot(ta.obv)\n', '//@version=4\nstudy("x")\nplot(obv)\n']) {
      const t = translatePine(src, { strict: true })
      expect(t.refusal, src).toBeFalsy()
      expect(t.outputs[0].formula).toBe('cum(sign(change(close)) * volume)')
      expect(isObvLevelNode(t.outputs[0].ast)).toBe(true)
    }
  })

  it('⛔ a SCREEN keeps the table\'s `obv` ruling (the level is not comparable across fetches)', () => {
    const t = translatePine('//@version=5\nindicator("x")\nplot(ta.obv)\n', { strict: false })
    expect(t.refusal && t.refusal.message).toMatch(/CUMULATIVE FROM THE FIRST BAR/)
  })

  it('a member\'s own `obv` binding wins over the built-in (v4 bare name)', () => {
    const t = translatePine('//@version=4\nstudy("x")\nobv = close * 2\nplot(obv)\n', { strict: true })
    expect(t.outputs[0].formula).toBe('close * 2')
  })

  it('the bounded forms are untouched: `obv - obv[3]` is still `obvN(3)`', () => {
    const t = translatePine('//@version=5\nindicator("x")\nplot(ta.obv - ta.obv[3])\n', { strict: true })
    expect(t.outputs[0].formula).toBe('obvN(3)')
  })

  it('Pine semantics on hand-made bars: up adds, down subtracts, an EQUAL close adds 0, bar 0 is na', () => {
    const bars = [[10, 100], [11, 200], [11, 300], [9, 400], [9, 50], [12, 7]].map(([c, v], i) =>
      ({ t: `2025-01-${String(i + 6).padStart(2, '0')}`, o: c, h: c, l: c, c, v }))
    const ast = parseFormula('cum(sign(change(close)) * volume)').ast
    const col = Array.from(interpret(ast, bars, {}, undefined, undefined, { tf: 'D' }))
    expect(Number.isNaN(col[0])).toBe(true)
    expect(col.slice(1)).toEqual([200, 200, -200, -200, -193])
  })
})

describe('⭐ H6 — graded: RDDT from the listing prints TradingView\'s text', () => {
  it('vendor: RDDT starts at the listing and its table holds "-29.984M"', () => {
    expect(cap('rddt').history.startsAtBar0).toBe(true)
    expect(cap('rddt').objects.texts.tableCells).toContain('-29.984M')
  })

  it('⭐ door, plot lane: the level on the capture\'s own 636 bars, last bar −29,983,517, bar 0 na', () => {
    const ours = door(cap('rddt'), PLOT)
    expect(ours.ok, ours.refusal).toBe(true)
    const col = ours.plots[0].column
    expect(ours.plots[0].missingReason).toBeNull()
    expect(col.length).toBe(636)
    expect(Number.isNaN(col[0])).toBe(true)
    expect(last(col)).toBe(-29983517)
    expect(volumeNumberText(last(col))).toBe('-29.984M')
  })

  it('⭐ door, object lane: the cell prints TradingView\'s text', () => {
    const ours = door(cap('rddt'), CELL)
    expect(ours.ok, ours.refusal).toBe(true)
    expect(ours.objects.texts.tableCells).toEqual(['-29.984M'])
  })
})

describe('⛔ H6 — off the listing the level is withheld, by name, in both lanes', () => {
  it('vendor: SPY does NOT start at the listing (TradingView summed bars we do not hold)', () => {
    expect(cap('spy').history && cap('spy').history.startsAtBar0).not.toBe(true)
    expect(cap('spy').objects.texts.tableCells).toContain('10.801B')
  })

  it('⭐ door, plot lane: every bar withheld, named `cum:window`', () => {
    const ours = door(cap('spy'), PLOT)
    expect(ours.ok, ours.refusal).toBe(true)
    expect(ours.plots[0].missingReason).toMatch(/cum:window/)
    expect(ours.notes.join('\n')).toMatch(/cum:window/)
  })

  it('⭐ door, object lane: the OBV cell is not drawn (and the chart says why)', () => {
    const ours = door(cap('spy'), CELL)
    expect(ours.ok, ours.refusal).toBe(true)
    expect(ours.objects.texts.tableCells).toEqual([])
    expect(JSON.stringify(ours.objects.chartClock || [])).toMatch(/cum:window/)
  })

  it('⛔ CONTROL: told (falsely) that SPY starts at the listing, the door draws a number that is NOT TradingView\'s', () => {
    const ours = door(cap('spy'), PLOT, { startsAtBar0: true })
    const v = last(ours.plots[0].column)
    expect(Number.isFinite(v)).toBe(true)
    expect(volumeNumberText(v)).not.toBe('10.801B')
  })

  it('the mask: only Pine documents, only off the listing, only a tree that reads the level', () => {
    const bars = [{ t: '2025-01-06', o: 1, h: 1, l: 1, c: 1, v: 1 }, { t: '2025-01-07', o: 2, h: 2, l: 2, c: 2, v: 1 }]
    const obv = parseFormula('ema(cum(sign(change(close)) * volume), 5)').ast
    const swapped = parseFormula('cum(volume * sign(change(close)))').ast
    const plainCum = parseFormula('cum(close)').ast
    const off = { barIndexAbsolute: true }
    expect(Array.from(cumulativeLevelMask(obv, bars, {}, undefined, undefined, off))).toEqual([1, 1])
    expect(Array.from(cumulativeLevelMask(swapped, bars, {}, undefined, undefined, off))).toEqual([1, 1])
    expect(cumulativeLevelMask(obv, bars, {}, undefined, undefined, { ...off, historyFromListing: true })).toBeNull()
    expect(cumulativeLevelMask(obv, bars, {}, undefined, undefined, {})).toBeNull()
    expect(cumulativeLevelMask(plainCum, bars, {}, undefined, undefined, off)).toBeNull()
    expect(CHART_CLOCK_WHOLE).toContain('cum:window')
    expect(CHART_CLOCK_WITHHELD['cum:window']('D')).toMatch(/withheld/)
    expect(CHART_CLOCK_WITHHELD['cum:window']('D')).toMatch(/What would settle it/)
  })
})
