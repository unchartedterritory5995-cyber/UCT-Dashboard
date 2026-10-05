// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.w19h2VolumeIndex.test.js
//
// ─── W19-H2 — `ta.nvi` / `ta.pvi` on the host lane, withheld off the listing ────
//
// Pine's reference (`pine_nvi()`): seed 1.0; on a bar whose close and previous
// close are both non-zero, `nvi := volume < nz(volume[1]) ? prev + (close -
// close[1]) / close[1] * prev : prev` (`pvi`: `>`). The host lane writes that
// product as `exp(cum(step ? ln(close / close[1]) : 0))`
// (`interpret.js::volumeIndexLevelTree`), only on a pane (a screen keeps the
// table's `_functions_excluded.nvi` / `.pvi` ruling).
//
// ⭐ GRADED on TradingView's own capture: `vw-nvi-pvi-spy-1d-full-2026-09-27`,
// AMEX:SPY 1D with the FULL history loaded (8472 bars from 1993-01-29, the P00
// `bar_index` control reads 0 on the first bar). P01 / P02 (the levels) and P06 /
// P07 (the corpus quantity `x - ta.ema(x, 255)`) are this lane's numbers on every
// bar, inside the harness tolerance (1e-9 relative).
//
// ⛔ It is a PRODUCT from the symbol's first bar: off the listing it is
// TradingView's divided by a factor nothing here knows, which never decays — so
// `cumulativeLevelMask` withholds every bar of a tree that reads it, by name
// (`cum:volume-index`), in both lanes.
// ⚠️ `vw-nvi-pvi-spy-1d-truncated-2026-09-27` says `history.startsAtBar0: true`,
// and its own P00 control reads 7432 on its first bar: the flag is wrong (its
// `why` is RDDT's sentence, copied). The rail reads the CONTROL, and grades that
// capture as what it is — a chart that does not start at the listing.
import { describe, it, expect, vi, afterEach } from 'vitest'
import path from 'node:path'

import { loadCapture, VENDOR_DIR } from './harness'
import { runOurSide } from './ourSide'
import { translatePine } from '../../ast/pine'
import { interpret, volumeIndexKindOf, volumeIndexLevelTree, cumulativeLevelMask, CHART_CLOCK_WITHHELD, CHART_CLOCK_WHOLE } from '../../ast/interpret'
import { parseFormula } from '../../ast/parse'
import { valuesAgree, tolerancePolicy } from '../../../../../../../tools/vendor_harness/compare.mjs'

afterEach(() => { vi.unstubAllEnvs() })

const cap = (which) => loadCapture(path.join(VENDOR_DIR, `vw-nvi-pvi-spy-1d-${which}-2026-09-27.json`)).capture
const door = (capture) => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '')
  return runOurSide(capture)
}
const col = (capture, title) => {
  const k = capture.study.plots.findIndex((p) => p.title === title)
  const fi = capture.plotValues.fields.indexOf(capture.study.plots[k].id)
  return capture.plotValues.rows.map((r) => r[fi])
}
const ourPlot = (ours, title) => ours.plots.find((p) => p.title === title)

describe('⭐ W19-H2 — `ta.nvi` / `ta.pvi` are Pine\'s reference, on the host lane only', () => {
  it('the host lane writes the level tree for v5/v6 `ta.nvi` and `ta.pvi`, and it parses back to itself', () => {
    for (const kind of ['nvi', 'pvi']) {
      const t = translatePine(`//@version=6\nindicator("x")\nplot(ta.${kind})\n`, { strict: true })
      expect(t.refusal, kind).toBeFalsy()
      expect(volumeIndexKindOf(t.outputs[0].ast)).toBe(kind)
      expect(volumeIndexKindOf(parseFormula(t.outputs[0].formula).ast)).toBe(kind)
    }
    expect(translatePine('//@version=6\nindicator("x")\nplot(ta.nvi)\n', { strict: true }).outputs[0].formula)
      .toBe('exp(cum(nz(close[1], 0) != 0 && close != 0 && volume < nz(volume[1], 0) ? ln(close / close[1]) : 0))')
  })

  it('⛔ a SCREEN keeps the table\'s ruling (the level is not comparable across fetches)', () => {
    const t = translatePine('//@version=6\nindicator("x")\nplot(ta.nvi)\n', { strict: false })
    expect(t.refusal && t.refusal.message).toMatch(/ta\.nvi/)
  })

  it('⛔ v4 bare `nvi` is NOT served (only the v6 spelling was captured)', () => {
    const t = translatePine('//@version=4\nstudy("x")\nplot(nvi)\n', { strict: true })
    expect(t.refusal).toBeTruthy()
  })

  it('the recogniser is exact: the other index, or a changed step, is not this level', () => {
    expect(volumeIndexKindOf(volumeIndexLevelTree('pvi'))).toBe('pvi')
    const f = parseFormula('exp(cum(nz(close[1], 0) != 0 && close != 0 && volume <= nz(volume[1], 0) ? ln(close / close[1]) : 0))').ast
    expect(volumeIndexKindOf(f)).toBe(null)
  })

  it('Pine semantics on hand-made bars: seed 1, multiplies only on a volume drop (nvi) / rise (pvi)', () => {
    const rows = [[10, 100], [11, 50], [12, 60], [6, 10], [6, 5], [12, 7]]
    const bars = rows.map(([c, v], i) => ({ t: `2025-01-${String(i + 6).padStart(2, '0')}`, o: c, h: c, l: c, c, v }))
    const nvi = Array.from(interpret(volumeIndexLevelTree('nvi'), bars, {}, undefined, undefined, { tf: 'D' }))
    const pvi = Array.from(interpret(volumeIndexLevelTree('pvi'), bars, {}, undefined, undefined, { tf: 'D' }))
    // nvi: bar1 vol fell -> x1.1; bar2 rose -> hold; bar3 fell -> x0.5; bar4 fell -> x1; bar5 rose -> hold
    const near = (a, b) => a.forEach((x, i) => expect(x).toBeCloseTo(b[i], 12))
    near(nvi, [1, 1.1, 1.1, 0.55, 0.55, 0.55])
    near(pvi, [1, 1, 12 / 11, 12 / 11, 12 / 11, 24 / 11])
  })
})

describe('⭐ W19-H2 — graded: SPY 1D from the listing reproduces TradingView on every bar', () => {
  const full = cap('full')

  it('vendor: the full capture starts at the listing (P00 reads 0 on its first bar) and both levels seed at 1', () => {
    expect(full.history.startsAtBar0).toBe(true)
    expect(col(full, 'P00_bar_index_CONTROL')[0]).toBe(0)
    expect(col(full, 'P01_nvi_RAW')[0]).toBe(1)
    expect(col(full, 'P02_pvi_RAW')[0]).toBe(1)
  })

  it('⭐ door: P01, P02, P06, P07 agree with TradingView on all 8472 bars (harness tolerance)', () => {
    const ours = door(full)
    expect(ours.ok, ours.refusal).toBe(true)
    const tol = tolerancePolicy(full)
    for (const title of ['P01_nvi_RAW', 'P02_pvi_RAW', 'P06_corpus_nvi_minus_ema255', 'P07_corpus_pvi_minus_ema255']) {
      const p = ourPlot(ours, title)
      expect(p, title).toBeTruthy()
      expect(p.missingReason, title).toBeNull()
      const v = col(full, title)
      expect(p.column.length).toBe(v.length)
      let agree = 0
      let compared = 0
      for (let i = 0; i < v.length; i++) {
        if (v[i] === null && Number.isNaN(p.column[i])) continue
        compared += 1
        if (valuesAgree(p.column[i], v[i], tol)) agree += 1
      }
      expect(agree, title).toBe(compared)
      expect(compared, title).toBeGreaterThan(8000)
    }
  })
})

describe('⛔ W19-H2 — off the listing the level is withheld, by name, in both lanes', () => {
  const trunc = cap('truncated')
  const offListing = { ...trunc, history: { ...trunc.history, startsAtBar0: false } }

  it('vendor: the "truncated" capture is NOT from the listing — its own P00 control reads 7432 on its first bar', () => {
    expect(col(trunc, 'P00_bar_index_CONTROL')[0]).toBe(7432)
    // ...and TradingView's level there is the full history's, not 1.
    expect(col(trunc, 'P01_nvi_RAW')[0]).toBeGreaterThan(1000)
  })

  it('⭐ door: every bar of every level plot withheld, named `cum:volume-index`', () => {
    const ours = door(offListing)
    expect(ours.ok, ours.refusal).toBe(true)
    for (const title of ['P01_nvi_RAW', 'P02_pvi_RAW', 'P06_corpus_nvi_minus_ema255', 'P07_corpus_pvi_minus_ema255']) {
      const p = ourPlot(ours, title)
      expect(p.missingReason, title).toMatch(/cum:volume-index/)
    }
    expect(ours.notes.join('\n')).toMatch(/cum:volume-index/)
  })

  it('control: from ITS first bar the level is TradingView\'s divided by a constant that never decays', () => {
    // The truncated chart's own bars, run raw (no listing claim, no mask): 1 on its bar 0,
    // where TradingView reads the level the full history carried there.
    const bars = trunc.bars.rows.map(([t, o, h, l, c, v]) => ({ t: new Date(t * 1000).toISOString().slice(0, 10), o, h, l, c, v }))
    for (const [kind, title] of [['nvi', 'P01_nvi_RAW'], ['pvi', 'P02_pvi_RAW']]) {
      const raw = Array.from(interpret(volumeIndexLevelTree(kind), bars, {}, undefined, undefined, { tf: 'D' }))
      const v = col(trunc, title)
      expect(raw[0]).toBe(1)
      expect(v[0]).not.toBe(1)
      const first = v[0] / raw[0]
      const lastRatio = v[v.length - 1] / raw[raw.length - 1]
      expect(Math.abs(lastRatio / first - 1)).toBeLessThan(1e-9)
    }
  })

  it('the mask names the code, and the code has a sentence and is a whole-series withholding', () => {
    const opts = { barIndexAbsolute: true, tf: 'D' }
    const m = cumulativeLevelMask({ type: 'op', name: '-', args: [volumeIndexLevelTree('nvi'), { type: 'num', value: 1 }] }, [{}, {}], {}, undefined, undefined, opts)
    expect(Array.from(m)).toEqual([1, 1])
    expect(CHART_CLOCK_WHOLE).toContain('cum:volume-index')
    expect(CHART_CLOCK_WITHHELD['cum:volume-index']('D')).toMatch(/ta\.nvi/)
    expect(cumulativeLevelMask(volumeIndexLevelTree('pvi'), [{}], {}, undefined, undefined, { ...opts, historyFromListing: true })).toBe(null)
  })
})
