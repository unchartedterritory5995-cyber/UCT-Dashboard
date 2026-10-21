// My setup edge (Task 20, wave 6): a table, with a "Thin sample" label on a thin row.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import MySetupEdgeEmbed from './MySetupEdgeEmbed'
import { widgetEmbedNode } from '../../../lib/notebookWidgets'

const PAYLOAD = {
  asOf: '2026-10-20T14:05:00Z', source: 'mixed',
  rows: [{ setup: 'VCP', n: 31, expectancyR: 0.85, winRate: 0.58, thin: false },
    { setup: 'Wedge Pop', n: 4, expectancyR: -0.4, winRate: null, thin: true }],
}
const attrsOf = (p = PAYLOAD) => widgetEmbedNode('mySetupEdge', p).attrs

let fetchSpy
beforeEach(() => { fetchSpy = vi.fn(); vi.stubGlobal('fetch', fetchSpy) })
afterEach(() => vi.unstubAllGlobals())

describe('MySetupEdgeEmbed', () => {
  it('renders each setup with trades, expectancy and win rate, no fetch', () => {
    render(<MySetupEdgeEmbed attrs={attrsOf()} />)
    const vcp = screen.getByText('VCP').closest('tr')
    expect(within(vcp).getByText('31')).toBeInTheDocument()
    expect(within(vcp).getByText('+0.8R')).toBeInTheDocument()
    expect(within(vcp).getByText('58%')).toBeInTheDocument()
    expect(within(vcp).queryByText('Thin sample')).toBeNull()
    expect(fetchSpy).toHaveBeenCalledTimes(0)
  })

  it('labels a thin sample in words and keeps it; an unknown win rate is n/a with a reason', () => {
    render(<MySetupEdgeEmbed attrs={attrsOf()} />)
    const wedge = screen.getByText('Wedge Pop').closest('tr')
    expect(within(wedge).getByText('Thin sample')).toBeInTheDocument()
    expect(within(wedge).getByText('-0.4R')).toBeInTheDocument()
    expect(within(wedge).getByText('n/a').getAttribute('title')).toMatch(/\w/)
  })

  it('an empty payload shows the empty sentence', () => {
    render(<MySetupEdgeEmbed attrs={attrsOf({
      asOf: PAYLOAD.asOf, source: 'manual', rows: [], empty: 'No setups with closed trades yet.',
    })} />)
    expect(screen.getByText('No setups with closed trades yet.')).toBeInTheDocument()
  })
})
