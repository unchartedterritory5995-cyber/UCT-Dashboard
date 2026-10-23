// I1 (review of the key-listener migration): the archive lightbox was a role="dialog" aria-modal overlay that
// covered the page for the mouse only. Focus stayed on the thumb that opened it, so Tab walked to the next
// post's thumb UNDER the overlay and Enter opened a second lightbox. Two open lightboxes meant two live
// registrations of 'archive.lightboxClose', which the shortcut registry refuses (it throws outside
// production). The lightbox now holds focus while open: focus moves in, Tab stays inside, Escape or Close
// returns focus to the thumb that opened it.
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ArchiveThumbs from './ArchiveThumbs'

const A = 'a'.repeat(64)
const B = 'b'.repeat(64)
const twoPosts = () => render(
  <div>
    <ArchiveThumbs ids={[A]} />
    <ArchiveThumbs ids={[B]} />
  </div>,
)

describe('the archive lightbox holds focus while it is open', () => {
  it('Enter opens it, focus moves in, Tab stays inside, and a second thumb cannot be opened behind it', async () => {
    const user = userEvent.setup()
    twoPosts()
    const [first, second] = screen.getAllByRole('button', { name: /Open chart 1 of 1/ })
    first.focus()
    await user.keyboard('{Enter}')
    const box = screen.getByTestId('archive-lightbox')
    const close = screen.getByRole('button', { name: 'Close chart' })
    expect(box.contains(document.activeElement)).toBe(true)
    expect(document.activeElement).toBe(close)
    await user.tab()
    expect(box.contains(document.activeElement)).toBe(true)
    expect(document.activeElement).not.toBe(second)
    await user.keyboard('{Enter}')                   // on the Close button, not on a thumb behind
    expect(screen.queryAllByTestId('archive-lightbox')).toHaveLength(0)
    expect(document.activeElement).toBe(first)        // focus returns to the opener
  })

  it('Escape closes it and puts focus back on the thumb that opened it', async () => {
    const user = userEvent.setup()
    twoPosts()
    const second = screen.getAllByRole('button', { name: /Open chart 1 of 1/ })[1]
    second.focus()
    await user.keyboard('{Enter}')
    expect(screen.getAllByTestId('archive-lightbox')).toHaveLength(1)
    expect(screen.getByTestId('archive-lightbox').querySelector('img').getAttribute('src')).toContain(B)
    expect(screen.getByTestId('archive-lightbox').contains(document.activeElement)).toBe(true)
    await user.keyboard('{Escape}')
    expect(screen.queryByTestId('archive-lightbox')).toBeNull()
    expect(document.activeElement).toBe(second)
  })
})
