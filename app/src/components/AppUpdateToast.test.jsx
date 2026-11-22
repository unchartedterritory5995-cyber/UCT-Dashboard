import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import AppUpdateToast, { COPY } from './AppUpdateToast'

// A fake desktop shell with the 'app-update' capability: the test pushes updates through `push`.
let listeners
let pending
let restarts
function installBridge({ capabilities = ['app-update'] } = {}) {
  listeners = new Set()
  restarts = 0
  window.uctDesktop = {
    bridgeVersion: 1,
    capabilities,
    getAppUpdate: vi.fn(async () => pending),
    onAppUpdate: (cb) => { listeners.add(cb); return () => listeners.delete(cb) },
    restartToUpdate: () => { restarts++ },
  }
}
async function push(u) { await act(async () => { for (const l of listeners) l(u) }) }
async function mount() { const r = render(<AppUpdateToast />); await act(async () => {}); return r }
const toast = () => screen.queryByTestId('app-update-toast')

beforeEach(() => { pending = null })
afterEach(() => {
  cleanup()
  delete window.uctDesktop
  window.opener = null
})

describe('AppUpdateToast', () => {
  it('shows nothing in a browser (no desktop bridge)', async () => {
    await mount()
    expect(toast()).toBeNull()
  })

  it('shows nothing on a shell without the app-update capability', async () => {
    installBridge({ capabilities: ['before-quit'] })
    pending = { version: '0.1.7' }
    await mount()
    expect(toast()).toBeNull()
  })

  it('an update already downloaded when the page loads is offered at once', async () => {
    installBridge()
    pending = { version: '0.1.7' }
    await mount()
    expect(toast()).toHaveTextContent(COPY)
  })

  it('appears when the shell finishes a download, and disappears when the version is withdrawn', async () => {
    installBridge()
    await mount()
    expect(toast()).toBeNull()
    await push({ version: '0.1.7' })
    expect(toast()).not.toBeNull()
    await push(null)
    expect(toast()).toBeNull()
  })

  it('Restart to update asks the shell to restart', async () => {
    installBridge()
    pending = { version: '0.1.7' }
    await mount()
    fireEvent.click(screen.getByRole('button', { name: 'Restart to update' }))
    expect(restarts).toBe(1)
  })

  it('Later hides it for that version only; a newer version shows again', async () => {
    installBridge()
    pending = { version: '0.1.7' }
    await mount()
    fireEvent.click(screen.getByRole('button', { name: 'Later' }))
    expect(toast()).toBeNull()
    await push({ version: '0.1.7' })
    expect(toast()).toBeNull()
    await push({ version: '0.1.8' })
    expect(toast()).not.toBeNull()
    expect(restarts).toBe(0)
  })

  it('never shows in a pop-out window (boards and charts on other monitors)', async () => {
    installBridge()
    pending = { version: '0.1.7' }
    window.opener = {}
    await mount()
    expect(toast()).toBeNull()
    expect(window.uctDesktop.getAppUpdate).not.toHaveBeenCalled()
  })

  it('ignores a malformed update from the shell', async () => {
    installBridge()
    await mount()
    await push({ version: '<img src=x>' })
    expect(toast()).toBeNull()
  })

  it('stops listening on unmount', async () => {
    installBridge()
    const { unmount } = await mount()
    expect(listeners.size).toBe(1)
    unmount()
    expect(listeners.size).toBe(0)
  })
})
