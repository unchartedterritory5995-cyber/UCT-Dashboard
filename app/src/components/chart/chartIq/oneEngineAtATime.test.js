// ONE pattern engine draws at a time (owner, 2026-11-01): while Chart IQ draws a daily chart, Auto Structures' PatternOverlay is
// not mounted, so two engines never draw over each other on one chart. StockChart has no render harness for this, so the rail
// reads the source the way singleWriterIndex.test.js does: every <PatternOverlay mount must sit under a `!chartIqActive` guard.
import { describe, it, expect } from 'vitest'
import src from '../../StockChart.jsx?raw'

describe('one pattern engine at a time', () => {
  it('every PatternOverlay mount is guarded by !chartIqActive', () => {
    const mounts = [...src.matchAll(/<PatternOverlay\b/g)].map((m) => m.index)
    expect(mounts.length).toBeGreaterThan(0)
    for (const at of mounts) {
      const guard = src.slice(Math.max(0, at - 160), at)
      expect(guard).toMatch(/\{[^{}]*!chartIqActive[^{}]*&&\s*\(\s*$/)
    }
  })

  it('the UCT Intelligence panel (same top-right spot) steps aside too', () => {
    const at = src.indexOf('<UctIntelligencePanel')
    expect(at).toBeGreaterThan(0)
    expect(src.slice(Math.max(0, at - 160), at)).toMatch(/\{[^{}]*!chartIqActive[^{}]*&&\s*\(\s*$/)
  })

  it('chartIqActive means Chart IQ is on, allowed and on the daily timeframe', () => {
    expect(src).toMatch(/const chartIqActive = chartIqOn && resolvedTf === 'D'/)
    expect(src).toMatch(/const chartIqOn = showChartIq && chartIqAllowed && !disablePatterns/)
  })
})

describe('Chart IQ on a non-daily chart', () => {
  it('mounts the not-daily notice (with the timeframe switch) when Chart IQ is on and the chart is not 1D', () => {
    expect(src).toMatch(/\{chartIqOn && resolvedTf !== 'D' && bars\?\.length > 0 && \(\s*<ChartIqPanel\s+notDaily/)
    expect(src).toMatch(/onShowDaily=\{typeof onTfChange === 'function' \? \(\) => onTfChange\('D'\) : null\}/)
  })
})
