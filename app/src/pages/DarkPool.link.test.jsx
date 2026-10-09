// `/dark-pool?ticker=NVDA` — the terminal's `NVDA DP` (wave 4, lane A). The page opens its own
// ticker search on the linked name; without a ticker it opens as it always did.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'

vi.mock('../components/TickerPopup', () => ({ default: ({ sym, children }) => <span>{children || sym}</span> }))
vi.mock('../components/chart/pane/ChartPane', () => ({ default: () => <div data-testid="chart-pane" /> }))

import DarkPool, { linkTickerFrom } from './DarkPool'

const item = (t, n) => ({ t, cat: 'Mega Cap Tech', last: 100, lo: 95, hi: 105, bigPrint: 98, n, c: 12, days: 3, top5: [] })
const payload = () => ({
  dates: ['2026-10-08'], allItems: [item('NVDA', 5e9), item('AMD', 2e9)],
  categories: [{ name: 'Mega Cap Tech', items: [item('NVDA', 5e9), item('AMD', 2e9)], count: 2, n: 7e9 }],
  above: [], below: [], unusual: [], phantom: [], options: [], alpha: [], themes: [],
  meta: { tradingDays: 1, totalTrades: 10, totalTickers: 2, totalNotional: 7e9, dateRange: 'Oct 8' },
})

afterEach(() => { cleanup(); vi.restoreAllMocks(); window.history.replaceState({}, '', '/') })

function mockFetch() {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    const u = String(url)
    if (u.startsWith('/api/darkpool/aggregated')) return { ok: true, status: 200, json: async () => payload() }
    return { ok: true, status: 200, json: async () => ({}) }
  })
}

describe('linkTickerFrom', () => {
  it('reads a ticker, upper-cased, and refuses anything that is not one', () => {
    expect(linkTickerFrom('?ticker=nvda')).toBe('NVDA')
    expect(linkTickerFrom('?ticker=BRK.B')).toBe('BRK.B')
    expect(linkTickerFrom('?ticker=%24TSLA')).toBe('TSLA')
    expect(linkTickerFrom('?ticker=<script>')).toBe('')
    expect(linkTickerFrom('')).toBe('')
  })
})

describe('/dark-pool?ticker=', () => {
  it('opens the ticker search on the linked name', async () => {
    window.history.replaceState({}, '', '/dark-pool?ticker=NVDA')
    mockFetch()
    render(<DarkPool />)
    const input = await screen.findByLabelText('Search ticker')
    expect(input.value).toBe('NVDA')
    expect(screen.getByText('1 result for "NVDA"')).toBeTruthy()
  })

  // Wave 6 (lane A): a linked name with no prints said "No tickers found.", which read as if
  // the ticker did not exist. A typed search with no match keeps the old line.
  it('a linked ticker with no prints says so by name', async () => {
    window.history.replaceState({}, '', '/dark-pool?ticker=ZZZZ')
    mockFetch()
    render(<DarkPool />)
    expect(await screen.findByText('No dark pool prints for ZZZZ in this window.')).toBeTruthy()
    expect(screen.queryByText('No tickers found.')).toBeNull()
  })

  it('a typed search with no match keeps "No tickers found."', async () => {
    window.history.replaceState({}, '', '/dark-pool?ticker=ZZZZ')
    mockFetch()
    render(<DarkPool />)
    const input = await screen.findByLabelText('Search ticker')
    fireEvent.change(input, { target: { value: 'QQQQ' } })
    expect(screen.getByText('No tickers found.')).toBeTruthy()
    expect(screen.queryByText(/No dark pool prints/)).toBeNull()
  })

  it('without a ticker the page opens with no search over it', async () => {
    window.history.replaceState({}, '', '/dark-pool')
    mockFetch()
    render(<DarkPool />)
    await screen.findByText('DARK POOL SCANNER')
    expect(screen.queryByLabelText('Search ticker')).toBeNull()
  })
})
