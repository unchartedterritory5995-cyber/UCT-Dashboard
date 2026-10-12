// whenIdle (N4, polish round): requestIdleCallback where the browser has it, a short timeout where
// it does not (Safari), and a cancel function either way.
import { describe, it, expect, vi, afterEach } from 'vitest'
import whenIdle, { FALLBACK_MS, IDLE_TIMEOUT_MS } from './whenIdle'

afterEach(() => { vi.useRealTimers() })

describe('whenIdle', () => {
  it('uses requestIdleCallback, bounded by a timeout, when the browser has it', () => {
    const win = { requestIdleCallback: vi.fn(() => 7), cancelIdleCallback: vi.fn() }
    const fn = vi.fn()
    const cancel = whenIdle(fn, { win })
    expect(win.requestIdleCallback).toHaveBeenCalledWith(expect.any(Function), { timeout: IDLE_TIMEOUT_MS })
    expect(fn).not.toHaveBeenCalled()
    win.requestIdleCallback.mock.calls[0][0]({ didTimeout: false })
    expect(fn).toHaveBeenCalledTimes(1)
    cancel()
    expect(win.cancelIdleCallback).toHaveBeenCalledWith(7)
  })

  it('falls back to a short timeout where there is no idle callback', () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    whenIdle(fn, { win: {} })
    vi.advanceTimersByTime(FALLBACK_MS - 1)
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('the fallback can be called off before it runs', () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    const cancel = whenIdle(fn, { win: {} })
    cancel()
    vi.advanceTimersByTime(FALLBACK_MS * 10)
    expect(fn).not.toHaveBeenCalled()
  })
})
