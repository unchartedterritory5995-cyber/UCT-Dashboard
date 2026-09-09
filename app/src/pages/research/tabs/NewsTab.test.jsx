import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// A8 News/Intelligence Slice 1 (owner-authorized narrow slice,
// 2026-09-04). Security-scoped only -- no market-wide feed, no
// personalization, no sentiment (FMP carries none genuinely).

const fullData = {
  sym: 'AAPL',
  entity: { status: 'resolved', entityId: 'e_aapl' },
  items: [
    {
      id: 'https://x.example/wire', kind: 'news', headline: 'Apple ships a thing',
      summary: 'A short lede.', publisher: 'Reuters', url: 'https://x.example/wire',
      published_at: '2026-08-09 18:00:00', image: 'https://x.example/img.png',
    },
    {
      id: 'https://x.example/pr', kind: 'release', headline: 'Apple announces a program',
      summary: '', publisher: 'Apple Inc.', url: 'https://x.example/pr',
      published_at: null, image: null,
    },
  ],
  _meta: {
    vendor: 'fmp', sourceActivity: 'fmp_client.get_news_stock',
    sourceObservedAt: null, tieBreak: null, freshnessClass: 'end_of_day',
    licensingClass: 'R', degraded: null,
  },
}

describe('NewsTab', () => {
  it('renders headline, publisher, kind badge, and summary', async () => {
    vi.resetModules()
    vi.doMock('../hooks/useCompanyNews', () => ({ default: () => ({ data: fullData, isLoading: false }) }))
    const { default: FreshTab } = await import('./NewsTab')
    render(<FreshTab sym="AAPL" />)

    expect(screen.getByText('Company news')).toBeInTheDocument()
    expect(screen.getByText('Apple ships a thing')).toBeInTheDocument()
    expect(screen.getByText('Reuters')).toBeInTheDocument()
    expect(screen.getByText('NEWS')).toBeInTheDocument()
    expect(screen.getByText('PR')).toBeInTheDocument()
    expect(screen.getByText('A short lede.')).toBeInTheDocument()
  })

  it('links each headline to the original article with rel=noopener', async () => {
    vi.resetModules()
    vi.doMock('../hooks/useCompanyNews', () => ({ default: () => ({ data: fullData, isLoading: false }) }))
    const { default: FreshTab } = await import('./NewsTab')
    render(<FreshTab sym="AAPL" />)
    const link = screen.getByText('Apple ships a thing').closest('a')
    expect(link).toHaveAttribute('href', 'https://x.example/wire')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('shows "Date unknown" rather than a blank or fabricated time for a missing published_at', async () => {
    vi.resetModules()
    vi.doMock('../hooks/useCompanyNews', () => ({ default: () => ({ data: fullData, isLoading: false }) }))
    const { default: FreshTab } = await import('./NewsTab')
    render(<FreshTab sym="AAPL" />)
    expect(screen.getByText('Date unknown')).toBeInTheDocument()
  })

  it('composes Provenance + FreshnessBadge from D1 meta once for the whole list, not per-article', async () => {
    vi.resetModules()
    vi.doMock('../hooks/useCompanyNews', () => ({ default: () => ({ data: fullData, isLoading: false }) }))
    const { default: FreshTab } = await import('./NewsTab')
    render(<FreshTab sym="AAPL" />)
    expect(screen.getAllByTestId('provenance-detail-toggle')).toHaveLength(1)
    expect(screen.getByText('FMP')).toBeInTheDocument()
  })

  it('renders an honest note when the symbol has not resolved to a canonical entity', async () => {
    vi.resetModules()
    vi.doMock('../hooks/useCompanyNews', () => ({
      default: () => ({
        data: { sym: 'ZZZ', entity: { status: 'not_found', entityId: null }, items: [], _meta: null },
        isLoading: false,
      }),
    }))
    const { default: FreshTab } = await import('./NewsTab')
    render(<FreshTab sym="ZZZ" />)
    expect(screen.getByTestId('entity-unresolved-note')).toHaveTextContent('not_found')
  })

  it('shows the empty-state note when there is no news at all', async () => {
    vi.resetModules()
    vi.doMock('../hooks/useCompanyNews', () => ({
      default: () => ({
        data: { sym: 'QUIET', entity: { status: 'resolved', entityId: 'e_1' }, items: [], _meta: null },
        isLoading: false,
      }),
    }))
    const { default: FreshTab } = await import('./NewsTab')
    render(<FreshTab sym="QUIET" />)
    expect(screen.getByText('No recent news for this ticker.')).toBeInTheDocument()
  })

  it('never fabricates a sentiment badge (FMP carries none genuinely)', async () => {
    vi.resetModules()
    vi.doMock('../hooks/useCompanyNews', () => ({ default: () => ({ data: fullData, isLoading: false }) }))
    const { default: FreshTab } = await import('./NewsTab')
    render(<FreshTab sym="AAPL" />)
    expect(screen.queryByText(/bullish|bearish|neutral/i)).not.toBeInTheDocument()
  })
})

describe('whenLabel', () => {
  it('reports unknown rather than blank for missing/malformed timestamps', async () => {
    const { whenLabel } = await import('./NewsTab')
    expect(whenLabel(null)).toBe('Date unknown')
    expect(whenLabel('')).toBe('Date unknown')
    expect(whenLabel('not a date')).toBe('Date unknown')
  })

  it('renders a relative label for a real recent timestamp', async () => {
    const { whenLabel } = await import('./NewsTab')
    const now = new Date('2026-08-09T18:30:00').getTime()
    expect(whenLabel('2026-08-09 18:00:00', now)).toBe('30m ago')
  })
})
