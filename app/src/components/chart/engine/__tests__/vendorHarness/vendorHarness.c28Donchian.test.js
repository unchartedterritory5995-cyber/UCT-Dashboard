// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.c28Donchian.test.js
//
// ─── C28b — donchian-channels' Basis colour, AGAINST TRADINGVIEW ─────────────
//
//     plot(basisInput ? basis : na, title = 'Basis', color = request.security(
//          syminfo.tickerid, timeframeInput, close > basis[1] ? color.new(#445b84, 50)
//          : close < basis[1] ? color.new(#844444, 50) : na), linewidth = 2)
//
// `timeframeInput` is `input.timeframe('')` — the chart's own timeframe. The
// colour was never opened (a `request.security` call is not a colour this door
// read), so the member pane drew the Basis in its gold on every bar: 533 bars
// graded DIVERGE on colour, first at bar 99 (TradingView draws nothing there —
// `basis[1]` is `na`). ⭐ PINNED against the capture (NYSE:RDDT 1D, 632 bars):
// the Basis plot is MATCH — value AND colour on every bar the vendor reports.
import { describe, it, expect } from 'vitest'
import path from 'node:path'

import { loadCapture, gradeCapture } from './harness'

const DIR = path.resolve(process.cwd(), '..', 'tests/fixtures/vendor/harness')

describe('C28b — donchian-channels: the Basis wears TradingView\'s colour', () => {
  it('⭐ the Basis plot agrees on every compared bar, colour included', () => {
    const loaded = loadCapture(path.join(DIR, 'donchian-channels-rddt-1d-2026-09-28.json'))
    expect(loaded.capture).toBeTruthy()
    const { verdict } = gradeCapture(loaded.capture)
    const basis = verdict.plots.find((p) => p.title === 'Basis')
    expect(basis.verdict, basis.reason).toBe('MATCH')
    expect(basis.stats.steady.compared).toBeGreaterThan(500)
    // the colour was graded, not skipped: the plot carries a per-bar colour
    expect(JSON.stringify(basis)).not.toMatch(/no colour|could not be resolved/)
    expect(verdict.verdict).toBe('MATCH')
  })
})
