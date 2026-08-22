import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Chart.js cannot draw on jsdom's stub canvas. The panes' options are the
// contract under test, so the mock renders them as data attributes instead.
vi.mock('react-chartjs-2', () => ({
  Chart: ({ type, data, options }) => (
    <div
      data-testid="chart"
      data-type={type}
      data-points={data?.labels?.length ?? 0}
      data-has-external-tip={typeof options?.plugins?.tooltip?.external === 'function' && options?.plugins?.tooltip?.enabled === false ? '1' : '0'}
    />
  ),
}))

vi.mock('../hooks/useBreakpoint', () => ({ useIsTouch: () => false, useIsPhone: () => false }))

import CotData from './CotData'

function mkRows(n) {
  const out = []
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(2016, 0, 5 + i * 7))
    out.push({
      date: d.toISOString().slice(0, 10),
      commercial_net: -100_000 + i * 100,
      large_spec_net:  50_000 - i * 50,
      small_spec_net:  10_000,
      open_interest:   1_500_000 + i * 500,
    })
  }
  return out
}

// Weekly proxy bars: one Friday close per report week, a gentle uptrend.
function mkBars(n) {
  const out = []
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(2016, 0, 8 + i * 7))   // Fridays, 3 days after each Tuesday report
    out.push({ t: d.toISOString().slice(0, 10), o: 100 + i, h: 101 + i, l: 99 + i, c: 100 + i * 0.5, v: 1000 })
  }
  return out
}

function routeFetch(url) {
  if (url.startsWith('/api/cot/') && url.includes('/narratives')) {
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ rows: [] }) })
  }
  if (url.startsWith('/api/cot/') && url.includes('/narrative')) {
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: 'disabled', text: null }) })
  }
  if (url.startsWith('/api/cot/')) return Promise.resolve({ ok: true, json: () => Promise.resolve(mkRows(520)) })
  if (url.startsWith('/api/bars/')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ bars: mkBars(600) }) })
  return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) })
}

describe('CotData — one fetch per symbol, lookback slices client-side', () => {
  let fetchMock
  beforeEach(() => {
    fetchMock = vi.fn(url => routeFetch(String(url)))
    globalThis.fetch = fetchMock
  })
  afterEach(() => { vi.restoreAllMocks() })

  const cotCalls  = () => fetchMock.mock.calls.filter(c => String(c[0]).startsWith('/api/cot/') && !String(c[0]).includes('narrative'))
  const barsCalls = () => fetchMock.mock.calls.filter(c => String(c[0]).startsWith('/api/bars/'))

  it('fetches the full history once, the SPY proxy once, and shows the 1Y slice with the rail', async () => {
    render(<CotData />)
    // 3 group panes + OI + the price pane (ES → SPY)
    await waitFor(() => expect(screen.getAllByTestId('chart')).toHaveLength(5))

    expect(cotCalls()).toHaveLength(1)
    expect(cotCalls()[0][0]).toBe('/api/cot/ES?weeks=520')
    expect(barsCalls()).toHaveLength(1)
    expect(barsCalls()[0][0]).toBe('/api/bars/SPY?tf=W&bars=600')

    // Every pane shows the 1Y slice, not the full fetch.
    for (const el of screen.getAllByTestId('chart')) {
      expect(el.dataset.points).toBe('52')
      expect(el.dataset.hasExternalTip).toBe('1')
    }
    // The rail is on the page with its read.
    expect(screen.getByText('Positioning')).toBeInTheDocument()
    // The narrative mock answers 'disabled' → the templated read takes over.
    await waitFor(() => expect(screen.getByText('What this means')).toBeInTheDocument())
    expect(screen.getByText(/Price · SPY/)).toBeInTheDocument()
  })

  it('switching lookback re-slices without another request', async () => {
    render(<CotData />)
    await waitFor(() => expect(screen.getAllByTestId('chart')).toHaveLength(5))

    fireEvent.click(screen.getByRole('button', { name: '3Y' }))
    await waitFor(() => {
      for (const el of screen.getAllByTestId('chart')) expect(el.dataset.points).toBe('156')
    })
    expect(cotCalls()).toHaveLength(1)
    expect(barsCalls()).toHaveLength(1)
  })
})
