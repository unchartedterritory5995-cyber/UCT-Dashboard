import { describe, it, expect } from 'vitest'
import { mergeChartSettings, CHART_DEFAULTS } from './chartDefaults'
import {
  CHART_SETTING_DESCRIPTORS, ELIGIBLE_SETTINGS, classifySettingPath, coerceSettingValue,
  settingUnavailable, withSetting, settingValue,
} from './chartSettingsDescriptors'

// Every leaf path of a settings blob: plain objects are walked, arrays and scalars are leaves.
function leafPaths(o, prefix = '') {
  const out = []
  for (const [k, v] of Object.entries(o || {})) {
    const p = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length) out.push(...leafPaths(v, p))
    else out.push(p)
  }
  return out
}
const AGENT = /^(eligible|known|internal|specialized:[a-z]+\.[a-zA-Z]+|owned:[a-z]+)$/

describe('chart settings descriptors — the completeness rail', () => {
  it('🔴 every key the settings allow-list keeps is CLASSIFIED (a new setting fails here until it has a row)', () => {
    const paths = [...new Set([...leafPaths(mergeChartSettings({})), ...leafPaths(CHART_DEFAULTS)])]
    const missing = paths.filter(p => !classifySettingPath(p))
    expect(missing, `Classify these in chartSettingsDescriptors.js: ${missing.join(', ')}`).toEqual([])
  })

  it('every row is well-formed, ids are unique, and the agent field is one of the known classes', () => {
    const ids = CHART_SETTING_DESCRIPTORS.map(d => d.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const d of CHART_SETTING_DESCRIPTORS) expect(d.agent, d.id).toMatch(AGENT)
    for (const d of ELIGIBLE_SETTINGS) {
      expect(d.label && d.section && d.ui, d.id).toBeTruthy()
      expect(['bool', 'enum'], d.id).toContain(d.type)
      if (d.type === 'enum') expect(d.options.length, d.id).toBeGreaterThan(1)
    }
  })

  it('a row never points at a key the allow-list would DROP (an eligible write must survive a reload)', () => {
    for (const d of ELIGIBLE_SETTINGS) {
      const cur = settingValue(mergeChartSettings({}), d)
      const want = d.type === 'bool' ? !cur : d.options.find(o => o !== cur)
      const base = d.requires?.chartType ? { ...mergeChartSettings({}), chartType: d.requires.chartType[0] } : mergeChartSettings({})
      const written = withSetting(base, d, want)
      expect(settingValue(mergeChartSettings(written), d), d.id).toEqual(want)
    }
  })
})

describe('chart settings descriptors — UI-equivalent writes', () => {
  const cs = mergeChartSettings({})
  it('the write is the same shape Chart Settings\' own setters produce (section spread, leaf set, preset custom)', () => {
    // ChartSettingsModal: setGridVisible(v) = setSetting({ grid: { ...grid, visible: v } })
    const grid = ELIGIBLE_SETTINGS.find(d => d.id === 'grid.visible')
    expect(withSetting(cs, grid, false)).toEqual({ ...cs, grid: { ...cs.grid, visible: false }, preset: 'custom' })
    // setPrevDay('high', { enabled }) = { prevDayLevels: { ...pdl, high: { ...pdl.high, enabled } } }
    const pdl = ELIGIBLE_SETTINGS.find(d => d.id === 'prevDayLevels.high.enabled')
    expect(withSetting(cs, pdl, false)).toEqual({ ...cs, prevDayLevels: { ...cs.prevDayLevels, high: { ...cs.prevDayLevels.high, enabled: false } }, preset: 'custom' })
    // the crosshair control writes ONLY crosshair.mode
    const ch = ELIGIBLE_SETTINGS.find(d => d.id === 'crosshair.mode')
    expect(withSetting(cs, ch, 'off').crosshair).toEqual({ ...cs.crosshair, mode: 'off' })
  })

  it('values are typed and validated; mode controls accept on/off through their bool map', () => {
    const ch = ELIGIBLE_SETTINGS.find(d => d.id === 'crosshair.mode')
    expect(coerceSettingValue(ch, false)).toEqual({ ok: true, value: 'off' })
    expect(coerceSettingValue(ch, 'hold')).toEqual({ ok: true, value: 'hold' })
    expect(coerceSettingValue(ch, 'sideways').ok).toBe(false)
    const ts = ELIGIBLE_SETTINGS.find(d => d.id === 'textSize')
    expect(coerceSettingValue(ts, '14')).toEqual({ ok: true, value: 14 })
    expect(coerceSettingValue(ts, 13).ok).toBe(false)
    expect(coerceSettingValue(CHART_SETTING_DESCRIPTORS.find(d => d.id === 'watermark.opacity'), 0.5).ok).toBe(false)
  })

  it('the UI prerequisite holds: thin bars only on Bars/HLC charts', () => {
    const thin = ELIGIBLE_SETTINGS.find(d => d.id === 'candles.thinBars')
    expect(settingUnavailable(thin, { chartType: 'candles' })).toMatch(/Bars and HLC/)
    expect(settingUnavailable(thin, { chartType: 'bars' })).toBe(null)
  })
})
