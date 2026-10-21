// Market on my names (Task 14): rendered from the frozen params, never fetched.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import MarketOnMyNamesEmbed from './MarketOnMyNamesEmbed'
import { widgetEmbedNode } from '../../../lib/notebookWidgets'

const PAYLOAD = {
  asOf: '2026-10-20T13:14:00Z',
  source: 'market',
  sectorBasis: 'your names',
  rows: [
    { symbol: 'NVDA', ret5d: 10, sector: 'Technology', sectorRet5d: 6, vsSector: 4 },
    { symbol: 'AMD', ret5d: 2, sector: 'Technology', sectorRet5d: 6, vsSector: -4 },
    { symbol: 'XOM', ret5d: -5, sector: 'Traditional Energy', sectorRet5d: null, vsSector: null },
    { symbol: 'NEWCO', ret5d: null, sector: null, sectorRet5d: null, vsSector: null },
  ],
  truncated: 3,
}

let fetchSpy
beforeEach(() => {
  fetchSpy = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }))
  vi.stubGlobal('fetch', fetchSpy)
})
afterEach(() => vi.unstubAllGlobals())

const mount = (payload = PAYLOAD) =>
  render(<MarketOnMyNamesEmbed attrs={widgetEmbedNode('marketOnMyNames', payload).attrs} />)

describe('MarketOnMyNamesEmbed', () => {
  it('renders_from_params_without_fetch, signed percents, and says how the sector figure was made', () => {
    mount()
    expect(screen.getByText('Market on my names')).toBeInTheDocument()
    const nvda = screen.getByText('NVDA').closest('tr')
    expect(nvda).toHaveTextContent('+10.00%')
    expect(nvda).toHaveTextContent('Technology')
    expect(nvda).toHaveTextContent('+6.00%')
    expect(nvda).toHaveTextContent('+4.00%')
    // colour is never the only signal: a lagging name carries its minus sign
    expect(screen.getByText('AMD').closest('tr')).toHaveTextContent('-4.00%')
    expect(screen.getByText(/Sector figure: the average of your names in that sector\./)).toBeInTheDocument()
    expect(screen.getByText(/3 more not shown\./)).toBeInTheDocument()
    expect(fetchSpy).toHaveBeenCalledTimes(0)
  })

  it('a null cell is n/a with a reason in its title', () => {
    mount()
    const xom = screen.getByText('XOM').closest('tr')
    const xomNa = within(xom).getAllByText('n/a')
    expect(xomNa.length).toBe(2)
    expect(xomNa[0].getAttribute('title')).toBe('Only one of your names is in this sector')
    const newco = screen.getByText('NEWCO').closest('tr')
    const nas = within(newco).getAllByText('n/a')
    expect(nas.length).toBe(4)
    expect(nas[0].getAttribute('title')).toBe('Fewer than six daily bars on record')
    expect(nas[1].getAttribute('title')).toBe('Not in the theme taxonomy')
    for (const na of nas) expect(na.getAttribute('title')).toBeTruthy()
  })

  it('an empty capture says so in words', () => {
    mount({ asOf: PAYLOAD.asOf, source: 'market', rows: [], empty: 'No names in your positions, watchlist or flagged list.' })
    expect(screen.getByText('No names in your positions, watchlist or flagged list.')).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
  })
})
