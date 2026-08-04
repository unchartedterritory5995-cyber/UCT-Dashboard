import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

let captured = null
vi.mock('echarts-for-react/lib/core', () => ({
  default: (props) => { captured = props; return <div data-testid="echart-inner" /> },
}))

import Histogram, { SIZE, binValues, buildHistogramOption } from './Histogram'

const PT = [180, 185, 190, 190, 195, 200, 205, 240]

describe('binValues', () => {
  it('splits the range into the requested number of bins', () => {
    const bins = binValues(PT, 4)
    expect(bins).toHaveLength(4)
    expect(bins[0].x0).toBe(180)
    expect(bins[3].x1).toBe(240)
    expect(bins.reduce((a, b) => a + b.count, 0)).toBe(PT.length)
  })

  it('puts the maximum in the LAST bin, not off the end', () => {
    const bins = binValues(PT, 4)
    expect(bins[3].count).toBe(1)
  })

  it('drops non-finite values instead of poisoning the range', () => {
    const bins = binValues([1, 2, NaN, null, undefined, 'x', Infinity, 3], 2)
    expect(bins.reduce((a, b) => a + b.count, 0)).toBe(3)
  })

  it('returns a single bin when every value is identical', () => {
    const bins = binValues([7, 7, 7], 5)
    expect(bins).toHaveLength(1)
    expect(bins[0]).toMatchObject({ x0: 7, x1: 7, count: 3 })
  })

  it('returns nothing when there is nothing finite', () => {
    expect(binValues([], 5)).toEqual([])
    expect(binValues(null, 5)).toEqual([])
    expect(binValues([NaN, 'x'], 5)).toEqual([])
  })
})

describe('buildHistogramOption', () => {
  it('draws one bar per bin with the counts', () => {
    const bins = binValues(PT, 4)
    const opt = buildHistogramOption(bins, {})
    expect(opt.series[0].type).toBe('bar')
    expect(opt.series[0].data).toEqual(bins.map((b) => b.count))
    expect(opt.xAxis.data).toHaveLength(4)
  })

  it('marks the current value when one is given, and omits the mark otherwise', () => {
    const bins = binValues(PT, 4)
    const withMark = buildHistogramOption(bins, { marker: 195, markerLabel: 'Price $195' })
    expect(withMark.series[0].markLine.data[0].xAxis).toBe(1)     // the bin containing 195
    expect(withMark.series[0].markLine.data[0].name).toBe('Price $195')
    expect(buildHistogramOption(bins, {}).series[0].markLine).toBeUndefined()
  })

  it('does not mark a value outside the distribution', () => {
    const bins = binValues(PT, 4)
    expect(buildHistogramOption(bins, { marker: 5 }).series[0].markLine).toBeUndefined()
  })
})

describe('Histogram', () => {
  it('renders an EmptyState when the distribution is empty', () => {
    render(<Histogram values={[]} />)
    expect(screen.getByTestId('rk-empty-title')).toBeInTheDocument()
    expect(screen.queryByTestId('echart-inner')).toBeNull()
  })

  it('mounts with the binned option', () => {
    render(<Histogram values={PT} bins={4} />)
    expect(captured.option.series[0].data).toEqual(binValues(PT, 4).map((b) => b.count))
  })

  it('builds an aria-label naming the sample size and range', () => {
    render(<Histogram values={PT} bins={4} valueFormatter={(v) => `$${v.toFixed(0)}`} />)
    expect(screen.getByRole('img').getAttribute('aria-label'))
      .toBe('Distribution of 8 values from $180 to $240.')
  })

  it('exports a SIZE box for SkeletonBlock', () => {
    expect(SIZE).toEqual({ width: '100%', height: 160 })
  })
})
