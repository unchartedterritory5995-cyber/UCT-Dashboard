// app/src/pages/BreadthCharts.live.test.jsx
//
// The provisional reading extends every plotted line to NOW. Three things have
// to hold, and all three are assertions about the option ECharts is actually
// handed — not about component state:
//
//   1. the live point is APPENDED, never substituted for a stored one
//   2. the tip of each line is visibly marked, so the eye can tell where
//      measured history stops and the intraday estimate begins
//   3. the "now" marker never leaks into the legend as a metric
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import BreadthCharts from './BreadthCharts'

let captured = null
vi.mock('echarts-for-react', () => ({
  default: (props) => { captured = props.option; return <div data-testid="echart" /> },
}))

function isoDaysAgo(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}
const TODAY = isoDaysAgo(0)

const ROWS = Array.from({ length: 20 }, (_, i) => ({
  date: isoDaysAgo(20 - i),          // ends yesterday
  breadth_score: 60 + i,
  pct_above_50sma: 45 + i,
}))

const LIVE_ROW = { date: TODAY, breadth_score: 89.4, pct_above_50sma: 65.3 }

function stubFetch({ live = true, degraded = false } = {}) {
  vi.stubGlobal('fetch', vi.fn((url, opts) => {
    const u = String(url)
    if (u.includes('/api/breadth-monitor/live')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(live ? {
          ok: true, superseded: false, degraded,
          as_of: `${TODAY}T13:44:00-04:00`,
          row: LIVE_ROW, accuracy: {}, carried: {}, partial_session: [],
        } : { ok: false, reason: 'unavailable' }),
      })
    }
    if (u.includes('/api/breadth-monitor')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ rows: ROWS }) })
    }
    if (u.includes('/api/auth/preferences')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(opts?.method === 'POST' ? { ok: true } : {}),
      })
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
  }))
}

const chart = async () => {
  await waitFor(() => expect(screen.getByTestId('echart')).toBeInTheDocument())
  await waitFor(() => expect(captured).toBeTruthy())
  return captured
}

const metricSeries = opt => opt.series.filter(s => !s.name.startsWith('__'))

beforeEach(() => { captured = null })

describe('Data Charts with a provisional reading', () => {
  it('extends each line to the live point without replacing a stored one', async () => {
    stubFetch()
    render(<BreadthCharts />)
    const opt = await chart()
    for (const s of metricSeries(opt)) {
      expect(s.data).toHaveLength(ROWS.length + 1)
      expect(s.data.at(-1)[0]).toBe(TODAY)
      expect(s.data.at(-2)[0]).toBe(ROWS.at(-1).date)
    }
  })

  it('marks the tip of every line and nothing else', async () => {
    stubFetch()
    render(<BreadthCharts />)
    const opt = await chart()
    for (const s of metricSeries(opt)) {
      expect(typeof s.symbol).toBe('function')
      expect(s.symbol(null, { dataIndex: ROWS.length })).toBe('circle')
      expect(s.symbol(null, { dataIndex: ROWS.length - 1 })).toBe('none')
      expect(s.symbol(null, { dataIndex: 0 })).toBe('none')
    }
  })

  it('draws a NOW line at the live date, stamped with the time', async () => {
    stubFetch()
    render(<BreadthCharts />)
    const opt = await chart()
    const now = opt.series.find(s => s.name === '__live_now__')
    expect(now).toBeTruthy()
    expect(now.markLine.data[0].xAxis).toBe(TODAY)
    expect(now.markLine.label.formatter).toMatch(/^LIVE \d/)
    expect(now.markLine.lineStyle.type).toBe('dashed')
  })

  it('keeps the NOW marker out of the legend', async () => {
    // It is a chart annotation, not a metric the user chose to plot.
    stubFetch()
    render(<BreadthCharts />)
    const opt = await chart()
    expect(opt.legend.data).not.toContain('__live_now__')
  })

  it('plots history alone when there is no live reading', async () => {
    stubFetch({ live: false })
    render(<BreadthCharts />)
    const opt = await chart()
    expect(opt.series.find(s => s.name === '__live_now__')).toBeUndefined()
    for (const s of metricSeries(opt)) {
      expect(s.data).toHaveLength(ROWS.length)
      expect(s.symbol).toBe('none')
    }
  })

  it('plots history alone when the reading is degraded', async () => {
    // Degraded means bars measured a different population — plotting it would
    // put a point from another market on the end of this line.
    stubFetch({ degraded: true })
    render(<BreadthCharts />)
    const opt = await chart()
    expect(opt.series.find(s => s.name === '__live_now__')).toBeUndefined()
    for (const s of metricSeries(opt)) expect(s.data).toHaveLength(ROWS.length)
  })
})
