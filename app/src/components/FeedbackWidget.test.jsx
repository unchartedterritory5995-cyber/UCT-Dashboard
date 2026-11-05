// Audit 2026-11-05, spec S5 (B10): Esc did not close Help & Feedback, and an invisible full-page
// overlay sat over everything while it was open, so the member's next click on the page was eaten
// just to close it. Now Esc closes it and focus goes back to the "?" button; a click outside closes
// it AND reaches what was clicked; and nothing invisible is left over the page.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act, waitFor } from '@testing-library/react'
import { useRef, useState } from 'react'
import NotebookPlusFab from '../pages/journal-2-0/components/notebook/NotebookPlusFab'
import NotebookPlusSheet from '../pages/journal-2-0/components/notebook/NotebookPlusSheet'
import { openFeedback } from './feedbackDoor'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))
vi.mock('../hooks/useHideOnScroll', () => ({ default: () => false }))
vi.mock('../hooks/useScrollLocked', () => ({ default: () => false }))

import FeedbackWidget from './FeedbackWidget'

afterEach(cleanup)

function mount() {
  const onPage = vi.fn()
  render(
    <MemoryRouter initialEntries={['/journal/notebook']}>
      <button type="button" onClick={onPage}>Something on the page</button>
      <FeedbackWidget />
    </MemoryRouter>,
  )
  return { onPage, trigger: screen.getByRole('button', { name: 'Help & Feedback' }) }
}

describe('Help & Feedback (B10)', () => {
  it('Esc closes the menu and puts focus back on the "?" button', () => {
    const { trigger } = mount()
    trigger.focus()
    fireEvent.click(trigger)
    expect(screen.getByText('Send Feedback')).toBeInTheDocument()
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByText('Send Feedback')).toBeNull()
    expect(document.activeElement).toBe(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('Esc closes the feedback form too', () => {
    const { trigger } = mount()
    fireEvent.click(trigger)
    fireEvent.click(screen.getByText('Send Feedback'))
    expect(screen.getByLabelText('Feedback message')).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByLabelText('Feedback message')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('a click outside closes it, and the click still reaches the page (no invisible overlay)', () => {
    const { trigger, onPage } = mount()
    fireEvent.click(trigger)
    const page = screen.getByRole('button', { name: 'Something on the page' })
    fireEvent.pointerDown(page)
    fireEvent.click(page)
    expect(screen.queryByText('Send Feedback')).toBeNull()
    expect(onPage).toHaveBeenCalledTimes(1)
  })

  it('a click inside the menu does not close it', () => {
    const { trigger } = mount()
    fireEvent.click(trigger)
    fireEvent.pointerDown(screen.getByText('Send Feedback'))
    expect(screen.getByText('Send Feedback')).toBeInTheDocument()
  })
})

// Fix round 1 (review minor 8): the items were <div onClick> -- no role, not in the Tab order, Enter
// did nothing -- and opening the menu left focus on the trigger. And the overlay rail must look for
// the overlay itself: jsdom does no hit-testing.
describe('Help & Feedback by keyboard (fix round 1)', () => {
  it('the items are buttons, and opening the menu puts focus on the first', () => {
    const { trigger } = mount()
    fireEvent.click(trigger)
    const first = screen.getByRole('button', { name: 'Send Feedback' })
    expect(screen.getByRole('button', { name: 'Support Ticket' })).toBeInTheDocument()
    expect(document.activeElement).toBe(first)
    fireEvent.click(first)
    expect(screen.getByLabelText('Feedback message')).toBeInTheDocument()
  })

  it('no full-page fixed element is left over the page while the menu is open', () => {
    const { trigger } = mount()
    fireEvent.click(trigger)
    const overlays = [...document.body.querySelectorAll('*')].filter((el) => {
      const s = el.style
      return s.position === 'fixed' && (s.inset === '0' || s.inset === '0px'
        || (s.top === '0px' && s.left === '0px' && s.right === '0px' && s.bottom === '0px'))
    })
    expect(overlays).toEqual([])
  })
})

// Fix round 2 (re-review N7): choosing Send Feedback unmounted the focused item and dropped focus.
describe('Send Feedback lands focus in the message (fix round 2)', () => {
  it('opening the form focuses the Feedback message field', () => {
    const { trigger } = mount()
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('button', { name: 'Send Feedback' }))
    expect(document.activeElement).toBe(screen.getByLabelText('Feedback message'))
  })
})

// Tier 1b fix round 1 (review Minor 8): the phone Notebook does not draw the "?" (S12); its "+" sheet's Help row opens
// THIS menu through components/feedbackDoor.js, so Send Feedback stays reachable there.
describe('the feedback door (Minor 8)', () => {
  it('openFeedback() opens the Help & Feedback menu, with Send Feedback in it', async () => {
    mount()
    expect(screen.queryByRole('button', { name: /Send Feedback/ })).toBeNull()
    act(() => { openFeedback() })
    fireEvent.click(await screen.findByRole('button', { name: /Send Feedback/ }))
    expect(screen.getByLabelText('Feedback message')).toBeInTheDocument()
  })
})

// Tier 1b fix round 2 (re-review N2): from the phone Notebook's "+" sheet, "Help & feedback" opens THIS menu with focus
// in it, and Escape hands focus back to the "+" that started it -- not to the "?", which is not drawn there.
describe('the feedback door from the "+" returns focus to the "+" (N2)', () => {
  it('"+" -> Help & feedback: focus lands on Send Feedback; Escape returns it to the "+"', async () => {
    function Plus() {
      const [open, setOpen] = useState(false)
      const ref = useRef(null)
      return (
        <>
          <NotebookPlusFab ref={ref} open={open} onOpen={() => setOpen(true)} />
          <NotebookPlusSheet open={open} onClose={() => setOpen(false)} returnFocusTo={ref} onQuickNote={vi.fn()} />
        </>
      )
    }
    render(<MemoryRouter initialEntries={['/journal/notebook']}><Plus /><FeedbackWidget /></MemoryRouter>)
    const plus = screen.getByRole('button', { name: 'Add to your notebook' })
    plus.focus()
    fireEvent.click(plus)
    fireEvent.click(screen.getByRole('button', { name: 'Help & feedback' }))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: /Send Feedback/ })))
    fireEvent.keyDown(document.activeElement, { key: 'Escape' })
    await waitFor(() => expect(document.activeElement).toBe(plus))
  })
})
