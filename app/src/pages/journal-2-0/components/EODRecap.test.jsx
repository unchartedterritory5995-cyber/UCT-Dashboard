import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import EODRecap from './EODRecap'

// Wave 13 lane 13F added a "Draft in today's note" door that navigates via
// useNavigate(), which throws outside a Router — every render needs one, even
// while the door itself is flag-gated off (the hook call is unconditional).
const renderRecap = (props) => render(<MemoryRouter><EODRecap {...props} /></MemoryRouter>)

const SAMPLE = {
  id: 'e1',
  body: "Today's two trades were a mixed read. The Pullback on AAPL (+2.1R) was clean. What was different about today's AAPL entry vs your prior Pullbacks?",
  summary: "Mixed day.",
  metadata: { day: '2026-05-11', validation: { passed: true, flags: [] } },
  feedback: null,
  created_at: '2026-05-11T20:00:00+00:00',
  validation: { passed: true, flags: [] },
  day: '2026-05-11',
}

describe('EODRecap', () => {
  it('renders the recap body', () => {
    renderRecap({ recap: SAMPLE, onFeedback: () => {}, onRegenerate: () => {}, onForget: () => {} })
    expect(screen.getByText(/Pullback on AAPL/i)).toBeInTheDocument()
  })

  it('renders the unverified-claims badge when validation.passed is false', () => {
    const withFlag = { ...SAMPLE, validation: { passed: false, flags: ['unverified R-multiple: 9.9R'] } }
    renderRecap({ recap: withFlag, onFeedback: () => {}, onRegenerate: () => {}, onForget: () => {} })
    expect(screen.getByText(/unverified/i)).toBeInTheDocument()
  })

  it('clicking 👍 calls onFeedback with "helpful"', async () => {
    const user = userEvent.setup()
    const onFeedback = vi.fn()
    renderRecap({ recap: SAMPLE, onFeedback, onRegenerate: () => {}, onForget: () => {} })
    await user.click(screen.getByRole('button', { name: /helpful/i }))
    expect(onFeedback).toHaveBeenCalledWith('helpful')
  })

  it('Forget button calls onForget', async () => {
    const user = userEvent.setup()
    const onForget = vi.fn()
    renderRecap({ recap: SAMPLE, onFeedback: () => {}, onRegenerate: () => {}, onForget })
    await user.click(screen.getByRole('button', { name: /forget/i }))
    expect(onForget).toHaveBeenCalled()
  })

  // Wave 13 lane 13F.
  it('the "Draft in today’s note" door is absent while the flag is off (default)', () => {
    renderRecap({ recap: SAMPLE, onFeedback: () => {}, onRegenerate: () => {}, onForget: () => {} })
    expect(screen.queryByRole('button', { name: /draft in today/i })).not.toBeInTheDocument()
  })
})

describe('EODRecap — "Draft in today’s note" (wave 13 lane 13F, flag on)', () => {
  it('drafts the daily recap and navigates to the landed note', async () => {
    vi.resetModules()
    vi.doMock('../lib/reviewDrafts', () => ({
      reviewDraftsEnabled: () => true,
      draftDailyReview: vi.fn(async () => ({ note: { id: 'daily1' } })),
    }))
    const navigateSpy = vi.fn()
    vi.doMock('react-router-dom', async () => {
      const actual = await vi.importActual('react-router-dom')
      return { ...actual, useNavigate: () => navigateSpy }
    })
    const { default: EODRecapFresh } = await import('./EODRecap')
    const user = userEvent.setup()
    render(<MemoryRouter><EODRecapFresh recap={SAMPLE} onFeedback={() => {}} onRegenerate={() => {}} onForget={() => {}} /></MemoryRouter>)
    const btn = screen.getByRole('button', { name: /draft in today/i })
    await user.click(btn)
    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith('/journal/notebook?note=daily1'))
    vi.doUnmock('../lib/reviewDrafts')
    vi.doUnmock('react-router-dom')
  })
})
