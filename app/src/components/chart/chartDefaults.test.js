import { describe, it, expect } from 'vitest'
import { mergeChartSettings, CHART_DEFAULTS } from './chartDefaults'

describe('watermark settings', () => {
  it('default watermark has lines/color/sizeScale/x/y', () => {
    expect(CHART_DEFAULTS.watermark).toEqual({
      visible: true, opacity: 0.07, color: '#a8a290', sizeScale: 1.0,
      lines: { ticker: true, company: true, sector: true, industry: true, theme: true },
      x: 0.5, y: 0.5,
    })
  })

  it('merges partial user watermark over defaults (back-compat with {visible,opacity}-only)', () => {
    const cs = mergeChartSettings(JSON.stringify({ watermark: { visible: false, opacity: 0.12 } }))
    expect(cs.watermark.visible).toBe(false)
    expect(cs.watermark.opacity).toBe(0.12)
    expect(cs.watermark.color).toBe('#a8a290')
    expect(cs.watermark.lines).toEqual({ ticker: true, company: true, sector: true, industry: true, theme: true })
    expect(cs.watermark.x).toBe(0.5)
  })

  it('deep-merges partial lines (user disables only ticker)', () => {
    const cs = mergeChartSettings(JSON.stringify({ watermark: { lines: { ticker: false } } }))
    expect(cs.watermark.lines).toEqual({ ticker: false, company: true, sector: true, industry: true, theme: true })
  })
})

describe('header per-item color overrides', () => {
  it('defaults to no overrides (every item keeps its built-in color)', () => {
    expect(CHART_DEFAULTS.header.colors).toEqual({})
    const cs = mergeChartSettings(JSON.stringify({}))
    expect(cs.header.colors).toEqual({})
  })

  it('preserves a stored override while keeping the show toggles', () => {
    const cs = mergeChartSettings(JSON.stringify({ header: { colors: { marketCap: '#ff0000' } } }))
    expect(cs.header.colors.marketCap).toBe('#ff0000')
    expect(cs.header.showMarketCap).toBe(true)   // untouched sibling
  })

  it('a partial colors blob does NOT wipe unset keys (the mergeChartSettings wholesale-replace trap)', () => {
    // header is spread as one object, so without the dedicated colors deep-merge a
    // stored {marketCap} would drop the rest — this pins that it stays a real merge.
    const cs = mergeChartSettings(JSON.stringify({
      header: { colors: { marketCap: '#111111', legend: '#222222' } },
    }))
    expect(cs.header.colors).toEqual({ marketCap: '#111111', legend: '#222222' })
    // and the other header fields survive the colors-only save
    expect(cs.header.timeframes).toEqual(CHART_DEFAULTS.header.timeframes)
    expect(cs.header.showLegend).toBe(true)
  })
})
