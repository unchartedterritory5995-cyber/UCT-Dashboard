import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

let captured = null
vi.mock('echarts-for-react/lib/core', () => ({
  default: (props) => { captured = props; return <div data-testid="echart-inner" /> },
}))

import RevisionColumns, { SIZE, revisionTotals, buildRevisionOption } from './RevisionColumns'
import { CHART_INK } from './echartsCore'

const BUCKETS = [
  { label: 'Jun 30', up: 1, down: 4 },
  { label: 'Jul 7', up: 3, down: 2 },
  { label: 'Jul 14', up: 6, down: 1 },
  { label: 'Jul 21', up: 5, down: 0 },
]

describe('revisionTotals', () => {
  it('sums both directions and the net', () => {
    expect(revisionTotals(BUCKETS)).toEqual({ up: 15, down: 7, net: 8, buckets: 4 })
  })

  it('treats missing counts as zero, never NaN', () => {
    expect(revisionTotals([{ label: 'a' }, { label: 'b', up: 2 }])).toEqual({ up: 2, down: 0, net: 2, buckets: 2 })
  })

  it('returns a zero shape on nothing', () => {
    expect(revisionTotals(null)).toEqual({ up: 0, down: 0, net: 0, buckets: 0 })
  })
})

describe('buildRevisionOption', () => {
  it('puts ups above zero and downs below, on the same x', () => {
    const opt = buildRevisionOption(BUCKETS)
    const [up, down] = opt.series
    expect(up.data).toEqual([1, 3, 6, 5])
    // Non-positive, and a zero count is PLAIN 0 -- not -0, which toEqual treats
    // as a different value from 0 and which would render a phantom mark.
    expect(down.data).toEqual([-4, -2, -1, 0])
    expect(down.barGap).toBe('-100%')
    expect(up.itemStyle.color).toBe(CHART_INK.gain)
    expect(down.itemStyle.color).toBe(CHART_INK.loss)
  })

  it('coerces a negative or junk down-count to a downward bar', () => {
    const opt = buildRevisionOption([{ label: 'a', up: '2', down: -3 }, { label: 'b', up: null, down: 'x' }])
    expect(opt.series[0].data).toEqual([2, 0])
    expect(opt.series[1].data).toEqual([-3, 0])
  })

  it('draws exactly one stronger rule, at zero (Part C rule 5)', () => {
    const opt = buildRevisionOption(BUCKETS)
    expect(opt.series[0].markLine.data).toEqual([{ yAxis: 0 }])
    expect(opt.series[0].markLine.silent).toBe(true)
    expect(opt.series[0].markLine.symbol).toBe('none')
  })

  it('labels the x axis with the bucket labels and carries no legend', () => {
    const opt = buildRevisionOption(BUCKETS)
    expect(opt.xAxis.data).toEqual(['Jun 30', 'Jul 7', 'Jul 14', 'Jul 21'])
    expect(opt.legend).toBeUndefined()
    expect(opt.yAxis.axisLine.show).toBe(false)
  })
})

describe('RevisionColumns', () => {
  it('renders an EmptyState with no buckets', () => {
    render(<RevisionColumns buckets={[]} />)
    expect(screen.getByTestId('rk-empty-title')).toBeInTheDocument()
  })

  it('renders an EmptyState when every bucket is empty (an all-zero chart is a lie)', () => {
    render(<RevisionColumns buckets={[{ label: 'a', up: 0, down: 0 }]} />)
    expect(screen.getByTestId('rk-empty-title')).toBeInTheDocument()
  })

  it('mounts and hands ECharts the built option', () => {
    render(<RevisionColumns buckets={BUCKETS} />)
    expect(screen.getByTestId('echart-inner')).toBeInTheDocument()
    expect(captured.option.series).toHaveLength(2)
  })

  it('builds an aria-label stating the direction of the crowd', () => {
    render(<RevisionColumns buckets={BUCKETS} />)
    expect(screen.getByRole('img').getAttribute('aria-label'))
      .toBe('Estimate revisions across 4 periods: 15 up, 7 down, net +8.')
  })

  it('exports a SIZE box for SkeletonBlock', () => {
    expect(SIZE).toEqual({ width: '100%', height: 180 })
  })
})
