// My names reporting (Task 7): rendered from the frozen params, never fetched.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import MyNamesReportingEmbed from './MyNamesReportingEmbed'
import { widgetEmbedNode } from '../../../lib/notebookWidgets'

const PAYLOAD = {
  asOf: '2026-10-20T13:14:00Z',
  source: 'market',
  rows: [
    { symbol: 'NVDA', day: '2026-10-22', timing: 'amc', daysAway: 2, sources: ['watchlist', 'positions'], impliedMovePct: 7.1 },
    { symbol: 'ANET', day: '2026-10-26', timing: null, daysAway: 6, sources: ['flagged'], impliedMovePct: null },
  ],
  partial: true,
}

let fetchSpy
beforeEach(() => {
  fetchSpy = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }))
  vi.stubGlobal('fetch', fetchSpy)
})
afterEach(() => vi.unstubAllGlobals())

describe('MyNamesReportingEmbed', () => {
  it('renders_from_params_without_fetch', () => {
    render(<MyNamesReportingEmbed attrs={widgetEmbedNode('myNamesReporting', PAYLOAD).attrs} />)
    expect(screen.getByText('My names reporting')).toBeInTheDocument()
    const nvda = screen.getByText('NVDA').closest('tr')
    expect(nvda).toHaveTextContent('Thu, Oct 22, after the close')
    expect(nvda).toHaveTextContent('±7.1%')
    expect(nvda).toHaveTextContent('Watchlist, Open position')
    expect(screen.getByText(/Some figures could not be read in time/)).toBeInTheDocument()
    expect(fetchSpy).toHaveBeenCalledTimes(0)
  })

  it('a null expected move is n/a with a reason in its title', () => {
    render(<MyNamesReportingEmbed attrs={widgetEmbedNode('myNamesReporting', PAYLOAD).attrs} />)
    const anet = screen.getByText('ANET').closest('tr')
    expect(anet).toHaveTextContent('time not announced')
    expect(within(anet).getByText('n/a').getAttribute('title')).toBeTruthy()
  })

  it('no names renders a sentence, not an empty table', () => {
    render(<MyNamesReportingEmbed attrs={widgetEmbedNode('myNamesReporting', { asOf: PAYLOAD.asOf, source: 'market', rows: [], partial: false }).attrs} />)
    expect(screen.getByText('None of your names report in the next seven days.')).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
  })
})
