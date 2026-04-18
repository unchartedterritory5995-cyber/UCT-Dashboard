import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
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
