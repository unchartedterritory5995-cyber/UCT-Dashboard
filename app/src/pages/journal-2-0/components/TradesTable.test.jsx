import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import TradesTable, { buildTradesColumns } from './TradesTable'

const SETTINGS = {
  journalColumns: { marketNavIndex: 'NYA', breadthMetric: 'NASI RSI' },
}

const BASE_TRADE = {
  id: 't1',
  userId: 'u1',
  positionId: 'p1',
  symbol: 'YSS',
  side: 'Long',
  shares: 100,
  entryPrice: 29.57,
  entryDate: '2026-04-09T00:00:00Z',
  exitPrice: 34.5,
  exitDate: '2026-04-10T00:00:00Z',
  originalStop: 27.9,
  setup: 'VCP',
  notes: null,
  pnlDollar: 493.0,
  pnlPercent: 0.166723,
  rMultiple: 2.9521,
  holdDays: 1,
  result: 'Win',
  contextAtEntry: {
    navCount: 5,
    rallyDay: 'D7',
    powerTrend: 'On',
    breadthValue: 62.5,
    breadthMetricName: 'NASI RSI',
    indexName: 'NYA',
    igRank: 42,
    rsRating: 88,
  },
  createdAt: '2026-04-10T00:00:00Z',
}

describe('TradesTable — YSS reference render (§11.3)', () => {
  it('renders empty state', () => {
    const cols = buildTradesColumns(SETTINGS).filter((c) => !c.hiddenByDefault)
    render(<TradesTable trades={[]} visibleColumns={cols} />)
    expect(screen.getByText('No trades yet.')).toBeInTheDocument()
  })

  it('renders YSS trade row with Win badge', () => {
    const cols = buildTradesColumns(SETTINGS).filter((c) => !c.hiddenByDefault)
    render(<TradesTable trades={[BASE_TRADE]} visibleColumns={cols} />)
    expect(screen.getByText('YSS')).toBeInTheDocument()
    expect(screen.getByText('Win')).toBeInTheDocument()
  })

  it('renders P&L +$493.00 and R +3.0R', () => {
    const cols = buildTradesColumns(SETTINGS).filter((c) => !c.hiddenByDefault)
    render(<TradesTable trades={[BASE_TRADE]} visibleColumns={cols} />)
    expect(screen.getByText('+$493.00')).toBeInTheDocument()
    expect(screen.getByText('+3.0R')).toBeInTheDocument()
  })

  it('renders context fields (Nav, Rally, Power Trend, breadth, IG, RS)', () => {
    const cols = buildTradesColumns(SETTINGS).filter((c) => !c.hiddenByDefault)
    render(<TradesTable trades={[BASE_TRADE]} visibleColumns={cols} />)
    expect(screen.getByText('5')).toBeInTheDocument()       // navCount
    expect(screen.getByText('D7')).toBeInTheDocument()      // rallyDay
    expect(screen.getByText('On')).toBeInTheDocument()      // powerTrend
    expect(screen.getByText('62.5')).toBeInTheDocument()    // breadthValue
    expect(screen.getByText('42')).toBeInTheDocument()      // igRank
    expect(screen.getByText('88')).toBeInTheDocument()      // rsRating
  })

  it('renders dash for null context fields (A2: skipped manual trades)', () => {
    const manual = {
      ...BASE_TRADE,
      contextAtEntry: {
        navCount: null,
        rallyDay: null,
        powerTrend: null,
        breadthValue: null,
        breadthMetricName: 'NASI RSI',
        indexName: 'NYA',
        igRank: null,
        rsRating: null,
      },
    }
    const cols = buildTradesColumns(SETTINGS).filter((c) => !c.hiddenByDefault)
    render(<TradesTable trades={[manual]} visibleColumns={cols} />)
    // Each of the 6 null context fields should produce a dash
    const dashes = screen.getAllByText('—')
    expect(dashes.length).toBeGreaterThanOrEqual(6)
  })

  it('breadth column label reflects live settings (not snapshot)', () => {
    const customSettings = {
      journalColumns: { marketNavIndex: 'NYA', breadthMetric: '% Above 50MA' },
    }
    const cols = buildTradesColumns(customSettings).filter((c) => !c.hiddenByDefault)
    render(<TradesTable trades={[BASE_TRADE]} visibleColumns={cols} />)
    // Header should say "% Above 50MA" even though the trade's
    // breadthMetricName is "NASI RSI" (§5.6 — labels live, values frozen)
    expect(screen.getByText('% Above 50MA')).toBeInTheDocument()
  })

  it('Stop column is hiddenByDefault', () => {
    const cols = buildTradesColumns(SETTINGS)
    const stop = cols.find((c) => c.key === 'originalStop')
    expect(stop.hiddenByDefault).toBe(true)
  })

  it('sorts by entry date DESC (newest first)', () => {
    const older = { ...BASE_TRADE, id: 'a', symbol: 'OLDER', entryDate: '2026-01-01T00:00:00Z' }
    const newer = { ...BASE_TRADE, id: 'b', symbol: 'NEWER', entryDate: '2026-06-01T00:00:00Z' }
    const cols = buildTradesColumns(SETTINGS).filter((c) => !c.hiddenByDefault)
    render(<TradesTable trades={[older, newer]} visibleColumns={cols} />)
    const rows = screen.getAllByRole('row').slice(1)
    const firstSymbol = rows[0].querySelector('td')?.textContent
    expect(firstSymbol).toBe('NEWER')
  })
})
