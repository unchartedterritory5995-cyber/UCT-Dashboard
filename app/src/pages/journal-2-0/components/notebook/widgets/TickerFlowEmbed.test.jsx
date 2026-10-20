// Options flow on a ticker (Task 14): rendered from the frozen params, never fetched.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import TickerFlowEmbed from './TickerFlowEmbed'
import { widgetEmbedNode } from '../../../lib/notebookWidgets'

const PAYLOAD = {
  asOf: '2026-10-20T13:14:00Z',
  source: 'market',
  symbol: 'NVDA',
  bullPremium: 2400000,
  bearPremium: 610000,
  window: 'Today',
  topPrints: [
    { cp: 'C', strike: 200, exp: '11/20/2026', dte: 31, premium: 1250000, volume: 900, direction: 'Bull' },
    { cp: 'P', strike: 180, exp: '10/24/2026', dte: 4, premium: 85000, volume: null, direction: 'Bear' },
  ],
}

let fetchSpy
beforeEach(() => {
  fetchSpy = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }))
  vi.stubGlobal('fetch', fetchSpy)
})
afterEach(() => vi.unstubAllGlobals())

const mount = (payload = PAYLOAD) => render(<TickerFlowEmbed attrs={widgetEmbedNode('tickerFlow', payload).attrs} />)
const cardRow = (label) => screen.getByText(label).closest('[data-card-row]')

describe('TickerFlowEmbed', () => {
  it('renders_from_params_without_fetch: net premium, the window and the top contracts in words', () => {
    mount()
    expect(screen.getByText('Options flow — NVDA')).toBeInTheDocument()
    expect(cardRow('Bullish premium')).toHaveTextContent('$2.4M')
    expect(cardRow('Bearish premium')).toHaveTextContent('$610K')
    expect(cardRow('Window')).toHaveTextContent('Today')
    const call = screen.getByText('200 Call, 11/20/2026').closest('tr')
    expect(call).toHaveTextContent('$1.25M')
    expect(call).toHaveTextContent('900')
    expect(call).toHaveTextContent('Bullish')
    const put = screen.getByText('180 Put, 10/24/2026').closest('tr')
    expect(put).toHaveTextContent('$85K')
    expect(put).toHaveTextContent('Bearish')
    expect(within(put).getByText('n/a').getAttribute('title')).toBe('No volume on record for this contract')
    for (const gone of ['Calls premium', 'Puts premium', 'Put/call ratio']) expect(screen.queryByText(gone)).toBeNull()
    expect(fetchSpy).toHaveBeenCalledTimes(0)
  })

  it('a widened window is named, not called today', () => {
    mount({ ...PAYLOAD, window: 'Last 5 sessions' })
    expect(cardRow('Window')).toHaveTextContent('Last 5 sessions')
    expect(screen.queryByText(/today\./)).toBeNull()
  })

  it('net figures absent from the record are n/a with a reason', () => {
    const { bullPremium, bearPremium, ...rest } = PAYLOAD
    mount(rest)
    for (const label of ['Bullish premium', 'Bearish premium']) {
      const na = within(cardRow(label)).getByText('n/a')
      expect(na.getAttribute('title')).toBe('The flow record for this name carries no net premium figure')
    }
  })

  it('a day with no flow on any window says so in words, and shows no empty figures', () => {
    mount({ asOf: PAYLOAD.asOf, source: 'market', symbol: 'NVDA', topPrints: [],
      empty: 'No options flow on record for NVDA today.' })
    expect(screen.getByText('No options flow on record for NVDA today.')).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.queryByText('Bullish premium')).toBeNull()
  })
})
