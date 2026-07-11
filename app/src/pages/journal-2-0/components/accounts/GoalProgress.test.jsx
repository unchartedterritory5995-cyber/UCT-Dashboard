import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SWRConfig } from 'swr'
import GoalProgress from './GoalProgress'

// goal-progress fetch → no per-period P&L; the account prop carries the goals.
beforeEach(() => {
  global.fetch = vi.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve({ periods: {} }) }),
  )
})

const renderGP = (account) =>
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <GoalProgress account={account} />
    </SWRConfig>,
  )

describe('GoalProgress', () => {
  it('renders the Goal Progress section with the period cards', () => {
    renderGP({ id: 'a1', name: 'Robinhood', goals: {} })
    expect(screen.getByText('Goal Progress')).toBeInTheDocument()
    expect(screen.getByText('Daily')).toBeInTheDocument()
    expect(screen.getByText('Weekly')).toBeInTheDocument()
  })

  it('shows the set-a-goal nudge when no goals are set', () => {
    renderGP({ id: 'a1', name: 'Robinhood', goals: {} })
    expect(screen.getByTestId('goal-nudge')).toBeInTheDocument()
  })

  it('shows the nudge when every goal is zero/null', () => {
    renderGP({ id: 'a1', name: 'Robinhood', goals: { daily: 0, weekly: null } })
    expect(screen.getByTestId('goal-nudge')).toBeInTheDocument()
  })

  it('hides the nudge once at least one goal is set', () => {
    renderGP({ id: 'a1', name: 'Robinhood', goals: { daily: 100 } })
    expect(screen.queryByTestId('goal-nudge')).toBeNull()
  })

  it('opens the daily inline editor when the nudge is clicked (existing goal-edit path)', () => {
    renderGP({ id: 'a1', name: 'Robinhood', goals: {} })
    fireEvent.click(screen.getByTestId('goal-nudge'))
    expect(screen.getByRole('spinbutton')).toBeInTheDocument()
  })
})
