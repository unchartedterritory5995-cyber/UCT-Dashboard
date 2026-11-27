// ⭐ (review of #2935, D-1) THE SWITCH TARGET STAYS HELD FROM ITS PREPARE UNTIL ITS CHART SUBSCRIBES.
// The handoff's prepare pins its key (ensure) and lets go when it reports; the chart subscribes at the commit. In between a
// never-shown target was an ordinary idle intraday entry, and another key's landing over the bar budget could drop it.
//   H1 registry: a held target survives any pressure; its chart's subscribe ends the hold (the subscriber pins it); an
//      unsubscribed hold ends after HANDOFF_HOLD_MS and the key goes like any other; at most HANDOFF_HOLDS_MAX holds.
//   H2 the facade: prepareForDisplay's target survives other keys' landings over the budget until its chart subscribes
//      (a D target: an intraday one can also be held by the prepare's own closed-bar waiter, which would hide the hold).
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { createRegistry, HANDOFF_HOLD_MS, HANDOFF_HOLDS_MAX } from './registry'
import { keyOf } from './types'
import { installFakeIndexedDB } from './testing/fakeIndexedDB'
import { fakeStream, fakeCandle, fakePrices } from './testing/fakeFeeds'
import { installFakeBarsServer, OPEN } from './testing/fakeBarsServer'

vi.mock('../../hooks/useTickerMeta', () => ({ prefetchTickerMeta: () => {} }))

const NOW = (OPEN + 32 * 60 + 20) * 1000
const rows = (n, k = 1) => Array.from({ length: n }, (_, i) => ({ t: OPEN - 86400 + 60 * (i % 390) - 86400 * Math.floor(i / 390) * 0, o: k, h: k + 1, l: k - 0.5, c: k, v: 1 }))
  .map((b, i) => ({ ...b, t: OPEN - 3600 - 60 * i })).reverse()
const full = (n, k) => ({ type: 'rest-full', payload: { bars: rows(n, k) } })
const K = (s) => keyOf({ sym: s, tf: '5' })

describe('H1 registry.holdUntilShown', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW) })
  afterEach(() => { vi.useRealTimers() })

  it('pins the target through any pressure until its chart subscribes, at most HANDOFF_HOLD_MS, at most HANDOFF_HOLDS_MAX', async () => {
    const reg = createRegistry({ barBudget: 100, recentSymbols: 0, ctx: () => ({ nowMs: NOW }), idle: (fn) => fn() })
    // the prepare: ensure pins, the answer lands, the prepare reports (release) and hands the key off
    reg.acquire(K('TGT')); reg.dispatch(K('TGT'), full(200, 1)); reg.release(K('TGT'))
    reg.holdUntilShown(K('TGT'))
    for (let i = 0; i < 6; i++) reg.dispatch(K(`O${i}`), full(200, 2))   // other keys' landings, far over the budget
    expect(reg.has(K('TGT')), 'held between prepare and commit').toBe(true)
    // the commit: the chart subscribes; the hold is over, the subscriber pins it
    const off = reg.subscribe(K('TGT'), () => {})
    expect(reg.refs(K('TGT'))).toBe(0)
    reg.dispatch(K('O9'), full(200, 2))
    expect(reg.has(K('TGT'))).toBe(true)
    off()
    // a hold whose chart never comes ends after HANDOFF_HOLD_MS
    reg.acquire(K('GHOST')); reg.dispatch(K('GHOST'), full(200, 1)); reg.release(K('GHOST'))
    reg.holdUntilShown(K('GHOST'))
    reg.dispatch(K('P1'), full(200, 2))
    expect(reg.has(K('GHOST'))).toBe(true)
    await vi.advanceTimersByTimeAsync(HANDOFF_HOLD_MS + 1)
    reg.dispatch(K('P2'), full(200, 2))
    expect(reg.has(K('GHOST')), 'released after the bound').toBe(false)
    // at most HANDOFF_HOLDS_MAX at once: the oldest go first
    const ks = Array.from({ length: HANDOFF_HOLDS_MAX + 2 }, (_, i) => K(`H${i}`))
    for (const k of ks) { reg.acquire(k); reg.dispatch(k, full(10, 1)); reg.release(k); reg.holdUntilShown(k) }
    expect(ks.filter((k) => reg.refs(k) > 0)).toEqual(ks.slice(-HANDOFF_HOLDS_MAX))
  })
})

let fakeDb
describe('H2 prepareForDisplay hands its target off held', () => {
  beforeAll(() => { fakeDb = installFakeIndexedDB() })
  beforeEach(() => { fakeDb._clear(); vi.useFakeTimers(); vi.setSystemTime(NOW) })
  afterEach(() => { vi.useRealTimers() })

  it("the target survives other keys' landings over the budget until its chart subscribes", async () => {
    vi.resetModules()
    const server = installFakeBarsServer()
    const { createBarStore } = await import('./index')
    const { createPrefetch } = await import('./prefetch')
    const R = await import('./registry')
    const registry = R.createRegistry({ barBudget: 1, recentSymbols: 0, ctx: () => ({ nowMs: Date.now() }), idle: (fn) => fn() })
    const store = createBarStore({
      stream: fakeStream(), candle: fakeCandle(), prices: fakePrices(),
      isHidden: () => false, onVisible: () => () => {}, idle: (fn) => fn(), registry,
    })
    const pf = createPrefetch({ store, tickerMeta: () => {} })
    const p = pf.prepareForDisplay('TGT', 'D')
    await server.drain()
    await p
    const key = pf.keyFor('TGT', 'D')
    await vi.advanceTimersByTimeAsync(200)   // (whatever else the prepare started settles: only the hold may pin it now)
    expect(registry.refs(key), 'held by the handoff alone').toBe(1)
    expect(registry.peek(key)?.depth, 'the prepare landed rows').toBeGreaterThan(0)
    // every other landing is over the 1-bar budget: an unheld idle entry would go at the first one
    for (let i = 0; i < 4; i++) registry.dispatch(pf.keyFor(`OTH${i}`, '5'), full(50, 2))
    expect(registry.has(key), 'the target between prepare and commit').toBe(true)
    const off = registry.subscribe(key, () => {})
    expect(registry.has(key)).toBe(true)
    off()
    store.dispose()
  })
})
