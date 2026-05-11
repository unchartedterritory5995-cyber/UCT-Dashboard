import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import EODRecap from './EODRecap'

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
    render(<EODRecap recap={SAMPLE} onFeedback={() => {}} onRegenerate={() => {}} onForget={() => {}} />)
    expect(screen.getByText(/Pullback on AAPL/i)).toBeInTheDocument()
  })

  it('renders the unverified-claims badge when validation.passed is false', () => {
    const withFlag = { ...SAMPLE, validation: { passed: false, flags: ['unverified R-multiple: 9.9R'] } }
    render(<EODRecap recap={withFlag} onFeedback={() => {}} onRegenerate={() => {}} onForget={() => {}} />)
    expect(screen.getByText(/unverified/i)).toBeInTheDocument()
  })

  it('clicking 👍 calls onFeedback with "helpful"', async () => {
    const user = userEvent.setup()
    const onFeedback = vi.fn()
    render(<EODRecap recap={SAMPLE} onFeedback={onFeedback} onRegenerate={() => {}} onForget={() => {}} />)
    await user.click(screen.getByRole('button', { name: /helpful/i }))
    expect(onFeedback).toHaveBeenCalledWith('helpful')
  })

  it('Forget button calls onForget', async () => {
    const user = userEvent.setup()
    const onForget = vi.fn()
    render(<EODRecap recap={SAMPLE} onFeedback={() => {}} onRegenerate={() => {}} onForget={onForget} />)
    await user.click(screen.getByRole('button', { name: /forget/i }))
    expect(onForget).toHaveBeenCalled()
  })
})
