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
      data-has-afterbody={typeof options?.plugins?.tooltip?.callbacks?.afterBody === 'function' ? '1' : '0'}
    />
  ),
}))

vi.mock('../hooks/useBreakpoint', () => ({ useIsTouch: () => false }))

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

describe('CotData — one fetch per symbol, lookback slices client-side', () => {
  let fetchMock
  beforeEach(() => {
    fetchMock = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(mkRows(520)) }))
    global.fetch = fetchMock
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('fetches the full history once and shows the 1Y slice with the positioning rail', async () => {
    render(<CotData />)
    await waitFor(() => expect(screen.getAllByTestId('chart')).toHaveLength(4))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/cot/ES?weeks=520')

    // Every pane shows the 1Y slice, not the full fetch.
    for (const el of screen.getAllByTestId('chart')) {
      expect(el.dataset.points).toBe('52')
      expect(el.dataset.hasAfterbody).toBe('1')
    }
    // The rail is on the page with its read.
    expect(screen.getByText('Positioning')).toBeInTheDocument()
    expect(screen.getByText('What this means')).toBeInTheDocument()
  })

  it('switching lookback re-slices without another request', async () => {
    render(<CotData />)
    await waitFor(() => expect(screen.getAllByTestId('chart')).toHaveLength(4))

    fireEvent.click(screen.getByRole('button', { name: '3Y' }))
    await waitFor(() => {
      for (const el of screen.getAllByTestId('chart')) expect(el.dataset.points).toBe('156')
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
