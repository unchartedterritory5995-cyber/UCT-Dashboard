// ⛔ (F2, 2026-11-28) A LAKE LOAD THAT FAILED SETTLED NOTHING. lakeSeed recorded a settle at whatever the entry held and
// notified subscribeSettled whatever the load's outcome, so a thrown load read "nothing more is coming" (lakePending false)
// and woke the hold to paint the shallow rows. A failed load leaves the depth due (a later load asks again); a load that
// answered (even with nothing older) settles it, as before.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRegistry } from './registry'
import { createNetwork } from './network'
import { keyOf } from './types'

const OPEN = Date.UTC(2026, 10, 10, 14, 30) / 1000     // Tue 09:30 ET
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(OPEN * 1000 + 60 * 60_000) })
afterEach(() => { vi.useRealTimers() })

function world(olderBars) {
  const request = vi.fn(async () => {
    const bars = []
    for (let i = 0; i < 12; i++) { const t = OPEN + i * 300; bars.push({ t, o: 10, h: 11, l: 9, c: 10, v: 5 }) }
    return { ticker: 'SIM', tf: '5', bars }
  })
  const registry = createRegistry({ ctx: () => ({ nowMs: Date.now() }) })
  const net = createNetwork({ registry, request, isHidden: () => false, onVisible: () => () => {}, history: { olderBars } })
  return { net, registry, key: keyOf({ sym: 'SIM', tf: '5' }) }
}

describe('a lake load that failed settles nothing (F2)', () => {
  it('a thrown load: the lake stays due and no settle is notified', async () => {
    const w = world(vi.fn(async () => { throw new Error('lake down') }))
    w.net.fetchOnce(w.key)
    await vi.advanceTimersByTimeAsync(20)
    expect(w.registry.peek(w.key)?.bars.length).toBeGreaterThan(0)
    const settled = vi.fn()
    w.net.subscribeSettled(w.key, settled)
    expect(w.net.lakePending(w.key)).toBe(true)
    await w.net.lakeSeed(w.key)
    await vi.advanceTimersByTimeAsync(0)
    expect(w.net.lakePending(w.key)).toBe(true)
    expect(settled).not.toHaveBeenCalled()
  })

  it('CONTROL: a load that answered with nothing older settles the depth and notifies it', async () => {
    const w = world(vi.fn(async () => ({ bars: [], exhausted: true })))
    w.net.fetchOnce(w.key)
    await vi.advanceTimersByTimeAsync(20)
    const settled = vi.fn()
    w.net.subscribeSettled(w.key, settled)
    await w.net.lakeSeed(w.key)
    await vi.advanceTimersByTimeAsync(0)
    expect(w.net.lakePending(w.key)).toBe(false)
    expect(settled).toHaveBeenCalledTimes(1)
  })
})
