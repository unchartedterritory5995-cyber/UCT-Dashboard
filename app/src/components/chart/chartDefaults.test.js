import { describe, it, expect } from 'vitest'
import { mergeChartSettings, CHART_DEFAULTS } from './chartDefaults'

describe('watermark settings', () => {
  it('default watermark has lines/color/sizeScale/x/y', () => {
    expect(CHART_DEFAULTS.watermark).toEqual({
      visible: true, opacity: 0.07, color: '#a8a290', sizeScale: 1.0,
      lines: { ticker: true, company: true, sector: true, industry: false },
      x: 0.5, y: 0.5,
    })
  })

  it('merges partial user watermark over defaults (back-compat with {visible,opacity}-only)', () => {
    const cs = mergeChartSettings(JSON.stringify({ watermark: { visible: false, opacity: 0.12 } }))
    expect(cs.watermark.visible).toBe(false)
    expect(cs.watermark.opacity).toBe(0.12)
    expect(cs.watermark.color).toBe('#a8a290')
    expect(cs.watermark.lines).toEqual({ ticker: true, company: true, sector: true, industry: false })
    expect(cs.watermark.x).toBe(0.5)
  })

  it('deep-merges partial lines (user disables only ticker)', () => {
    const cs = mergeChartSettings(JSON.stringify({ watermark: { lines: { ticker: false } } }))
    expect(cs.watermark.lines).toEqual({ ticker: false, company: true, sector: true, industry: false })
  })
})
