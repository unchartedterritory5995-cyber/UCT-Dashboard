import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

let captured = null
vi.mock('echarts-for-react/lib/core', () => ({
  default: (props) => { captured = props; return <div data-testid="echart-inner" /> },
}))

import LollipopChart, {
  SIZE, beatState, yDomain, horizonLabel, renderLollipopItem, buildLollipopOption,
} from './LollipopChart'
import { CHART_INK } from './echartsCore'

/** Oldest-first, exactly the earnings-history row shape (§6 row 3). */
const Q = (over = {}) => ({
  quarter: 'Q1 26', report_date: '2026-02-04', period_end: '2025-12-31', session: 'amc',
  reported: true, eps_estimate: 1.0, eps_estimate_low: 0.9, eps_estimate_high: 1.1,
  eps_actual: 1.2, surprise_pct: 20, reaction_pct: 3.1, ...over,
})
const ROWS = [
  Q({ quarter: 'Q1 25', eps_estimate: 0.8, eps_actual: 0.9 }),
  Q({ quarter: 'Q2 25', eps_estimate: 0.9, eps_actual: 0.85 }),
  Q({ quarter: 'Q3 25', eps_estimate: 1.0, eps_actual: 1.0 }),
  Q({ quarter: 'Q4 25', eps_estimate: 1.1, eps_actual: 1.4 }),
  Q({ quarter: 'Q1 26', reported: false, eps_actual: null, surprise_pct: null }),
]

describe('beatState', () => {
  it('is beat above the estimate, miss below, inline on the number', () => {
    expect(beatState(Q({ eps_estimate: 1, eps_actual: 1.2 }))).toBe('beat')
    expect(beatState(Q({ eps_estimate: 1, eps_actual: 0.8 }))).toBe('miss')
    expect(beatState(Q({ eps_estimate: 1, eps_actual: 1 }))).toBe('inline')
  })

  it('is null for a quarter that has not reported, or with missing numbers', () => {
    expect(beatState(Q({ reported: false }))).toBeNull()
    expect(beatState(Q({ eps_actual: null }))).toBeNull()
    expect(beatState(Q({ eps_estimate: undefined }))).toBeNull()
    expect(beatState(null)).toBeNull()
  })
})

describe('yDomain', () => {
  it('spans every finite estimate, actual and whisker end with headroom', () => {
    const [min, max] = yDomain(ROWS)
    expect(min).toBeLessThan(0.8)
    expect(max).toBeGreaterThan(1.4)
  })

  it('never returns a degenerate domain', () => {
    const [min, max] = yDomain([Q({ eps_estimate: 1, eps_actual: 1, eps_estimate_low: 1, eps_estimate_high: 1 })])
    expect(max).toBeGreaterThan(min)
  })

  it('returns null when nothing is finite', () => {
    expect(yDomain([{ quarter: 'Q1', eps_estimate: null, eps_actual: null }])).toBeNull()
    expect(yDomain([])).toBeNull()
  })
})

describe('horizonLabel — the horizon comes from the data, never hardcoded', () => {
  it('names the count and both ends', () => {
    expect(horizonLabel(ROWS)).toBe('5 quarters · Q1 25 – Q1 26')
  })

  it('degrades gracefully on a single quarter', () => {
    expect(horizonLabel([Q({ quarter: 'Q4 25' })])).toBe('1 quarter · Q4 25')
  })
})

describe('renderLollipopItem — the drawing contract (pure, canvas-free)', () => {
  // Stub api: x = index*20, y = 200 - value*100.
  const apiFor = (row) => ({
    value: (i) => row[i],
    coord: ([x, y]) => [x * 20, 200 - y * 100],
  })
  // [index, estimate, actual, low, high, reported]
  const beat = [1, 1.0, 1.2, 0.9, 1.1, 1]
  const miss = [2, 1.0, 0.8, 0.9, 1.1, 1]
  const next = [3, 1.3, null, null, null, 0]

  const kinds = (g) => g.children.map((c) => c.type)

  it('draws whisker, stem, hollow estimate and solid actual for a reported beat', () => {
    const g = renderLollipopItem({}, apiFor(beat))
    expect(g.type).toBe('group')
    expect(kinds(g)).toEqual(['line', 'line', 'line', 'line', 'circle', 'circle'])
    const [estDot, actDot] = g.children.slice(-2)
    expect(estDot.style.fill).toBe('transparent')          // expectation is ALWAYS hollow (§3.3)
    expect(actDot.style.fill).toBe(CHART_INK.gain)          // realized beat is solid green
  })

  it('colours the actual dot red on a miss', () => {
    const g = renderLollipopItem({}, apiFor(miss))
    expect(g.children.at(-1).style.fill).toBe(CHART_INK.loss)
  })

  it('draws the not-yet-reported quarter as a DASHED hollow ring and no actual dot', () => {
    const g = renderLollipopItem({}, apiFor(next))
    expect(kinds(g)).toEqual(['circle'])
    const ring = g.children[0]
    expect(ring.style.fill).toBe('transparent')
    expect(ring.style.lineDash).toEqual([3, 3])
  })

  it('omits the whisker when the analyst hi/lo is missing', () => {
    const g = renderLollipopItem({}, apiFor([0, 1.0, 1.1, null, null, 1]))
    expect(kinds(g)).toEqual(['line', 'circle', 'circle'])   // stem + 2 dots, no whisker
  })

  it('draws nothing when even the estimate is missing', () => {
    expect(renderLollipopItem({}, apiFor([0, null, null, null, null, 0])).children).toEqual([])
  })
})

describe('buildLollipopOption', () => {
  it('builds ONE custom series over the encoded quarter rows', () => {
    const opt = buildLollipopOption(ROWS)
    expect(opt.series).toHaveLength(1)
    expect(opt.series[0].type).toBe('custom')
    expect(opt.series[0].renderItem).toBe(renderLollipopItem)
    expect(opt.series[0].data).toHaveLength(ROWS.length)
    expect(opt.series[0].data[0]).toEqual([0, 0.8, 0.9, 0.9, 1.1, 1])
    expect(opt.series[0].data[4][5]).toBe(0)                 // the unreported quarter
  })

  it('labels the x axis with the quarters, oldest first', () => {
    expect(buildLollipopOption(ROWS).xAxis.data).toEqual(['Q1 25', 'Q2 25', 'Q3 25', 'Q4 25', 'Q1 26'])
  })

  it('pins the y domain from the data and hides the axis spine (Part C rule 5)', () => {
    const opt = buildLollipopOption(ROWS)
    expect(opt.yAxis.min).toBe(yDomain(ROWS)[0])
    expect(opt.yAxis.max).toBe(yDomain(ROWS)[1])
    expect(opt.yAxis.axisLine.show).toBe(false)
    expect(opt.xAxis.axisLine.show).toBe(false)
    expect(opt.yAxis.splitLine.lineStyle.color).toBe(CHART_INK.grid)
  })

  it('carries no legend — direct marks only', () => {
    expect(buildLollipopOption(ROWS).legend).toBeUndefined()
  })
})

describe('LollipopChart', () => {
  it('renders an EmptyState below two quarters', () => {
    render(<LollipopChart quarters={[Q()]} />)
    expect(screen.getByTestId('rk-empty-title')).toBeInTheDocument()
    expect(screen.queryByTestId('echart-inner')).toBeNull()
  })

  it('renders an EmptyState on junk input', () => {
    render(<LollipopChart quarters={null} />)
    expect(screen.getByTestId('rk-empty-title')).toBeInTheDocument()
  })

  it('mounts the chart and hands ECharts the built option', () => {
    render(<LollipopChart quarters={ROWS} />)
    expect(screen.getByTestId('echart-inner')).toBeInTheDocument()
    expect(captured.option.series[0].type).toBe('custom')
  })

  it('builds an aria-label naming the horizon and the beat record', () => {
    render(<LollipopChart quarters={ROWS} />)
    const label = screen.getByRole('img').getAttribute('aria-label')
    expect(label).toMatch(/5 quarters/)
    expect(label).toMatch(/Q1 25 – Q1 26/)
    expect(label).toMatch(/Beat 2 of 4/)
  })

  it('exports a SIZE box for SkeletonBlock', () => {
    expect(SIZE).toEqual({ width: '100%', height: 240 })
  })

  it('shows the horizon caption under the chart', () => {
    render(<LollipopChart quarters={ROWS} />)
    expect(screen.getByTestId('rk-lollipop-horizon')).toHaveTextContent('5 quarters · Q1 25 – Q1 26')
  })
})
