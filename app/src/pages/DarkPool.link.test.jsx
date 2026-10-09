// `/dark-pool?ticker=NVDA` — the terminal's `NVDA DP` (wave 4, lane A). The page opens its own
// ticker search on the linked name; without a ticker it opens as it always did.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

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

  it('without a ticker the page opens with no search over it', async () => {
    window.history.replaceState({}, '', '/dark-pool')
    mockFetch()
    render(<DarkPool />)
    await screen.findByText('DARK POOL SCANNER')
    expect(screen.queryByLabelText('Search ticker')).toBeNull()
  })
})
