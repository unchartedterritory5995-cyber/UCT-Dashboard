import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CompassReview from './CompassReview'

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
    render(<CompassReview review={SAMPLE_REVIEW} onFeedback={() => {}} onRegenerate={() => {}} onForget={() => {}} />)
    expect(screen.getByText(/Week of 2026-05-04/i)).toBeInTheDocument()
    expect(screen.getByText(/Head coach line/i)).toBeInTheDocument()
    expect(screen.getByText(/Net P&L: \+\$500/i)).toBeInTheDocument()
  })

  it('clicking 👍 calls onFeedback with "helpful"', async () => {
    const user = userEvent.setup()
    const onFeedback = vi.fn()
    render(<CompassReview review={SAMPLE_REVIEW} onFeedback={onFeedback} onRegenerate={() => {}} onForget={() => {}} />)
    await user.click(screen.getByRole('button', { name: /helpful/i }))
    expect(onFeedback).toHaveBeenCalledWith('helpful')
  })

  it('clicking Forget calls onForget', async () => {
    const user = userEvent.setup()
    const onForget = vi.fn()
    render(<CompassReview review={SAMPLE_REVIEW} onFeedback={() => {}} onRegenerate={() => {}} onForget={onForget} />)
    await user.click(screen.getByRole('button', { name: /forget/i }))
    expect(onForget).toHaveBeenCalled()
  })
})
