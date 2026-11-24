// Review of #2624 (FIX FIRST): the capture dialog loads on its first open (CaptureDialogDoor), and a share parked by the
// mobile share page is opened by CaptureHost on mount. A chunk that fails must not lose the share -- phone networks fail
// chunks more often than desktops do, and the door's own advice is "Try again, or reload the page". So the share is
// TAKEN (read and cleared) only once the dialog has mounted: a failing chunk, then Close, then a reload, and the share
// is still parked, and the reload opens it. Once the dialog has shown it, it is consumed exactly once, as before.
// Each "page" is a fresh module graph (vi.resetModules): the memory carrier starts empty, sessionStorage survives, as
// across a real reload; and the door's page-life cache of the dialog starts empty too.
import { it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { PENDING_SHARE_KEY, parseShare } from '../../lib/shareTarget'

async function freshPage() {
  vi.resetModules()
  const host = await import('./CaptureHost')
  const door = await import('./CaptureDialogDoor')
  const share = await import('../../lib/shareTarget')
  return { CaptureHost: host.default, door, share }
}
beforeEach(() => { sessionStorage.clear(); global.fetch = vi.fn() })
afterEach(() => { cleanup(); sessionStorage.clear(); vi.restoreAllMocks() })

it('a failing chunk with a parked share, then Close, then a reload: the share is still parked, and the reload opens it', async () => {
  let page = await freshPage()
  page.share.writePendingShare(parseShare({ url: 'https://wsj.com/x', title: 'Fed holds', text: 'rates steady' }))
  page.door.captureDialogLoaders.dialog = () => Promise.reject(new Error('offline'))
  const first = render(<MemoryRouter><page.CaptureHost /></MemoryRouter>)
  expect(await screen.findByText(page.door.CAPTURE_UNAVAILABLE)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  expect(screen.queryByText(page.door.CAPTURE_UNAVAILABLE)).toBeNull()
  expect(sessionStorage.getItem(PENDING_SHARE_KEY), 'the share was lost').not.toBeNull()
  first.unmount()

  page = await freshPage()                                  // the reload: the real chunk, the session copy
  render(<MemoryRouter><page.CaptureHost /></MemoryRouter>)
  expect(await screen.findByRole('dialog')).toBeInTheDocument()
  expect(screen.getByLabelText('Source link')).toHaveValue('https://wsj.com/x')
  expect(screen.getByLabelText('Selected passage')).toHaveValue('rates steady')
  expect(sessionStorage.getItem(PENDING_SHARE_KEY), 'shown, so taken').toBeNull()
  expect(page.share.peekPendingShare()).toBeNull()
})

it('a share is taken only by ITS opening: a hotkey capture that shows first leaves it parked', async () => {
  const page = await freshPage()
  page.share.writePendingShare(parseShare({ text: 'margins normalize by Q3' }))
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const real = page.door.captureDialogLoaders.dialog
  page.door.captureDialogLoaders.dialog = () => gate.then(() => real())
  render(<MemoryRouter><page.CaptureHost /></MemoryRouter>)
  // While the share's chunk is still loading, the member presses the capture hotkey: a new opening replaces it.
  fireEvent.keyDown(window, { key: 'Y', code: 'KeyY', metaKey: true, shiftKey: true })
  release()
  expect(await screen.findByRole('dialog')).toBeInTheDocument()
  expect(screen.getByLabelText('Quick thought')).toHaveValue('')
  expect(page.share.peekPendingShare(), 'a share the member never saw was consumed').not.toBeNull()
})
