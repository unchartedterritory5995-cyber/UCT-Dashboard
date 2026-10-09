// Lane w9-10 (terminal load performance): an open comparison panel re-reads its closes every
// CLOSES_TTL_MS, and a HIDDEN tab must not. The refresh that came due while hidden is owed and
// paid once when the tab is shown again (the useMobileSWR / livePriceStore rule).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import useCloses, { CLOSES_TTL_MS, clearClosesCache } from './useCloses'
import { fakeBarsFetch, series, weekdays } from './__fixtures__/compareFixtures'

const realFetch = globalThis.fetch
let hidden = false

function setHidden(v) {
  hidden = v
  document.dispatchEvent(new Event('visibilitychange'))
}

beforeEach(() => {
  clearClosesCache()
  hidden = false
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
})
afterEach(() => {
  globalThis.fetch = realFetch
  vi.useRealTimers()
  delete document.hidden
})

async function settle() {
  // let the settled fetch promises resolve
  for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve() })
}

describe('useCloses pauses its background refresh on a hidden tab', () => {
  it('re-reads on the interval while visible (control)', async () => {
    const spy = vi.fn(fakeBarsFetch({ NVDA: series(weekdays(40), () => 0.001) }))
    globalThis.fetch = spy
    renderHook(() => useCloses(['NVDA'], 'D'))
    await settle()
    expect(spy).toHaveBeenCalledTimes(1)
    await act(async () => { vi.advanceTimersByTime(CLOSES_TTL_MS + 1) })
    await settle()
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('does not re-read while hidden, and pays the owed refresh once on return', async () => {
    const spy = vi.fn(fakeBarsFetch({ NVDA: series(weekdays(40), () => 0.001) }))
    globalThis.fetch = spy
    renderHook(() => useCloses(['NVDA'], 'D'))
    await settle()
    expect(spy).toHaveBeenCalledTimes(1)

    act(() => setHidden(true))
    // three intervals pass overnight: nothing is fetched
    await act(async () => { vi.advanceTimersByTime(CLOSES_TTL_MS * 3 + 1) })
    await settle()
    expect(spy).toHaveBeenCalledTimes(1)

    act(() => setHidden(false))
    await settle()
    expect(spy).toHaveBeenCalledTimes(2)   // one refresh, not three

    // showing the tab again with nothing owed reads nothing
    act(() => setHidden(true))
    act(() => setHidden(false))
    await settle()
    expect(spy).toHaveBeenCalledTimes(2)
  })
})
