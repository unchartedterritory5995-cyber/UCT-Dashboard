// Ticker card (Task 7): rendered from the frozen params, never fetched.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import TickerCardEmbed from './TickerCardEmbed'
import { widgetEmbedNode } from '../../../lib/notebookWidgets'

const PAYLOAD = {
  asOf: '2026-10-20T13:14:00Z',
  source: 'mixed',
  symbol: 'NVDA',
  price: 187.4,
  changePct: 1.8,
  ma10: 181.2,
  ma50: 172.9,
  earningsDay: '2026-10-22',
  impliedMovePct: 7.1,
  history: { trades: 5, winRate: 0.6, netPnl: 1234.5 },
}

let fetchSpy
beforeEach(() => {
  fetchSpy = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }))
  vi.stubGlobal('fetch', fetchSpy)
})
afterEach(() => vi.unstubAllGlobals())

const rowOf = (label) => screen.getByText(label).closest('[data-card-row]')

describe('TickerCardEmbed', () => {
  it('renders_from_params_without_fetch', () => {
    render(<TickerCardEmbed attrs={widgetEmbedNode('tickerCard', PAYLOAD).attrs} />)
    expect(screen.getByText('NVDA')).toBeInTheDocument()
    expect(rowOf('Last')).toHaveTextContent('$187.40 +1.80%')
    expect(rowOf('10-day / 50-day')).toHaveTextContent('$181.20 / $172.90')
    expect(rowOf('Earnings')).toHaveTextContent('Thu, Oct 22 · ±7.1%')
    expect(rowOf('Your history')).toHaveTextContent('5 trades · 60% wins · +$1,234.50')
    expect(fetchSpy).toHaveBeenCalledTimes(0)
  })

  it('R58 I-9: the history row is labelled Only you, with a lock; no other row is', () => {
    const { container } = render(<TickerCardEmbed attrs={widgetEmbedNode('tickerCard', PAYLOAD).attrs} />)
    const history = rowOf('Your history')
    expect(within(history).getByText('Only you')).toBeInTheDocument()
    expect(history.querySelector('[data-snapshot-lock] svg')).not.toBeNull()
    expect(container.querySelectorAll('[data-card-row] [data-snapshot-lock]')).toHaveLength(1)
    expect(within(rowOf('Last')).queryByText('Only you')).toBeNull()
  })

  it('no history says so, and null cells are n/a with a reason', () => {
    render(<TickerCardEmbed attrs={widgetEmbedNode('tickerCard', {
      ...PAYLOAD, price: null, changePct: null, ma50: null, earningsDay: null, impliedMovePct: null, history: null,
    }).attrs} />)
    expect(screen.getByText('No trades in NVDA yet.')).toBeInTheDocument()
    const nas = screen.getAllByText('n/a')
    expect(nas.length).toBeGreaterThanOrEqual(3)
    for (const na of nas) expect(na.getAttribute('title')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/\$0\.00/)
  })
})
