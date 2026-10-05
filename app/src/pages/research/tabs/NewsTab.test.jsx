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

// TERM-088 -- a failed read must render as an error, never as the genuine
// "no recent news" empty state.
describe('NewsTab -- failed read vs genuine empty state', () => {
  async function renderWith(mockReturn) {
    vi.resetModules()
    vi.doMock('../hooks/useCompanyNews', () => ({ default: () => mockReturn }))
    const { default: FreshTab } = await import('./NewsTab')
    return render(<FreshTab sym="AAPL" />)
  }

  it('renders the error state on a failed read, not "No recent news for this ticker."', async () => {
    await renderWith({ data: null, isLoading: false, error: true, mutate: () => {} })
    expect(screen.getByTestId('news-error')).toHaveTextContent("Couldn't load news")
    expect(screen.queryByText('No recent news for this ticker.')).not.toBeInTheDocument()
  })

  it('still renders the genuine empty state when the read succeeded with no items', async () => {
    await renderWith({ data: { items: [] }, isLoading: false, error: false, mutate: () => {} })
    expect(screen.getByText('No recent news for this ticker.')).toBeInTheDocument()
    expect(screen.queryByTestId('news-error')).not.toBeInTheDocument()
  })

  it('Retry calls mutate', async () => {
    const mutate = vi.fn()
    await renderWith({ data: null, isLoading: false, error: true, mutate })
    screen.getByText('Retry').click()
    expect(mutate).toHaveBeenCalled()
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
    // 18:00 ET on 2026-08-09 (EDT, UTC-4) is 22:00Z; "now" is 22:30Z.
    const now = Date.parse('2026-08-09T22:30:00Z')
    expect(whenLabel('2026-08-09 18:00:00', now)).toBe('30m ago')
  })

  it('reads the zone-less FMP string as America/New_York, not browser-local (fixed instants, EDT and EST)', async () => {
    const { whenLabel } = await import('./NewsTab')
    // EDT: 09:15 ET = 13:15Z. Two hours later is 15:15Z.
    expect(whenLabel('2026-07-01 09:15:00', Date.parse('2026-07-01T15:15:00Z'))).toBe('2h ago')
    // EST: 09:15 ET = 14:15Z. Three hours later is 17:15Z.
    expect(whenLabel('2026-01-15 09:15:00', Date.parse('2026-01-15T17:15:00Z'))).toBe('3h ago')
  })

  it('a timestamp well in the future is not clamped to "just now"', async () => {
    const { whenLabel } = await import('./NewsTab')
    // 20:00 ET on 2026-08-09 = 2026-08-10T00:00Z; "now" is an hour earlier.
    expect(whenLabel('2026-08-09 20:00:00', Date.parse('2026-08-09T23:00:00Z'))).toBe('Aug 9')
    // A small skew still reads "just now".
    expect(whenLabel('2026-08-09 20:02:00', Date.parse('2026-08-10T00:00:00Z'))).toBe('just now')
  })
})
