// liveFeed.js — ordering (push final vs poll vs tick) over P2a's seeded sessions, the tick
// fallback gate (S6), one tick source at a time, and the D/W/M fold of the 1m stream.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { reduce, initialState, isSealedRow, bucketEnd, inSealedSpan } from './reducer'
import { createRegistry } from './registry'
import { createLiveFeed, foldMinute, foldAnchor, SOURCE_QUIET_MS } from './liveFeed'
import { forSeeds, simulateIntraday, withDuplicates, shuffled, etUnix, rng } from './__fixtures__/seededSeries'
import { keyOf } from './types'

const N = Number(globalThis.process?.env?.BARSTORE_SEEDS || 300)
afterEach(() => { vi.useRealTimers() })
function check(cond, msg) { if (!cond) throw new Error(typeof msg === 'function' ? msg() : msg) }

import { fakeStream, fakeCandle, fakePrices } from './testing/fakeFeeds'

const canon = (s) => JSON.stringify({
  bars: s.bars.map((b) => [b.t, b.o, b.h, b.l, b.c, b.v]),
  dev: s.developing && [s.developing.t, s.developing.o, s.developing.h, s.developing.l, s.developing.c, s.developing.v],
  C: s.completeThrough,
})

/** Deliver one simulated event through the live feed (push) or the network path (REST). */
function deliver(w, sim, e) {
  const t = e.action.type
  if (t === 'push-bar' || t === 'push-final') w.stream.emit(sim.sym, sim.tf, e.action.event)
  else if (t === 'tick-fallback') w.candle.tick(sim.sym, e.action.event.price, e.action.event.ts)
  else w.registry.dispatch(sim.key, e.action, e.ctx)
}

function liveWorld(sim, nowMs) {
  const registry = createRegistry({ ctx: () => ({ nowMs }) })
  const stream = fakeStream(), candle = fakeCandle(), prices = fakePrices()
  const live = createLiveFeed({ registry, pushEnabled: () => true, stream, candle, prices, now: () => nowMs })
  const detach = live.attach(sim.key, { session: sim.session })
  // every snapshot the feed produces keeps S1 / S3 / frozen
  registry.subscribe(sim.key, (s) => {
    check(Object.isFrozen(s) && Object.isFrozen(s.bars), 'S10 frozen')
    for (let i = 1; i < s.bars.length; i++) check(s.bars[i].t > s.bars[i - 1].t, 'S1 increasing')
    const last = s.bars[s.bars.length - 1]
    if (s.developing && last) check(s.developing.t > last.t, 'S3 developing after closed')
  })
  return { registry, stream, candle, prices, live, detach }
}

describe('liveFeed ordering — push final vs poll vs tick (seeded)', () => {
  it(`any order / duplication of push frames (via the stream) and REST answers converges to the reducer's answer (${N} seeds)`, () => {
    forSeeds(N, 120000, (r, seed) => {
      const sim = simulateIntraday(r)
      const nowMs = sim.nowSec * 1000
      vi.setSystemTime(nowMs)
      let ref = initialState(sim.key, { nowMs })
      for (const e of sim.events) ref = reduce(ref, e.action, { nowMs, streamLive: true })
      for (let k = 0; k < 2; k++) {
        const w = liveWorld(sim, nowMs)
        for (const e of withDuplicates(r, shuffled(r, sim.events), 0.2)) deliver(w, sim, e)
        check(canon(w.registry.getSnapshot(sim.key)) === canon(ref), () => `seed ${seed} order ${k} diverged`)
      }
    })
  })

  it(`S6: ticks while the stream delivers never change the snapshot; when it does not, they touch only the developing bar (${N} seeds)`, () => {
    forSeeds(N, 140000, (r) => {
      const sim = simulateIntraday(r)
      const nowMs = sim.nowSec * 1000
      vi.setSystemTime(nowMs)
      const w = liveWorld(sim, nowMs)
      for (const e of sim.events) deliver(w, sim, e)
      const s0 = w.registry.getSnapshot(sim.key)
      const anchor = s0.developing?.c ?? s0.bars.at(-1)?.c ?? 100
      const ticks = Array.from({ length: r.int(1, 6) }, () => ({ p: Math.round(anchor * (1 + r.float(-0.004, 0.004)) * 100) / 100, ms: r.int(sim.win[0].t * 1000, nowMs) }))
      w.stream.st.delivering = true
      for (const x of ticks) w.candle.tick(sim.sym, x.p, x.ms)
      check(w.registry.getSnapshot(sim.key) === s0, 'S6 a tick moved the snapshot while push delivers')
      w.stream.st.delivering = false
      for (const x of ticks) w.candle.tick(sim.sym, x.p, x.ms)
      const s1 = w.registry.getSnapshot(sim.key)
      // closed rows untouched (a tick never touches a closed / sealed bucket)
      const closedBefore = s0.bars.map((b) => [b.t, b.o, b.h, b.l, b.c, b.v])
      const closedAfter = s1.bars.slice(0, s0.bars.length).map((b) => [b.t, b.o, b.h, b.l, b.c, b.v])
      check(JSON.stringify(closedBefore) === JSON.stringify(closedAfter), 'S6 a tick changed a closed row')
      if (s0.developing && s1.developing && s1.developing.t === s0.developing.t && !s0.developing.provisional && s0.developing.src !== 'tick') {
        check(s1.developing.o === s0.developing.o, 'S6 a tick moved an authoritative open')
      }
      // the server settles: sealed rows equal the truth regardless of the ticks
      const settled = w.registry.dispatch(sim.key, sim.settle)
      for (const b of settled.bars) {
        if (!isSealedRow(settled, b) || bucketEnd(b.t, settled) > sim.nowSec) continue
        const tr = sim.truth.get(b.t)
        check(tr && b.o === tr.o && b.h === tr.h && b.l === tr.l && b.c === tr.c && b.v === tr.v, () => `sealed ${b.t} != truth after ticks`)
      }
      for (const b of settled.bars) if (inSealedSpan(settled, b.t) && bucketEnd(b.t, settled) <= sim.nowSec) check(b.src === 'rest', 'tick row inside the seal')
    })
  })

  it('exactly one tick source: livePrices is ignored while the trade feed ticks for the symbol', () => {
    const key = keyOf({ sym: 'SIM', tf: '5' })
    const nowMs = Date.UTC(2026, 10, 10, 15, 2)
    vi.setSystemTime(nowMs)
    const registry = createRegistry({ ctx: () => ({ nowMs }) })
    const stream = fakeStream(), candle = fakeCandle(), prices = fakePrices()
    stream.st.delivering = false
    let clock = nowMs
    const live = createLiveFeed({ registry, pushEnabled: () => true, stream, candle, prices, now: () => clock })
    live.attach(key)
    registry.dispatch(key, { type: 'rest-full', payload: { bars: [{ t: nowMs / 1000 - 420, o: 100, h: 101, l: 99, c: 100, v: 5 }], contract: 1, grid: 'eth-clock', cache_key: 'b1:SIM:5:eth-clock', series_rev: 1, history_rev: 1, complete_through: null } })
    candle.tick('SIM', 100.4, clock)
    const a = registry.getSnapshot(key)
    expect(a.developing?.c).toBe(100.4)
    prices.set('SIM', 100.9)                               // the candle ticked < SOURCE_QUIET_MS ago
    expect(registry.getSnapshot(key)).toBe(a)
    clock += SOURCE_QUIET_MS + 1
    prices.set('SIM', 100.9)                               // trade feed silent → livePrices is the fallback
    expect(registry.getSnapshot(key).developing.c).toBe(100.9)
  })

  it('detach releases every subscription (stream, candle, prices)', () => {
    const sim = simulateIntraday(rng(7), { tf: '5', session: 'rth' })
    const w = liveWorld(sim, sim.nowSec * 1000)
    expect(w.stream.count() + w.candle.count() + w.prices.count()).toBe(3)
    w.detach()
    expect(w.stream.count() + w.candle.count() + w.prices.count()).toBe(0)
  })
})

// P3-S1 review fix 2 — the push feed is DARK unless its ONE build gate (lib/realtimeBarsGate,
// the VITE_REALTIME_BARS owner legacy Writer B's useRealtimeBars reads) is on. INVARIANT, every
// key kind: gate off ⇒ the store opens no stream subscription, never counts push as delivering,
// and the tick fallback is the live source; gate on ⇒ the push feed is subscribed.
describe('push feed build gate (VITE_REALTIME_BARS)', () => {
  afterEach(() => { vi.unstubAllEnvs() })
  const keys = [keyOf({ sym: 'GATE', tf: '1' }), keyOf({ sym: 'GATE', tf: '5' }), keyOf({ sym: 'GATE', tf: '60', session: 'eth' }), keyOf({ sym: 'GATE', tf: 'D' })]
  for (const [env, on] of [[undefined, false], ['0', false], ['1', true]]) {
    it(`VITE_REALTIME_BARS=${env} ⇒ push ${on ? 'subscribed' : 'never subscribed, ticks are the source'}`, () => {
      if (env !== undefined) vi.stubEnv('VITE_REALTIME_BARS', env)
      else vi.stubEnv('VITE_REALTIME_BARS', '')
      for (const key of keys) {
        const registry = createRegistry({ ctx: () => ({ nowMs: Date.now() }) })
        const stream = fakeStream(), candle = fakeCandle(), prices = fakePrices()
        const live = createLiveFeed({ registry, stream, candle, prices })   // the DEFAULT gate
        const off = live.attach(key)
        expect(stream.count(), key).toBe(on ? 1 : 0)
        expect(live.isStreamLive(key), key).toBe(on)
        expect(candle.count() + prices.count(), key).toBe(2)   // the fallback is always attached
        off()
        expect(stream.count() + candle.count() + prices.count()).toBe(0)
      }
    })
  }
})

describe('D/W/M fold of the 1m stream', () => {
  const NF = Math.max(40, Math.floor(N / 5))   // each seed is a whole trading stretch through the feed
  const day = '2026-11-10'
  const dayT = Date.UTC(2026, 10, 10) / 1000
  const minute = (m) => etUnix(day, m)

  /**
   * One seeded day: trades every few seconds; the server answers (arriving at `arr`) carry a
   * developing bar read at some instant <= arr (fresh, lagged, or a stale cache copy) with a
   * `rev` that says nothing about the read (null, an old write, or arr); 1m frames arrive with
   * delivery delay and duplicates. Everything is applied in ARRIVAL order through the feed.
   */
  function simulateDay(r) {
    const trades = []
    let px = r.float(20, 300)
    const t0 = minute(570) * 1000, t1 = minute(570 + r.int(20, 120)) * 1000
    for (let ms = t0 + r.int(0, 3000); ms < t1; ms += r.int(500, 9000)) {
      px = Math.max(1, px * (1 + r.float(-0.003, 0.003)))
      trades.push({ ms, p: Math.round(px * 100) / 100, s: r.int(1, 900) })
    }
    // prefix aggregates (the test must stay O(n))
    const pre = []
    for (const x of trades) { const p = pre.at(-1); pre.push(p ? { o: p.o, h: Math.max(p.h, x.p), l: Math.min(p.l, x.p), c: x.p, v: p.v + x.s, ms: x.ms } : { o: x.p, h: x.p, l: x.p, c: x.p, v: x.s, ms: x.ms }) }
    const aggAt = (ms) => { let lo = 0, hi = pre.length; while (lo < hi) { const m = (lo + hi) >> 1; if (pre[m].ms <= ms) lo = m + 1; else hi = m } return lo ? pre[lo - 1] : null }
    const events = []
    let mt0 = null, cur = null
    for (const x of trades) {
      const mt = Math.floor(x.ms / 60000) * 60
      if (mt !== mt0) { mt0 = mt; cur = { o: x.p, h: x.p, l: x.p, c: x.p, v: 0 } }
      cur = { o: cur.o, h: Math.max(cur.h, x.p), l: Math.min(cur.l, x.p), c: x.p, v: cur.v + x.s }
      const frame = { sym: 'SIM', tf: '1', t_s: mt, bar: { t: mt * 1000, ...cur, final: false, trade_ts: x.ms }, rev: x.ms }
      const arr = x.ms + r.int(0, 4000)
      events.push({ arr, kind: 'frame', frame })
      if (r.chance(0.1)) events.push({ arr: arr + r.int(0, 8000), kind: 'frame', frame })
    }
    for (let i = r.int(1, 6); i > 0; i--) {
      const arr = r.int(t0 + 1000, t1 + 60_000)
      const read = r.chance(0.2) ? r.int(t0, arr) : arr - r.int(0, 5000)   // stale cache or lagged read
      const d = aggAt(read)
      if (!d) continue
      const rev = r.pick([null, t0 - 3_600_000, arr, read])
      events.push({ arr, kind: 'rest', d, rev })
    }
    events.sort((a, b) => a.arr - b.arr)
    return { trades, events, aggAt }
  }

  it(`property: any interleaving of server developing answers and 1m frames never over-counts volume (v <= the true sum) (${NF} seeds)`, () => {
    forSeeds(NF, 160000, (r, seed) => {
      const sim = simulateDay(r)
      let clock = minute(570) * 1000
      vi.setSystemTime(clock)
      const key = keyOf({ sym: 'SIM', tf: 'D' })
      const registry = createRegistry({ ctx: () => ({ nowMs: clock }) })
      const stream = fakeStream()
      createLiveFeed({ registry, pushEnabled: () => true, stream, candle: fakeCandle(), prices: fakePrices(), now: () => clock }).attach(key)
      for (const e of sim.events) {
        clock = e.arr
        vi.setSystemTime(clock)
        if (e.kind === 'frame') stream.emit('SIM', '1', e.frame)
        else {
          registry.dispatch(key, { type: 'rest-full', payload: {
            bars: [{ t: '2026-11-09', o: 90, h: 95, l: 89, c: 94, v: 9000 }, { t: day, o: e.d.o, h: e.d.h, l: e.d.l, c: e.d.c, v: e.d.v }],
            contract: 1, grid: 'plain', cache_key: 'b1:SIM:D:plain', series_rev: e.rev, history_rev: 1,
            complete_through: null, developing: { t: day, o: e.d.o, h: e.d.h, l: e.d.l, c: e.d.c, v: e.d.v, rev: e.rev },
          } }, { nowMs: clock })
        }
        const dv = registry.getSnapshot(key).developing
        if (!dv) continue
        const truth = sim.aggAt(clock)
        check(truth && dv.v <= truth.v, () => `seed ${seed}: folded v ${dv.v} > true ${truth?.v}`)
        check(dv.h <= truth.h + 1e-9 && dv.l >= truth.l - 1e-9, () => `seed ${seed}: H/L outside the traded range`)
      }
    })
  })

  it('pure step: volume only from minutes that start after the arrival minute + the skew margin; earlier minutes H/L only', () => {
    const arrived = (minute(700) + 30) * 1000
    const base = { t: dayT, o: 100, h: 102, l: 98, c: 101, v: 5000, rev: null, src: 'server' }
    const st = { base, anchor: foldAnchor(arrived), minutes: new Map(), rev: null }
    expect(st.anchor).toBe(minute(702))
    expect(foldMinute(st, { t: minute(500), o: 1, h: 200, l: 1, c: 150, v: 9 }, 'D', 1)).toBe(null)          // pre-market
    expect(foldMinute(st, { t: minute(600) + 86400, o: 1, h: 200, l: 1, c: 150, v: 9 }, 'D', 1)).toBe(null)  // tomorrow
    let f = foldMinute(st, { t: minute(650), o: 101, h: 103, l: 100, c: 99, v: 40 }, 'D', 2)                 // long before arrival
    expect([f.bar.h, f.bar.c, f.bar.v]).toEqual([103, 101, 5000])
    f = foldMinute(st, { t: minute(700), o: 101, h: 101, l: 100, c: 100.5, v: 40 }, 'D', 3)                // the arrival minute
    expect([f.bar.c, f.bar.v]).toEqual([100.5, 5000])
    f = foldMinute(st, { t: minute(701), o: 101, h: 101, l: 100, c: 100.7, v: 40 }, 'D', 4)                // skew margin
    expect(f.bar.v).toBe(5000)
    f = foldMinute(st, { t: minute(702), o: 101, h: 101, l: 100, c: 100.9, v: 25 }, 'D', 5)
    expect([f.bar.c, f.bar.v]).toEqual([100.9, 5025])
    f = foldMinute(st, { t: minute(702), o: 101, h: 101, l: 100, c: 101.1, v: 30 }, 'D', 6)                // same minute grows: replaced
    expect(f.bar.v).toBe(5030)
    expect(f.bar.o).toBe(100)
  })

  it('a base with no anchor never adds volume', () => {
    const st = { base: { t: dayT, o: 100, h: 102, l: 98, c: 101, v: 5000, rev: null }, anchor: null, minutes: new Map() }
    expect(foldMinute(st, { t: minute(800), o: 1, h: 101, l: 99, c: 100, v: 70 }, 'D', 1).bar.v).toBe(5000)
  })

  it('through the feed: rebased on each REST answer, volume anchored on its arrival', () => {
    const key = keyOf({ sym: 'SIM', tf: 'D' })
    let nowMs = (minute(720) + 30) * 1000
    vi.setSystemTime(nowMs)
    const registry = createRegistry({ ctx: () => ({ nowMs }) })
    const stream = fakeStream()
    createLiveFeed({ registry, pushEnabled: () => true, stream, candle: fakeCandle(), prices: fakePrices(), now: () => nowMs }).attach(key)
    const rest = (h, v, rev) => registry.dispatch(key, { type: 'rest-full', payload: {
      bars: [{ t: '2026-11-09', o: 90, h: 95, l: 89, c: 94, v: 9000 }, { t: day, o: 100, h, l: 98, c: 101, v }],
      contract: 1, grid: 'plain', cache_key: 'b1:SIM:D:plain', series_rev: rev, history_rev: 1, complete_through: null,
      developing: { t: day, o: 100, h, l: 98, c: 101, v, rev },
    } })
    rest(102, 5000, null)
    const emit = (m, h, c, v) => stream.emit('SIM', '1', { sym: 'SIM', tf: '1', t_s: minute(m), bar: { t: minute(m) * 1000, o: c, h, l: c, c, v, final: false }, rev: minute(m) * 1000 + 999 })
    emit(720, 103.5, 103, 70)                       // already (partly) inside the base: H only
    const s = registry.getSnapshot(key)
    expect([s.developing.h, s.developing.o, s.developing.v]).toEqual([103.5, 100, 5000])
    emit(722, 104, 103.8, 20)
    expect(registry.getSnapshot(key).developing.v).toBe(5020)
    nowMs = (minute(725) + 10) * 1000
    rest(104, 5100, nowMs)                          // a newer answer: the new base, anchor 727
    emit(726, 104, 103.9, 15)
    expect(registry.getSnapshot(key).developing.v).toBe(5100)
    emit(727, 104.2, 104.1, 10)
    expect(registry.getSnapshot(key).developing.v).toBe(5110)
  })
})
