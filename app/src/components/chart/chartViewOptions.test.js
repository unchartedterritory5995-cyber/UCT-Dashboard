// The seven formerly-Soon Chart Settings rows: settings → lightweight-charts options, defaults = today's look,
// old blobs still parse, and the merged blob is untouched for a chart that never set one.
import { describe, it, expect } from 'vitest'
import { mergeChartSettings, CHART_DEFAULTS } from './chartDefaults'
import {
  candlePartsOf, priceLineOf, gridLinesOf, gridPatchFor, gridOptionsFor, rightMarginOf, priceDecimalsOf,
  priceFormatForDecimals, timeFormatOf, sanitizeScaleTime, scaleTimePatch, LINE_STYLE_NUM,
  sessionBreaksOf, preMarketLevelsOf, nextEarningsMarkerOf, priceAlertLinesOf, myTradeMarkersOf,
} from './chartViewOptions'
import { settingDescriptor, classifySettingPath } from './chartSettingsDescriptors'
import {
  chartTickMarkFormatter, chartTickMarkFormatter24, chartCrosshairTimeFormatter, chartCrosshairTimeFormatter24,
  studyTickMarkFormatter, studyTickMarkFormatter24,
} from '../StockChart'

const D = mergeChartSettings({})

describe('defaults reproduce today\'s chart', () => {
  it('an untouched blob: every part, the dashed price line, both grid lines, auto margin/decimals, 12-hour', () => {
    expect(candlePartsOf(D)).toEqual({ body: true, borders: true, wick: true })
    expect(priceLineOf(D)).toEqual({ visible: true, style: 'dashed' })
    expect(LINE_STYLE_NUM[priceLineOf(D).style]).toBe(2)          // lightweight-charts' default priceLineStyle (Dashed)
    expect(gridLinesOf(D)).toBe('both')
    expect(rightMarginOf(D)).toBe(null)
    expect(priceDecimalsOf(D)).toBe(null)
    expect(timeFormatOf(D)).toBe('12')
  })
  it('no new key is declared or emitted: the merged default blob is what it was', () => {
    for (const k of ['showBody', 'showBorders', 'showWick', 'priceLine', 'priceLineStyle']) {
      expect(k in CHART_DEFAULTS.candles, k).toBe(false)
      expect(k in D.candles, k).toBe(false)
    }
    expect('lines' in D.grid).toBe(false)
    expect('scaleTime' in D).toBe(false)
    expect('scaleTime' in CHART_DEFAULTS).toBe(false)
    for (const k of ['sessionBreaks', 'preMarketLevels', 'nextEarningsMarker', 'priceAlertLines', 'myTradeMarkers']) {
      expect(k in D, k).toBe(false)
      expect(k in CHART_DEFAULTS, k).toBe(false)
    }
  })
  it('session breaks and pre-market levels read OFF when absent', () => {
    expect(sessionBreaksOf(D)).toBe(false)
    expect(preMarketLevelsOf(D)).toBe(false)
    expect(nextEarningsMarkerOf(D)).toBe(false)
    expect(nextEarningsMarkerOf({ nextEarningsMarker: true })).toBe(true)
    expect(priceAlertLinesOf(D)).toBe(false)                              // absent = OFF: the chart drew no alert lines before
    expect(priceAlertLinesOf(null)).toBe(false)
    expect(priceAlertLinesOf({ priceAlertLines: true })).toBe(true)
    for (const v of ['yes', 1, {}, false]) expect(priceAlertLinesOf({ priceAlertLines: v }), String(v)).toBe(false)
    expect(myTradeMarkersOf(D)).toBe(false)                               // absent = OFF: a /charts chart drew no trades before
    expect(myTradeMarkersOf(null)).toBe(false)
    expect(myTradeMarkersOf({ myTradeMarkers: true })).toBe(true)
    for (const v of ['yes', 1, {}, false]) expect(myTradeMarkersOf({ myTradeMarkers: v }), String(v)).toBe(false)
    expect(sessionBreaksOf(null)).toBe(false)
  })
  it('the grid options are exactly the old shape: the colour on both lines, transparent when hidden', () => {
    expect(gridOptionsFor(D, '#abc')).toEqual({ vertLines: { color: '#abc' }, horzLines: { color: '#abc' } })
    expect(gridOptionsFor({ grid: { visible: false } }, '#abc')).toEqual({ vertLines: { color: 'transparent' }, horzLines: { color: 'transparent' } })
  })
})

describe('settings → lightweight-charts options', () => {
  it('grid lines', () => {
    expect(gridOptionsFor({ grid: { visible: true, lines: 'horizontal' } }, '#abc')).toEqual({ vertLines: { color: 'transparent' }, horzLines: { color: '#abc' } })
    expect(gridOptionsFor({ grid: { visible: true, lines: 'vertical' } }, '#abc')).toEqual({ vertLines: { color: '#abc' }, horzLines: { color: 'transparent' } })
    // visible:false is the master — Off whatever `lines` holds
    expect(gridLinesOf({ grid: { visible: false, lines: 'vertical' } })).toBe('off')
    expect(gridLinesOf({ grid: { visible: true, lines: 'nonsense' } })).toBe('both')
    expect(gridPatchFor({ color: 'x', visible: true }, 'off')).toEqual({ color: 'x', visible: false })
    expect(gridPatchFor({ color: 'x', visible: false, lines: 'vertical' }, 'both')).toEqual({ color: 'x', visible: true })
    expect(gridPatchFor({ color: 'x', visible: false }, 'horizontal')).toEqual({ color: 'x', visible: true, lines: 'horizontal' })
  })
  it('price line + candle parts', () => {
    expect(priceLineOf({ candles: { priceLine: false, priceLineStyle: 'solid' } })).toEqual({ visible: false, style: 'solid' })
    expect(LINE_STYLE_NUM.solid).toBe(0); expect(LINE_STYLE_NUM.dotted).toBe(1)
    expect(priceLineOf({ candles: { priceLineStyle: 'wavy' } }).style).toBe('dashed')
    expect(candlePartsOf({ candles: { showBody: false, showWick: false } })).toEqual({ body: false, borders: true, wick: false })
  })
  it('price decimals → priceFormat', () => {
    expect(priceFormatForDecimals(0)).toEqual({ type: 'price', precision: 0, minMove: 1 })
    expect(priceFormatForDecimals(2)).toEqual({ type: 'price', precision: 2, minMove: 0.01 })
    expect(priceFormatForDecimals(4)).toEqual({ type: 'price', precision: 4, minMove: 0.0001 })
    expect(priceDecimalsOf({ scaleTime: { priceDecimals: 3 } })).toBe(3)
  })
  it('right margin and time format', () => {
    expect(rightMarginOf({ scaleTime: { rightMargin: 0 } })).toBe(0)
    expect(rightMarginOf({ scaleTime: { rightMargin: 99 } })).toBe(null)
    expect(timeFormatOf({ scaleTime: { timeFormat: '24' } })).toBe('24')
  })
  it('the 24-hour formatters (intraday tick + crosshair); daily labels never change', () => {
    const t = Date.UTC(2026, 6, 14, 14, 5) / 1000             // chart time = ET wall clock in UTC parts
    expect(chartTickMarkFormatter(t, 3)).toBe('2:05 PM')
    expect(chartTickMarkFormatter24(t, 3)).toBe('14:05')
    expect(chartTickMarkFormatter24(Date.UTC(2026, 6, 14, 9, 30) / 1000, 3)).toBe('09:30')
    expect(chartCrosshairTimeFormatter(t)).toBe("Tue 14 Jul '26 2:05 PM")
    expect(chartCrosshairTimeFormatter24(t)).toBe("Tue 14 Jul '26 14:05")
    expect(chartTickMarkFormatter24('2026-07-14', 2)).toBe(chartTickMarkFormatter('2026-07-14', 2))
    expect(chartCrosshairTimeFormatter24('2026-07-14')).toBe(chartCrosshairTimeFormatter('2026-07-14'))
    expect(studyTickMarkFormatter24('2026-03-04', 2)).toBe(studyTickMarkFormatter('2026-03-04', 2))
    expect(studyTickMarkFormatter24(t, 3)).toBe('14:05')
    // the library calls tickMarkFormatter(time, type, locale): a locale must never switch on 24-hour
    expect(chartTickMarkFormatter(t, 3, 'en-US')).toBe('2:05 PM')
  })
})

describe('storage: scaleTime survives the allow-list, sanitised; old blobs still parse', () => {
  it('a set value round-trips; junk and defaults are dropped; an empty block emits no key', () => {
    expect(mergeChartSettings(JSON.stringify({ scaleTime: { rightMargin: 9, priceDecimals: 1, timeFormat: '24' } })).scaleTime)
      .toEqual({ rightMargin: 9, priceDecimals: 1, timeFormat: '24' })
    expect(mergeChartSettings(JSON.stringify({ scaleTime: { rightMargin: -1, priceDecimals: 7, timeFormat: '12', junk: 1 } })).scaleTime).toBeUndefined()
    expect(mergeChartSettings(JSON.stringify({ scaleTime: [] })).scaleTime).toBeUndefined()
    expect(sanitizeScaleTime('x')).toBe(null)
  })
  it('candles.* and grid.lines survive the merge', () => {
    const m = mergeChartSettings(JSON.stringify({ candles: { showWick: false, priceLineStyle: 'dotted' }, grid: { lines: 'vertical' } }))
    expect(m.candles.showWick).toBe(false)
    expect(m.candles.priceLineStyle).toBe('dotted')
    expect(m.candles.upColor).toBe(CHART_DEFAULTS.candles.upColor)
    expect(m.grid).toEqual({ ...CHART_DEFAULTS.grid, lines: 'vertical' })
  })
  it('an old blob (grid.visible:false, no new keys) reads as Off and today\'s look elsewhere', () => {
    const old = mergeChartSettings(JSON.stringify({ grid: { color: '#111111', visible: false }, candles: { upColor: '#00ff00' } }))
    expect(gridLinesOf(old)).toBe('off')
    expect(candlePartsOf(old)).toEqual({ body: true, borders: true, wick: true })
  })
  it('sessionBreaks / preMarketLevels survive the allow-list only while true', () => {
    const on = mergeChartSettings(JSON.stringify({ sessionBreaks: true, preMarketLevels: true }))
    expect(on.sessionBreaks).toBe(true)
    expect(on.preMarketLevels).toBe(true)
    expect(sessionBreaksOf(on) && preMarketLevelsOf(on)).toBe(true)
    for (const v of [false, 'yes', 1, null, {}]) {
      const m = mergeChartSettings(JSON.stringify({ sessionBreaks: v, preMarketLevels: v }))
      expect('sessionBreaks' in m, String(v)).toBe(false)
      expect('preMarketLevels' in m, String(v)).toBe(false)
    }
  })
  it('scaleTimePatch writes one field and keeps the others', () => {
    expect(scaleTimePatch({ scaleTime: { timeFormat: '24' } }, 'rightMargin', 4)).toEqual({ scaleTime: { timeFormat: '24', rightMargin: 4 } })
    expect(scaleTimePatch({ scaleTime: { rightMargin: 4 } }, 'rightMargin', null)).toEqual({ scaleTime: {} })
  })
})

describe('descriptors: each new setting is classified (Agent-eligible since R2, owner 11-16)', () => {
  it.each([
    'candles.showBody', 'candles.showBorders', 'candles.showWick', 'candles.priceLine', 'candles.priceLineStyle',
    'grid.lines', 'scaleTime.rightMargin', 'scaleTime.priceDecimals', 'scaleTime.timeFormat', 'scaleTime.timeZone',
    'sessionBreaks', 'preMarketLevels', 'nextEarningsMarker', 'priceAlertLines', 'myTradeMarkers',
  ])('%s', (id) => {
    const d = settingDescriptor(id)
    expect(d?.agent).toBe('eligible')
    expect(d.ui).toMatch(/^Chart Settings → /)
    expect(classifySettingPath(id)).toBe(d)
  })
  it('grid.visible stays the Agent\'s eligible grid on/off', () => {
    expect(settingDescriptor('grid.visible').agent).toBe('eligible')
  })
})
