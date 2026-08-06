import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

let captured = null
vi.mock('echarts-for-react/lib/core', () => ({
  default: (props) => { captured = props; return <div data-testid="echart-inner" /> },
}))

import MetricTrendChart, { SIZE, buildTrendOption } from './MetricTrendChart'
import { CHART_INK } from './echartsCore'

const PERIODS = ['Q3 25', 'Q4 25', 'Q1 26', 'Q2 26']
const VALUES = [-3, 8, 24, 62]

describe('buildTrendOption', () => {
  it('draws one bar per period, oldest first, coloured by sign', () => {
    const opt = buildTrendOption(PERIODS, VALUES, {})
    expect(opt.series[0].type).toBe('bar')
    expect(opt.series[0].data.map((d) => d.value)).toEqual(VALUES)
    expect(opt.series[0].data[0].itemStyle.color).toBe(CHART_INK.loss)
    expect(opt.series[0].data[3].itemStyle.color).toBe(CHART_INK.gain)
    expect(opt.xAxis.data).toEqual(PERIODS)
  })

  it('direct-labels ONLY the last value (Part C rule 5)', () => {
    const opt = buildTrendOption(PERIODS, VALUES, {})
    expect(opt.series[0].data[3].label.show).toBe(true)
    expect(opt.series[0].data[0].label.show).toBe(false)
  })

  it('keeps a null period in place instead of shifting the axis', () => {
    const opt = buildTrendOption(PERIODS, [1, null, 3, 4], {})
    expect(opt.series[0].data[1].value).toBeNull()
    expect(opt.series[0].data).toHaveLength(4)
  })

  it('rules the zero baseline once', () => {
    expect(buildTrendOption(PERIODS, VALUES, {}).series[0].markLine.data).toEqual([{ yAxis: 0 }])
  })
})

describe('MetricTrendChart', () => {
  it('renders an EmptyState when no value is finite', () => {
    render(<MetricTrendChart periods={PERIODS} values={[null, null, null, null]} label="Revenue YoY" />)
    expect(screen.getByTestId('rk-empty-title')).toBeInTheDocument()
  })

  it('mounts with the built option', () => {
    render(<MetricTrendChart periods={PERIODS} values={VALUES} label="Revenue YoY" />)
    expect(screen.getByTestId('echart-inner')).toBeInTheDocument()
    expect(captured.option.series[0].data).toHaveLength(4)
  })

  it('names the metric and its span in the aria-label', () => {
    render(<MetricTrendChart periods={PERIODS} values={VALUES} label="Revenue YoY" />)
    expect(screen.getByRole('img').getAttribute('aria-label'))
      .toBe('Revenue YoY by period, Q3 25 to Q2 26. Latest +62.0%.')
  })

  it('exports a SIZE box for SkeletonBlock', () => {
    expect(SIZE).toEqual({ width: '100%', height: 140 })
  })
})
