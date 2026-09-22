import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// Packet H CP1 (signed by the owner 2026-09-22, fingerprint f119617df). Has
// this ticker ever been a curated Model Book entry, across every year --
// distinct from browsing /model-book by hand.

const fullData = {
  symbol: 'NVDA',
  appearances: [
    { id: 2, year: 2025, symbol: 'NVDA', thesis: 'AI leader', gain_pct: 171.0, setup_count: 3 },
    { id: 1, year: 2023, symbol: 'NVDA', thesis: 'early leg', gain_pct: 42.0, setup_count: 0 },
  ],
}

function renderTab(sym) {
  return import('./ModelBookTab').then(({ default: FreshTab }) =>
    render(<MemoryRouter><FreshTab sym={sym} /></MemoryRouter>))
}

describe('ModelBookTab', () => {
  it('renders one card per appearance, year + gain + setup count + thesis', async () => {
    vi.resetModules()
    vi.doMock('../hooks/useModelBookAppearances', () => ({ default: () => ({ data: fullData, isLoading: false }) }))
    await renderTab('NVDA')

    expect(screen.getByText('Model Book appearances')).toBeInTheDocument()
    expect(screen.getByText('2025')).toBeInTheDocument()
    expect(screen.getByText('2023')).toBeInTheDocument()
    expect(screen.getByText('+171.0%')).toBeInTheDocument()
    expect(screen.getByText('3 setups')).toBeInTheDocument()
    expect(screen.getByText('AI leader')).toBeInTheDocument()
    expect(screen.getByText('early leg')).toBeInTheDocument()
  })

  it('does not render a setup-count chip for a year with zero setups', async () => {
    vi.resetModules()
    vi.doMock('../hooks/useModelBookAppearances', () => ({ default: () => ({ data: fullData, isLoading: false }) }))
    await renderTab('NVDA')
    expect(screen.queryByText('0 setups')).not.toBeInTheDocument()
  })

  it('links to the bare /model-book page, never a deep link the page cannot read', async () => {
    // ModelBook.jsx reads no year/symbol param anywhere -- a deep link would
    // silently do nothing, so this packet deliberately links to the page as
    // it actually exists today.
    vi.resetModules()
    vi.doMock('../hooks/useModelBookAppearances', () => ({ default: () => ({ data: fullData, isLoading: false }) }))
    await renderTab('NVDA')
    const link = screen.getByText(/Open the Model Book/).closest('a')
    expect(link).toHaveAttribute('href', '/model-book')
  })

  it('shows a loading state distinct from the empty state', async () => {
    vi.resetModules()
    vi.doMock('../hooks/useModelBookAppearances', () => ({ default: () => ({ data: null, isLoading: true }) }))
    await renderTab('NVDA')
    expect(screen.getByText('Loading Model Book history…')).toBeInTheDocument()
    expect(screen.queryByText('Not yet in the Model Book.')).not.toBeInTheDocument()
  })

  it('shows the honest empty-state note for a ticker never curated -- never a blank card', async () => {
    vi.resetModules()
    vi.doMock('../hooks/useModelBookAppearances', () => ({ default: () => ({ data: { symbol: 'ZZZZ', appearances: [] }, isLoading: false }) }))
    await renderTab('ZZZZ')
    expect(screen.getByText('Not yet in the Model Book.')).toBeInTheDocument()
    expect(screen.queryByText('Model Book appearances')).not.toBeInTheDocument()
  })
})
