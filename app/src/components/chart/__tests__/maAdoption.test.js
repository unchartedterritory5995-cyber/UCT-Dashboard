// app/src/components/chart/__tests__/maAdoption.test.js
//
// ─── ONE MOVING AVERAGE: `cs.overlays` adopted as `movingAverage` instances ───

import { describe, it, expect } from 'vitest'
import {
  adoptOverlayAverages, averageSlotView, writeAverageSlot, revivableSlotIndex, reviveSlot,
  dropAverages, isAdoptedSlot, MA_PERIOD_MAX,
} from '../maAdoption'
import { CHART_DEFAULTS, mergeChartSettings, mergeSettingsOverride } from '../chartDefaults'
import { applyThemeToSettings } from '../chartThemes'
import * as registry from '../engine/nativeRegistry'
import { validateInstance, normalizeInstances } from '../engine/instances'

const byId = (cs, id) => (cs.indicatorInstances || []).find((i) => i && i.instanceId === id)
const live = (cs) => (cs.indicatorInstances || []).filter((i) => i && i.deleted !== true)

describe('⭐⭐ THE FOLD — every live slot becomes `ovl:<i>`, nothing is destroyed', () => {
  it('a fresh chart: four averages, four adopted slots, values carried exactly', () => {
    const cs = mergeChartSettings(null)
    expect(live(cs).map((i) => [i.instanceId, i.inputs.maType, i.inputs.period, i.inputs.color, i.hidden])).toEqual([
      ['ovl:0', 'ema', 9, '#4ade80', false],
      ['ovl:1', 'ema', 20, '#f472b6', false],
      ['ovl:2', 'sma', 50, '#60a5fa', false],
      ['ovl:3', 'sma', 200, '#fb923c', false],
    ])
    cs.overlays.forEach((s, i) => {
      expect(s.adopted).toBe(`ovl:${i}`)
      expect(s.removed, 'an older client would draw the slot too').toBe(true)
      expect(s.period, 'the slot lost its data').toBe(CHART_DEFAULTS.overlays[i].period)
    })
  })

  it('⛔ IDEMPOTENT: a second read (and a JSON round trip) adopts nothing more', () => {
    const once = mergeChartSettings(null)
    expect(adoptOverlayAverages(once)).toBe(once)
    const twice = mergeChartSettings(JSON.stringify(once))
    expect(twice.indicatorInstances).toEqual(JSON.parse(JSON.stringify(once.indicatorInstances)))
  })

  it('appearance rides PRESENTATION — never an undeclared input an older client drops', () => {
    const cs = mergeChartSettings({ overlays: [{ lineWidth: 3, lineStyle: 'dotted', onTop: true, offset: 2, plotStyle: 'area' }] })
    const a = byId(cs, 'ovl:0')
    expect(a.presentation).toEqual({ lineWidth: 3, lineStyle: 'dotted', overlap: true, offset: 2 })
    expect(a.presentation, 'a never-honoured plotStyle took effect on adoption').not.toHaveProperty('plotStyle')
    expect(Object.keys(a.inputs).sort()).toEqual(['color', 'maType', 'period', 'source'])
  })

  it('⭐ ROLLBACK SAFETY: every adopted instance validates against the definition as it stands', () => {
    const cs = mergeChartSettings({ overlays: [{ period: 450 }, { enabled: false }, {}, {}] })
    const { kept, dropped } = normalizeInstances(cs.indicatorInstances, registry)
    expect(dropped).toEqual([])
    expect(kept.map((i) => i.instanceId)).toEqual(['ovl:0', 'ovl:1', 'ovl:2', 'ovl:3'])
    for (const i of kept) expect(validateInstance(i, registry).ok).toBe(true)
    expect(byId(cs, 'ovl:1').hidden, 'a switched-off slot drew').toBe(true)
  })

  it('an invalid or out-of-range period is held, never a line at a period nobody chose', () => {
    const cs = mergeChartSettings({ overlays: [{ period: 0 }, { period: 99999 }, {}, {}] })
    expect(byId(cs, 'ovl:0').hidden).toBe(true)
    expect(byId(cs, 'ovl:1').inputs.period).toBe(MA_PERIOD_MAX)
  })

  it('a MEMBER-DELETED slot adopts as a TOMBSTONE (so a global copy cannot leak in)', () => {
    const cs = mergeChartSettings({ overlays: [{ removed: true }, {}, {}, {}] })
    expect(byId(cs, 'ovl:0')).toEqual({ instanceId: 'ovl:0', deleted: true })
    expect(cs.overlays[0].adopted).toBe('ovl:0')
  })

  it('⭐ a LIVE slot written AFTER adoption (a preset, an old editor) updates its average', () => {
    const cs = mergeChartSettings(null)
    const preset = { ...cs, overlays: CHART_DEFAULTS.overlays.map((o, i) => (i === 0 ? { ...o, period: 8 } : { ...o })) }
    const withTf = { ...preset, indicatorInstances: preset.indicatorInstances.map((i) => (i.instanceId === 'ovl:0' ? { ...i, calculationTimeframe: 'W' } : i)) }
    const re = mergeChartSettings(JSON.stringify(withTf))
    expect(byId(re, 'ovl:0').inputs.period).toBe(8)
    expect(byId(re, 'ovl:0').calculationTimeframe, 'a field the slot cannot express was lost').toBe('W')
    expect(live(re)).toHaveLength(4)
  })

  it('a member\'s within-pane order keyed `overlay-<i>` follows the average to `ovl:<i>`', () => {
    const cs = mergeChartSettings({ paneSeriesOrder: { price: ['overlay-3', 'overlay-0'] } })
    expect(cs.paneSeriesOrder.price).toEqual(['ovl:3', 'ovl:0'])
  })

  it('adopted averages sit where the stack order puts them — after the pane oscillators, before BB', () => {
    const cs = mergeChartSettings({ indicators: { rsi: { enabled: true }, bb: { enabled: true } } })
    expect(cs.indicatorInstances.map((i) => i.defId)).toEqual(
      ['rsi', 'movingAverage', 'movingAverage', 'movingAverage', 'movingAverage', 'bb'])
  })
})

describe('⭐⭐ THE OVERRIDE MERGE — a widget\'s own averages, in both directions', () => {
  const global = mergeChartSettings(null)
  it('a pre-adoption widget blob gets ITS values, not the global average\'s timeframe', () => {
    const g = { ...global, indicatorInstances: global.indicatorInstances.map((i) => (i.instanceId === 'ovl:0' ? { ...i, calculationTimeframe: 'W', visibility: { preset: 'dailyUp' } } : i)) }
    const widget = { overlays: CHART_DEFAULTS.overlays.map((o, i) => (i === 0 ? { ...o, period: 13 } : { ...o })) }
    const out = mergeSettingsOverride(g, widget)
    const a = byId(out, 'ovl:0')
    expect(a.inputs.period).toBe(13)
    expect(a.calculationTimeframe, 'the global average\'s timeframe leaked into the widget').toBeUndefined()
    expect(a.visibility).toBeUndefined()
  })
  it('a widget whose member deleted EMA 9 does not get the global EMA 9 back', () => {
    const widget = { overlays: CHART_DEFAULTS.overlays.map((o, i) => (i === 0 ? { ...o, removed: true } : { ...o })) }
    const out = mergeSettingsOverride(global, widget)
    expect(byId(out, 'ovl:0').deleted).toBe(true)
    expect(live(out).map((i) => i.instanceId)).toEqual(['ovl:1', 'ovl:2', 'ovl:3'])
  })
  it('…and a GLOBAL deletion does not swallow a widget\'s own EMA 9', () => {
    const g = { ...global, indicatorInstances: global.indicatorInstances.map((i) => (i.instanceId === 'ovl:0' ? { instanceId: 'ovl:0', deleted: true } : i)) }
    const widget = { overlays: CHART_DEFAULTS.overlays.map((o) => ({ ...o })) }
    const out = mergeSettingsOverride(g, widget)
    expect(byId(out, 'ovl:0').deleted).toBeFalsy()
    expect(byId(out, 'ovl:0').inputs.period).toBe(9)
  })
})

describe('the doors that still speak slots — revive, legacy editors, themes, new-chart defaults', () => {
  it('revive: a deleted average comes back as its instance, with the slot\'s own values', () => {
    let cs = mergeChartSettings({ overlays: [{ type: 'EMA', period: 9, color: '#123456', removed: true }, {}, {}, {}] })
    expect(revivableSlotIndex(cs)).toBe(0)
    cs = reviveSlot(cs, 0)
    expect(byId(cs, 'ovl:0')).toMatchObject({ inputs: { period: 9, color: '#123456', maType: 'ema' }, hidden: false })
    expect(revivableSlotIndex(cs), 'nothing left to revive').toBe(-1)
  })
  it('an ADOPTED slot whose instance is live is not offered for revival', () => {
    expect(revivableSlotIndex(mergeChartSettings(null))).toBe(-1)
  })
  it('the positional view and writer read/write THROUGH the adopted instance', () => {
    let cs = mergeChartSettings(null)
    expect(averageSlotView(cs)[1]).toMatchObject({ type: 'EMA', period: 20, enabled: true, instanceId: 'ovl:1' })
    cs = writeAverageSlot(cs, 1, 'period', '21')
    cs = writeAverageSlot(cs, 1, 'type', 'SMA')
    cs = writeAverageSlot(cs, 1, 'enabled', false)
    cs = writeAverageSlot(cs, 1, 'lineWidth', 2)
    expect(byId(cs, 'ovl:1')).toMatchObject({ inputs: { period: 21, maType: 'sma' }, hidden: true, presentation: { lineWidth: 2 } })
    expect(cs.overlays[1].period, 'the kept slot was rewritten').toBe(20)
  })
  it('a chart THEME recolours the adopted averages by position', () => {
    const themed = applyThemeToSettings(mergeChartSettings(null), { up: '#0f0', down: '#f00', ma: ['#ff0000', '#00ff00'] })
    expect(byId(themed, 'ovl:0').inputs.color).toBe('rgba(255, 0, 0, 0.75)')
    expect(byId(themed, 'ovl:1').inputs.color).toBe('rgba(0, 255, 0, 0.75)')
    expect(byId(themed, 'ovl:2').inputs.color).toBe('#60a5fa')
  })
  it('new-chart defaults drop an SMA 5 — the slot AND its adopted instance', () => {
    const cs = mergeChartSettings({ overlays: [{}, {}, {}, {}, { type: 'SMA', period: 5, enabled: true }] })
    const out = dropAverages(cs, (v) => v.type === 'SMA' && Number(v.period) === 5)
    expect(byId(out, 'ovl:4').deleted).toBe(true)
    expect(live(out)).toHaveLength(4)
  })
  it('isAdoptedSlot tells an adopted slot from a member-deleted one', () => {
    expect(isAdoptedSlot({ removed: true, adopted: 'ovl:0' })).toBe(true)
    expect(isAdoptedSlot({ removed: true })).toBe(false)
  })
})
