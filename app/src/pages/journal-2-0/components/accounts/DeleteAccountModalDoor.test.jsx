// The Delete Account dialog loads on its first open (bytes headroom, controller ruling 2026-10-16).
// What may change is WHEN the dialog appears, nothing else: while its chunk loads nothing is sent,
// the dialog then opens with the props its caller passed, and deleting still waits for the dialog's
// own confirmation. A chunk that cannot load says so in the door's one status line (mounted empty
// with the door, before any sentence can arrive), with Try again and Close -- never a silent no-op.
// The static-import half of the rail is components/notebook/RefusedCopyOffer.lazy.test.js.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import DeleteAccountModalDoor, {
  DELETE_ACCOUNT_UNAVAILABLE, deleteAccountModalLoaders,
} from './DeleteAccountModalDoor'

const MAIN = { id: 'a1', name: 'Main', color: 'gold' }
const SWING = { id: 'a2', name: 'Swing', color: 'blue' }

const realModal = deleteAccountModalLoaders.modal
let fetchSpy

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
  )
})
afterEach(() => {
  deleteAccountModalLoaders.modal = realModal
  fetchSpy.mockRestore()
})

const renderDoor = (props = {}) => {
  const onClose = vi.fn()
  render(<DeleteAccountModalDoor account={MAIN} allAccounts={[MAIN, SWING]} conflict={null} onClose={onClose} {...props} />)
  return { onClose }
}

describe('DeleteAccountModalDoor -- the dialog loads on its first open', () => {
  it('while the chunk loads nothing is sent; then the dialog opens, and deleting still waits for its confirmation', async () => {
    let release
    const gate = new Promise((resolve) => { release = resolve })
    const loader = vi.fn(() => gate.then(() => realModal()))
    deleteAccountModalLoaders.modal = loader
    const { onClose } = renderDoor()

    const door = screen.getByTestId('delete-account-door')
    expect(within(door).getByRole('status').textContent, 'the status line is mounted empty').toBe('')
    expect(screen.queryByRole('heading', { name: 'Delete "Main"?' })).toBeNull()
    expect(loader).toHaveBeenCalledTimes(1)

    release()
    expect(await screen.findByRole('heading', { name: 'Delete "Main"?' })).toBeInTheDocument()
    expect(screen.queryByTestId('delete-account-door'), 'the door gives way to the dialog').toBeNull()
    expect(fetchSpy, 'opening the dialog deleted something').not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()

    // The dialog's own confirmation is still the only way to delete.
    fireEvent.click(screen.getByRole('button', { name: 'Delete Account' }))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(fetchSpy.mock.calls[0][0]).toBe('/api/j2/accounts/a1')
    expect(fetchSpy.mock.calls[0][1]).toMatchObject({ method: 'DELETE' })
  })

  it('passes the caller’s props through unchanged: a blocked account still asks how to resolve it', async () => {
    renderDoor({ conflict: { tradeCount: 3, openPositionCount: 1 } })
    expect(await screen.findByRole('radiogroup', { name: 'How to delete this account' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Move + Delete' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: /Delete the account and all its trades/ }))
    expect(screen.getByRole('button', { name: 'Delete Everything' }), 'purge must wait for its checkbox').toBeDisabled()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('a purge confirmed for one account never carries over to another account', async () => {
    const conflict = { tradeCount: 3, openPositionCount: 1 }
    const onClose = vi.fn()
    const { rerender } = render(
      <DeleteAccountModalDoor account={MAIN} allAccounts={[MAIN, SWING]} conflict={conflict} onClose={onClose} />,
    )
    fireEvent.click(await screen.findByRole('radio', { name: /Delete the account and all its trades/ }))
    fireEvent.click(screen.getByRole('checkbox'))
    expect(screen.getByRole('button', { name: 'Delete Everything' })).toBeEnabled()

    rerender(<DeleteAccountModalDoor account={SWING} allAccounts={[MAIN, SWING]} conflict={conflict} onClose={onClose} />)
    expect(await screen.findByRole('heading', { name: 'Delete "Swing"?' })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox'), 'the purge box came over to the other account').toBeNull()
    expect(screen.getByRole('radio', { name: /Move trades, then delete/ })).toBeChecked()
    expect(screen.queryByRole('button', { name: 'Delete Everything' })).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('a chunk that cannot load says so in the status line (never a silent no-op); nothing is deleted; Try again opens the dialog', async () => {
    // Safari's wording (no chunk URL): a real chunk-load error, asked for again in place once.
    const failing = vi.fn(() => Promise.reject(new TypeError('Importing a module script failed.')))
    deleteAccountModalLoaders.modal = failing
    renderDoor()

    const status = within(screen.getByTestId('delete-account-door')).getByRole('status')
    await waitFor(() => expect(status.textContent).toBe(DELETE_ACCOUNT_UNAVAILABLE))
    expect(failing.mock.calls.length, 'the in-place retry was not tried').toBeGreaterThanOrEqual(2)
    expect(within(screen.getByTestId('delete-account-door')).getByRole('status'), 'the live region was replaced, not filled').toBe(status)
    expect(screen.queryByRole('heading', { name: 'Delete "Main"?' })).toBeNull()
    expect(fetchSpy, 'a failed chunk deleted something').not.toHaveBeenCalled()

    deleteAccountModalLoaders.modal = realModal
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { name: 'Delete "Main"?' })).toBeInTheDocument()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('Close on a failed chunk closes the door and deletes nothing', async () => {
    deleteAccountModalLoaders.modal = vi.fn(() => Promise.reject(new TypeError('Importing a module script failed.')))
    const { onClose } = renderDoor()
    await screen.findByText(DELETE_ACCOUNT_UNAVAILABLE)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
