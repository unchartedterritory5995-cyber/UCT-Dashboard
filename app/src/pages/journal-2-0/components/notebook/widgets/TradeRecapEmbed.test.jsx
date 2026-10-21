// Trade recap (Task 20, wave 6): entry and exit, R, setup, hold, mistakes and an inline daily line, from params only.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import TradeRecapEmbed, { recapChart } from './TradeRecapEmbed'
import { widgetEmbedNode } from '../../../lib/notebookWidgets'

const BARS = [
  { t: '2026-09-30', o: 179, h: 181, l: 178, c: 180 },
  { t: '2026-10-01', o: 180, h: 183, l: 179, c: 182 },
  { t: '2026-10-08', o: 186, h: 190, l: 185, c: 189 },
  { t: '2026-10-14', o: 195, h: 198, l: 194, c: 196.5 },
]
const PAYLOAD = {
  asOf: '2026-10-20T14:05:00Z', source: 'broker', tradeId: 'tr-9f1c', symbol: 'NVDA', side: 'Long',
  entryDate: '2026-10-01', exitDate: '2026-10-14', entryPrice: 181.25, exitPrice: 196.5, r: 2.4, pnl: 7654.32,
  setup: 'Classic Flag/Pullback', holdDays: 13, mistakes: ['early_exit'], bars: BARS,
}
const attrsOf = (p = PAYLOAD) => widgetEmbedNode('tradeRecap', p).attrs

let fetchSpy
beforeEach(() => {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => true })
  fetchSpy = vi.fn()
  vi.stubGlobal('fetch', fetchSpy)
})
afterEach(() => vi.unstubAllGlobals())

describe('TradeRecapEmbed', () => {
  it('renders entry, exit, R, P&L, setup, hold and mistakes from params, no fetch', () => {
    render(<TradeRecapEmbed attrs={attrsOf()} />)
    expect(screen.getByText('NVDA')).toBeInTheDocument()
    expect(screen.getByText('long')).toBeInTheDocument()
    expect(screen.getByText(/\$181\.25 on Oct 1, 2026/)).toBeInTheDocument()
    expect(screen.getByText(/\$196\.50 on Oct 14, 2026/)).toBeInTheDocument()
    expect(screen.getByText('+2.4R')).toBeInTheDocument()
    expect(screen.getByText('+$7,654.32')).toBeInTheDocument()
    expect(screen.getByText('Classic Flag/Pullback')).toBeInTheDocument()
    expect(screen.getByText('13 days')).toBeInTheDocument()
    expect(screen.getByText('Early exit')).toBeInTheDocument()
    expect(fetchSpy).toHaveBeenCalledTimes(0)
  })

  it('draws the daily line as inline SVG with the entry and exit sessions marked, never the chart engine', () => {
    const { container } = render(<TradeRecapEmbed attrs={attrsOf()} />)
    const svg = container.querySelector('svg[role="img"]')
    expect(svg.getAttribute('aria-label'))
      .toBe('Daily closes from Sep 30, 2026 to Oct 14, 2026, entry on Oct 1, 2026, exit on Oct 14, 2026')
    expect(svg.querySelectorAll('polyline')).toHaveLength(1)
    expect(svg.querySelectorAll('line')).toHaveLength(2)
    expect(container.querySelector('canvas')).toBeNull()
  })

  it('never draws the request key', () => {
    render(<TradeRecapEmbed attrs={attrsOf()} />)
    expect(document.body.textContent).not.toContain('tr-9f1c')
  })

  it('an unknown figure is n/a with a reason, never 0, and no bars is said in words', () => {
    render(<TradeRecapEmbed attrs={attrsOf({
      ...PAYLOAD, r: null, pnl: null, setup: null, holdDays: null, mistakes: [], bars: [],
    })} />)
    const nas = screen.getAllByText('n/a')
    expect(nas).toHaveLength(4)
    for (const n of nas) expect(n.getAttribute('title')).toMatch(/\w/)
    expect(screen.getByText('None tagged')).toBeInTheDocument()
    expect(screen.getByText('No daily bars held for this trade, so no chart.')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/\$0(\.00)?\b|\b0\.0R/)
  })

  it('recapChart marks the first session on or after a thinned-out day', () => {
    const c = recapChart(BARS, '2026-10-05', '2026-10-14')
    expect(c.entryX).toBe(200) // 2026-10-08 is the first bar on or after 2026-10-05
    expect(c.exitX).toBe(300)
    expect(recapChart([BARS[0]], '2026-10-01', '2026-10-14')).toBeNull()
  })
})
