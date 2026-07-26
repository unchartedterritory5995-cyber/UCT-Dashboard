import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import LandingAnalytics from './LandingAnalytics'

function mockSummary(payload) {
  vi.stubGlobal('fetch', vi.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve(payload) })
  ))
}

const MARKETING_FUNNEL = { views: 0, cta_clickers: 0, click_through_rate: 0 }

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('LandingAnalytics', () => {
  it('shows the pre-launch funnel while the COMING SOON page is the front door', async () => {
    // The marketing CTA events cannot fire pre-launch, so showing that funnel
    // would report 0 visitors / 0% and read as "analytics are broken".
    mockSummary({
      days: 7, events: [], daily: [], funnel: MARKETING_FUNNEL,
      coming_soon: {
        views: 120, joined: 18, join_rate: 0.15,
        founder_clickers: 7, substack_clickers: 25,
        founder_by_channel: [{ channel: 'phone', n: 4 }, { channel: 'email', n: 3 }],
      },
    })
    render(<LandingAnalytics />)

    await waitFor(() => expect(screen.getByText('Saw Coming Soon')).toBeInTheDocument())
    expect(screen.getByText('120')).toBeInTheDocument()
    expect(screen.getByText('18')).toBeInTheDocument()
    expect(screen.getByText('15')).toBeInTheDocument()          // join rate %
    expect(screen.getByText(/phone 4/)).toBeInTheDocument()      // which route they used
    expect(screen.getByText('Opened the Substack')).toBeInTheDocument()
    expect(screen.queryByText('Clicked any CTA')).not.toBeInTheDocument()
  })

  it('falls back to the marketing funnel once pre-launch traffic stops', async () => {
    mockSummary({
      days: 7, events: [], daily: [],
      funnel: { views: 90, cta_clickers: 30, click_through_rate: 0.3333 },
      coming_soon: {
        views: 0, joined: 0, join_rate: 0,
        founder_clickers: 0, substack_clickers: 0, founder_by_channel: [],
      },
    })
    render(<LandingAnalytics />)

    await waitFor(() => expect(screen.getByText('Clicked any CTA')).toBeInTheDocument())
    expect(screen.getByText('90')).toBeInTheDocument()
    expect(screen.queryByText('Saw Coming Soon')).not.toBeInTheDocument()
  })

  it('survives a summary payload with no coming_soon block', async () => {
    // An older backend, or a cached response from before the field existed.
    mockSummary({ days: 7, events: [], daily: [], funnel: MARKETING_FUNNEL })
    render(<LandingAnalytics />)

    await waitFor(() => expect(screen.getByText('Clicked any CTA')).toBeInTheDocument())
  })
})
