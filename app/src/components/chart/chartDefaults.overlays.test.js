import { describe, it, expect } from 'vitest'
import { mergeChartSettings, CHART_DEFAULTS } from './chartDefaults'

// The overlays array merges POSITIONALLY, so slot ORDER is a compatibility contract.
// These pin it: a pre-existing 4-slot blob must keep every one of its overlays in
// place AND gain the appended 5th, never shift.
describe('mergeChartSettings — overlays slot stability', () => {
  const legacy = JSON.stringify({
    overlays: [
      { enabled: true, type: 'EMA', period: 9,   color: '#111111' },
      { enabled: true, type: 'EMA', period: 20,  color: '#222222' },
      { enabled: true, type: 'SMA', period: 50,  color: '#333333' },
      { enabled: false, type: 'SMA', period: 200, color: '#444444' },
    ],
  })

  it('keeps a 4-slot blob in its original slots', () => {
    const ov = mergeChartSettings(legacy).overlays
    expect(ov[0]).toMatchObject({ type: 'EMA', period: 9,   color: '#111111' })
    expect(ov[1]).toMatchObject({ type: 'EMA', period: 20,  color: '#222222' })
    expect(ov[2]).toMatchObject({ type: 'SMA', period: 50,  color: '#333333' })
    expect(ov[3]).toMatchObject({ type: 'SMA', period: 200, color: '#444444', enabled: false })
  })

  it('pads the appended slot instead of dropping it', () => {
    const ov = mergeChartSettings(legacy).overlays
    expect(ov).toHaveLength(CHART_DEFAULTS.overlays.length)
    expect(ov[4]).toMatchObject({ type: 'SMA', period: 5 })
  })

  it('backfills new per-overlay fields onto legacy entries', () => {
    const ov = mergeChartSettings(legacy).overlays
    expect(ov[0].lineWidth).toBe(1)
    expect(ov[0].lineStyle).toBe('solid')
  })

  it('never truncates a longer stored array', () => {
    const extra = JSON.stringify({ overlays: [...JSON.parse(legacy).overlays, {}, { type: 'EMA', period: 100 }] })
    const ov = mergeChartSettings(extra).overlays
    expect(ov.length).toBeGreaterThanOrEqual(6)
    expect(ov[5]).toMatchObject({ type: 'EMA', period: 100 })
  })

  it('carries the new volume fields', () => {
    const v = mergeChartSettings(JSON.stringify({ volume: { visible: true } })).volume
    expect(v.labelVisible).toBe(true)
    expect(v.maPeriod).toBe(50)
  })
})
