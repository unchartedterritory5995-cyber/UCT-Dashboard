// app/src/components/chart/engine/__tests__/calcFramesPlan.test.js
//
// ─── WHICH FRAMES A CHART FETCHES — measured defects, pinned (2026-09-28) ─────
//
// Both cases below were found in the browser, not by reasoning:
//   · a "Daily only" weekly average fetched its weekly frame on every 5m chart;
//   · the first render after a timeframe switch sized windows from the PREVIOUS
//     timeframe's bars (a 2,500-bar daily window on a 5m chart), which the chart's
//     abortable fetcher then cancelled.

import { describe, it, expect } from 'vitest'
import * as registry from '../nativeRegistry'
import { framesNeeded, chartBarsMatchTf, frameDepthFor } from '../useCalcFrames'
import { engineChips, paneReadoutLabel } from '../readout'

const defOf = (id) => registry.getDefinition(id)

describe('framesNeeded — only what is DRAWN here, and what that reads', () => {
  const wk = { instanceId: 'w', defId: 'movingAverage', inputs: { source: 'close' }, calculationTimeframe: 'W', visibility: { preset: 'custom', tfs: ['D'] } }
  const d1 = { instanceId: 'a', defId: 'movingAverage', inputs: { source: 'close' }, calculationTimeframe: 'D' }
  const d2 = { instanceId: 'b', defId: 'rsi', inputs: {}, calculationTimeframe: 'D' }
  it('a timeframe-hidden instance fetches nothing; four Daily consumers share ONE window', () => {
    expect(framesNeeded([wk, d1, d2], defOf, 'AAPL', '5')).toEqual([{ frame: 'D', symbol: 'AAPL' }])
  })
  it('…but a hidden SOURCE is fetched when something visible reads it', () => {
    const hiddenRsi = { ...d2, visibility: { preset: 'custom', tfs: ['D'] } }
    const ma = { instanceId: 'm', defId: 'movingAverage', inputs: { source: '@b::rsi' } }
    expect(framesNeeded([hiddenRsi, ma], defOf, 'AAPL', '5')).toEqual([{ frame: 'D', symbol: 'AAPL' }])
  })
  it('a member-hidden instance with no visible reader fetches nothing', () => {
    expect(framesNeeded([{ ...d1, hidden: true }], defOf, 'AAPL', '5')).toEqual([])
  })
  it('another symbol at a frame is requested too', () => {
    const q = { instanceId: 'q', defId: 'movingAverage', inputs: { source: 'sym:QQQ:close' }, calculationTimeframe: 'D' }
    expect(framesNeeded([q], defOf, 'AAPL', '5')).toEqual([{ frame: 'D', symbol: 'AAPL' }, { frame: 'D', symbol: 'QQQ' }])
  })
  it('a chart-frame or gated instance needs no frame', () => {
    expect(framesNeeded([d1], defOf, 'AAPL', 'D')).toEqual([])
    expect(framesNeeded([d1], defOf, 'AAPL', 'W')).toEqual([])
  })
})

describe('chartBarsMatchTf — never plan from the previous timeframe\'s bars', () => {
  it('dated bars belong to D/W/M, unix bars to intraday', () => {
    expect(chartBarsMatchTf([{ t: '2026-09-28' }], 'D')).toBe(true)
    expect(chartBarsMatchTf([{ t: '2026-09-28' }], '5')).toBe(false)
    expect(chartBarsMatchTf([{ t: 1790034300 }], '5')).toBe(true)
    expect(chartBarsMatchTf([{ t: 1790034300 }], 'W')).toBe(false)
    expect(chartBarsMatchTf([], 'D')).toBe(false)
  })
  it('window depths come from a LADDER, so a growing chart keeps one URL', () => {
    const days = Array.from({ length: 30 }, (_, i) => ({ t: 1790000000 + i * 86400 }))
    expect(frameDepthFor('D', days)).toBe(600)
    expect(frameDepthFor('D', days.slice(0, 20))).toBe(600)
  })
})

describe('the chip says when a series is calculated on another timeframe', () => {
  const series = {}
  const inst = { instanceId: 'm', defId: 'movingAverage', inputs: { source: 'close', period: 200, maType: 'sma', color: '#fff' } }
  it('`SMA 200 · 1D` for a framed binding; unchanged for a chart-frame one', () => {
    const framed = engineChips([{ defId: 'movingAverage', plotKey: 'ma', series, lastValue: 1, instanceId: 'm', frame: 'D' }], null, registry, [inst])
    expect(framed[0].label).toBe('SMA 200 · 1D')
    const plain = engineChips([{ defId: 'movingAverage', plotKey: 'ma', series, lastValue: 1, instanceId: 'm' }], null, registry, [inst])
    expect(plain[0].label).toBe('SMA 200')
    expect(plain[0]).not.toHaveProperty('frameSuffix')
  })
  it('the long pane name carries it too', () => {
    const rsi = { instanceId: 'r', defId: 'rsi', inputs: { period: 14 } }
    const [chip] = engineChips([{ defId: 'rsi', plotKey: 'rsi', series, lastValue: 50, instanceId: 'r', frame: '60' }], null, registry, [rsi])
    expect(paneReadoutLabel(chip, defOf('rsi'))).toBe('Relative Strength Index · 1h')
  })
})
