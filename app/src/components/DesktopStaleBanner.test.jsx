import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import DesktopStaleBanner, { CATCH_UP_MS, RESUME_GAP_MS, TICK_MS } from './DesktopStaleBanner'

function setOnline(value) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => value })
}

function fire(name) { act(() => { window.dispatchEvent(new Event(name)) }) }

/** Sleep: the wall clock jumps and the interval then fires once, late. */
function sleepFor(ms) {
  act(() => {
    vi.setSystemTime(Date.now() + ms)
    vi.advanceTimersByTime(TICK_MS)
  })
}

const banner = () => screen.queryByRole('status')

beforeEach(() => {
  vi.useFakeTimers()
  setOnline(true)
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  delete navigator.onLine
})

describe('DesktopStaleBanner', () => {
  it('shows nothing while online and awake', () => {
    render(<DesktopStaleBanner />)
    expect(banner()).toBeNull()
    act(() => { vi.advanceTimersByTime(TICK_MS * 20) })
    expect(banner()).toBeNull()
  })

  it('starts offline when the machine is offline at launch, and stays up while it is', () => {
    setOnline(false)
    render(<DesktopStaleBanner />)
    expect(banner()).toHaveTextContent(/offline/i)
    act(() => { vi.advanceTimersByTime(CATCH_UP_MS * 10) })
    expect(banner()).toHaveTextContent(/offline/i)
  })

  it('shows offline at the offline event, then catches up and clears after coming back', () => {
    render(<DesktopStaleBanner />)
    setOnline(false)
    fire('offline')
    expect(banner()).toHaveTextContent(/offline/i)
    setOnline(true)
    fire('online')
    expect(banner()).toHaveTextContent(/moment behind/i)
    act(() => { vi.advanceTimersByTime(CATCH_UP_MS) })
    expect(banner()).toBeNull()
  })

  it('shows the catch-up banner after the PC wakes from sleep, then clears', () => {
    render(<DesktopStaleBanner />)
    sleepFor(RESUME_GAP_MS + 1000)
    expect(banner()).toHaveTextContent(/moment behind/i)
    act(() => { vi.advanceTimersByTime(CATCH_UP_MS) })
    expect(banner()).toBeNull()
  })

  it('an ordinary late tick is not a wake from sleep', () => {
    render(<DesktopStaleBanner />)
    sleepFor(RESUME_GAP_MS - 10000)
    expect(banner()).toBeNull()
  })

  it('a wake while offline keeps the offline message', () => {
    setOnline(false)
    render(<DesktopStaleBanner />)
    sleepFor(RESUME_GAP_MS + 1000)
    expect(banner()).toHaveTextContent(/offline/i)
  })

  it('going offline during the catch-up keeps offline up, the old timer does not clear it', () => {
    render(<DesktopStaleBanner />)
    setOnline(true)
    fire('online')
    setOnline(false)
    fire('offline')
    act(() => { vi.advanceTimersByTime(CATCH_UP_MS * 2) })
    expect(banner()).toHaveTextContent(/offline/i)
  })

  it('removes its listeners and interval on unmount', () => {
    const removed = vi.spyOn(window, 'removeEventListener')
    const { unmount } = render(<DesktopStaleBanner />)
    unmount()
    const names = removed.mock.calls.map(([n]) => n)
    expect(names).toEqual(expect.arrayContaining(['offline', 'online']))
    expect(vi.getTimerCount()).toBe(0)
  })
})
