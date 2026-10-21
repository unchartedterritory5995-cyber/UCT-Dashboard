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
    expect(screen.getByText('No trades, open positions or notes in NVDA yet.')).toBeInTheDocument()
    const nas = screen.getAllByText('n/a')
    expect(nas.length).toBeGreaterThanOrEqual(3)
    for (const na of nas) expect(na.getAttribute('title')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/\$0\.00/)
  })

  // Fix F4 (O2, walk 2026-10-21): an open NVDA position and a note on NVDA, no closed trade, read
  // "No trades in NVDA yet." The row counts what the spec lists: the member's trades AND notes in the name.
  it('an open position and a note, no closed trade: the row says so, labelled Only you', () => {
    render(<TickerCardEmbed attrs={widgetEmbedNode('tickerCard', {
      ...PAYLOAD, history: { trades: 0, winRate: null, netPnl: null, openPositions: 1, notes: 1, notesMore: false },
    }).attrs} />)
    const row = rowOf('Your history')
    expect(row).toHaveTextContent('No closed trades · 1 open position · 1 note')
    expect(row).not.toHaveTextContent('No trades in NVDA yet.')
    expect(within(row).getByText('Only you')).toBeInTheDocument()
  })

  it('trades, positions and notes read together; a capped note count says so', () => {
    render(<TickerCardEmbed attrs={widgetEmbedNode('tickerCard', {
      ...PAYLOAD, history: { trades: 5, winRate: 0.6, netPnl: 1234.5, openPositions: 2, notes: 99, notesMore: true },
    }).attrs} />)
    expect(rowOf('Your history')).toHaveTextContent('5 trades · 60% wins · +$1,234.50 · 2 open positions · 99+ notes')
  })

  it('a count the capture could not read is n/a with a reason, never 0', () => {
    render(<TickerCardEmbed attrs={widgetEmbedNode('tickerCard', {
      ...PAYLOAD, history: { trades: 0, winRate: null, netPnl: null, openPositions: null, notes: null, notesMore: false },
    }).attrs} />)
    const row = rowOf('Your history')
    expect(row).toHaveTextContent('No closed trades · open positions n/a · notes n/a')
    for (const na of within(row).getAllByText('n/a')) expect(na.getAttribute('title')).toBeTruthy()
    expect(row.textContent).not.toMatch(/\b0 (open|notes?)/)
  })

  it('a snapshot taken before these counts existed shows its trades as before', () => {
    render(<TickerCardEmbed attrs={widgetEmbedNode('tickerCard', PAYLOAD).attrs} />)
    expect(rowOf('Your history').textContent).toMatch(/5 trades · 60% wins · \+\$1,234\.50$/)
  })
})
