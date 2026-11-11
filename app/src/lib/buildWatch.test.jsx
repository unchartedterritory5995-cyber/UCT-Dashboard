// The watcher survives the leaf remounting between polls (RouteErrorBoundary remounts Layout on
// every navigation when no pop-out is open). Real `watch` behaviour, fake timers.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import UpdateReadyToast from '../components/UpdateReadyToast'
import { __resetBuildWatchForTests } from './buildWatch'
import { __resetReloadGuardForTests, isUpdateAnnounced } from './reloadGuard'

let script
beforeEach(() => {
  vi.useFakeTimers()
  __resetBuildWatchForTests()
  __resetReloadGuardForTests()
  script = document.createElement('script')
  script.type = 'module'
  script.setAttribute('src', '/assets/index-old.js')
  document.head.appendChild(script)
})
afterEach(() => {
  cleanup()
  __resetBuildWatchForTests()
  script.remove()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const stubHealth = (id) => {
  const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ build_id: id }) })
  vi.stubGlobal('fetch', f)
  return f
}
const FIVE_MIN = 300000

describe('build watcher singleton', () => {
  it('fires on 2 matching polls even when the leaf is remounted between them', async () => {
    const fetchMock = stubHealth('assets/index-new.js')
    const first = render(<UpdateReadyToast />)
    await act(async () => { await vi.advanceTimersByTimeAsync(FIVE_MIN + 1) })
    expect(isUpdateAnnounced()).toBe(false)
    first.unmount()
    render(<UpdateReadyToast />)
    await act(async () => { await vi.advanceTimersByTimeAsync(FIVE_MIN) })
    expect(isUpdateAnnounced()).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('two mounted leaves share ONE interval', async () => {
    const fetchMock = stubHealth('assets/index-old.js')
    render(<><UpdateReadyToast /><UpdateReadyToast /></>)
    await act(async () => { await vi.advanceTimersByTimeAsync(FIVE_MIN + 1) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('stops after the last leaf unmounts for good', async () => {
    const fetchMock = stubHealth('assets/index-new.js')
    render(<UpdateReadyToast />).unmount()
    await act(async () => { await vi.advanceTimersByTimeAsync(FIVE_MIN * 3) })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
