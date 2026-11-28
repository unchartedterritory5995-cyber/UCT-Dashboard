// Board pre-mount's scheduler and order (2026-11-28, boardPremount.js)
//   PO1 (red first) nearest-first in tab order from the active tab (right, left, ...), each once, the active and skipped out
//   PM2 (red first) a press restarts the quiet clock: no step until PREMOUNT_QUIET_MS without input, and a press while the
//       idle callback waits cancels it
//   PM6 (red first) a 429 / 503 within PRESSURE_WINDOW_MS defers the next step, exponentially and capped; requests in
//       flight on the page (the board in front loading) or a front board not yet mounted defer it too
//   PM7 one board per step, a quiet spell between steps, and a step with nothing to do ends the run until a poke
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  premountOrder, createPremountScheduler, PREMOUNT_QUIET_MS, PRESSURE_WINDOW_MS, PRESSURE_BACKOFF_MS, PRESSURE_BACKOFF_MAX_MS,
  PREMOUNT_BUSY_RETRY_MS,
} from './boardPremount'

afterEach(() => { vi.useRealTimers() })
const idleNow = (fn) => { const t = setTimeout(fn, 0); return () => clearTimeout(t) }

describe('premountOrder', () => {
  it('PO1 (red first) nearest first from the active tab, each once', () => {
    expect(premountOrder([1, 2, 3, 4, 5], 3)).toEqual(['4', '2', '5', '1'])
    expect(premountOrder([1, 2, 3, 4], 1)).toEqual(['2', '3', '4'])
    expect(premountOrder([1, 2, 2, 3], 3), 'a duplicated pin once').toEqual(['2', '1'])
    expect(premountOrder([1, 2, 3], 2, (id) => id === '3')).toEqual(['1'])
    expect(premountOrder([1, 2], null), 'no active tab: in tab order').toEqual(['1', '2'])
    expect(premountOrder(null, 1)).toEqual([])
  })
})

describe('createPremountScheduler', () => {
  it('PM2 (red first) a press restarts the quiet clock and cancels a waiting idle step', async () => {
    vi.useFakeTimers()
    const step = vi.fn(() => true)
    let pendingIdle = null
    const idle = (fn) => { pendingIdle = fn; return () => { pendingIdle = null } }
    const s = createPremountScheduler({ step, idle })
    for (let i = 0; i < 6; i++) { await vi.advanceTimersByTimeAsync(PREMOUNT_QUIET_MS / 2); s.noteInput() }
    expect(pendingIdle, 'a step was asked while the member was pressing').toBe(null)
    expect(step).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(PREMOUNT_QUIET_MS + 10)
    expect(pendingIdle, 'NON-VACUITY: quiet, the step is asked').toBeTypeOf('function')
    s.noteInput()
    expect(pendingIdle, 'a press did not cancel the waiting idle step').toBe(null)
    await vi.advanceTimersByTimeAsync(PREMOUNT_QUIET_MS + 10)
    pendingIdle()
    expect(step).toHaveBeenCalledTimes(1)
    s.stop()
  })

  it('PM6 (red first) server pressure backs off exponentially, capped; a page with requests out waits', async () => {
    vi.useFakeTimers()
    let shedding = true   // a 429 / 503 seen within the window at every look while true
    let out = 0
    const step = vi.fn(() => true)
    const s = createPremountScheduler({ step, idle: idleNow, pressureAge: () => (shedding ? 0 : PRESSURE_WINDOW_MS + 1), inflight: () => out })
    await vi.advanceTimersByTimeAsync(PREMOUNT_QUIET_MS + 10)
    expect(step, 'a step under server pressure').not.toHaveBeenCalled()
    expect(s.state().backoff).toBe(PRESSURE_BACKOFF_MS)
    await vi.advanceTimersByTimeAsync(PRESSURE_BACKOFF_MS + 10)
    expect(s.state().backoff, 'the back-off did not grow').toBe(PRESSURE_BACKOFF_MS * 2)
    for (let i = 0; i < 12; i++) await vi.advanceTimersByTimeAsync(s.state().backoff + 10)
    expect(s.state().backoff, 'the back-off is not capped').toBe(PRESSURE_BACKOFF_MAX_MS)
    expect(step).not.toHaveBeenCalled()
    // the pressure ages out; now the page has requests in flight
    shedding = false
    out = 2
    await vi.advanceTimersByTimeAsync(PRESSURE_BACKOFF_MAX_MS + 10)
    expect(step, 'a step while requests are in flight').not.toHaveBeenCalled()
    expect(s.state().deferredBusy).toBeGreaterThan(0)
    out = 0
    await vi.advanceTimersByTimeAsync(PREMOUNT_BUSY_RETRY_MS + 10)
    expect(step, 'NON-VACUITY: no pressure, nothing in flight: the step runs').toHaveBeenCalledTimes(1)
    expect(s.state().backoff, 'the back-off did not reset').toBe(0)
    s.stop()
  })

  it('PM6b a front board still mounting defers the step', async () => {
    vi.useFakeTimers()
    let ready = false
    const step = vi.fn(() => true)
    const s = createPremountScheduler({ step, idle: idleNow, ready: () => ready })
    await vi.advanceTimersByTimeAsync(PREMOUNT_QUIET_MS * 3)
    expect(step).not.toHaveBeenCalled()
    ready = true
    await vi.advanceTimersByTimeAsync(PREMOUNT_BUSY_RETRY_MS + 10)
    expect(step).toHaveBeenCalledTimes(1)
    s.stop()
  })

  it('PM7 one board per quiet spell; nothing to do ends the run until a poke', async () => {
    vi.useFakeTimers()
    let left = 2
    const step = vi.fn(() => (left-- > 0))
    const s = createPremountScheduler({ step, idle: idleNow })
    await vi.advanceTimersByTimeAsync(PREMOUNT_QUIET_MS + 10)
    expect(step).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(PREMOUNT_QUIET_MS / 2)
    expect(step, 'two boards in one quiet spell').toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(PREMOUNT_QUIET_MS * 3)
    expect(step).toHaveBeenCalledTimes(3)
    expect(s.state().done).toBe(true)
    await vi.advanceTimersByTimeAsync(PREMOUNT_QUIET_MS * 5)
    expect(step, 'a finished run kept stepping').toHaveBeenCalledTimes(3)
    left = 1
    s.poke()
    await vi.advanceTimersByTimeAsync(PREMOUNT_QUIET_MS + 10)
    expect(step).toHaveBeenCalledTimes(4)
    s.stop()
  })
})
