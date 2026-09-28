// F4 (A2R-05's second dialog in the note Delete flow). Trashing a note that still holds
// unsent words opens this aria-modal dialog after ConfirmModal. It had ConfirmModal's two
// defects: Tab walked out of it, and a re-render of the editor behind it (its `onClose` is
// a fresh arrow) pulled focus back to "Send first". Walked with the keyboard.
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import UnsentTrashDialog from './UnsentTrashDialog'

const props = (over = {}) => ({
  what: 'Two paragraphs are not sent yet.',
  onSendFirst: vi.fn(),
  onTrashAnyway: vi.fn(),
  onClose: () => {},
  ...over,
})

describe('UnsentTrashDialog — keyboard (F4)', () => {
  it('opens on the safe default and Tab never leaves the dialog', async () => {
    const user = userEvent.setup()
    render(
      <div>
        <button type="button">Behind the dialog</button>
        <UnsentTrashDialog {...props()} />
        <a href="#after">After the dialog</a>
      </div>,
    )
    const dialog = screen.getByRole('dialog')
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Send first' })))
    for (let i = 0; i < 8; i += 1) {
      await user.tab()
      expect(dialog.contains(document.activeElement)).toBe(true)
    }
    for (let i = 0; i < 8; i += 1) {
      await user.tab({ shift: true })
      expect(dialog.contains(document.activeElement)).toBe(true)
    }
  })

  it('a re-render behind it keeps focus where the member put it, and Escape reaches the latest onClose', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const { rerender } = render(<UnsentTrashDialog {...props({ onClose: () => onClose() })} />)
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Send first' })))
    await user.tab({ shift: true })
    const anyway = screen.getByRole('button', { name: 'Trash anyway' })
    expect(document.activeElement).toBe(anyway)
    rerender(<UnsentTrashDialog {...props({ onClose: () => onClose() })} />)
    expect(document.activeElement).toBe(anyway)
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
