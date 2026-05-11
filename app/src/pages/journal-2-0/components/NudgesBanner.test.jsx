import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import NudgesBanner from './NudgesBanner'

beforeEach(() => {
  // Clear any test-state from prior runs.
  localStorage.clear()
})

describe('NudgesBanner', () => {
  it('renders nothing when state is undefined (loading)', () => {
    const { container } = render(<NudgesBanner accountId="acct1" state={undefined} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when no nudges are active', () => {
    const state = {
      lossStreakCount: 0,
      winStreakCount: 0,
      staleCount: 0,
      thresholds: { loss: 3, win: 5, staleDays: 30 },
    }
    const { container } = render(<NudgesBanner accountId="acct1" state={state} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders the loss-streak nudge when count >= threshold', () => {
    const state = {
      lossStreakCount: 3,
      winStreakCount: 0,
      staleCount: 0,
      thresholds: { loss: 3, win: 5, staleDays: 30 },
    }
    render(<NudgesBanner accountId="acct1" state={state} />)
    expect(screen.getByText(/3 down today/i)).toBeInTheDocument()
  })

  it('hides a nudge after Snooze is clicked', async () => {
    const user = userEvent.setup()
    const state = {
      lossStreakCount: 4,
      winStreakCount: 0,
      staleCount: 0,
      thresholds: { loss: 3, win: 5, staleDays: 30 },
    }
    const { rerender, container } = render(<NudgesBanner accountId="acct1" state={state} />)
    // Click the snooze button on the loss-streak nudge
    const snoozeBtn = screen.getByRole('button', { name: /snooze loss-streak nudge/i })
    await user.click(snoozeBtn)
    // Re-render with the same state (the snooze should now suppress it)
    rerender(<NudgesBanner accountId="acct1" state={state} />)
    expect(container.firstChild).toBeNull()
  })
})
