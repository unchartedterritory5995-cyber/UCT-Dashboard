// I1 (review of the key-listener migration): the archive lightbox was a role="dialog" aria-modal overlay that
// covered the page for the mouse only. Focus stayed on the thumb that opened it, so Tab walked to the next
// post's thumb UNDER the overlay and Enter opened a second lightbox. Two open lightboxes meant two live
// registrations of 'archive.lightboxClose', which the shortcut registry refuses (it throws outside
// production). The lightbox now holds focus while open: focus moves in, Tab stays inside, Escape or Close
// returns focus to the thumb that opened it.
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ArchiveThumbs from './ArchiveThumbs'
import { registerShortcuts } from '../command/shortcutRegistry'

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

// Review M4: one key press is answered by the topmost surface only. A stand-in modal layer (what
// the command palette or a ticker popup is: role="dialog" aria-modal) opened over the surface, and
// a live video binding, are the two things that used to answer the same press as well.
const openModalLayer = () => {
  const el = document.createElement('div')
  el.setAttribute('role', 'dialog')
  el.setAttribute('aria-modal', 'true')
  document.body.appendChild(el)
  return () => el.remove()
}

describe('Escape is answered by the topmost layer only', () => {
  it('with a modal layer over the lightbox, Escape leaves the lightbox open', async () => {
    const user = userEvent.setup()
    twoPosts()
    screen.getAllByRole('button', { name: /Open chart 1 of 1/ })[0].focus()
    await user.keyboard('{Enter}')
    const close = openModalLayer()
    await user.keyboard('{Escape}')
    expect(screen.getByTestId('archive-lightbox')).toBeInTheDocument()
    close()
    await user.keyboard('{Escape}')
    expect(screen.queryByTestId('archive-lightbox')).toBeNull()
  })

  it('when the lightbox closes on Escape, the video player\'s Escape does not also fire', async () => {
    const user = userEvent.setup()
    const videoEscape = vi.fn()
    const off = registerShortcuts({ 'video.escape': videoEscape })
    try {
      twoPosts()
      screen.getAllByRole('button', { name: /Open chart 1 of 1/ })[0].focus()
      await user.keyboard('{Enter}')
      await user.keyboard('{Escape}')
      expect(screen.queryByTestId('archive-lightbox')).toBeNull()
      expect(videoEscape).not.toHaveBeenCalled()
      await user.keyboard('{Escape}')                 // nothing open: the video key works as usual
      expect(videoEscape).toHaveBeenCalledTimes(1)
    } finally { off() }
  })
})
