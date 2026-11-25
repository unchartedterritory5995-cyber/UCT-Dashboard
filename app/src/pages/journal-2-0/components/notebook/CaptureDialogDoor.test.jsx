// The capture dialog loads on its first open (first-open bytes, coordinator ruling 2026-11-23, PR #2624). What may
// change is WHEN the FIRST opening after a page load shows the dialog, nothing else: closed, the door renders nothing
// and loads nothing; while the chunk loads nothing is sent; the dialog then opens with the props CaptureHost passed;
// every LATER opening (a new door: CaptureHost keys it per opening) renders the dialog in its own commit, as before.
// A chunk that cannot load says so in the door's one status line (mounted empty while it waits, before any sentence
// can arrive), with Try again and Close -- never a silent no-op, never a page reload.
// The static-import half of the rail is components/notebook/RefusedCopyOffer.lazy.test.js.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within, cleanup } from '@testing-library/react'
import { captureDestination } from '../../lib/capture'

const DEST = captureDestination({ noteId: 'n1', ticker: 'NVDA', source: 'palette' })

// The door keeps the loaded dialog for the page's life, so each case gets a fresh module (a fresh page).
let Door, mod
beforeEach(async () => {
  vi.resetModules()
  mod = await import('./CaptureDialogDoor')
  Door = mod.default
})
let fetchSpy
beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
  )
})
afterEach(() => { cleanup(); fetchSpy.mockRestore() })

describe('CaptureDialogDoor -- the dialog loads on its first open', () => {
  it('closed, it renders nothing and loads nothing', () => {
    const loader = vi.fn(() => import('./CaptureDialog'))
    mod.captureDialogLoaders.dialog = loader
    const { container } = render(<Door open={false} onClose={() => {}} destination={DEST} />)
    expect(container.innerHTML).toBe('')
    expect(loader).not.toHaveBeenCalled()
  })

  it('the first opening: nothing is sent while the chunk loads, then the dialog opens with the host’s props', async () => {
    const real = mod.captureDialogLoaders.dialog
    let release
    const gate = new Promise((resolve) => { release = resolve })
    const loader = vi.fn(() => gate.then(() => real()))
    mod.captureDialogLoaders.dialog = loader
    const onClose = vi.fn()
    render(<Door open onClose={onClose} destination={DEST} doorSource="hotkey" />)
    const door = screen.getByTestId('capture-dialog-door')
    expect(within(door).getByRole('status').textContent, 'the status line is mounted empty').toBe('')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(loader).toHaveBeenCalledTimes(1)
    expect(fetchSpy, 'the door sent something').not.toHaveBeenCalled()
    release()
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.queryByTestId('capture-dialog-door'), 'the door gives way to the dialog').toBeNull()
    expect(screen.getByTestId('capture-destination')).toHaveTextContent('NVDA Research')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('a later opening (a new door, as CaptureHost keys it) renders the dialog in its own commit, loading nothing', async () => {
    const real = mod.captureDialogLoaders.dialog
    const loader = vi.fn(() => real())
    mod.captureDialogLoaders.dialog = loader
    const first = render(<Door key={1} open onClose={() => {}} destination={DEST} />)
    await screen.findByRole('dialog')
    first.unmount()
    render(<Door key={2} open onClose={() => {}} destination={DEST} />)
    expect(screen.getByRole('dialog'), 'not in the opening commit').toBeInTheDocument()   // no await: same commit
    expect(screen.queryByTestId('capture-dialog-door')).toBeNull()
    expect(loader).toHaveBeenCalledTimes(1)
  })

  it('a chunk that cannot load says so (never a silent no-op); Close closes; Try again opens the dialog', async () => {
    const real = mod.captureDialogLoaders.dialog
    // Safari's wording (no chunk URL): a real chunk-load error, asked for again in place once.
    const failing = vi.fn(() => Promise.reject(new TypeError('Importing a module script failed.')))
    mod.captureDialogLoaders.dialog = failing
    const onClose = vi.fn()
    render(<Door open onClose={onClose} destination={DEST} />)
    expect(await screen.findByText(mod.CAPTURE_UNAVAILABLE, {}, { timeout: 3000 })).toBeInTheDocument()
    expect(failing).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    mod.captureDialogLoaders.dialog = real
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.queryByText(mod.CAPTURE_UNAVAILABLE)).toBeNull()
  })

  it('Try again that fails again is announced again: the line empties while it retries, the buttons stay', async () => {
    const failing = vi.fn(() => Promise.reject(new Error('offline')))
    mod.captureDialogLoaders.dialog = failing
    render(<Door open onClose={() => {}} destination={DEST} />)
    await screen.findByText(mod.CAPTURE_UNAVAILABLE)
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(screen.getByTestId('capture-dialog-door').querySelector('[role="status"]').textContent,
      'the same sentence again is no new announcement').toBe('')
    expect(screen.getByRole('button', { name: 'Try again' }), 'the pressed button keeps its place').toBeInTheDocument()
    expect(await screen.findByText(mod.CAPTURE_UNAVAILABLE)).toBeInTheDocument()
    expect(failing).toHaveBeenCalledTimes(2)
  })

  it('onShown (the host’s, never the dialog’s) is called once the dialog is mounted, never while loading or failed', async () => {
    const real = mod.captureDialogLoaders.dialog
    let release
    const gate = new Promise((resolve) => { release = resolve })
    mod.captureDialogLoaders.dialog = () => gate.then(() => real())
    const onShown = vi.fn()
    render(<Door open onClose={() => {}} destination={DEST} onShown={onShown} />)
    expect(onShown).not.toHaveBeenCalled()
    release()
    await screen.findByRole('dialog')
    expect(onShown).toHaveBeenCalledTimes(1)
    cleanup()
    mod.captureDialogLoaders.dialog = () => Promise.reject(new Error('offline'))
    vi.resetModules()
    const fresh = await import('./CaptureDialogDoor')
    fresh.captureDialogLoaders.dialog = () => Promise.reject(new Error('offline'))
    const failedShown = vi.fn()
    render(<fresh.default open onClose={() => {}} destination={DEST} onShown={failedShown} />)
    await screen.findByText(fresh.CAPTURE_UNAVAILABLE)
    expect(failedShown).not.toHaveBeenCalled()
  })

  it('closed after a failure, it renders nothing', async () => {
    mod.captureDialogLoaders.dialog = () => Promise.reject(new Error('offline'))
    const { rerender, container } = render(<Door open onClose={() => {}} destination={DEST} />)
    await screen.findByText(mod.CAPTURE_UNAVAILABLE)
    rerender(<Door open={false} onClose={() => {}} destination={DEST} />)
    expect(container.innerHTML).toBe('')
  })
})
