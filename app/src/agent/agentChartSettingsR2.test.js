// R2 (owner 11-16, "your best call"): the Chart Settings rows that were "Soon" are chart.setSetting options. Each is
// written exactly as the dialog writes it (the product's own reader / patch) and read back through the same reader.
import { describe, it, expect } from 'vitest'
import { registerBuiltins } from './builtins'
import { getCapability } from './capabilities'
import { mergeChartSettings } from '../components/chart/chartDefaults'
import { settingDescriptor, coerceSettingValue, settingValue, classifySettingPath } from '../components/chart/chartSettingsDescriptors'

registerBuiltins()
const cap = () => getCapability('chart.setSetting')
const R2 = ['candles.showBody', 'candles.showBorders', 'candles.showWick', 'candles.priceLine', 'candles.priceLineStyle', 'grid.lines',
  'scaleTime.rightMargin', 'scaleTime.priceDecimals', 'scaleTime.timeFormat', 'scaleTime.timeZone', 'sessionBreaks', 'preMarketLevels',
  'nextEarningsMarker', 'priceAlertLines', 'myTradeMarkers', 'header.statLabels']
const run = (cs, setting, value) => {
  const st = { cs, tf: '5' }
  const why = cap().check(st, { setting, value })
  if (why) return { why }
  return { cs: cap().apply(st, { setting, value }).cs }
}

describe('the promoted rows are eligible chart.setSetting options', () => {
  it('every R2 row is in the contract enum; Apply to all charts stays known (an action, not a stored key)', () => {
    const ids = cap().args.properties.setting.enum
    for (const id of R2) {
      expect(ids, id).toContain(id)
      expect(settingDescriptor(id).agent, id).toBe('eligible')
    }
    expect(ids).not.toContain('applyToAllCharts')
    expect(settingDescriptor('applyToAllCharts').agent).toBe('known')
    expect(settingDescriptor('extendedHoursShading').agent).toBe('specialized:chart.setSession')
  })
  it('the new values are named to the planner (hints or shape) and both stay under the manifest caps', () => {
    const c = cap()
    expect(c.hints.length).toBeLessThanOrEqual(1000)
    expect(c.shape.length).toBeLessThanOrEqual(600)
    expect(c.summary.length).toBeLessThanOrEqual(400)
    expect(c.hints).toMatch(/candles\.priceLineStyle: solid\|dashed\|dotted/)
    expect(c.shape).toMatch(/grid\.lines off\|horizontal\|vertical\|both/)
    expect(c.shape).toMatch(/timeZone exchange\|local\|utc\|/)
    expect(c.shape).toMatch(/header\.statLabels "stat=name"/)
  })
})

describe('written as the dialog writes it, read back through the product reader', () => {
  const base = () => mergeChartSettings({})
  it('on / off rows: a plain top-level boolean', () => {
    for (const id of ['sessionBreaks', 'preMarketLevels', 'nextEarningsMarker', 'priceAlertLines', 'myTradeMarkers']) {
      const { cs } = run(base(), id, 'on')
      expect(cs[id], id).toBe(true)
      expect(cs.preset).toBe('custom')
      expect(settingValue(mergeChartSettings(cs), settingDescriptor(id)), id).toBe(true)
    }
  })
  it('grid lines go through gridPatchFor: "off" is the visible master, "horizontal" keeps it on', () => {
    const off = run(base(), 'grid.lines', 'off').cs
    expect(off.grid.visible).toBe(false)
    const h = run(off, 'grid.lines', 'horizontal').cs
    expect(h.grid).toMatchObject({ visible: true, lines: 'horizontal' })
    expect(settingValue(h, settingDescriptor('grid.lines'))).toBe('horizontal')
  })
  it('scale & time go through scaleTimePatch: a default value removes the key, the rest are sanitised', () => {
    let cs = run(base(), 'scaleTime.priceDecimals', '2').cs
    expect(cs.scaleTime).toEqual({ priceDecimals: 2 })
    cs = run(cs, 'scaleTime.timeZone', 'tokyo').cs
    cs = run(cs, 'scaleTime.timeFormat', '24').cs
    cs = run(cs, 'scaleTime.rightMargin', 12).cs
    expect(cs.scaleTime).toEqual({ priceDecimals: 2, timeZone: 'tokyo', timeFormat: '24', rightMargin: 12 })
    cs = run(cs, 'scaleTime.priceDecimals', 'auto').cs
    cs = run(cs, 'scaleTime.timeZone', 'exchange').cs
    expect(cs.scaleTime).toEqual({ timeFormat: '24', rightMargin: 12 })
    expect(run(cs, 'scaleTime.rightMargin', 31).why).toMatch(/from 0 to 30/)
    expect(run(cs, 'scaleTime.timeZone', 'mars').why).toMatch(/can be exchange, local, utc/)
  })
  it('candle parts: only on Candles / Hollow and not on One Color — where the dialog shows the switches', () => {
    expect(run(base(), 'candles.showWick', false).cs.candles.showWick).toBe(false)
    expect(run({ ...base(), chartType: 'bars' }, 'candles.showWick', false).why).toMatch(/Candles and Hollow/)
    expect(run({ ...base(), candleColorMode: 'onecolor' }, 'candles.showBody', false).why).toMatch(/One Color/)
  })
  it('the last price line: its style needs the line on (the dialog hides the style while it is off)', () => {
    const cs = base()
    expect(settingValue(cs, settingDescriptor('candles.priceLine'))).toBe(false)   // /charts hides it until the member chooses
    expect(run(cs, 'candles.priceLineStyle', 'dotted').why).toMatch(/price line on first/)
    const on = run(cs, 'candles.priceLine', true).cs
    expect(run(on, 'candles.priceLineStyle', 'dotted').cs.candles).toMatchObject({ priceLine: true, priceLineStyle: 'dotted' })
  })
  it('stat names: "<stat>=<name>" by key or by name, cleaned; an empty name puts the stat\'s own name back', () => {
    const d = settingDescriptor('header.statLabels')
    expect(coerceSettingValue(d, 'Market Cap=MCap')).toEqual({ ok: true, value: { key: 'mcap', label: 'MCap' } })
    expect(coerceSettingValue(d, 'mcap: a very long name for it')).toEqual({ ok: true, value: { key: 'mcap', label: 'a very long name' } })
    expect(coerceSettingValue(d, 'nope=x').ok).toBe(false)
    const cs = run(base(), 'header.statLabels', 'Market Cap=MCap').cs
    expect(cs.header.statLabels).toEqual({ mcap: 'MCap' })
    expect(run(cs, 'header.statLabels', 'mcap=').cs.header.statLabels).toEqual({})
    expect(classifySettingPath('header.statLabels.mcap')?.id).toBe('header.statLabels')
    expect(cap().describe({ cs: base() }, { cs }, { setting: 'header.statLabels' })).toBe('Info row stat names (a short custom label per stat): Market Cap = MCap')
  })
})
