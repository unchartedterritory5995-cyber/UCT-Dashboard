import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// PortfolioAttentionBanner is a thin, read-only display over
// useJ2PositionsAttention's SWR fetch — the endpoint's own contract (dedupe,
// auth, degrade-gracefully) is covered server-side in
// tests/test_journal_two_positions_attention.py. These tests exercise only
// the render logic: empty → null, data → per-symbol facts/context.
const mockUseAttention = vi.fn()
vi.mock('../hooks/useJ2PositionsAttention', () => ({
  default: () => mockUseAttention(),
}))

import PortfolioAttentionBanner from './PortfolioAttentionBanner'

// Cards are react-router Links (Attention Signal Propagation V1 click-through)
// — every render needs a Router ancestor, matching the HoldingsList.test.jsx
// convention for the same reason.
const renderBanner = () => render(<MemoryRouter><PortfolioAttentionBanner /></MemoryRouter>)

describe('PortfolioAttentionBanner', () => {
  it('renders nothing when there are no open positions (empty attention map)', () => {
    mockUseAttention.mockReturnValue({ attention: {}, isLoading: false, error: null })
    const { container } = renderBanner()
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing while still loading', () => {
    mockUseAttention.mockReturnValue({ attention: {}, isLoading: true, error: null })
    const { container } = renderBanner()
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing on a fetch error', () => {
    mockUseAttention.mockReturnValue({ attention: {}, isLoading: false, error: new Error('500') })
    const { container } = renderBanner()
    expect(container.firstChild).toBeNull()
  })

  it('renders facts and context per symbol when the endpoint returns data', () => {
    mockUseAttention.mockReturnValue({
      isLoading: false,
      error: null,
      attention: {
        NVDA: {
          status: 'ok',
          notable: true,
          facts: [
            { kind: 'price_move', label: 'Moving +5.2% today', as_of: '2026-09-05', source: 'live price', freshness: 'fresh' },
            { kind: 'earnings_proximity', label: 'Reports in 2 days', as_of: '2026-09-07', source: 'calendar', freshness: 'fresh' },
          ],
          context: { composite_rating: 92, rs_rank: 88 },
        },
        MSFT: {
          status: 'ok',
          notable: false,
          facts: [],
          context: { composite_rating: null, rs_rank: null },
        },
      },
    })
    renderBanner()

    expect(screen.getByTestId('portfolio-attention-banner')).toBeInTheDocument()
    // Notable symbol: facts + context render, with evidence dates (never a
    // rendered "now").
    const nvdaCard = screen.getByTestId('attention-card-NVDA')
    expect(nvdaCard).toHaveTextContent('Moving +5.2% today')
    expect(nvdaCard).toHaveTextContent('2026-09-05')
    expect(nvdaCard).toHaveTextContent('Reports in 2 days')
    expect(nvdaCard).toHaveTextContent('Rating 92')
    expect(nvdaCard).toHaveTextContent('RS 88')
    expect(screen.getByLabelText('NVDA notable')).toBeInTheDocument()

    // Non-notable symbol still renders (per-symbol, read-only) but with no
    // notable marker and no fabricated facts.
    const msftCard = screen.getByTestId('attention-card-MSFT')
    expect(msftCard).toHaveTextContent('Nothing notable')
    expect(screen.queryByLabelText('MSFT notable')).not.toBeInTheDocument()
  })

  it('shows a degraded-status pill when a symbol resolved partially, never hiding it silently', () => {
    mockUseAttention.mockReturnValue({
      isLoading: false,
      error: null,
      attention: {
        TSLA: { status: 'partial', notable: false, facts: [], context: {} },
      },
    })
    renderBanner()
    expect(screen.getByTitle('Data partial')).toBeInTheDocument()
  })

  it('links each card into PositionDetailPage for the same symbol (Attention Signal Propagation V1)', () => {
    mockUseAttention.mockReturnValue({
      isLoading: false,
      error: null,
      attention: {
        NVDA: { status: 'ok', notable: true, facts: [], context: {} },
      },
    })
    renderBanner()
    const card = screen.getByTestId('attention-card-NVDA')
    expect(card.tagName).toBe('A')
    expect(card).toHaveAttribute('href', '/journal-2-0/position/NVDA')
  })
})
