// liveFeed.js — ordering (push final vs poll vs tick) over P2a's seeded sessions, the tick
// fallback gate (S6), one tick source at a time, and the D/W/M fold of the 1m stream.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { reduce, initialState, isSealedRow, bucketEnd, inSealedSpan } from './reducer'
import { createRegistry } from './registry'
import { createLiveFeed, foldMinute, CANDLE_ACTIVE_MS } from './liveFeed'
import { forSeeds, simulateIntraday, withDuplicates, shuffled, etUnix, rng } from './__fixtures__/seededSeries'
import { keyOf } from './types'
import { bucketStartUnix } from '../../components/chart/barTime'

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
  const live = createLiveFeed({ registry, stream, candle, prices, now: () => nowMs })
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
    const live = createLiveFeed({ registry, stream, candle, prices, now: () => clock })
    live.attach(key)
    registry.dispatch(key, { type: 'rest-full', payload: { bars: [{ t: nowMs / 1000 - 420, o: 100, h: 101, l: 99, c: 100, v: 5 }], contract: 1, grid: 'eth-clock', cache_key: 'b1:SIM:5:eth-clock', series_rev: 1, history_rev: 1, complete_through: null } })
    candle.tick('SIM', 100.4, clock)
    const a = registry.getSnapshot(key)
    expect(a.developing?.c).toBe(100.4)
    prices.set('SIM', 100.9)                               // the candle ticked < CANDLE_ACTIVE_MS ago
    expect(registry.getSnapshot(key)).toBe(a)
    clock += CANDLE_ACTIVE_MS + 1
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

describe('D/W/M fold of the 1m stream', () => {
  const day = '2026-11-10'
  const dayT = Date.UTC(2026, 10, 10) / 1000
  const minute = (m) => etUnix(day, m)

  it(`property: folded period bar keeps open, H↑ L↓ V↑, and equals base ∪ minutes since the base (${N} seeds)`, () => {
    forSeeds(N, 160000, (r) => {
      const baseMin = r.int(575, 900)                       // base read mid-session
      const base = { t: dayT, o: 100, h: 102, l: 98, c: 101, v: 5000, rev: minute(baseMin) * 1000 + r.int(0, 59_000), src: 'server' }
      const st = { base, minutes: new Map(), rev: null }
      let px = 101, prev = null
      const finalMin = new Map()
      const n = r.int(1, 40)
      for (let i = 0; i < n; i++) {
        const m = r.int(baseMin - 3, Math.min(baseMin + 60, 959))
        const t = minute(m)
        px = Math.max(1, px * (1 + r.float(-0.003, 0.003)))
        const cur = finalMin.get(t) || { h: px, l: px, v: 0 }
        const b = { t, o: px, h: Math.max(cur.h, px), l: Math.min(cur.l, px), c: Math.round(px * 100) / 100, v: cur.v + r.int(1, 50) }
        finalMin.set(t, b)
        const f = foldMinute(st, b, 'D', b.t * 1000)
        if (!f) continue
        const fb = f.bar
        check(fb.o === base.o, 'fold moved the open')
        check(fb.h >= base.h && fb.l <= base.l, 'fold shrank the base range')
        if (prev) {
          check(fb.h >= prev.h && fb.l <= prev.l, 'fold H/L not monotone')
          check(fb.v >= prev.v, 'fold volume fell')
        }
        check(fb.l <= fb.c && fb.c <= fb.h, 'fold OHLC inconsistent')
        prev = fb
      }
      if (prev) {
        const baseMinStart = Math.floor(base.rev / 60000) * 60
        let v = base.v
        for (const [t, b] of finalMin) if (t > baseMinStart && t >= minute(570) && t < minute(960)) v += b.v
        check(prev.v === v, () => `fold volume ${prev.v} != base + minutes since ${v}`)
      }
    })
  })

  it('ignores extended-hours minutes, other periods, and minutes wholly inside the base', () => {
    const base = { t: dayT, o: 100, h: 102, l: 98, c: 101, v: 5000, rev: minute(700) * 1000 + 30_000, src: 'server' }
    const st = { base, minutes: new Map(), rev: null }
    expect(foldMinute(st, { t: minute(500), o: 1, h: 200, l: 1, c: 150, v: 9 }, 'D', 1)).toBe(null)     // pre-market
    expect(foldMinute(st, { t: minute(600) + 86400, o: 1, h: 200, l: 1, c: 150, v: 9 }, 'D', 1)).toBe(null)   // tomorrow
    expect(foldMinute(st, { t: minute(650), o: 1, h: 200, l: 1, c: 150, v: 9 }, 'D', 1)).toBe(null)     // before the base
    const f = foldMinute(st, { t: minute(700), o: 101, h: 103, l: 100, c: 102, v: 40 }, 'D', 2)        // the base's own minute
    expect(f.bar.h).toBe(103)
    expect(f.bar.v).toBe(5000)                                                                       // never counted twice
  })

  it('through the feed: a D store folds 1m frames onto the SERVER developing bar and rebases on each REST answer', () => {
    const key = keyOf({ sym: 'SIM', tf: 'D' })
    const nowMs = (minute(720) + 30) * 1000
    vi.setSystemTime(nowMs)
    const registry = createRegistry({ ctx: () => ({ nowMs }) })
    const stream = fakeStream(), candle = fakeCandle(), prices = fakePrices()
    const live = createLiveFeed({ registry, stream, candle, prices, now: () => nowMs })
    live.attach(key)
    const rest = (h, v, rev) => registry.dispatch(key, { type: 'rest-full', payload: {
      bars: [{ t: '2026-11-09', o: 90, h: 95, l: 89, c: 94, v: 9000 }, { t: day, o: 100, h, l: 98, c: 101, v }],
      contract: 1, grid: 'plain', cache_key: 'b1:SIM:D:plain', series_rev: rev, history_rev: 1, complete_through: null,
      developing: { t: day, o: 100, h, l: 98, c: 101, v, rev },
    } })
    rest(102, 5000, minute(719) * 1000)
    const emit = (m, h, c, v) => stream.emit('SIM', '1', { sym: 'SIM', tf: '1', t_s: minute(m), bar: { t: minute(m) * 1000, o: c, h, l: c, c, v, final: false }, rev: minute(m) * 1000 + 999 })
    emit(720, 103.5, 103, 70)
    let s = registry.getSnapshot(key)
    expect(s.developing.h).toBe(103.5)
    expect(s.developing.o).toBe(100)
    expect(s.developing.v).toBe(5070)
    emit(721, 104, 103.8, 20)
    expect(registry.getSnapshot(key).developing.v).toBe(5090)
    // a newer REST answer is the new base: the minutes it already holds are not re-added
    rest(104, 5100, minute(722) * 1000)
    emit(722, 104, 103.9, 15)
    s = registry.getSnapshot(key)
    expect(s.developing.v).toBe(5100)
    emit(723, 104.2, 104.1, 10)
    expect(registry.getSnapshot(key).developing.v).toBe(5110)
    expect(bucketStartUnix(minute(723), 1)).toBe(minute(723))
  })
})
