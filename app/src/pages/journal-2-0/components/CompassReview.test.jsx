import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import CompassReview from './CompassReview'

// Wave 13 lane 13F added a "Draft weekly review note" door that navigates via
// useNavigate(), which throws outside a Router — every render needs one, even
// while the door itself is flag-gated off (the hook call is unconditional).
const renderReview = (props) => render(<MemoryRouter><CompassReview {...props} /></MemoryRouter>)

const SAMPLE_REVIEW = {
  id: 'r1',
  body: '# Week of 2026-05-04\n\nHead coach line.\n\n## Performance\n- Net P&L: +$500',
  summary: 'Head coach line.',
  metadata: { week_start: '2026-05-04', key_observations: ['a', 'b'] },
  feedback: null,
  created_at: '2026-05-11T20:00:00+00:00',
}

describe('CompassReview', () => {
  it('renders the review body as markdown', () => {
    renderReview({ review: SAMPLE_REVIEW, onFeedback: () => {}, onRegenerate: () => {}, onForget: () => {} })
    expect(screen.getByText(/Week of 2026-05-04/i)).toBeInTheDocument()
    expect(screen.getByText(/Head coach line/i)).toBeInTheDocument()
    expect(screen.getByText(/Net P&L: \+\$500/i)).toBeInTheDocument()
  })

  it('clicking 👍 calls onFeedback with "helpful"', async () => {
    const user = userEvent.setup()
    const onFeedback = vi.fn()
    renderReview({ review: SAMPLE_REVIEW, onFeedback, onRegenerate: () => {}, onForget: () => {} })
    await user.click(screen.getByRole('button', { name: /helpful/i }))
    expect(onFeedback).toHaveBeenCalledWith('helpful')
  })

  it('clicking Forget calls onForget', async () => {
    const user = userEvent.setup()
    const onForget = vi.fn()
    renderReview({ review: SAMPLE_REVIEW, onFeedback: () => {}, onRegenerate: () => {}, onForget })
    await user.click(screen.getByRole('button', { name: /forget/i }))
    expect(onForget).toHaveBeenCalled()
  })

  // Wave 13 lane 13F.
  it('the "Draft weekly review note" door is absent while the flag is off (default)', () => {
    renderReview({ review: SAMPLE_REVIEW, onFeedback: () => {}, onRegenerate: () => {}, onForget: () => {} })
    expect(screen.queryByRole('button', { name: /draft weekly review/i })).not.toBeInTheDocument()
  })
})

describe('CompassReview — "Draft weekly review note" (wave 13 lane 13F, flag on)', () => {
  it('drafts the weekly review and navigates to the landed note', async () => {
    vi.resetModules()
    vi.doMock('../lib/reviewDrafts', () => ({
      reviewDraftsEnabled: () => true,
      draftWeeklyReview: vi.fn(async () => ({ note: { id: 'weekly1' } })),
    }))
    const navigateSpy = vi.fn()
    vi.doMock('react-router-dom', async () => {
      const actual = await vi.importActual('react-router-dom')
      return { ...actual, useNavigate: () => navigateSpy }
    })
    const { default: CompassReviewFresh } = await import('./CompassReview')
    const user = userEvent.setup()
    render(<MemoryRouter><CompassReviewFresh review={SAMPLE_REVIEW} onFeedback={() => {}} onRegenerate={() => {}} onForget={() => {}} /></MemoryRouter>)
    const btn = screen.getByRole('button', { name: /draft weekly review/i })
    await user.click(btn)
    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith('/journal/notebook?note=weekly1'))
    vi.doUnmock('../lib/reviewDrafts')
    vi.doUnmock('react-router-dom')
  })
})
