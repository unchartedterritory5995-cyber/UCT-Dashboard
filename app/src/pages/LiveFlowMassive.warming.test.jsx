// L11 (2026-10-08) — Live Flow right after a flow-worker restart.
//
// A `warming` answer from /api/live/massive/recent can now carry the last
// saved tape (the worker's last-good snapshot, restored from disk after a
// restart, marked status.restored_from_disk). The page must SHOW those rows,
// labelled, instead of sitting on 0 alerts. An empty warming stub must still
// show no rows (and no false label). Same mocking idiom as
// LiveFlowMassive.rightclick.test.jsx.
import { renderWithProviders, screen } from '../test-utils'
import { vi, afterEach, test, expect } from 'vitest'

vi.mock('../utils/prefetchBars', () => ({
  prefetchAllTimeframes: vi.fn(),
  prefetchBars: vi.fn(),
  prefetchBar: vi.fn(),
  default: vi.fn(),
}))
vi.mock('../components/StockChart', () => ({
  default: ({ sym, tf }) => <div data-testid={`stock-chart-${sym}-${tf}`}>chart {sym} {tf}</div>,
}))

import LiveFlowMassive from './LiveFlowMassive'

const NOW = Math.floor(Date.now() / 1000)
const ALERTS = [
  { id: 'a1', ticker: 'AAPL', cp: 'C', strike: 150, exp: '2026-09-19',
    alertPremium: 500000, alertName: 'UCT Bullish', _tierKey: 'bullish', _direction: 'Bull', timestamp: NOW },
]

function mockFetch(recentBody) {
  vi.stubGlobal('fetch', vi.fn((url) => {
    const u = String(url)
    if (u.includes('/api/live/massive/recent')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(recentBody) })
    }
    if (u.includes('/api/live/massive/day-stats')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          total_classified: 0, query_date: '2026-10-08',
          bull_premium: 0, bear_premium: 0,
          last_hour: { bull_premium: 0, bear_premium: 0, count: 0, is_today_target: false },
          top_bull: [], top_bear: [], by_dte: [],
        }),
      })
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) })
  }))
}

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})

test('a warming answer that carries the saved tape shows its rows, labelled', async () => {
  localStorage.clear()
  mockFetch({
    warming: true,
    alerts: ALERTS,
    status: { connected: true, warming: true, restored_from_disk: true,
              snapshot_saved_at: '2026-10-08T10:31:05-04:00' },
  })
  renderWithProviders(<LiveFlowMassive />)
  expect(await screen.findByTitle('Filter to AAPL')).toBeInTheDocument()
  const note = await screen.findByTestId('lfm-warming-note')
  expect(note.textContent).toMatch(/showing the tape saved at .+ while the live feed warms up/)
})

test('control: an empty warming stub shows no rows and no restored label', async () => {
  localStorage.clear()
  mockFetch({ warming: true, alerts: [], status: { connected: true, warming: true } })
  renderWithProviders(<LiveFlowMassive />)
  // Give the first poll time to land, then assert nothing was painted.
  await new Promise((r) => setTimeout(r, 300))
  expect(screen.queryByTitle('Filter to AAPL')).not.toBeInTheDocument()
  expect(screen.queryByText(/showing the tape saved at/)).not.toBeInTheDocument()
})
