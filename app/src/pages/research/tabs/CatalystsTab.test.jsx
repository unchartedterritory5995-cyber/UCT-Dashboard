import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// Packet G CP1 (signed by the owner 2026-09-22, fingerprint 5331c90c2). What
// has UCT's own catalyst engine ever flagged about this ticker, across every
// date -- distinct from the Dashboard tile (today's top-20 only) and
// /catalysts/history (a date-scoped browser).

const fullData = {
  ticker: 'NVDA',
  entries: [
    { market_date: '2026-05-26', ticker: 'NVDA', tag: 'Earnings', thesis_text: 'Beat on the top and bottom line.', rank: 1, thesis_model: 'claude-opus-4-7', thesis_at: 1780000000 },
    { market_date: '2026-03-01', ticker: 'NVDA', tag: 'Catalyst', thesis_text: 'New product announcement.', rank: null, thesis_model: 'claude-opus-4-7', thesis_at: 1772000000 },
  ],
}

describe('CatalystsTab', () => {
  it('renders one card per historical entry, newest first as the store already orders them', async () => {
    vi.resetModules()
    vi.doMock('../hooks/useCatalystHistory', () => ({ default: () => ({ data: fullData, isLoading: false }) }))
    const { default: FreshTab } = await import('./CatalystsTab')
    render(<FreshTab sym="NVDA" />)

    expect(screen.getByText('Catalyst history')).toBeInTheDocument()
    expect(screen.getByText('Beat on the top and bottom line.')).toBeInTheDocument()
    expect(screen.getByText('New product announcement.')).toBeInTheDocument()
    expect(screen.getByText('Earnings')).toBeInTheDocument()
    expect(screen.getByText('Catalyst')).toBeInTheDocument()
  })

  it('shows a loading state distinct from the empty state', async () => {
    vi.resetModules()
    vi.doMock('../hooks/useCatalystHistory', () => ({ default: () => ({ data: null, isLoading: true }) }))
    const { default: FreshTab } = await import('./CatalystsTab')
    render(<FreshTab sym="NVDA" />)
    expect(screen.getByText('Loading catalyst history…')).toBeInTheDocument()
    expect(screen.queryByText('No catalysts recorded for this ticker yet.')).not.toBeInTheDocument()
  })

  it('shows the honest empty-state note for a ticker the engine has never flagged -- never a blank card', async () => {
    vi.resetModules()
    vi.doMock('../hooks/useCatalystHistory', () => ({ default: () => ({ data: { ticker: 'ZZZZ', entries: [] }, isLoading: false }) }))
    const { default: FreshTab } = await import('./CatalystsTab')
    render(<FreshTab sym="ZZZZ" />)
    expect(screen.getByText('No catalysts recorded for this ticker yet.')).toBeInTheDocument()
    expect(screen.queryByText('Catalyst history')).not.toBeInTheDocument()
  })

  it('composes a REAL Provenance citation per entry, never a shared/degraded one -- each has its own model+timestamp', async () => {
    vi.resetModules()
    vi.doMock('../hooks/useCatalystHistory', () => ({ default: () => ({ data: fullData, isLoading: false }) }))
    const { default: FreshTab } = await import('./CatalystsTab')
    render(<FreshTab sym="NVDA" />)
    // Two entries -> two independent citations, not one list-level envelope
    // (a catalyst history spans many dates/models; one shared timestamp
    // would overstate how fresh the older entries are).
    expect(screen.getAllByTestId('provenance-present')).toHaveLength(2)
    expect(screen.getAllByText('UCT Catalyst Engine')).toHaveLength(2)
    expect(screen.queryByTestId('provenance-degraded')).not.toBeInTheDocument()
  })
})

describe('whenLabel', () => {
  it('reports unknown rather than blank or a fabricated date for a missing/malformed market_date', async () => {
    const { whenLabel } = await import('./CatalystsTab')
    expect(whenLabel(null)).toBe('Date unknown')
    expect(whenLabel('')).toBe('Date unknown')
  })

  it('renders a real market_date as a readable date', async () => {
    const { whenLabel } = await import('./CatalystsTab')
    expect(whenLabel('2026-05-26')).toBe('May 26, 2026')
  })
})
