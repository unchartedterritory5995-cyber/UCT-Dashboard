import { describe, it, expect } from 'vitest'
import { listIndicators, patchFor, readEnabled, VWAP_FIELDS } from './indicatorRegistry'
import { mergeChartSettings, CHART_DEFAULTS } from './chartDefaults'

// VWAP was the first indicator folded out of the old flat `indicators` map and into
// the registry-driven Indicators tab. It needed a THIRD path kind ('indicator',
// two levels deep) that the previous two — 'overlay' and 'section' — couldn't reach.
// These pin the wiring: a wrong patch shape here silently writes to the top level
// of the settings blob and the setting appears to do nothing.

const vwapRow = (settings) => listIndicators(settings).find((r) => r.id === 'vwap')

describe('registry — VWAP row', () => {
  const settings = mergeChartSettings(null)

  it('is listed, in its own group, reading settings.indicators.vwap', () => {
    const row = vwapRow(settings)
    expect(row).toBeTruthy()
    expect(row.group).toBe('VWAP')
    expect(row.path).toEqual({ kind: 'indicator', key: 'vwap' })
    expect(row.values).toBe(settings.indicators.vwap)
  })

  it('offers exactly the four controls: color, opacity, line style, line width', () => {
    expect(VWAP_FIELDS.map((f) => f.key)).toEqual(['color', 'opacity', 'lineStyle', 'lineWidth'])
    // None are inert — an indicator showing a greyed control it can't honor is the
    // `offset`/`plotStyle` situation, and these four are all wired in StockChart.
    expect(VWAP_FIELDS.some((f) => f.disabled)).toBe(false)
  })

  it('reads OFF by default (VWAP ships disabled) via the standard enabled key', () => {
    expect(readEnabled(vwapRow(settings))).toBe(false)
    expect(readEnabled(vwapRow(mergeChartSettings(JSON.stringify({
      indicators: { vwap: { enabled: true } },
    }))))).toBe(true)
  })
})

describe('patchFor — kind: indicator', () => {
  const settings = mergeChartSettings(null)

  it('nests the patch under indicators.<key>, NOT at the top level', () => {
    const patch = patchFor(vwapRow(settings), { lineWidth: 3 }, settings)
    expect(patch.indicators.vwap.lineWidth).toBe(3)
    expect(patch.lineWidth).toBeUndefined()
  })

  it('merges — one field never drops the others on the same indicator', () => {
    const patch = patchFor(vwapRow(settings), { opacity: 40 }, settings)
    expect(patch.indicators.vwap).toMatchObject({
      opacity: 40,
      color: CHART_DEFAULTS.indicators.vwap.color,
      lineStyle: 'solid',
      lineWidth: 1,
      enabled: false,
    })
  })

  it('merges — patching vwap never drops a sibling indicator', () => {
    const on = mergeChartSettings(JSON.stringify({ indicators: { rsi: { enabled: true, period: 21 } } }))
    const patch = patchFor(vwapRow(on), { enabled: true }, on)
    expect(patch.indicators.rsi).toMatchObject({ enabled: true, period: 21 })
  })

  it('leaves the other two path kinds behaving as before', () => {
    const rows = listIndicators(settings)
    const ov = rows.find((r) => r.path.kind === 'overlay')
    expect(patchFor(ov, { period: 34 }, settings).overlays[ov.path.index].period).toBe(34)
    const vol = rows.find((r) => r.id === 'volume')
    expect(patchFor(vol, { visible: false }, settings).volume.visible).toBe(false)
  })
})

describe('chartDefaults — VWAP style keys backfill', () => {
  // mergeChartSettings spreads the defaults FIRST, so a stored blob (or saved
  // template / layout preset) written before these keys existed picks them up
  // without a migration. This is the compatibility rail for that.
  it('adds opacity/lineStyle/lineWidth to a legacy vwap blob, keeping its color', () => {
    const legacy = JSON.stringify({ indicators: { vwap: { enabled: true, color: '#ff0000' } } })
    expect(mergeChartSettings(legacy).indicators.vwap).toEqual({
      enabled: true, color: '#ff0000', opacity: 100, lineStyle: 'solid', lineWidth: 1,
    })
  })

  it('defaults to fully opaque, solid, 1px — i.e. exactly the old hardcoded look', () => {
    expect(CHART_DEFAULTS.indicators.vwap).toMatchObject({ opacity: 100, lineStyle: 'solid', lineWidth: 1 })
  })
})
