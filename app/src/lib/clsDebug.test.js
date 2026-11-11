// Tier 2 fix round 1 (review Important 4): the debug-only layout-shift logger is OFF unless the device opts in.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { CLS_DEBUG_KEY, installLayoutShiftDebug } from './clsDebug'

function fakeWin(stored) {
  const observers = []
  const win = {
    localStorage: { getItem: (k) => (k === CLS_DEBUG_KEY ? stored : null) },
    location: { pathname: '/journal/notebook' },
    console: { info: vi.fn() },
    PerformanceObserver: vi.fn(function PO(cb) { this.observe = vi.fn(); observers.push({ cb, po: this }) }),
  }
  return { win, observers }
}
afterEach(() => vi.restoreAllMocks())

describe('installLayoutShiftDebug', () => {
  it('off by default: no observer, nothing logged, nothing on window', () => {
    const { win } = fakeWin(null)
    expect(installLayoutShiftDebug(win)).toBe(false)
    expect(win.PerformanceObserver).not.toHaveBeenCalled()
    expect(win.__uctLayoutShifts).toBeUndefined()
  })

  it('any value but "1" is off too', () => {
    const { win } = fakeWin('true')
    expect(installLayoutShiftDebug(win)).toBe(false)
  })

  it('on: observes layout-shift (buffered) and logs each shift with its sources, skipping input-driven ones', () => {
    const { win, observers } = fakeWin('1')
    expect(installLayoutShiftDebug(win)).toBe(true)
    expect(observers[0].po.observe).toHaveBeenCalledWith({ type: 'layout-shift', buffered: true })
    const node = { nodeType: 1, tagName: 'DIV', id: '', className: '_main_x', previousElementSibling: null }
    const rect = (y, h) => ({ y, height: h })
    observers[0].cb({ getEntries: () => [
      { value: 0.30349, startTime: 12239.4, hadRecentInput: false, sources: [{ node, previousRect: rect(400, 600), currentRect: rect(120, 600) }] },
      { value: 0.5, startTime: 13000, hadRecentInput: true, sources: [] },
    ] })
    expect(win.__uctLayoutShifts).toHaveLength(1)
    expect(win.__uctLayoutShifts[0]).toMatchObject({ value: 0.3035, t: 12239, path: '/journal/notebook',
      sources: [{ node: 'div._main_x', before: [400, 600], after: [120, 600] }] })
    expect(win.console.info).toHaveBeenCalledTimes(1)
  })
})
