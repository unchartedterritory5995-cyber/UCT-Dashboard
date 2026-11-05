// Audit 2026-11-05, spec S5 (B10): Esc did not close Help & Feedback, and an invisible full-page
// overlay sat over everything while it was open, so the member's next click on the page was eaten
// just to close it. Now Esc closes it and focus goes back to the "?" button; a click outside closes
// it AND reaches what was clicked; and nothing invisible is left over the page.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
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
