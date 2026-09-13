// app/src/pages/BreadthCharts.mechanics.test.jsx
//
// What the member set must survive a rebuild: the zoom window (A-07) and a hidden
// series (A-08). The chart draws once, then updates instantly (02-design §7). Ticks
// carry the year (A-06); a flattened series is announced (A-04); Notable Extremes
// appears only in the group where it draws (A-22). Asserted on what ECharts is handed.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import { SWRConfig } from 'swr'
import BreadthCharts from './BreadthCharts'
import { todayET, shiftISO } from './breadth/sessionDates'

let captured = null
let events = null
vi.mock('echarts-for-react', () => ({
  default: (props) => { captured = props.option; events = props.onEvents; return <div data-testid="echart" /> },
}))

const ROWS = Array.from({ length: 40 }, (_, i) => ({
  date: shiftISO(todayET(), i - 39),
  breadth_score: 60 + (i % 9), pct_above_50sma: 45 + (i % 7),
  universe_count: 3000 + i, new_52w_lows: 10 + (i % 5), new_52w_highs: 40 + (i % 6),
}))

beforeEach(() => {
  captured = null
  events = null
  vi.stubGlobal('fetch', vi.fn((url, opts) => {
    const u = String(url)
    const body = u.includes('/api/breadth-monitor/live') ? { ok: false }
      : u.includes('/api/breadth-monitor') ? { rows: ROWS }
      : u.includes('/api/auth/preferences') ? (opts?.method === 'POST' ? { ok: true } : {}) : {}
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })
  }))
})

// A fresh cache per render, and App.jsx's focus policy so a focus event is not a fetch.
const renderTab = () => render(
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}><BreadthCharts /></SWRConfig>,
)
const chart = async () => {
  await waitFor(() => expect(captured?.series?.length).toBeGreaterThan(0))
  return captured
}

describe('zoom survives rebuilds (A-07)', () => {
  it('holds the window the member zoomed to across a selection change', async () => {
    renderTab()
    await chart()
    act(() => events.datazoom({ batch: [{ start: 50, end: 100 }] }))
    const from = ROWS[20].date
    await waitFor(() => expect(captured.dataZoom[0].startValue).toBe(from))
    expect(captured.dataZoom[1].startValue).toBe(from)
    expect(captured.dataZoom[0].endValue).toBe(ROWS[39].date)

    fireEvent.click(screen.getByRole('button', { name: /^Highs \/ Lows/ }))
    fireEvent.click(screen.getByLabelText('52W Highs (Close)'))
    await waitFor(() => expect(captured.series.some(s => s.name === '52W Highs (Close)')).toBe(true))
    expect(captured.dataZoom[0].startValue).toBe(from)
  })

  // CONTROL: a new date range is a new domain; the old zoom does not carry into it.
  it('lets a changed range drop the zoom', async () => {
    renderTab()
    await chart()
    act(() => events.datazoom({ batch: [{ start: 50, end: 100 }] }))
    await waitFor(() => expect(captured.dataZoom[0].startValue).toBe(ROWS[20].date))
    fireEvent.change(screen.getByLabelText('From'), { target: { value: ROWS[5].date } })
    await waitFor(() => expect(captured.dataZoom[0].startValue).toBeUndefined())
  })
})

describe('a hidden series stays hidden (A-08)', () => {
  it('writes the readout\'s hidden set into the option, so a rebuild re-applies it', async () => {
    renderTab()
    await chart()
    fireEvent.click(screen.getByRole('button', { name: /^Health Score/ }))
    await waitFor(() => expect(captured.legend.selected['Health Score']).toBe(false))
    expect(captured.legend.selected['% Above 50SMA']).toBe(true)
    fireEvent.click(screen.getByLabelText(/Follow-through days/))
    await waitFor(() => expect(captured.series.length).toBeGreaterThan(0))
    expect(captured.legend.selected['Health Score']).toBe(false)
  })
})

describe('motion (02-design §7)', () => {
  it('draws once, then updates instantly', async () => {
    renderTab()
    const opt = await chart()
    expect(opt.animationDurationUpdate).toBe(0)
    expect(opt.animationDuration).toBe(400)
    act(() => events.finished())
    await waitFor(() => expect(captured.animationDuration).toBe(0))
  })
})

describe('ticks and tooltip carry the year (A-06)', () => {
  it('formats a short window as month and day, and the tooltip header with the weekday and year', async () => {
    renderTab()
    const opt = await chart()
    expect(opt.xAxis.axisLabel.formatter(ROWS[1].date, 1)).toMatch(/^[A-Z][a-z]{2} \d{1,2}(, \d{4})?$/)
    expect(opt.xAxis.axisLabel.interval).toBe('auto')
    const header = opt.tooltip.formatter([{ axisValue: '2026-09-11', value: ['2026-09-11', 50], color: '#fff', seriesName: 'Health Score' }])
    expect(header).toContain('Fri, Sep 11, 2026')
  })
})

describe('a flattened series is announced (A-04)', () => {
  it('names the series, the factor and the axis', async () => {
    renderTab()
    await chart()
    fireEvent.click(screen.getByRole('button', { name: /^Primary Breadth/ }))
    fireEvent.click(screen.getByLabelText('Universe Count'))
    fireEvent.click(screen.getByRole('button', { name: /^Highs \/ Lows/ }))
    fireEvent.click(screen.getByLabelText('52W Lows (Close)'))
    expect(await screen.findByText(/^52W Lows \(Close\) is \d+× smaller than Universe Count on this axis\.$/))
      .toBeInTheDocument()
  })

  // CONTROL: the default selection is two percentages within the limit.
  it('says nothing when the series share a scale', async () => {
    renderTab()
    await chart()
    expect(screen.queryByText(/smaller than .* on this axis/)).not.toBeInTheDocument()
  })
})

describe('Notable Extremes (A-22)', () => {
  it('appears only in MA Breadth, the group whose lines it draws', async () => {
    renderTab()
    await chart()
    fireEvent.click(screen.getByRole('button', { name: /^Regime/ }))
    expect(screen.queryByRole('button', { name: /Notable Extremes/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^MA Breadth/ }))
    expect(screen.getByRole('button', { name: /Notable Extremes/ })).toBeInTheDocument()
  })
})
