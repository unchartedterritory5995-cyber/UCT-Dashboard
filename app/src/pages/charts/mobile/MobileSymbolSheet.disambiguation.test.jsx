// @vitest-environment jsdom
/* Item 5 — the phone symbol sheet stops throwing the answer away at the door.
 *
 * ⛔ THE DEFECT WAS NOT A MISSING FEATURE. `/api/ticker-search` already returned
 * `type`, `exchange`, `delisted` + `delisted_date`, and breadth `group_label`;
 * the DESKTOP dropdown already rendered all of it. The phone consumed the same
 * rows and drew a logo, a ticker and a name — so a delisted ticker looked exactly
 * like a live one and tapping it produced a dead chart, with nothing on screen
 * having warned anybody. Every layer looked correct, which is why it lasted.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import MobileSymbolSheet from './MobileSymbolSheet'

vi.mock('../../../components/mobile/haptics', () => ({ default: { tap: () => {} } }))
vi.mock('../../../components/CompanyLogo', () => ({ default: () => <span data-testid="logo" /> }))

const ROWS = [
  { ticker: 'AAPL', name: 'Apple Inc.', type: 'stock', exchange: 'NASDAQ' },
  { ticker: 'SPY', name: 'SPDR S&P 500 ETF Trust', type: 'etf', exchange: 'ARCA' },
  { ticker: 'YHOO', name: 'Yahoo! Inc.', type: 'delisted', delisted: true, delisted_date: '2017-06-13' },
  { ticker: 'UCTA50', name: '% above 50-day', type: 'breadth', breadth: true, group_label: 'MA breadth' },
]

let urls
beforeEach(() => {
  cleanup()
  urls = []
  global.fetch = vi.fn((url) => {
    urls.push(String(url))
    if (String(url).includes('/api/breadth-symbols')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ symbols: [{ symbol: 'UCTA50', name: '% above 50-day', group: 'MA breadth' }] }) })
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ results: ROWS }) })
  })
})

const open = (props = {}) => {
  const onPick = vi.fn()
  render(<MobileSymbolSheet open onClose={() => {}} onPick={onPick} {...props} />)
  return { onPick }
}
const type = async (v) => {
  fireEvent.change(screen.getByLabelText('Search symbol'), { target: { value: v } })
  await waitFor(() => expect(screen.queryByText('Apple Inc.')).toBeTruthy())
}

describe('a row now says WHAT the symbol is', () => {
  it('⛔ a DELISTED ticker is labelled, with the year — you are warned before you tap', async () => {
    open(); await type('A')
    expect(screen.getByText('Delisted 2017')).toBeTruthy()
  })

  it('an ETF is distinguishable from an operating company', async () => {
    open(); await type('A')
    expect(screen.getByText('ETF')).toBeTruthy()
  })

  it('a UCT breadth pseudo-ticker does not masquerade as a company', async () => {
    open(); await type('A')
    expect(screen.getByText('BREADTH')).toBeTruthy()
  })

  it('a plain stock carries its EXCHANGE — the thing that disambiguates two stocks', async () => {
    open(); await type('A')
    expect(screen.getByText('NASDAQ')).toBeTruthy()
  })

  it('picking still works and still returns just the ticker', async () => {
    const { onPick } = open(); await type('A')
    fireEvent.click(screen.getByText('Apple Inc.').closest('button'))
    expect(onPick).toHaveBeenCalledWith('AAPL')
  })
})

describe('the category chips the API already supported', () => {
  it('offers the same five categories as the desktop dropdown', () => {
    open()
    for (const label of ['All', 'Stocks', 'ETFs', 'Indices', 'Breadth'])
      expect(screen.getByRole('tab', { name: label })).toBeTruthy()
  })

  it('sends the type filter to the backend', async () => {
    open()
    fireEvent.click(screen.getByRole('tab', { name: 'ETFs' }))
    fireEvent.change(screen.getByLabelText('Search symbol'), { target: { value: 'S' } })
    await waitFor(() => expect(urls.some((u) => u.includes('type=etf'))).toBe(true))
  })

  it('Indices is answered from the closed client-side list — no round trip', async () => {
    open()
    fireEvent.click(screen.getByRole('tab', { name: 'Indices' }))
    fireEvent.change(screen.getByLabelText('Search symbol'), { target: { value: 'SP' } })
    await waitFor(() => expect(screen.getByText('S&P 500 Index')).toBeTruthy())
    expect(urls.filter((u) => u.includes('/api/ticker-search'))).toHaveLength(0)
  })

  it('CONTROL — the "All" chip does NOT send a type, so the filter test means something', async () => {
    open(); await type('A')
    const searches = urls.filter((u) => u.includes('/api/ticker-search'))
    expect(searches.length).toBeGreaterThan(0)
    expect(searches.every((u) => !u.includes('type='))).toBe(true)
  })
})
