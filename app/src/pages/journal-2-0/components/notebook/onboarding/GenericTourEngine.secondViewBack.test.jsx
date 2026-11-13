// Follow-up B, item 2b: Back from a step inside a menu's SECOND view goes to the step that opened that view, and the
// menu is left as it is. Before: the opener's anchor (a row of the menu's first view) was not on screen, so Back
// skipped it and landed on the step that opened the MENU, whose card told the member to press the arrow (which closes
// the menu). The Reviews walkthrough (tours/reviewDrafts.steps.js) is the case: its first review's card.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import GenericTourEngine from './GenericTourEngine'
import { installTourLayout } from './__fixtures__/tourLayout'
import { STEPS as REVIEW_STEPS } from './tours/reviewDrafts.steps'

// The Reviews walkthrough's shape, on one tier: the arrow opens the menu, a row opens its second view, the reviews.
const entry = {
  id: 'second-view-probe',
  load: async () => ({
    steps: [
      { id: 'open', anchor: 'arrow', file: 'x', waitFor: 'row-open' },
      { id: 'open-reviews', anchor: 'row-open', file: 'x', waitFor: 'review-daily' },
      { id: 'daily', anchor: 'review-daily', file: 'x' },
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

// The menu: the arrow is always drawn; open, the first view has the row, the second view has the reviews.
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

describe('Back from a step inside a second view', () => {
  it('goes to the step that opened the view, with the menu left as it is', async () => {
    render(<Page />)
    expect(await screen.findByRole('dialog', { name: 'Press the arrow' }, { timeout: 4000 })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByRole('dialog', { name: 'Open Draft a review' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Draft a review' }))     // the member opens the second view
    expect(await screen.findByRole('dialog', { name: "Today's recap" }, { timeout: 4000 })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(await screen.findByRole('dialog', { name: 'Open Draft a review' })).toBeInTheDocument()
    expect(screen.getByTestId('second-view')).toBeInTheDocument()                 // the menu is as it was
    // It stays there: the review it waits for was already on screen, so nothing jumps forward on its own.
    await new Promise((r) => setTimeout(r, 400))
    expect(screen.getByRole('dialog', { name: 'Open Draft a review' })).toBeInTheDocument()
    // Next goes on to the review again.
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => expect(screen.getByRole('dialog', { name: "Today's recap" })).toBeInTheDocument())
  })

  it('the Reviews walkthrough has that shape: on each tier, the first review is waited for by the step that opens its view', () => {
    const daily = REVIEW_STEPS.find((s) => s.id === 'daily')
    const openers = REVIEW_STEPS.filter((s) => s.waitFor === daily.anchor).map((s) => `${s.id}:${s.tier}`)
    expect(openers).toEqual(['open-reviews:wide', 'phone-open-reviews:phone'])
  })
})
