// Finish program, lane KEYS round 2. Research Home: a skip link to the reviews and the setups.
//
// "This week's review" was 21 Tabs into Research Home and the morning board 24, behind the
// prep row and the Passed setups form and list. The page now offers "Skip to reviews and
// setups" in the shell's skip-link slot. It lands on the reviews heading, so the next Tab is
// "Today's recap". It exists only while the reviews box exists (its own switch).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { latchNotebookFlags, __resetNotebookFlags } from '../../lib/offline/notebookFlags'
import { REVIEW_DRAFTS_FLAG } from '../../lib/reviewDraftsFlag'
import { ReviewDraftsHomeBox } from './ResearchHome'

afterEach(() => __resetNotebookFlags())

const mount = () => render(
  <div>
    <button type="button">a control before the reviews</button>
    <ReviewDraftsHomeBox onOpenNote={vi.fn()} skipLinkClassName="skipLink" />
  </div>,
)

describe('Research Home: skip to the reviews and setups', () => {
  it('the link moves focus to the reviews heading; the next control is "Today\'s recap"', () => {
    latchNotebookFlags({ [REVIEW_DRAFTS_FLAG]: true })
    mount()
    const link = screen.getByRole('link', { name: 'Skip to reviews and setups' })
    expect(link.className).toContain('skipLink')
    fireEvent.click(link)
    const heading = screen.getByRole('heading', { name: 'Reviews that write themselves' })
    expect(document.activeElement).toBe(heading)
    expect(heading.getAttribute('tabindex')).toBe('-1')
    const after = [...document.querySelectorAll('button')]
      .find((b) => heading.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
    expect(after.textContent).toMatch(/Today's recap/)
  })

  it('switch off: no reviews box and no skip link', () => {
    latchNotebookFlags({ [REVIEW_DRAFTS_FLAG]: false })
    mount()
    expect(screen.queryByRole('link', { name: 'Skip to reviews and setups' })).toBeNull()
  })

  it('with no skip-link class handed in (the box rendered alone) there is no link', () => {
    latchNotebookFlags({ [REVIEW_DRAFTS_FLAG]: true })
    render(<ReviewDraftsHomeBox onOpenNote={vi.fn()} />)
    expect(screen.getByRole('heading', { name: 'Reviews that write themselves' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Skip to reviews and setups' })).toBeNull()
  })
})
