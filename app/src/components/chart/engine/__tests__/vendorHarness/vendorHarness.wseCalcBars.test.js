// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.wseCalcBars.test.js
//
// ─── ⭐⭐ PHASE 3 WS-E — `calc_bars_count` AND `offset`, GRADED BY TRADINGVIEW ────
//
// `wyckoff-accumulation-distribution` declares `calc_bars_count = 1000`, paints its
// bars (`barcolor(…, offset = -2)`), draws boxes from its run, and marks eight
// plotshapes at `offset = offsetVal` (`offsetVal = -pivotLen`, an input at 5).
// Two captures, one on each side of the window:
//   · RDDT 1D (636 bars, under 1,000): the run takes every bar, as before;
//   · SPY 1D (1,800 bars): TradingView calculates the LAST 1,000 only.
// Before WS-E the SPY capture DIVERGED (the barcolor; its boxes withheld by name;
// the eight plotshapes withheld for their `offset`) and the plotshapes, once
// carried, drew marks on bars 10..824 where TradingView draws none. With the
// window (`runtime/calcBarsWindow.js`) and the carried displacement
// (`memberPaneDefinition::runtimeRowShift`) BOTH captures read MATCH on every item.
// This is the harness's own grade, the verdict a member's chart would get, taken
// with the runtime pane on (it is dark in production).
import { describe, it, expect, vi, afterEach } from 'vitest'
import path from 'node:path'

import { loadCapture, gradeCapture } from './harness'

const HARNESS = path.join(path.resolve(process.cwd(), '..'), 'tests', 'fixtures', 'vendor', 'harness')

afterEach(() => { vi.unstubAllEnvs() })

function graded(file) {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
  const loaded = loadCapture(path.join(HARNESS, file))
  if (!loaded.capture) throw new Error(loaded.reason)
  return { capture: loaded.capture, v: gradeCapture(loaded.capture).verdict }
}
const SHAPES = ['The Selling Climax', 'Automatic Rally', 'the Secondary Test', 'The Buying Climax',
  'Automatic Reaction', 'The Secondary Test', 'pivotHigh', 'pivotLow']

describe('WS-E — wyckoff, graded on both sides of its `calc_bars_count`', () => {
  it('⭐⭐ SPY 1D (1,800 bars, window 1,000): plotshapes, barcolor and boxes all MATCH', () => {
    const { capture, v } = graded('wyckoff-accumulation-distribution-spy-1d-2026-10-02.json')
    expect(capture.bars.rows.length).toBeGreaterThan(1000) // non-vacuity: the window is taken
    expect(v.verdict, v.reason).toBe('MATCH')
    expect(v.plots.map((p) => p.title).sort()).toEqual([...SHAPES].sort())
    for (const p of v.plots) expect(p.verdict, `${p.title}: ${p.reason}`).toBe('MATCH')
    expect(v.paints.rows).toEqual([{ id: 'plot_0', kind: 'barcolor', state: 'agree' }])
    expect(v.objects.verdict, v.objects.reason).toBe('MATCH')
  })

  it('⛔ CONTROL — RDDT 1D (under the window): the same script, the whole history, MATCH', () => {
    const { capture, v } = graded('wyckoff-accumulation-distribution-rddt-1d-2026-10-02.json')
    expect(capture.bars.rows.length).toBeLessThan(1000)
    expect(v.verdict, v.reason).toBe('MATCH')
    for (const p of v.plots) expect(p.verdict, `${p.title}: ${p.reason}`).toBe('MATCH')
  })
})
