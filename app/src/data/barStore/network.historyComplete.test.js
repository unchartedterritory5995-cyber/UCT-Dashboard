// ⭐ (2026-11-28, zoomed-out short shadows) historyComplete: a key's WHOLE history is here, PROVED. Intraday: a lake load
// that read the index and took every older piece (historyFeed `complete`), settled at the depth held, the server's answer
// held. Never: a load that failed, one that answered rows but not all of them, or one still running.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRegistry } from './registry'
import { createNetwork } from './network'
import { keyOf } from './types'

const OPEN = Date.UTC(2026, 10, 10, 14, 30) / 1000     // Tue 09:30 ET
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(OPEN * 1000 + 60 * 60_000) })
afterEach(() => { vi.useRealTimers() })

// older rows that share the answer's bars (the join proves its price basis over them)
const older = (n) => Array.from({ length: n + 12 }, (_, i) => ({ t: OPEN - (n - i) * 300, o: 10, h: 11, l: 9, c: 10, v: 5 }))
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
async function seeded(olderBars) {
  const w = world(olderBars)
  w.net.fetchOnce(w.key)
  await vi.advanceTimersByTimeAsync(20)
  await w.net.lakeSeed(w.key)
  await vi.advanceTimersByTimeAsync(0)
  return w
}

describe('historyComplete', () => {
  it('C1 a lake load that took every older piece: complete', async () => {
    const w = await seeded(vi.fn(async () => ({ bars: older(300), exhausted: false, complete: true })))
    expect(w.registry.peek(w.key).bars.length).toBeGreaterThan(12)   // the lake's rows joined
    expect(w.net.historyComplete(w.key)).toBe(true)
  })
  it('C2 a lake load that answered rows but NOT all the lake holds: not complete', async () => {
    const w = await seeded(vi.fn(async () => ({ bars: older(300), exhausted: false, complete: false })))
    expect(w.net.historyComplete(w.key)).toBe(false)
  })
  it('C3 a lake load that failed: not complete (and still due)', async () => {
    const w = await seeded(vi.fn(async () => { throw new Error('lake down') }))
    expect(w.net.historyComplete(w.key)).toBe(false)
    expect(w.net.lakePending(w.key)).toBe(true)
  })
  it('C4 nothing older in a lake index that was read: complete', async () => {
    const w = await seeded(vi.fn(async () => ({ bars: [], exhausted: true, complete: true })))
    expect(w.net.historyComplete(w.key)).toBe(true)
  })
  it('C5 a missing index (exhausted, not complete: the lake does not carry the symbol): not complete', async () => {
    const w = await seeded(vi.fn(async () => ({ bars: [], exhausted: true })))
    expect(w.net.historyComplete(w.key)).toBe(false)
  })
  it('C6 a key no server answered: not complete', async () => {
    const w = world(vi.fn(async () => ({ bars: older(300), exhausted: false, complete: true })))
    expect(w.net.historyComplete(w.key)).toBe(false)
  })

  // (review of #3038, MED) a lake load whose rows the reducer REFUSED proves nothing (another basis: a hole at the join)
  it('C7 a lake load whose rows did not join (another price basis on the shared bars): not complete', async () => {
    const other = (n) => older(n).map((b) => ({ ...b, o: 50, h: 51, l: 49, c: 50 }))
    const w = await seeded(vi.fn(async () => ({ bars: other(300), exhausted: false, complete: true })))
    expect(w.registry.peek(w.key).bars.length).toBe(12)              // refused: only the answer's rows
    expect(w.net.historyComplete(w.key)).toBe(false)
  })
  // (review of #3038, LOW) a lake seed BEFORE the server's answer never stamps the key: the answer may discard its rows
  it('C8 a lake load that landed before any server answer: not complete', async () => {
    // the server's answer is held back: the lake seeds the entry first (restSeen false when it settles)
    let release
    const gate = new Promise((r) => { release = r })
    const request = vi.fn(async () => {
      await gate
      const bars = []
      for (let i = 0; i < 12; i++) { const t = OPEN + i * 300; bars.push({ t, o: 10, h: 11, l: 9, c: 10, v: 5 }) }
      return { ticker: 'SIM', tf: '5', bars }
    })
    const registry = createRegistry({ ctx: () => ({ nowMs: Date.now() }) })
    const net = createNetwork({ registry, request, isHidden: () => false, onVisible: () => () => {}, history: { olderBars: vi.fn(async () => ({ bars: older(300), exhausted: false, complete: true })) } })
    const key = keyOf({ sym: 'SIM', tf: '5' })
    net.fetchOnce(key)
    await vi.advanceTimersByTimeAsync(5)
    await net.lakeSeed(key)
    await vi.advanceTimersByTimeAsync(0)
    expect(registry.peek(key)?.restSeen).toBeFalsy()
    expect(registry.peek(key)?.bars.length).toBeGreaterThan(12)        // the lake seeded it
    release()
    await vi.advanceTimersByTimeAsync(20)
    expect(registry.peek(key)?.restSeen).toBe(true)
    expect(net.historyComplete(key)).toBe(false)
  })
})
