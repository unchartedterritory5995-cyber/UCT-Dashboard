import { describe, it, expect } from 'vitest'
import { mergeChartSettings, CHART_DEFAULTS } from './chartDefaults'

// The overlays array merges POSITIONALLY, so slot ORDER is a compatibility contract.
// These pin it: a pre-existing 4-slot blob keeps every overlay in place, and a shorter
// blob pads UP to the default count (now 4 — the terminal SMA5 was removed 2026-08-27).
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

  it('pads a short legacy blob up to the default overlay count', () => {
    const short = JSON.stringify({ overlays: [
      { enabled: true, type: 'EMA', period: 9,  color: '#111111' },
      { enabled: true, type: 'EMA', period: 20, color: '#222222' },
    ] })
    const ov = mergeChartSettings(short).overlays
    expect(ov).toHaveLength(CHART_DEFAULTS.overlays.length)   // 4
    expect(ov[2]).toMatchObject({ type: 'SMA', period: 50 })   // padded from CHART_DEFAULTS
    expect(ov[3]).toMatchObject({ type: 'SMA', period: 200 })
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
    // ⭐⭐ ZERO SINCE 2026-09-16, DELIBERATELY (owner §16). A default of 50 drew a
    // volume moving average, and printed a reading for it, on every chart in the
    // product without anybody choosing either. The member-facing way to have one
    // is to add a Moving Average sourced from Volume, like any other indicator.
    expect(v.maPeriod, 'a volume MA is back by default — §16 says a member adds it').toBe(0)
    // ⛔ …AND A STORED CHOICE IS UNTOUCHED, which is the other half of the rule
    // (§51: remove the default, never the configuration). Every chart saved
    // through the settings modal carries this key, so this is the case that says
    // those members keep their line.
    const mine = mergeChartSettings(JSON.stringify({ volume: { maPeriod: 50 } })).volume
    expect(mine.maPeriod, 'the merge overwrote a member’s own volume MA period').toBe(50)
  })
})
