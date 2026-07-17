import { describe, it, expect } from 'vitest'
import { mergeChartSettings, mergeSettingsOverride, CHART_DEFAULTS } from './chartDefaults'

describe('mergeSettingsOverride', () => {
  const base = mergeChartSettings({ chartType: 'hollow', candles: { upColor: '#111111' } })

  it('null/absent override returns the base unchanged (same reference)', () => {
    expect(mergeSettingsOverride(base, null)).toBe(base)
    expect(mergeSettingsOverride(base, undefined)).toBe(base)
  })

  it('primitive keys replace; untouched keys keep the base value', () => {
    const out = mergeSettingsOverride(base, { chartType: 'line' })
    expect(out.chartType).toBe('line')
    expect(out.candles.upColor).toBe('#111111')
    expect(base.chartType).toBe('hollow')   // base not mutated
  })

  it('section objects merge one level instead of replacing wholesale', () => {
    const out = mergeSettingsOverride(base, { candles: { downColor: '#222222' } })
    expect(out.candles.downColor).toBe('#222222')
    expect(out.candles.upColor).toBe('#111111')   // preserved from base
  })

  it('watermark.lines merges two levels', () => {
    const out = mergeSettingsOverride(base, { watermark: { lines: { symbol: false } } })
    expect(out.watermark.lines.symbol).toBe(false)
    expect(out.watermark.enabled).toBe(base.watermark.enabled)
  })

  it('per-indicator override merges without dropping sibling indicators', () => {
    const out = mergeSettingsOverride(base, { indicators: { rsi: { enabled: true } } })
    expect(out.indicators.rsi.enabled).toBe(true)
    expect(out.indicators.macd).toEqual(base.indicators.macd)
  })

  it('arrays replace wholesale', () => {
    const out = mergeSettingsOverride(base, { comparisonSymbols: ['QQQ'] })
    expect(out.comparisonSymbols).toEqual(['QQQ'])
  })

  it('precedence: defaults < global < override', () => {
    const out = mergeSettingsOverride(mergeChartSettings(null), { chartType: 'area' })
    expect(out.chartType).toBe('area')
    expect(out.background).toBe(CHART_DEFAULTS.background)
  })

  // DRIFT GUARD: mergeSettingsOverride keeps its own list of section keys that
  // must merge one level instead of replacing wholesale. If a new object-valued
  // section is added to CHART_DEFAULTS (the historical pattern: swingLabels,
  // markers, positionCalc all arrived over time) but not to that list, a
  // section override would silently DROP the user's sibling sub-settings. This
  // walks every object section generically so the lists can never drift apart.
  it('every object-valued CHART_DEFAULTS section merges one level, never replaces', () => {
    const full = mergeChartSettings(null)
    for (const [key, val] of Object.entries(CHART_DEFAULTS)) {
      if (!val || typeof val !== 'object' || Array.isArray(val)) continue
      const subKeys = Object.keys(val)
      if (subKeys.length < 2) continue   // need a sibling to prove merging
      const [first, ...siblings] = subKeys
      const out = mergeSettingsOverride(full, { [key]: { [first]: full[key][first] } })
      for (const sk of siblings) {
        expect(out[key][sk], `${key}.${sk} dropped — add '${key}' to the override section list`).toEqual(full[key][sk])
      }
    }
  })
})
