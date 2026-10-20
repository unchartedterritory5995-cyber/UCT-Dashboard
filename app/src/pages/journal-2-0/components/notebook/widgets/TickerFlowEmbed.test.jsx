// Options flow on a ticker (Task 14): rendered from the frozen params, never fetched.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import TickerFlowEmbed from './TickerFlowEmbed'
import { widgetEmbedNode } from '../../../lib/notebookWidgets'

const PAYLOAD = {
  asOf: '2026-10-20T13:14:00Z',
  source: 'market',
  symbol: 'NVDA',
  callPremium: null,
  putPremium: null,
  ratio: null,
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

describe('TickerFlowEmbed', () => {
  it('renders_from_params_without_fetch: the top contracts in words', () => {
    mount()
    expect(screen.getByText('Options flow — NVDA')).toBeInTheDocument()
    const call = screen.getByText('200 Call, 11/20/2026').closest('tr')
    expect(call).toHaveTextContent('$1.25M')
    expect(call).toHaveTextContent('900')
    expect(call).toHaveTextContent('Bullish')
    const put = screen.getByText('180 Put, 10/24/2026').closest('tr')
    expect(put).toHaveTextContent('$85K')
    expect(put).toHaveTextContent('Bearish')
    expect(within(put).getByText('n/a').getAttribute('title')).toBe('No volume on record for this contract')
    expect(fetchSpy).toHaveBeenCalledTimes(0)
  })

  it('call, put and ratio figures the flow record does not carry are n/a with a reason', () => {
    mount()
    for (const label of ['Calls premium', 'Puts premium', 'Put/call ratio']) {
      const row = screen.getByText(label).closest('[data-card-row]')
      const na = within(row).getByText('n/a')
      expect(na.getAttribute('title')).toBe('The flow record does not total calls and puts')
    }
  })

  it('a day with no flow says so in words', () => {
    mount({ asOf: PAYLOAD.asOf, source: 'market', symbol: 'NVDA', topPrints: [],
      empty: 'No options flow on record for NVDA today.' })
    expect(screen.getByText('No options flow on record for NVDA today.')).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
  })
})
