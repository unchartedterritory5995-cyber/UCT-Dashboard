// DarkPool hooks order. SearchResultsTable called useState AFTER its empty-list return. With a
// single hook React does not throw on that; it silently restarts the state, so a row the member
// opened snapped shut after an empty pass (a second hook would have made it a crash). The
// category jump cleared the parent's state from inside a useMemo, which React reports as
// updating one component while rendering another.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'

vi.mock('../components/TickerPopup', () => ({ default: ({ sym, children }) => <span>{children || sym}</span> }))
vi.mock('../components/chart/pane/ChartPane', () => ({ default: () => <div data-testid="chart-pane" /> }))

import DarkPool, { SearchResultsTable } from './DarkPool'

const item = (t, n, extra = {}) => ({ t, cat: 'Mega Cap Tech', last: 100, lo: 95, hi: 105, bigPrint: 98, n, c: 12, days: 3, top5: [], prices: [], w: [], ...extra })

afterEach(() => { cleanup(); vi.restoreAllMocks(); window.history.replaceState({}, '', '/') })

describe('SearchResultsTable', () => {
  it('survives going from no rows to rows and back', () => {
    const { rerender, container } = render(<SearchResultsTable items={[]} />)
    expect(container.querySelector('table')).toBeNull()
    rerender(<SearchResultsTable items={[item('NVDA', 5e9)]} />)
    expect(screen.getByText('$NVDA')).toBeTruthy()
    rerender(<SearchResultsTable items={[]} />)
    expect(container.querySelector('table')).toBeNull()
    rerender(<SearchResultsTable items={[item('AMD', 2e9)]} />)
    expect(screen.getByText('$AMD')).toBeTruthy()
  })

  // With the hook after the early return, React keeps no hook list for the empty render, so
  // the next filled render starts from scratch and the opened row snaps shut.
  it('keeps the opened row through an empty pass', () => {
    const rows = [item('NVDA', 5e9), item('AMD', 2e9)]
    const { rerender } = render(<SearchResultsTable items={rows} />)
    fireEvent.click(screen.getAllByTitle('Click to show dark pool chart')[0])
    expect(screen.getAllByTitle('Click to hide chart')).toHaveLength(1)
    rerender(<SearchResultsTable items={[]} />)
    rerender(<SearchResultsTable items={rows} />)
    expect(screen.getAllByTitle('Click to hide chart')).toHaveLength(1)
  })
})

describe('category jump', () => {
  it('opens the category tab without updating the page mid-render', async () => {
    const notable = item('ZXQ', 3e9, { cat: 'Large Cap', signals: ['big'], bigPrintN: 2e8 })
    const payload = {
      dates: ['2026-10-08'], allItems: [item('NVDA', 5e9), notable],
      categories: [
        { name: 'Mega Cap Tech', items: [item('NVDA', 5e9)], count: 1, n: 5e9 },
        { name: 'Large Cap', items: [notable], count: 1, n: 3e9 },
      ],
      above: [], below: [], unusual: [], phantom: [], options: [], alpha: [], themes: [],
      meta: { tradingDays: 1, totalTrades: 10, totalTickers: 2, totalNotional: 8e9, dateRange: 'Oct 8' },
    }
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const u = String(url)
      if (u.startsWith('/api/darkpool/aggregated')) return { ok: true, status: 200, json: async () => payload }
      return { ok: true, status: 200, json: async () => ({}) }
    })
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<DarkPool />)
    await screen.findByText('DARK POOL SCANNER')
    const links = await screen.findAllByText('ZXQ')
    fireEvent.click(links[0])
    expect(await screen.findByRole('button', { name: 'Mega Cap Tech' })).toBeTruthy()
    const renderUpdate = errors.mock.calls.filter(c => /while rendering a different component/.test(String(c[0])))
    expect(renderUpdate).toEqual([])
  })
})
