// `joinedAutoscaleExtent` — the price extent of every OTHER series lightweight-charts'
// autoscale fits on the candles' scale, by the library's own rule (same pane, visible,
// same priceScaleId, the series' own autoscaleInfoProvider over the visible bars).
// The view lock stores this band so a re-applied lock reproduces what the member saw
// (StockChart.verticalViewLock.test.jsx holds the component-level rail).
import { describe, it, expect } from 'vitest'
import { joinedAutoscaleExtent } from '../chromeGeometry'

/** A series double: values by logical index, options as the library reports them. */
const line = (values, opts = {}) => ({
  options: () => ({ priceScaleId: 'right', visible: true, ...opts }),
  dataByIndex: (i) => (i in values ? (values[i] === null ? { time: i } : { time: i, value: values[i] }) : null),
})
const bar = (rows, opts = {}) => ({
  options: () => ({ priceScaleId: 'right', visible: true, ...opts }),
  dataByIndex: (i) => (rows[i] ? { time: i, ...rows[i] } : null),
})
const candleWith = (others, candleOpts = { priceScaleId: 'right' }) => {
  const c = { options: () => candleOpts }
  c.getPane = () => ({ getSeries: () => [c, ...others] })
  return c
}

describe('joinedAutoscaleExtent', () => {
  it('a line on the candles\' scale is counted over the visible bars only', () => {
    const c = candleWith([line({ 0: 5, 1: 60, 2: 70, 3: 999 })])
    expect(joinedAutoscaleExtent(c, 1, 2)).toEqual({ hi: 70, lo: 60 })
  })

  it('several joined series union; whitespace and missing bars are skipped', () => {
    const c = candleWith([line({ 1: 60, 2: null }), line({ 1: 130, 2: 125 })])
    expect(joinedAutoscaleExtent(c, 1, 2)).toEqual({ hi: 130, lo: 60 })
  })

  it('⛔ a series whose autoscaleInfoProvider answers null is NOT counted (excluded overlay)', () => {
    const c = candleWith([line({ 1: 60 }, { autoscaleInfoProvider: () => null })])
    expect(joinedAutoscaleExtent(c, 0, 5)).toBeNull()
  })

  it('⛔ a null priceRange is also an exclusion (the fit-to-candles surface\'s answer)', () => {
    const c = candleWith([line({ 1: 60 }, { autoscaleInfoProvider: () => ({ priceRange: null }) })])
    expect(joinedAutoscaleExtent(c, 0, 5)).toBeNull()
  })

  it('a provider that WIDENS (autoscaleInclude) or pins is honoured as answered', () => {
    const widen = (base) => {
      const b = base()
      return { priceRange: { minValue: Math.min(80, b.priceRange.minValue), maxValue: Math.max(99, b.priceRange.maxValue) } }
    }
    const c = candleWith([line({ 1: 90 }, { autoscaleInfoProvider: widen })])
    expect(joinedAutoscaleExtent(c, 0, 3)).toEqual({ hi: 99, lo: 80 })
  })

  it('⛔ another price scale (volume on its overlay scale) and a hidden series are NOT counted', () => {
    const c = candleWith([line({ 1: 5e6 }, { priceScaleId: '' }), line({ 1: 1 }, { visible: false })])
    expect(joinedAutoscaleExtent(c, 0, 3)).toBeNull()
  })

  it('a bar-shaped series counts its high and low', () => {
    const c = candleWith([bar({ 1: { high: 50, low: 40 }, 2: { high: 55, low: 42 } })])
    expect(joinedAutoscaleExtent(c, 1, 2)).toEqual({ hi: 55, lo: 40 })
  })

  it('the candles\' own scale id is read, not assumed', () => {
    const c = candleWith([line({ 1: 60 }, { priceScaleId: 'right' })], { priceScaleId: 'left' })
    expect(joinedAutoscaleExtent(c, 0, 3)).toBeNull()
  })

  it('nothing else in the pane, a bad range, or a pane that cannot answer → null', () => {
    expect(joinedAutoscaleExtent(candleWith([]), 0, 10)).toBeNull()
    expect(joinedAutoscaleExtent(candleWith([line({ 1: 60 })]), 5, 2)).toBeNull()
    expect(joinedAutoscaleExtent({ options: () => ({}), getPane: () => { throw new Error('disposed') } }, 0, 3)).toBeNull()
    expect(joinedAutoscaleExtent(null, 0, 3)).toBeNull()
  })
})
