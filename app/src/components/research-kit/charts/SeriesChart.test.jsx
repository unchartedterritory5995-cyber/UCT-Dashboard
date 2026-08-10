import { describe, it, expect } from 'vitest'
import { buildSeriesOption, hasPlottableData } from './SeriesChart'

const P = ['Q1', 'Q2', 'Q3']
const line = [
  { name: 'Gross', color: '#aaa', values: [50, 49, 48] },
  { name: 'Net', color: '#bbb', values: [27, 26, 29] },
]

describe('line mode', () => {
  it('draws one series per measure, each with the colour it was GIVEN', () => {
    // The colour must never come from position. `PALETTE[i]` is how this repo
    // once drew every bearish breadth line green.
    const o = buildSeriesOption(P, line, { mode: 'line' })
    expect(o.series).toHaveLength(2)
    expect(o.series[0].lineStyle.color).toBe('#aaa')
    expect(o.series[1].lineStyle.color).toBe('#bbb')
    expect(o.series.every(s => !s.stack)).toBe(true)
  })

  it('keeps the value axis unstacked and scaled to the data', () => {
    const o = buildSeriesOption(P, line, { mode: 'line' })
    expect(o.yAxis.scale).toBe(true)   // margins near 50% must not start at 0
  })
})

describe('stacked mode', () => {
  const buckets = [
    { name: 'Buy', color: '#0f0', values: [10, 11, 12] },
    { name: 'Sell', color: '#f00', values: [2, 2, 1] },
  ]

  it('stacks onto ONE total so the balance is readable', () => {
    const o = buildSeriesOption(P, buckets, { mode: 'stacked' })
    expect(o.series.map(s => s.stack)).toEqual(['total', 'total'])
    expect(o.series.every(s => s.areaStyle)).toBe(true)
  })

  it('starts the axis at zero — a stacked share of a whole must not be scaled', () => {
    const o = buildSeriesOption(P, buckets, { mode: 'stacked' })
    expect(o.yAxis.scale).toBe(false)
  })
})

describe('band mode', () => {
  const band = [
    { name: 'Low', color: '#888', values: [1.93, 2.51] },
    { name: 'Consensus', color: '#c9a84c', values: [1.98, 2.91] },
    { name: 'High', color: '#888', values: [2.04, 3.42] },
  ]

  it('plots the SPAN, not the high — the high is stacked on the low', () => {
    // ECharts has no band type: the fill is `high` stacked above an invisible
    // `low`. Handing it the raw high would draw a band twice as tall as the
    // real range, and it would look entirely plausible.
    const o = buildSeriesOption(P, band, { mode: 'band' })
    const spanSeries = o.series[1]
    expect(spanSeries.data[0]).toBeCloseTo(2.04 - 1.93, 5)
    expect(spanSeries.data[1]).toBeCloseTo(3.42 - 2.51, 5)
  })

  it('hides the floor series but keeps it in the stack', () => {
    const o = buildSeriesOption(P, band, { mode: 'band' })
    expect(o.series[0].lineStyle.opacity).toBe(0)
    expect(o.series[0].stack).toBe('band')
    expect(o.series[1].stack).toBe('band')
  })

  it('the centre line is NOT stacked — it is an absolute value', () => {
    const o = buildSeriesOption(P, band, { mode: 'band' })
    expect(o.series[2].stack).toBeUndefined()
    expect(o.series[2].data).toEqual([1.98, 2.91])
  })

  it('a missing endpoint yields no span rather than a wrong one', () => {
    const gap = [
      { name: 'Low', values: [1.0, null] },
      { name: 'Avg', values: [1.5, 2.0] },
      { name: 'High', values: [2.0, 3.0] },
    ]
    const o = buildSeriesOption(P, gap, { mode: 'band' })
    expect(o.series[1].data[1]).toBeNull()
  })
})

describe('rank mode', () => {
  const holders = ['Vanguard', 'BlackRock', 'State Street']
  const one = [{ name: '% out', color: '#c9a84c', values: [8.5, 7.1, 4.2] }]

  it('is a horizontal bar: categories on Y, values on X', () => {
    const o = buildSeriesOption(holders, one, { mode: 'rank' })
    expect(o.yAxis.type).toBe('category')
    expect(o.xAxis.type).toBe('value')
    expect(o.series[0].type).toBe('bar')
  })

  it('reverses so the LARGEST sits at the top, where it is read first', () => {
    // ECharts draws a category axis bottom-up, so passing rank order straight
    // through would put the smallest holder on top.
    const o = buildSeriesOption(holders, one, { mode: 'rank' })
    expect(o.yAxis.data).toEqual(['State Street', 'BlackRock', 'Vanguard'])
    expect(o.series[0].data).toEqual([4.2, 7.1, 8.5])
  })
})

describe('hasPlottableData', () => {
  it('needs two points to call something a trend', () => {
    expect(hasPlottableData([{ values: [1] }])).toBe(false)
    expect(hasPlottableData([{ values: [1, 2] }])).toBe(true)
  })

  it('but a ranking of one is still a ranking', () => {
    expect(hasPlottableData([{ values: [1] }], 'rank')).toBe(true)
  })

  it('ignores nulls when counting real points', () => {
    expect(hasPlottableData([{ values: [1, null, null] }])).toBe(false)
    expect(hasPlottableData([{ values: [1, null, 3] }])).toBe(true)
  })

  it('is false for nothing at all', () => {
    expect(hasPlottableData(null)).toBe(false)
    expect(hasPlottableData([])).toBe(false)
  })
})

describe('bars mode', () => {
  const many = Array.from({ length: 24 }, (_, i) => `Q${(i % 4) + 1} 20${20 + ((i / 4) | 0)}`)
  const two = [
    { name: 'Revenue', color: '#5aa9e6', values: many.map((_, i) => i * 10) },
    { name: 'Operating income', color: '#e57373', values: many.map((_, i) => i) },
  ]

  it('draws BARS, because a statement period is discrete', () => {
    // A line between two quarters implies a value in between that never existed.
    const o = buildSeriesOption(many, two, { mode: 'bars' })
    expect(o.series.every(s => s.type === 'bar')).toBe(true)
    expect(o.series).toHaveLength(2)
  })

  it('thins the axis labels instead of overprinting 24 of them', () => {
    const o = buildSeriesOption(many, two, { mode: 'bars' })
    expect(o.xAxis.axisLabel.interval).toBeGreaterThan(0)
    expect(o.xAxis.axisLabel.hideOverlap).toBe(true)
  })

  it('keeps each series on the colour it was given', () => {
    const o = buildSeriesOption(many, two, { mode: 'bars' })
    expect(o.series.map(s => s.itemStyle.color)).toEqual(['#5aa9e6', '#e57373'])
  })
})
