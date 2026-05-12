import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TradeReviewCard from './TradeReviewCard'

describe('TradeReviewCard', () => {
  it('renders nothing when review + isLoading are both falsy', () => {
    const { container } = render(<TradeReviewCard review={null} isLoading={false} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders loading message when isLoading', () => {
    render(<TradeReviewCard review={null} isLoading={true} />)
    expect(screen.getByText(/Compass is writing/i)).toBeInTheDocument()
  })

  it('renders review body', () => {
    render(<TradeReviewCard review={{
      id: 'r1', body: 'This NVDA Bull Flag at +2.0R landed cleanly. Repeat the rhythm.',
    }} isLoading={false} />)
    expect(screen.getByText(/Bull Flag at \+2.0R/i)).toBeInTheDocument()
  })

  it('clicking helpful fires onFeedback("helpful")', async () => {
    const onFeedback = vi.fn()
    const user = userEvent.setup()
    render(<TradeReviewCard review={{ id: 'r1', body: 'hi' }} isLoading={false}
                            onFeedback={onFeedback} />)
    await user.click(screen.getByRole('button', { name: /helpful/i }))
    expect(onFeedback).toHaveBeenCalledWith('helpful')
  })
})
