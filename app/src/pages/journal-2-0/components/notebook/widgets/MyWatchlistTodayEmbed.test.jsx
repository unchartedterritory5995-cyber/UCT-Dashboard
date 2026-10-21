// My watchlist today (Task 7): rendered from the frozen params, never fetched.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import MyWatchlistTodayEmbed from './MyWatchlistTodayEmbed'
import { widgetEmbedNode } from '../../../lib/notebookWidgets'

const PAYLOAD = {
  asOf: '2026-10-20T13:14:00Z',
  source: 'market',
  listLabel: 'Watchlist',
  rows: [
    { symbol: 'NVDA', price: 187.4, changePct: 1.8, earningsDay: '2026-10-22' },
    { symbol: 'CELH', price: 41.2, changePct: -4.2, earningsDay: null },
    { symbol: 'ANET', price: null, changePct: null, earningsDay: null },
  ],
  truncated: 2,
}

let fetchSpy
beforeEach(() => {
  fetchSpy = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }))
  vi.stubGlobal('fetch', fetchSpy)
})
afterEach(() => vi.unstubAllGlobals())

describe('MyWatchlistTodayEmbed', () => {
  it('renders_from_params_without_fetch', () => {
    render(<MyWatchlistTodayEmbed attrs={widgetEmbedNode('myWatchlistToday', PAYLOAD).attrs} />)
    expect(screen.getByText('My watchlist today')).toBeInTheDocument()
    const nvda = screen.getByText('NVDA').closest('tr')
    expect(nvda).toHaveTextContent('$187.40')
    expect(nvda).toHaveTextContent('+1.80%')
    expect(nvda).toHaveTextContent('Thu, Oct 22')
    expect(screen.getByText('CELH').closest('tr')).toHaveTextContent('-4.20%')
    expect(screen.getByText('From your Watchlist list. 2 more not shown.')).toBeInTheDocument()
    expect(fetchSpy).toHaveBeenCalledTimes(0)
  })

  it('a null cell is n/a with a reason in its title', () => {
    render(<MyWatchlistTodayEmbed attrs={widgetEmbedNode('myWatchlistToday', PAYLOAD).attrs} />)
    const anet = screen.getByText('ANET').closest('tr')
    const nas = within(anet).getAllByText('n/a')
    expect(nas.length).toBe(3)
    expect(nas[0].getAttribute('title')).toBe('No price available right now')
    for (const na of nas) expect(na.getAttribute('title')).toBeTruthy()
  })
})
