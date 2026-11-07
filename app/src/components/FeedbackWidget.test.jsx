// Audit 2026-11-05, spec S5 (B10): Esc did not close Help & Feedback, and an invisible full-page
// overlay sat over everything while it was open, so the member's next click on the page was eaten
// just to close it. Now Esc closes it and focus goes back to the "?" button; a click outside closes
// it AND reaches what was clicked; and nothing invisible is left over the page.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act, waitFor } from '@testing-library/react'
import { useRef, useState } from 'react'
import NotebookPlusFab from '../pages/journal-2-0/components/notebook/NotebookPlusFab'
import NotebookPlusSheet from '../pages/journal-2-0/components/notebook/NotebookPlusSheet'
import { openFeedback, registerHelpHost, registerShortcutsHost } from './feedbackDoor'
import { HELP_SEARCH_HREF, HELP_WALKTHROUGHS_HREF, NEW_TICKET_HREF, QUICK_ANSWERS_HREF } from './helpAnchors'
import { MemoryRouter, useLocation } from 'react-router-dom'

vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))
vi.mock('../hooks/useHideOnScroll', () => ({ default: () => false }))
vi.mock('../hooks/useScrollLocked', () => ({ default: () => false }))

import FeedbackWidget, { helpMenuRows } from './FeedbackWidget'
import { __resetNotebookFlags, latchNotebookFlags } from '../pages/journal-2-0/lib/offline/notebookFlags'

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
    expect(screen.getByRole('menuitem', { name: 'Send feedback' })).toBeInTheDocument()
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu', { name: 'Help' })).toBeNull()
    expect(document.activeElement).toBe(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('Esc closes the feedback form too', () => {
    const { trigger } = mount()
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Send feedback' }))
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
    expect(screen.queryByRole('menu', { name: 'Help' })).toBeNull()
    expect(onPage).toHaveBeenCalledTimes(1)
  })

  it('a click inside the menu does not close it', () => {
    const { trigger } = mount()
    fireEvent.click(trigger)
    fireEvent.pointerDown(screen.getByRole('menuitem', { name: 'Send feedback' }))
    expect(screen.getByRole('menuitem', { name: 'Send feedback' })).toBeInTheDocument()
  })
})

// Fix round 1 (review minor 8): the items were <div onClick> -- no role, not in the Tab order, Enter
// did nothing -- and opening the menu left focus on the trigger. And the overlay rail must look for
// the overlay itself: jsdom does no hit-testing.
describe('Help & Feedback by keyboard (fix round 1)', () => {
  it('the items are buttons, and opening the menu puts focus on the first', () => {
    const { trigger } = mount()
    fireEvent.click(trigger)
    const first = screen.getByRole('menuitem', { name: 'Search help' })
    expect(first.tagName).toBe('BUTTON')
    expect(document.activeElement).toBe(first)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Send feedback' }))
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
    fireEvent.click(screen.getByRole('menuitem', { name: 'Send feedback' }))
    expect(document.activeElement).toBe(screen.getByLabelText('Feedback message'))
  })
})

// Tier 1b fix round 1 (review Minor 8): the phone Notebook does not draw the "?" (S12); its "+" sheet's Help row opens
// THIS menu through components/feedbackDoor.js, so Send Feedback stays reachable there.
describe('the feedback door (Minor 8)', () => {
  it('openFeedback() opens the Help & Feedback menu, with Send Feedback in it', async () => {
    mount()
    expect(screen.queryByRole('menuitem', { name: /Send feedback/ })).toBeNull()
    act(() => { openFeedback() })
    fireEvent.click(await screen.findByRole('menuitem', { name: /Send feedback/ }))
    expect(screen.getByLabelText('Feedback message')).toBeInTheDocument()
  })
})

// Tier 1b fix round 2 (re-review N2): from the phone Notebook's "+" sheet, "Help & feedback" opens THIS menu with focus
// in it, and Escape hands focus back to the "+" that started it -- not to the "?", which is not drawn there.
describe('the feedback door from the "+" returns focus to the "+" (N2)', () => {
  it('"+" -> Help & feedback: focus lands in the menu (its first row); Escape returns it to the "+"', async () => {
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
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Search help' })))
    fireEvent.keyDown(document.activeElement, { key: 'Escape' })
    await waitFor(() => expect(document.activeElement).toBe(plus))
  })
})

// S14 (audit 2026-11-05, details #3-#5): ONE Help menu. Two "?" buttons did two jobs (the corner one: feedback and a
// ticket; the Journal header's: keyboard shortcuts). The menu is this one, with the spec's five rows in its order.
describe('the one Help menu (S14)', () => {
  // the wave-14 switch on, so Help > Walkthroughs exists and "Tours" is offered (review minor 10)
  beforeEach(() => latchNotebookFlags({ notebook_onboarding_enabled: true, notebook_getting_started_enabled: true }))
  afterEach(() => __resetNotebookFlags())
  function Where() {
    const loc = useLocation()
    return <span data-testid="where" data-search={loc.search}>{loc.pathname}{loc.hash}</span>
  }
  function mountAt(extra = null) {
    render(
      <MemoryRouter initialEntries={['/journal/notebook']}>
        <FeedbackWidget />
        <Where />
        {extra}
      </MemoryRouter>,
    )
  }
  const rows = () => screen.getAllByRole('menuitem').map((b) => b.textContent.trim())

  it('the rows, in order; Keyboard shortcuts only where the page has a shortcut sheet', () => {
    mountAt()
    fireEvent.click(screen.getByRole('button', { name: 'Help & Feedback' }))
    expect(rows()).toEqual(['Search help', 'Quick answers', 'Tours', 'Send feedback'])
  })

  it('with a shortcuts host, Keyboard shortcuts is the third row and opens the page\'s sheet', () => {
    const open = vi.fn()
    let release
    act(() => { release = registerShortcutsHost(open) })
    try {
      mountAt()
      fireEvent.click(screen.getByRole('button', { name: 'Help & Feedback' }))
      expect(rows()).toEqual(['Search help', 'Quick answers', 'Keyboard shortcuts', 'Tours', 'Send feedback'])
      fireEvent.click(screen.getByRole('menuitem', { name: 'Keyboard shortcuts' }))
      expect(open).toHaveBeenCalledTimes(1)
      expect(screen.queryByRole('menu', { name: 'Help' })).toBeNull()
    } finally { act(() => release()) }
  })

  it.each([
    ['Search help', HELP_SEARCH_HREF],
    ['Quick answers', QUICK_ANSWERS_HREF],
    ['Tours', HELP_WALKTHROUGHS_HREF],
  ])('%s goes to its place on the Support page', (name, href) => {
    mountAt()
    fireEvent.click(screen.getByRole('button', { name: 'Help & Feedback' }))
    fireEvent.click(screen.getByRole('menuitem', { name }))
    expect(screen.getByTestId('where').textContent).toBe(href)
    expect(screen.queryByRole('menu', { name: 'Help' })).toBeNull()
  })

  // Tier 2 fix round 1 (review Important 3): a ticket is two named activations away -- Send feedback, then
  // "Open a support ticket" -- and lands on the new-ticket form.
  it('Send feedback carries "Need a reply? Open a support ticket", which opens the new-ticket form', () => {
    mountAt()
    fireEvent.click(screen.getByRole('button', { name: 'Help & Feedback' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Send feedback' }))
    const link = screen.getByRole('link', { name: 'Need a reply? Open a support ticket' })
    expect(link).toHaveAttribute('href', NEW_TICKET_HREF)
    fireEvent.click(link)
    expect(screen.getByTestId('where').textContent).toBe('/support')
    expect(screen.getByTestId('where').getAttribute('data-search')).toBe('?view=new')
    expect(screen.queryByLabelText('Feedback message')).toBeNull()
  })

  it('Arrow keys walk the rows and wrap', () => {
    mountAt()
    fireEvent.click(screen.getByRole('button', { name: 'Help & Feedback' }))
    const menu = screen.getByRole('menu', { name: 'Help' })
    fireEvent.keyDown(menu, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Send feedback' }))
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Search help' }))
  })

  it('a page with its own Help button: the corner "?" steps aside (exactly one "?"), and the door still opens the menu', async () => {
    let release
    act(() => { release = registerHelpHost() })
    try {
      mountAt()
      expect(screen.queryByRole('button', { name: 'Help & Feedback' })).toBeNull()
      act(() => { openFeedback('menu') })
      expect(await screen.findByRole('menu', { name: 'Help' })).toBeInTheDocument()
    } finally { act(() => release()) }
    // CONTROL: released, the corner "?" is back
    expect(screen.getByRole('button', { name: 'Help & Feedback' })).toBeInTheDocument()
  })
})

// Tier 2 fix round 1 (review minors 9, 10 and 17).
describe('the Help menu: where it hangs, and which rows a page gets', () => {
  it('opened from a page\'s own Help button, it hangs under that button; from the corner "?", in the corner', async () => {
    const btn = document.createElement('button')
    document.body.appendChild(btn)
    btn.getBoundingClientRect = () => ({ top: 20, bottom: 52, left: 900, right: 940, width: 40, height: 32 })
    const realW = window.innerWidth
    Object.defineProperty(window, 'innerWidth', { value: 1200, configurable: true })
    try {
      render(<MemoryRouter><FeedbackWidget /></MemoryRouter>)
      act(() => { openFeedback('menu', btn, { toggle: true }) })
      const menu = await screen.findByRole('menu', { name: 'Help' })
      expect(menu.style.top).toBe('58px')
      expect(menu.style.right).toBe('260px')
      fireEvent.keyDown(document, { key: 'Escape' })
      fireEvent.click(screen.getByRole('button', { name: 'Help & Feedback' }))
      expect(screen.getByRole('menu', { name: 'Help' }).style.top).toBe('40px')   // the corner, as before
    } finally {
      Object.defineProperty(window, 'innerWidth', { value: realW, configurable: true })
      btn.remove()
    }
  })

  it('"Tours" only where Help > Walkthroughs exists (the wave-14 switch); "Keyboard shortcuts" never on a phone touch screen', () => {
    const on = (k) => k === 'notebook_onboarding_enabled' || k === 'notebook_getting_started_enabled'
    const keys = (o) => helpMenuRows(o).map((r) => r.key)
    expect(keys({ hasShortcuts: true, flag: on })).toEqual(['search', 'answers', 'shortcuts', 'tours', 'feedback'])
    expect(keys({ hasShortcuts: true, flag: () => false })).toEqual(['search', 'answers', 'shortcuts', 'feedback'])
    expect(keys({ hasShortcuts: true, flag: on, phoneTouch: true })).toEqual(['search', 'answers', 'tours', 'feedback'])
  })
})
