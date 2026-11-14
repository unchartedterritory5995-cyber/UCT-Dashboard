// Follow-up B fix round 1 (replaces the round-0 `backFrom` engine change): a step may say it has no Back (`noBack`).
// The Reviews walkthrough (tours/reviewDrafts.steps.js) sets it on its first review: that card sits inside the menu's
// SECOND view, and Back from it used to land on step 1 with the menu open, telling the member to press the arrow (which
// closes the menu). With no Back on that card, nothing points at a control that is not on screen. Every other card is
// unchanged: Back is drawn, and from a step whose earlier step is on screen it goes there.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import GenericTourEngine from './GenericTourEngine'
import { installTourLayout } from './__fixtures__/tourLayout'
import { STEPS as REVIEW_STEPS } from './tours/reviewDrafts.steps'

// The Reviews walkthrough's shape, on one tier: the arrow opens the menu, a row opens its second view, the reviews.
const entry = {
  id: 'no-back-probe',
  load: async () => ({
    steps: [
      { id: 'open', anchor: 'arrow', file: 'x', waitFor: 'row-open' },
      { id: 'open-reviews', anchor: 'row-open', file: 'x', waitFor: 'review-daily' },
      { id: 'daily', anchor: 'review-daily', file: 'x', noBack: true },
      { id: 'later', anchor: 'review-weekly', file: 'x' },
    ],
    copy: {
      open: { title: 'Press the arrow', body: 'b' },
      'open-reviews': { title: 'Open Draft a review', body: 'b' },
      daily: { title: "Today's recap", body: 'b' },
      later: { title: 'Week and month', body: 'b' },
    },
  }),
}

function Menu() {
  const [view, setView] = useState('first')
  return (
    <div>
      <button type="button" data-tour="arrow">arrow</button>
      {view === 'first'
        ? <button type="button" data-tour="row-open" onClick={() => setView('second')}>Draft a review</button>
        : (
          <div data-testid="second-view">
            <button type="button" data-tour="review-daily">Today's recap</button>
            <button type="button" data-tour="review-weekly">This week</button>
          </div>
        )}
    </div>
  )
}

function Page() {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <MemoryRouter>
        <Menu />
        <GenericTourEngine entry={entry} onClose={vi.fn()} startWaitMs={120} stepWaitMs={120} />
      </MemoryRouter>
    </SWRConfig>
  )
}

let restore
beforeEach(() => {
  global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }))
  restore = installTourLayout()
})
afterEach(() => { restore(); vi.restoreAllMocks() })

const back = () => screen.queryByRole('button', { name: 'Back' })

describe('a step with `noBack`', () => {
  it('the first review (inside the second view) draws no Back; the cards around it are unchanged', async () => {
    render(<Page />)
    expect(await screen.findByRole('dialog', { name: 'Press the arrow' }, { timeout: 4000 })).toBeInTheDocument()
    expect(back()).toBeDisabled()                                                // the first card: Back drawn, disabled
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByRole('dialog', { name: 'Open Draft a review' })).toBeInTheDocument()
    expect(back()).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Draft a review' }))     // the member opens the second view
    expect(await screen.findByRole('dialog', { name: "Today's recap" }, { timeout: 4000 })).toBeInTheDocument()
    expect(back()).toBeNull()
    expect(screen.getByRole('button', { name: 'Next' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByRole('dialog', { name: 'Week and month' })).toBeInTheDocument()
    // CONTROL: the next card has Back again, and it goes to the review (on screen), the engine's ordinary rule.
    fireEvent.click(back())
    expect(await screen.findByRole('dialog', { name: "Today's recap" })).toBeInTheDocument()
    expect(screen.getByTestId('second-view')).toBeInTheDocument()
  })

  it('the Reviews walkthrough sets it on its first review only, the step every tier reaches inside the second view', () => {
    const daily = REVIEW_STEPS.find((s) => s.id === 'daily')
    expect(REVIEW_STEPS.filter((s) => s.noBack).map((s) => s.id)).toEqual(['daily'])
    expect(REVIEW_STEPS.filter((s) => s.waitFor === daily.anchor).map((s) => `${s.id}:${s.tier}`))
      .toEqual(['open-reviews:wide', 'phone-open-reviews:phone'])
    expect(daily.tier).toBeUndefined()                                           // on both tiers
  })
})
