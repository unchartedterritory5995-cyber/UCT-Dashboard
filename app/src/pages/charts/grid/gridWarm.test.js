import { describe, it, expect, vi } from 'vitest'
import { makeGridWarmer } from './gridWarm'

describe('makeGridWarmer', () => {
  it('warms once for a new sym set when ready', () => {
    const warm = vi.fn()
    const w = makeGridWarmer({ warm })
    expect(w.maybeWarm(['AAPL', 'MSFT'], true)).toBe(true)
    expect(warm).toHaveBeenCalledTimes(1)
    expect(warm).toHaveBeenCalledWith(['AAPL', 'MSFT'])
  })

  it('does NOT warm while not ready (pre-hydration / first paint pending)', () => {
    const warm = vi.fn()
    const w = makeGridWarmer({ warm })
    expect(w.maybeWarm(['AAPL'], false)).toBe(false)
    expect(warm).not.toHaveBeenCalled()
  })

  it('is a no-op on the SAME sym set regardless of order (content-keyed dedupe)', () => {
    const warm = vi.fn()
    const w = makeGridWarmer({ warm })
    w.maybeWarm(['AAPL', 'MSFT'], true)
    expect(w.maybeWarm(['MSFT', 'AAPL'], true)).toBe(false)   // reordered, same set
    expect(w.maybeWarm(['aapl', 'msft'], true)).toBe(false)   // case-insensitive
    expect(warm).toHaveBeenCalledTimes(1)
  })

  it('re-warms when the sym set changes (add/remove a ticker)', () => {
    const warm = vi.fn()
    const w = makeGridWarmer({ warm })
    w.maybeWarm(['AAPL'], true)
    expect(w.maybeWarm(['AAPL', 'NVDA'], true)).toBe(true)
    expect(warm).toHaveBeenCalledTimes(2)
    expect(warm).toHaveBeenLastCalledWith(['AAPL', 'NVDA'])
  })

  it('is a no-op on an empty/blank sym set', () => {
    const warm = vi.fn()
    const w = makeGridWarmer({ warm })
    expect(w.maybeWarm([], true)).toBe(false)
    expect(w.maybeWarm([null, '', undefined], true)).toBe(false)
    expect(warm).not.toHaveBeenCalled()
  })

  it('reset() clears the dedupe key so the next same-set call warms again', () => {
    const warm = vi.fn()
    const w = makeGridWarmer({ warm })
    w.maybeWarm(['AAPL'], true)
    w.reset()
    expect(w.maybeWarm(['AAPL'], true)).toBe(true)
    expect(warm).toHaveBeenCalledTimes(2)
  })
})
