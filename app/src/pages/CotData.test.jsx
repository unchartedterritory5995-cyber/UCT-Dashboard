import { render, screen, waitFor } from '@testing-library/react'
import { vi, beforeEach, test, expect } from 'vitest'

// Packet N CP1 (signed 2026-09-22, fingerprint d411866cd).

let mockSwrData = {}
vi.mock('swr', () => ({
  default: (key) => {
    const k = typeof key === 'string' ? key : String(key)
    if (k.includes('/api/cot/status')) return { data: mockSwrData.status }
    if (k.includes('/api/cot/symbols')) return { data: mockSwrData.symbols }
    return { data: null }
  },
}))

// Chart.js/react-chartjs-2 render real canvases jsdom can't measure -- not
// under test here, so stub the chart area to keep this a fast, focused test
// of the wiring (fetch calls + picker/freshness rendering), not the charts.
vi.mock('react-chartjs-2', () => ({ Chart: () => <div data-testid="chart-stub" /> }))
vi.mock('./cot/PositioningRail', () => ({ default: () => null }))

// A real fetch would hit /api/cot/{symbol} (expects a raw array response,
// per CotData.jsx's own `data.slice(-weeks)`) and /api/bars/{ticker}
// (expects `{bars: [...]}`) on mount -- stub global fetch URL-aware so both
// settle to "no data yet" rather than erroring or racing real endpoints.
global.fetch = vi.fn((url) => {
  const body = String(url).includes('/api/bars/') ? { bars: [] } : []
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body) })
})

import CotData from './CotData'

beforeEach(() => {
  mockSwrData = {
    status: { last_updated: '2026-09-19 15:50:00', record_count: 128340, last_status: 'ok' },
    symbols: {
      groups: {
        INDICES: [{ symbol: 'ES', name: 'S&P 500 E-Mini' }, { symbol: 'NK', name: 'Nikkei 225' }],
      },
    },
  }
})

test('fetches /api/cot/status on mount and renders the freshness line', async () => {
  render(<CotData />)
  await waitFor(() => {
    expect(screen.getByText(/Data through 2026-09-19 15:50:00/)).toBeTruthy()
  })
})

test('no freshness line renders when /status has not resolved yet', () => {
  mockSwrData.status = null
  render(<CotData />)
  expect(screen.queryByText(/Data through/)).toBeNull()
})

test('the live "INDICES" group from /api/cot/symbols is reachable from the picker', async () => {
  render(<CotData />)
  const dropdownBtn = await screen.findByRole('button', { name: /ES/ })
  dropdownBtn.click()
  await waitFor(() => {
    expect(screen.getByText('INDICES')).toBeTruthy()
  })
})

test('falls back to the hardcoded symbol list without crashing when /symbols has not resolved', async () => {
  mockSwrData.symbols = null
  render(<CotData />)
  const dropdownBtn = await screen.findByRole('button', { name: /ES/ })
  dropdownBtn.click()
  await waitFor(() => {
    // The fallback's own "MOST WATCHED" group name, never a blank picker.
    expect(screen.getByText('MOST WATCHED')).toBeTruthy()
  })
})
