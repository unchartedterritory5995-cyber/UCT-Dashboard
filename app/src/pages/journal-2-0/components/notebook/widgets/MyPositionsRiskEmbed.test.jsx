// My open positions and risk (Task 7): rendered from the frozen params, never fetched.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import MyPositionsRiskEmbed from './MyPositionsRiskEmbed'
import { widgetEmbedNode } from '../../../lib/notebookWidgets'

const PAYLOAD = {
  asOf: '2026-10-17T20:05:00Z',
  source: 'broker',
  accountSize: 100000,
  rows: [
    { positionId: 'p1', symbol: 'NVDA', side: 'long', sizePct: 8, openPnl: 610, stopPrice: 178, distToStopPct: 5, noStop: false },
    { positionId: 'p2', symbol: 'AVGO', side: 'long', sizePct: 6, openPnl: -120, stopPrice: null, distToStopPct: null, noStop: true },
    { positionId: 'p3', symbol: 'CELH', side: 'short', sizePct: null, openPnl: null, stopPrice: null, distToStopPct: null, noStop: null },
  ],
}
const attrsOf = (p = PAYLOAD) => widgetEmbedNode('myPositionsRisk', p).attrs

let fetchSpy
beforeEach(() => {
  fetchSpy = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }))
  vi.stubGlobal('fetch', fetchSpy)
})
afterEach(() => vi.unstubAllGlobals())

describe('MyPositionsRiskEmbed', () => {
  it('renders_from_params_without_fetch', () => {
    render(<MyPositionsRiskEmbed attrs={attrsOf()} />)
    expect(screen.getByText('My open positions and risk')).toBeInTheDocument()
    const nvda = screen.getByText('NVDA').closest('tr')
    expect(nvda).toHaveTextContent('8.0%')
    expect(nvda).toHaveTextContent('+$610.00')
    expect(nvda).toHaveTextContent('$178.00')
    expect(nvda).toHaveTextContent('5.0%')
    expect(fetchSpy).toHaveBeenCalledTimes(0)
  })

  it('labels the stop distance as measured from entry', () => {
    render(<MyPositionsRiskEmbed attrs={attrsOf()} />)
    expect(screen.getByText('Stop distance (from entry)')).toBeInTheDocument()
  })

  it('a noStop row says No stop set with a link to set it, and never 0%', () => {
    render(<MyPositionsRiskEmbed attrs={attrsOf()} />)
    const avgo = screen.getByText('AVGO').closest('tr')
    expect(within(avgo).getByText('No stop set')).toBeInTheDocument()
    const link = within(avgo).getByRole('link', { name: 'Set it in Journal' })
    expect(link).toHaveAttribute('href', '/journal?j2tab=positions')
    expect(avgo.textContent).not.toMatch(/(^|[^\d.])0(\.0+)?%/)
  })

  it('a null cell is n/a with a reason in its title', () => {
    render(<MyPositionsRiskEmbed attrs={attrsOf()} />)
    const celh = screen.getByText('CELH').closest('tr')
    const nas = within(celh).getAllByText('n/a')
    expect(nas.length).toBeGreaterThanOrEqual(3)
    for (const na of nas) expect(na.getAttribute('title')).toBeTruthy()
    expect(celh).not.toHaveTextContent('$0.00')
  })

  it('no open positions renders the empty sentence', () => {
    render(<MyPositionsRiskEmbed attrs={attrsOf({ asOf: PAYLOAD.asOf, source: 'manual', accountSize: null, rows: [], empty: 'No open positions.' })} />)
    expect(screen.getByText('No open positions.')).toBeInTheDocument()
  })
})

describe('MyPositionsRiskEmbed default account size', () => {
  it('says the size percent uses the default account size, with the size as a money cell', () => {
    render(<MyPositionsRiskEmbed attrs={attrsOf({ ...PAYLOAD, accountSizeSource: 'default' })} />)
    expect(screen.getByText('Size % uses the default $100,000.00 account size. Set yours in Journal settings.')).toBeInTheDocument()
  })

  it('shows no default note for a member-set size', () => {
    render(<MyPositionsRiskEmbed attrs={attrsOf({ ...PAYLOAD, accountSizeSource: 'member' })} />)
    expect(screen.queryByTestId('default-account-note')).toBeNull()
  })
})
