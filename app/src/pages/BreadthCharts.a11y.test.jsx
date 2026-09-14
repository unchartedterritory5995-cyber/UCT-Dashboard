// app/src/pages/BreadthCharts.a11y.test.jsx
//
// A-24: the metric group toggles opened and closed a list without saying so, and
// Notable Extremes switched lines on and off without saying which it was.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import { SWRConfig } from 'swr'
import BreadthCharts from './BreadthCharts'
import { todayET, shiftISO } from './breadth/sessionDates'

vi.mock('echarts-for-react', () => ({ default: () => <div data-testid="echart" /> }))

const ROWS = Array.from({ length: 10 }, (_, i) => ({
  date: shiftISO(todayET(), i - 9), breadth_score: 50 + i, pct_above_50sma: 40 + i,
}))

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn((url, opts) => {
    const u = String(url)
    const body = u.includes('/api/breadth-monitor/live') ? { ok: false }
      : u.includes('/api/breadth-monitor') ? { rows: ROWS }
      : u.includes('/api/auth/preferences') ? (opts?.method === 'POST' ? { ok: true } : {}) : {}
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })
  }))
})

// A fresh cache per render, and App.jsx's focus policy so a focus event is not a fetch.
const renderTab = async () => {
  render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}><BreadthCharts /></SWRConfig>)
  await waitFor(() => expect(screen.getByTestId('echart')).toBeInTheDocument())
}

describe('metric group toggles (A-24)', () => {
  it('say whether their list is open, and point at it', async () => {
    await renderTab()
    const toggle = screen.getByRole('button', { name: /^Regime/ })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    const list = document.getElementById(toggle.getAttribute('aria-controls'))
    expect(within(list).getByLabelText('VIX')).toBeInTheDocument()
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
  })
})

describe('Notable Extremes (A-24)', () => {
  it('says whether it is on', async () => {
    await renderTab()
    fireEvent.click(screen.getByRole('button', { name: /^MA Breadth/ }))
    const extremes = screen.getByRole('button', { name: /Notable Extremes/ })
    expect(extremes.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(extremes)
    await waitFor(() => expect(screen.getByRole('button', { name: /Notable Extremes/ }).getAttribute('aria-pressed')).toBe('true'))
  })
})
