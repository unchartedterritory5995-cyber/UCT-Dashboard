// Two store invariants the chart's timeframe switch and its readout rest on (2026-11-13 NVDA;
// synthetic prices only):
//   B1  the BASE view (getBaseSnapshot — what the chart renders, setData()s and reads its legend
//       from) always ends on the SAME bar as the live snapshot: a developing bar that opens a
//       bucket, or goes away, is a base change; only a move WITHIN one bucket is developing-only.
//       Over any interleaving of ticks (lagging or not) and REST answers with or without a
//       developing bar. (seeded)
//   A1  network.answered(key) is true only once a tail request of the key's CURRENT life settled
//       (answer / no_data / error); a new life starts unanswered whatever the entry still holds;
//       its listeners hear the flip after the answer's action was dispatched.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRegistry } from './registry'
import { createLiveFeed } from './liveFeed'
import { createNetwork } from './network'
import { isDevOnlyChange } from './reducer'
import { legacyBars } from './adapter'
import { keyOf } from './types'
import { rng } from './__fixtures__/seededSeries'
import { fakeCandle, fakePrices, fakeStream } from './testing/fakeFeeds'

afterEach(() => { vi.useRealTimers() })

const OPEN = Date.UTC(2026, 10, 13, 14, 30) / 1000   // Fri 09:30 ET
const K = keyOf({ sym: 'SIMB', tf: '1' })

describe('B1 — the base view always ends on the live bar', () => {
  it('isDevOnlyChange: a new bucket, an opened or a dropped developing bar is never developing-only', () => {
    const base = { key: K, bars: [], developing: { t: 60, c: 1 }, devRev: 1 }
    expect(isDevOnlyChange(base, { ...base, developing: { t: 60, c: 2 }, devRev: 2 })).toBe(true)
    expect(isDevOnlyChange(base, { ...base, developing: { t: 120, c: 2 }, devRev: 2 })).toBe(false)
    expect(isDevOnlyChange({ ...base, developing: null }, { ...base, developing: { t: 60, c: 2 }, devRev: 2 })).toBe(false)
    expect(isDevOnlyChange(base, { ...base, developing: null, devRev: 2 })).toBe(false)
  })

  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    it(`seed ${seed}: lagging ticks + REST answers with / without a developing bar`, () => {
      const r = rng(seed)
      const clock = { ms: (OPEN + 20 * 60) * 1000 }
      const registry = createRegistry({ ctx: () => ({ nowMs: clock.ms }), frame: (fn) => fn() })
      const prices = fakePrices()
      createLiveFeed({ registry, pushEnabled: () => false, stream: fakeStream(), candle: fakeCandle(), prices, now: () => clock.ms }).attach(K)
      const px = (ms) => Math.round((50 + Math.sin(ms / 9000) * 1.5) * 100) / 100
      const rest = (dataLagMs) => {
        const upto = clock.ms - dataLagMs, nowS = Math.floor(clock.ms / 1000)
        const bars = []
        for (let b = OPEN; b * 1000 <= upto; b += 60) bars.push({ t: b, o: px(b * 1000), h: 52, l: 48, c: px(Math.min(upto, b * 1000 + 59_000)), v: 10 })
        const last = bars.at(-1)
        registry.dispatch(K, { type: 'rest-full', key: K, gen: registry.getSnapshot(K).gen, payload: {
          bars, contract: 1, grid: 'session', cache_key: 'b1:SIMB:1:session', series_rev: clock.ms, history_rev: 1,
          complete_through: null, verified_through: Math.floor(upto / 1000),
          developing: last && last.t + 60 > nowS ? { ...last, rev: clock.ms } : null,
        } })
      }
      rest(0)
      let checked = 0, rolls = 0, prevT = null
      for (let i = 0; i < 400; i++) {
        clock.ms += r.int(200, 2500)
        const x = r.float(0, 1)
        if (x < 0.08) rest(r.int(0, 40_000))
        else { const lag = r.int(0, 60_000); prices.set('SIMB', px(clock.ms - lag), { trade_ts: clock.ms - lag }) }
        const live = registry.getSnapshot(K)
        const base = registry.getBaseSnapshot(K)
        const lt = legacyBars(live).at(-1)?.t ?? null
        const bt = legacyBars(base).at(-1)?.t ?? null
        expect(bt, `step ${i}: base tail vs live tail`).toBe(lt)
        if (lt !== prevT) { rolls++; prevT = lt }
        checked++
      }
      expect(checked).toBe(400)
      expect(rolls, 'non-vacuity: the bar rolled buckets').toBeGreaterThan(5)
    })
  }
})

describe('A1 — network.answered: the server spoke in THIS life of the key', () => {
  function net(request) {
    const registry = createRegistry({ ctx: () => ({ nowMs: Date.now() }) })
    const timers = []
    const network = createNetwork({
      registry, request, setTimer: (fn, ms) => { const h = { fn, ms }; timers.push(h); return h },
      clearTimer: (h) => { const i = timers.indexOf(h); if (i >= 0) timers.splice(i, 1) },
      isHidden: () => false, onVisible: () => () => {},
    })
    const run = async () => { const t = timers.shift(); t?.fn(); await new Promise((res) => setTimeout(res, 0)) }
    return { registry, network, run }
  }
  const ok = () => ({ bars: [{ t: OPEN, o: 1, h: 1, l: 1, c: 1, v: 1 }], contract: 1, cache_key: 'b1:SIMB:1:session', history_rev: 1, series_rev: 1, complete_through: null, developing: null })

  it('false until the first answer of the life, then true; listeners hear it after the dispatch', async () => {
    const { registry, network, run } = net(vi.fn(async () => ok()))
    const seen = []
    network.subscribeAnswered(K, () => seen.push(registry.peek(K)?.restSeen))
    const stop = network.start(K)
    expect(network.answered(K)).toBe(false)
    await run()
    expect(network.answered(K)).toBe(true)
    expect(seen, 'one flip, heard with the answer already applied').toEqual([true])
    stop()
    // A new life: the entry still holds that answer, but this life has not been answered.
    expect(registry.peek(K).restSeen).toBe(true)
    network.start(K)
    expect(network.answered(K)).toBe(false)
  })

  it('an error answers the life too (the hold must end on it); an aborted request does not', async () => {
    let fail = true
    const { network, run } = net(vi.fn(async () => { if (fail) throw Object.assign(new Error('x'), { status: 503 }); return ok() }))
    network.start(K)
    await run()
    expect(network.answered(K)).toBe(true)
    fail = false
    const K2 = keyOf({ sym: 'SIMC', tf: '1' })
    const stop2 = network.start(K2)
    stop2()   // aborted before it ran
    expect(network.answered(K2)).toBe(false)
  })
})
