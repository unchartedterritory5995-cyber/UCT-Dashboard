// Lane FIN-A11Y (review R4, M-2). Answering the "new in your Notebook" offer unmounts the
// card with focus on one of its buttons, so focus fell to <body>. After "Take the tour" the
// tour then recorded <body> as where to return focus, so closing the tour lost it again.
// The card now hands focus to the page heading BEFORE it answers, so both paths leave focus
// on a named element, and the tour has somewhere to return to.
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import TourOfferPrompt from './TourOfferPrompt'

const ENTRY = { id: 'chart-plan', title: 'Chart plans' }

function Host({ onAccept, onLater, heading = true, firstRun = false }) {
  const [open, setOpen] = useState(true)
  return (
    <main>
      {open && (
        <TourOfferPrompt
          entry={ENTRY}
          onAccept={() => { onAccept?.(document.activeElement); setOpen(false) }}
          onLater={() => { onLater?.(document.activeElement); setOpen(false) }}
        />
      )}
      {heading && <h1>Notebook</h1>}
      {firstRun && <h2 data-first-run-heading="" tabIndex={-1}>Welcome to your Notebook</h2>}
      <button type="button">something else</button>
    </main>
  )
}

describe('M-2 -- answering the tour offer leaves focus on a named element', () => {
  it('"Not now" moves focus to the page heading, not to <body>', async () => {
    const user = userEvent.setup()
    render(<Host />)
    await user.click(screen.getByRole('button', { name: 'Not now' }))
    expect(screen.queryByRole('button', { name: 'Not now' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Notebook' })).toHaveFocus()
  })

  it('Escape inside the card does the same', async () => {
    const user = userEvent.setup()
    render(<Host />)
    screen.getByRole('button', { name: 'Take the tour' }).focus()
    await user.keyboard('{Escape}')
    expect(screen.getByRole('heading', { name: 'Notebook' })).toHaveFocus()
  })

  it('"Take the tour" has already moved focus when the tour is asked to open', async () => {
    const user = userEvent.setup()
    const seen = vi.fn()
    render(<Host onAccept={seen} />)
    await user.click(screen.getByRole('button', { name: 'Take the tour' }))
    // what the tour will record as "where focus was": a heading, never <body> or a button
    // that is about to unmount
    expect(seen.mock.calls[0][0]).toBe(screen.getByRole('heading', { name: 'Notebook' }))
    expect(screen.getByRole('heading', { name: 'Notebook' })).toHaveFocus()
  })

  it('prefers the first-run heading when the page has one', async () => {
    const user = userEvent.setup()
    render(<Host firstRun />)
    await user.click(screen.getByRole('button', { name: 'Not now' }))
    expect(screen.getByRole('heading', { name: 'Welcome to your Notebook' })).toHaveFocus()
  })

  it('never uses its own heading as the target', async () => {
    const user = userEvent.setup()
    render(<Host heading={false} />)
    await user.click(screen.getByRole('button', { name: 'Not now' }))
    // no page heading at all: nothing to hand focus to, and nothing throws
    expect(screen.queryByRole('button', { name: 'Not now' })).not.toBeInTheDocument()
  })

  it('a member whose focus is elsewhere keeps it', async () => {
    render(<Host />)
    const other = screen.getByRole('button', { name: 'something else' })
    other.focus()
    // answered without focus being in the card (a pointer on a browser that does not focus
    // buttons on click): focus is not taken from where the member put it
    screen.getByRole('button', { name: 'Not now' }).dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await Promise.resolve()
    expect(other).toHaveFocus()
  })
})
