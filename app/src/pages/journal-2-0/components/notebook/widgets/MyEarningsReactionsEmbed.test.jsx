// My earnings reactions (Task 20, wave 6): EPS and revenue actual vs estimate, and the next-day move.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import MyEarningsReactionsEmbed, { fmtRevenue } from './MyEarningsReactionsEmbed'
import { widgetEmbedNode } from '../../../lib/notebookWidgets'

const PAYLOAD = {
  asOf: '2026-10-20T14:05:00Z', source: 'market', partial: true,
  rows: [
    { symbol: 'TSLA', day: '2026-10-15', epsActual: 0.73, epsEst: 0.68, revActual: 25100000000, revEst: 24800000000, nextDayPct: -4.6 },
    { symbol: 'NFLX', day: '2026-10-19', epsActual: null, epsEst: 5.1, revActual: null, revEst: null, nextDayPct: null },
  ],
}
const attrsOf = (p = PAYLOAD) => widgetEmbedNode('myEarningsReactions', p).attrs

let fetchSpy
beforeEach(() => { fetchSpy = vi.fn(); vi.stubGlobal('fetch', fetchSpy) })
afterEach(() => vi.unstubAllGlobals())

describe('MyEarningsReactionsEmbed', () => {
  it('renders EPS and revenue actual vs estimate and the next-day move, no fetch', () => {
    render(<MyEarningsReactionsEmbed attrs={attrsOf()} />)
    const tsla = screen.getByText('TSLA').closest('tr')
    expect(within(tsla).getByText('$0.73')).toBeInTheDocument()
    expect(within(tsla).getByText('$0.68')).toBeInTheDocument()
    expect(within(tsla).getByText('$25.1B')).toBeInTheDocument()
    expect(within(tsla).getByText('$24.8B')).toBeInTheDocument()
    expect(within(tsla).getByText('-4.60%')).toBeInTheDocument()
    expect(screen.getByText(/Some figures could not be read in time\./)).toBeInTheDocument()
    expect(fetchSpy).toHaveBeenCalledTimes(0)
  })

  it('each unknown is n/a with its own reason, never 0', () => {
    render(<MyEarningsReactionsEmbed attrs={attrsOf()} />)
    const nflx = screen.getByText('NFLX').closest('tr')
    const nas = within(nflx).getAllByText('n/a')
    expect(nas).toHaveLength(4)
    for (const n of nas) expect(n.getAttribute('title')).toMatch(/\w/)
    expect(within(nflx).getByText('$5.10')).toBeInTheDocument()
    expect(nflx.textContent).not.toMatch(/\b0\.00%|\$0\.00/)
  })

  it('an empty payload shows the empty sentence', () => {
    render(<MyEarningsReactionsEmbed attrs={attrsOf({
      asOf: PAYLOAD.asOf, source: 'market', rows: [], partial: false,
      empty: 'None of your names reported in the last 7 days.',
    })} />)
    expect(screen.getByText('None of your names reported in the last 7 days.')).toBeInTheDocument()
  })

  it('fmtRevenue reads billions and millions', () => {
    expect(fmtRevenue(412300000)).toBe('$412.3M')
    expect(fmtRevenue(-2e9)).toBe('-$2.0B')
  })
})
