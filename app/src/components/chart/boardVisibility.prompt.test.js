// ⭐ (lane C, typed Enter 'shadow-unreported', 2026-11-28) A HIDDEN LAYER'S FIRST PASS OF A NEW ROW IS NOT LEFT FOR IDLE
// TIME (boardVisibility.forwardWhileCurrent `promptUntil`). A member typing leaves no idle period: the hidden pane the
// double buffer had just retargeted to the typed ticker re-rendered up to 500 ms later, after the Enter.
//   P1 inside the prompt window a hidden CURRENT layer's feed is forwarded in its own task (setTimeout 0), coalesced
//   P2 CONTROL: no window (or a window that has passed): an idle task, exactly as before
//   P3 never in the feed's own task (the key or input task that caused it)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createBoardVisibility, forwardWhileCurrent } from './boardVisibility'

let idleCbs
beforeEach(() => {
  vi.useFakeTimers()
  idleCbs = []
  vi.stubGlobal('requestIdleCallback', (fn) => { idleCbs.push(fn); return idleCbs.length })   // an idle period never comes
  vi.stubGlobal('cancelIdleCallback', () => {})
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

function hiddenCurrent() {
  const v = createBoardVisibility({ layer: true, current: true })
  v.set('hidden')
  return v
}

describe('forwardWhileCurrent: the prompt window', () => {
  it('P1 + P3 inside the window: its own task, coalesced, never the feed\'s task', async () => {
    const v = hiddenCurrent()
    const notify = vi.fn()
    const f = forwardWhileCurrent(v, notify)
    v.promptUntil = performance.now() + 1000
    f.cb(); f.cb()
    expect(notify, 'forwarded inside the feed\'s own task').toHaveBeenCalledTimes(0)
    await vi.advanceTimersByTimeAsync(0)
    expect(notify).toHaveBeenCalledTimes(1)
    expect(idleCbs).toHaveLength(0)
    f.stop()
  })

  it('P2 CONTROL: no window, or one that has passed: left for idle time as before', async () => {
    const v = hiddenCurrent()
    const notify = vi.fn()
    const f = forwardWhileCurrent(v, notify)
    f.cb()
    await vi.advanceTimersByTimeAsync(50)
    expect(notify).toHaveBeenCalledTimes(0)
    expect(idleCbs).toHaveLength(1)
    idleCbs[0]()
    expect(notify).toHaveBeenCalledTimes(1)
    v.promptUntil = performance.now() - 1
    f.cb()
    await vi.advanceTimersByTimeAsync(50)
    expect(notify).toHaveBeenCalledTimes(1)
    expect(idleCbs).toHaveLength(2)
    f.stop()
  })
})
