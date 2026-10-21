// Room buzz on my names (Task 20, wave 6): symbol, mentions, people. Counts only.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import RoomBuzzOnMyNamesEmbed from './RoomBuzzOnMyNamesEmbed'
import { widgetEmbedNode } from '../../../lib/notebookWidgets'

const PAYLOAD = {
  asOf: '2026-10-20T14:05:00Z', source: 'market', truncated: 2,
  rows: [{ symbol: 'NVDA', mentions: 37, people: 23 }, { symbol: 'AMD', mentions: 6, people: null }],
}
const attrsOf = (p = PAYLOAD) => widgetEmbedNode('roomBuzzOnMyNames', p).attrs

let fetchSpy
beforeEach(() => { fetchSpy = vi.fn(); vi.stubGlobal('fetch', fetchSpy) })
afterEach(() => vi.unstubAllGlobals())

describe('RoomBuzzOnMyNamesEmbed', () => {
  it('renders rows of symbol, mentions and people, no fetch', () => {
    render(<RoomBuzzOnMyNamesEmbed attrs={attrsOf()} />)
    const nvda = screen.getByText('NVDA').closest('tr')
    expect(within(nvda).getByText('37')).toBeInTheDocument()
    expect(within(nvda).getByText('23')).toBeInTheDocument()
    expect(screen.getByText(/2 more not shown\./)).toBeInTheDocument()
    expect(fetchSpy).toHaveBeenCalledTimes(0)
  })

  it('an unknown count is n/a with a reason, never 0', () => {
    render(<RoomBuzzOnMyNamesEmbed attrs={attrsOf()} />)
    const amd = screen.getByText('AMD').closest('tr')
    expect(within(amd).getByText('n/a').getAttribute('title')).toMatch(/\w/)
  })

  it('no mentions, or no channels set up, shows the server sentence', () => {
    render(<RoomBuzzOnMyNamesEmbed attrs={attrsOf({
      asOf: PAYLOAD.asOf, source: 'market', rows: [], empty: "Room buzz isn't set up yet.",
    })} />)
    expect(screen.getByText("Room buzz isn't set up yet.")).toBeInTheDocument()
  })
})
