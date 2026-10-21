// F2 (ruling R58, UX I-4 to I-7): the payload keys the F1 server pass added (fix-f1-report.md, "FOR F2"),
// rendered. Every payload goes in through widgetEmbedNode, the insert's own builder, so a key the registry
// schema drops at insert would be missing here too. Asserted by RENDERED TEXT.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { widgetEmbedNode } from '../../../lib/notebookWidgets'
import MyWatchlistTodayEmbed from './MyWatchlistTodayEmbed'
import TickerCardEmbed from './TickerCardEmbed'
import MyNamesReportingEmbed from './MyNamesReportingEmbed'
import TickerFlowEmbed from './TickerFlowEmbed'
import MyEarningsReactionsEmbed from './MyEarningsReactionsEmbed'
import MyPositionsRiskEmbed from './MyPositionsRiskEmbed'
import TradeRecapEmbed from './TradeRecapEmbed'
import MyRulesCheckEmbed from './MyRulesCheckEmbed'

const ASOF = '2026-10-20T13:14:00Z'
const attrs = (kind, payload) => widgetEmbedNode(kind, { asOf: ASOF, ...payload }).attrs

beforeEach(() => { vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }))) })
afterEach(() => vi.unstubAllGlobals())

describe('earningsUnknown: a calendar that was read says "None this week"; one that was not says n/a', () => {
  const rows = [{ symbol: 'CELH', price: 41.2, changePct: -4.2, earningsDay: null }]

  it('watchlist today, calendar read: None this week, visible', () => {
    render(<MyWatchlistTodayEmbed attrs={attrs('myWatchlistToday', { source: 'market', rows, earningsUnknown: false })} />)
    expect(within(screen.getByText('CELH').closest('tr')).getByText('None this week')).toBeInTheDocument()
  })

  it('watchlist today, calendar not read: n/a with the reason, never "None this week"', () => {
    render(<MyWatchlistTodayEmbed attrs={attrs('myWatchlistToday', { source: 'market', rows, earningsUnknown: true, partial: true })} />)
    const row = screen.getByText('CELH').closest('tr')
    expect(within(row).getByRole('button', { name: 'n/a: The earnings calendar could not be read just now' })).toBeInTheDocument()
    expect(within(row).queryByText('None this week')).toBeNull()
    expect(screen.getByText(/Some figures could not be read in time\./)).toBeInTheDocument()
  })

  it('ticker card: the same two answers', () => {
    const { unmount } = render(<TickerCardEmbed attrs={attrs('tickerCard', { source: 'market', symbol: 'NVDA', earningsUnknown: false })} />)
    expect(screen.getByText('None this week')).toBeInTheDocument()
    unmount()
    render(<TickerCardEmbed attrs={attrs('tickerCard', { source: 'market', symbol: 'NVDA', earningsUnknown: true })} />)
    expect(screen.getByRole('button', { name: 'n/a: The earnings calendar could not be read just now' })).toBeInTheDocument()
    expect(screen.queryByText('None this week')).toBeNull()
  })

  it('names reporting with the calendar unread never says none of your names report', () => {
    render(<MyNamesReportingEmbed attrs={attrs('myNamesReporting', { source: 'market', rows: [], partial: true, earningsUnknown: true })} />)
    expect(screen.getByText(/The earnings calendar could not be read just now, so this can't say who reports\./)).toBeInTheDocument()
    expect(screen.queryByText('None of your names report in the next seven days.')).toBeNull()
  })

  it('control: names reporting with the calendar read and nothing found says none', () => {
    render(<MyNamesReportingEmbed attrs={attrs('myNamesReporting', { source: 'market', rows: [], earningsUnknown: false })} />)
    expect(screen.getByText('None of your names report in the next seven days.')).toBeInTheDocument()
  })
})

describe('tickerFlow failed: the failure sentence, distinct from the empty one', () => {
  it('a failed read shows the server sentence in the failure style', () => {
    render(<TickerFlowEmbed attrs={attrs('tickerFlow', { source: 'market', symbol: 'NVDA', topPrints: [], failed: true,
      empty: "Couldn't load options flow right now." })} />)
    const p = screen.getByText("Couldn't load options flow right now.")
    expect(p.className).toMatch(/failed/)
    expect(screen.queryByText('No options flow on record for NVDA today.')).toBeNull()
  })

  it('control: a true empty read keeps the empty sentence and style', () => {
    render(<TickerFlowEmbed attrs={attrs('tickerFlow', { source: 'market', symbol: 'NVDA', topPrints: [],
      empty: 'No options flow on record for NVDA today.' })} />)
    const p = screen.getByText('No options flow on record for NVDA today.')
    expect(p.className).toMatch(/empty/)
    expect(p.className).not.toMatch(/failed/)
  })
})

describe('sourceDetail and priceBasis', () => {
  const SENT = 'Positions: your linked broker. Open P&L and size: live market data, delayed.'
  const row = { symbol: 'NVDA', kind: 'stock', sizePct: 8, openPnl: 120, stopPrice: 170, distToStopPct: 6, noStop: false }

  it('the server sentence is the source line, and the old generic line is not repeated', () => {
    render(<MyPositionsRiskEmbed attrs={attrs('myPositionsRisk', { source: 'broker', rows: [row], sourceDetail: SENT, priceBasis: 'live' })} />)
    expect(screen.getByText(SENT)).toBeInTheDocument()
    expect(screen.queryByText(/Source: your linked broker/)).toBeNull()
    expect(screen.queryByText(/Open P&L and size: live market prices\./)).toBeNull()
  })

  it('with no sentence, the price basis is said in words', () => {
    render(<MyPositionsRiskEmbed attrs={attrs('myPositionsRisk', { source: 'broker', rows: [row], priceBasis: 'broker' })} />)
    expect(screen.getByText('Source: your linked broker · Open P&L and size: broker marks.')).toBeInTheDocument()
  })

  it('a market kind shows the sentence in place of its own line', () => {
    render(<TickerFlowEmbed attrs={attrs('tickerFlow', { source: 'market', symbol: 'NVDA', topPrints: [],
      sourceDetail: 'Options flow: UCT options tape.' })} />)
    expect(screen.getByText('Options flow: UCT options tape.')).toBeInTheDocument()
    expect(screen.queryByText('Options flow as the Options Flow page reads it.')).toBeNull()
  })
})

describe('option rows (kind: "option")', () => {
  it('say "Not applicable to options" in both stop cells, never "No stop set", and show the strategy side', () => {
    render(<MyPositionsRiskEmbed attrs={attrs('myPositionsRisk', { source: 'broker', rows: [
      { symbol: 'CRWV Oct 16 $110C', side: 'Long Call', kind: 'option', sizePct: null, openPnl: null,
        stopPrice: null, distToStopPct: null, noStop: null },
    ] })} />)
    const tr = screen.getByText('CRWV Oct 16 $110C').closest('tr')
    expect(within(tr).getAllByText('Not applicable to options')).toHaveLength(2)
    expect(within(tr).getByText('Long Call')).toBeInTheDocument()
    expect(within(tr).queryByText('No stop set')).toBeNull()
  })
})

describe('timingUnknown on a reaction row', () => {
  it('shows the note, never a number', () => {
    render(<MyEarningsReactionsEmbed attrs={attrs('myEarningsReactions', { source: 'market', rows: [
      { symbol: 'NVDA', day: '2026-10-15', epsActual: 1.2, epsEst: 1.1, revActual: 3e10, revEst: 2.9e10,
        nextDayPct: null, timingUnknown: true, nextDayNote: "Report time unknown, so the reaction isn't shown." },
    ] })} />)
    const tr = screen.getByText('NVDA').closest('tr')
    expect(within(tr).getByText("Report time unknown, so the reaction isn't shown.")).toBeInTheDocument()
    expect(within(tr).queryByText('n/a')).toBeNull()
  })
})

describe('tooLarge and mistakesTruncated', () => {
  const SENT = "This widget's data was too large to save. Narrow it and try again."

  it('a too-large payload renders the sentence in place of the body', () => {
    render(<MyRulesCheckEmbed attrs={attrs('myRulesCheck', { source: 'manual', range: { from: '2026-10-13', to: '2026-10-17' },
      tooLarge: true, empty: SENT })} />)
    expect(screen.getByText(SENT)).toBeInTheDocument()
    expect(screen.queryByText('No rule checks in this range yet.')).toBeNull()
  })

  it('a recap with clipped mistakes says how many more', () => {
    render(<TradeRecapEmbed attrs={attrs('tradeRecap', { source: 'manual', symbol: 'NVDA', side: 'Long',
      mistakes: ['fomo', 'chasing'], mistakesTruncated: 7 })} />)
    expect(screen.getByText('+7 more')).toBeInTheDocument()
  })
})
