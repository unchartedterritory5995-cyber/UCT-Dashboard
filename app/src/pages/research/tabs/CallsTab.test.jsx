import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../../../components/calendar/SentimentGauge', () => ({ default: () => <div>sentiment-gauge</div> }))
// The stub normalizes exactly as the real section does, so it sees what the
// real one would: the inner recap fields AND the outer ones.
vi.mock('../../../components/calendar/CallRecapSection', async () => {
  const { normalizeCallRecap } = await vi.importActual('../../../components/research/callRecap')
  return { default: ({ recap }) => {
    const r = normalizeCallRecap(recap) || {}
    return <div>recap:{r.headline} webcast:{r.webcast_url || 'none'} ratings:{(r.rating_changes || []).length} review:{r.review_status || 'none'}</div>
  } }
})
vi.mock('../hooks/useCallRecap', () => ({ default: () => ({ data: {
  recap: { headline: 'Strong quarter' },
  webcast_url: 'https://example.com/live', rating_changes: [{ period: '2026-09' }], review_status: 'reviewed',
}, isLoading: false }) }))
vi.mock('../hooks/useEarningsAudio', () => ({ default: () => ({ data: null }) }))

import CallsTab from './CallsTab'

describe('CallsTab', () => {
  it('renders the sentiment gauge and call recap', () => {
    render(<CallsTab sym="AAPL" />)
    expect(screen.getByText('sentiment-gauge')).toBeInTheDocument()
    expect(screen.getByText(/Strong quarter/)).toBeInTheDocument()
  })

  it('hands the section the whole payload, so the outer webcast/ratings/review fields survive', () => {
    render(<CallsTab sym="AAPL" />)
    expect(screen.getByText(/Strong quarter/).textContent)
      .toBe('recap:Strong quarter webcast:https://example.com/live ratings:1 review:reviewed')
  })
})

// TERM-088 -- a failed read must render as an error, never as the genuine
// "no recap available" empty state. vi.resetModules + vi.doMock so each case
// gets a fresh mock independent of the file-level vi.mock above.
describe('CallsTab -- failed read vs genuine empty state', () => {
  async function renderWith(mockReturn) {
    vi.resetModules()
    vi.doMock('../hooks/useCallRecap', () => ({ default: () => mockReturn }))
    vi.doMock('../hooks/useEarningsAudio', () => ({ default: () => ({ data: null, error: false, mutate: () => {} }) }))
    vi.doMock('../../../components/calendar/SentimentGauge', () => ({ default: () => <div>sentiment-gauge</div> }))
    vi.doMock('../../../components/calendar/CallRecapSection', () => ({ default: ({ recap }) => <div>recap:{recap?.headline}</div> }))
    vi.doMock('../../../components/calendar/TranscriptPanel', () => ({ default: () => <div>transcript-panel</div> }))
    const { default: FreshTab } = await import('./CallsTab')
    return render(<FreshTab sym="AAPL" />)
  }

  it('renders the error state on a failed read, not the "no recap available" empty copy', async () => {
    await renderWith({ data: null, isLoading: false, error: true, mutate: () => {} })
    expect(screen.getByTestId('call-recap-error')).toHaveTextContent("Couldn't load the earnings call recap")
    expect(screen.queryByText(/No earnings call recap/i)).not.toBeInTheDocument()
  })

  it('still renders the genuine empty state when the read succeeded with no recap', async () => {
    await renderWith({ data: {}, isLoading: false, error: false, mutate: () => {} })
    expect(screen.queryByTestId('call-recap-error')).not.toBeInTheDocument()
  })

  it('Retry calls mutate', async () => {
    const mutate = vi.fn()
    await renderWith({ data: null, isLoading: false, error: true, mutate })
    screen.getByText('Retry').click()
    expect(mutate).toHaveBeenCalled()
  })
})
