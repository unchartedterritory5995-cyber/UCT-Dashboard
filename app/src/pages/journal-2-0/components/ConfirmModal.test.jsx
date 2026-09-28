import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ConfirmModal from './ConfirmModal'

describe('ConfirmModal', () => {
  it('renders title + body + buttons', () => {
    render(
      <ConfirmModal
        title="Delete NVDA?"
        body="This cannot be undone."
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByText('Delete NVDA?')).toBeInTheDocument()
    expect(screen.getByText('This cannot be undone.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })

  it('supports React node body', () => {
    render(
      <ConfirmModal
        title="Confirm"
        body={<p>Custom <strong>body</strong></p>}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByText('Custom')).toBeInTheDocument()
    expect(screen.getByText('body')).toBeInTheDocument()
  })

  it('Confirm fires callback then closes', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn().mockResolvedValue()
    const onClose = vi.fn()
    render(
      <ConfirmModal
        title="Confirm"
        body="body"
        confirmLabel="Delete Position"
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Delete Position' }))
    expect(onConfirm).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('Cancel fires onClose without onConfirm', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    const onClose = vi.fn()
    render(
      <ConfirmModal
        title="Confirm"
        body="body"
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onConfirm).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('Esc closes', () => {
    const onClose = vi.fn()
    render(
      <ConfirmModal
        title="Confirm"
        body="body"
        onConfirm={vi.fn()}
        onClose={onClose}
      />,
    )
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})

/**
 * ⛔⛔ F4 / A2R-05 (WCAG 2.4.3). Lane 10E-2's keyboard walk: the aria-modal Delete
 * confirmation opened with focus on the DESTRUCTIVE button, and Tab walked out of the
 * dialog into the page behind it. Walked here with the keyboard (user-event), on a page
 * that has focusable things before and after the dialog, so a leak has somewhere to go.
 */
function Page({ onConfirm = vi.fn(), afterConfirm = null }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>Delete note</button>
      <button type="button">Something else on the page</button>
      <a href="#elsewhere">A link on the page</a>
      {open && (
        <ConfirmModal
          title="Delete this note?"
          body="It moves to Trash."
          onConfirm={async () => { await onConfirm(); afterConfirm?.() }}
          // a fresh arrow every render, the way every caller passes it
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  )
}

describe('ConfirmModal — keyboard (F4, A2R-05)', () => {
  it('opens with focus on the SAFE action, Cancel -- never on the destructive one', async () => {
    const user = userEvent.setup()
    render(<Page />)
    screen.getByRole('button', { name: 'Delete note' }).focus()
    await user.keyboard('{Enter}')
    const dialog = await screen.findByRole('dialog', { name: 'Delete this note?' })
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' })))
    expect(dialog.contains(document.activeElement)).toBe(true)
    // a stray Enter cancels
    await user.keyboard('{Enter}')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('Tab and Shift+Tab stay inside the dialog, wrapping at both ends', async () => {
    const user = userEvent.setup()
    render(<Page />)
    screen.getByRole('button', { name: 'Delete note' }).focus()
    await user.keyboard('{Enter}')
    const dialog = await screen.findByRole('dialog', { name: 'Delete this note?' })
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' })))
    const seen = []
    for (let i = 0; i < 7; i += 1) {
      await user.tab()
      expect(dialog.contains(document.activeElement)).toBe(true)
      seen.push(document.activeElement.getAttribute('aria-label') || document.activeElement.textContent)
    }
    // it really walked (Cancel -> Delete -> x -> Cancel ...), not stuck on one control
    expect(new Set(seen)).toEqual(new Set(['Delete', 'Close', 'Cancel']))
    for (let i = 0; i < 7; i += 1) {
      await user.tab({ shift: true })
      expect(dialog.contains(document.activeElement)).toBe(true)
    }
  })

  it('Escape closes it and focus goes back to the button that opened it', async () => {
    const user = userEvent.setup()
    render(<Page />)
    const opener = screen.getByRole('button', { name: 'Delete note' })
    opener.focus()
    await user.keyboard('{Enter}')
    await screen.findByRole('dialog', { name: 'Delete this note?' })
    await user.tab()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(opener))
  })

  it('a caller that put focus somewhere on purpose keeps it (the next row after a delete)', async () => {
    const user = userEvent.setup()
    let elsewhere = null
    render(<Page afterConfirm={() => { elsewhere = screen.getByRole('link', { name: 'A link on the page' }); elsewhere.focus() }} />)
    screen.getByRole('button', { name: 'Delete note' }).focus()
    await user.keyboard('{Enter}')
    await screen.findByRole('dialog', { name: 'Delete this note?' })
    await user.tab()   // Cancel -> Delete
    expect(document.activeElement.textContent).toBe('Delete')
    await user.keyboard('{Enter}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.activeElement).toBe(elsewhere)
  })

  it('a re-render of the page behind it does not pull focus back to a button', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const { rerender } = render(<ConfirmModal title="Confirm" body="b" onConfirm={vi.fn()} onClose={() => onClose()} />)
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' })))
    await user.tab()
    const del = screen.getByRole('button', { name: 'Delete' })
    expect(document.activeElement).toBe(del)
    rerender(<ConfirmModal title="Confirm" body="b" onConfirm={vi.fn()} onClose={() => onClose()} />)
    rerender(<ConfirmModal title="Confirm" body="b" onConfirm={vi.fn()} onClose={() => onClose()} />)
    expect(document.activeElement).toBe(del)
    // and Escape reaches the LATEST onClose
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
