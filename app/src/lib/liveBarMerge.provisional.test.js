import { describe, it, expect } from 'vitest'
import { mergePushBar, reconcileWithServerTail, mergeRegistryMinute, provisionalOpen, foldPrice } from './liveBarMerge'

// I6 — a provisional value never locks. Property form: whatever ticks a fallback writer
// folds into a provisionally-opened bucket first, the first authoritative bucket-to-date
// observation fully determines open/high/low; after that only authoritative widening applies.
const rng = (seed) => () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
const T0 = 1000 * 300

describe('liveBarMerge I6 (provisional never locks)', () => {
  it('push: for any provisional tick history, the first push frame sets O/H/L exactly', () => {
    const r = rng(9)
    for (let n = 0; n < 300; n++) {
      let bar = provisionalOpen(T0, 20 + r())
      for (let k = Math.floor(r() * 6); k > 0; k--) bar = foldPrice(bar, 19 + r() * 3, null, '5').bar
      expect(bar.provisional).toBe(true)
      const o = 19.5 + r(), h = 21 + r(), l = 19 - r(), c = l + (h - l) * r()
      const m = mergePushBar(bar, { time: T0, open: o, high: h, low: l, close: c, volume: 10 }, { tf: '5' })
      expect(m.kind).toBe('update')
      expect(m.bar).toMatchObject({ open: o, high: h, low: l, close: c })
      expect(m.bar.provisional).toBeUndefined()
      // …and from then on open is set once and H/L only widen
      const m2 = mergePushBar(m.bar, { time: T0, open: o + 0.3, high: h - 0.1, low: l + 0.1, close: c, volume: 11 }, { tf: '5' })
      expect(m2.bar).toMatchObject({ open: o, high: h, low: l })
    }
  })

  it('poll: the fetched bucket replaces provisional O/H/L; the live close stands and may only widen', () => {
    const live = { ...provisionalOpen(T0, 21.0) }
    const { bar } = reconcileWithServerTail(live, { time: T0, open: 20.0, high: 20.8, low: 19.5, close: 20.7, volume: 5 }, { periodSec: 300 })
    expect(bar).toMatchObject({ open: 20.0, high: 21.0, low: 19.5, close: 21.0 })
    expect(bar.provisional).toBeUndefined()
    // a NON-provisional live bar keeps its widened range (I1)
    const { bar: b2 } = reconcileWithServerTail({ time: T0, open: 20, high: 22, low: 19, close: 21 }, { time: T0, open: 20.0, high: 20.8, low: 19.5, close: 20.7 }, { periodSec: 300 })
    expect(b2).toMatchObject({ high: 22, low: 19 })
  })

  it('registry minute: a partial (joined mid-minute) candle is provisional; a full one replaces a provisional bar', () => {
    const p = mergeRegistryMinute(null, { time: T0, o: 20.4, h: 20.5, l: 20.3, c: 20.45, v: 3, partial: true })
    expect(p.provisional).toBe(true)
    const a = mergeRegistryMinute(provisionalOpen(T0, 20.4), { time: T0, o: 20.0, h: 20.6, l: 19.9, c: 20.5, v: 9, partial: false })
    expect(a).toMatchObject({ open: 20.0, high: 20.6, low: 19.9, close: 20.5 })
    expect(a.provisional).toBeUndefined()
    // a partial registry candle never overrides an authoritative held open
    const k = mergeRegistryMinute({ time: T0, open: 19.8, high: 20.7, low: 19.7, close: 20.1 }, { time: T0, o: 20.4, h: 20.5, l: 20.3, c: 20.45, v: 3, partial: true })
    expect(k).toMatchObject({ open: 19.8, high: 20.7, low: 19.7 })
    expect(k.provisional).toBeUndefined()
  })
})

describe('I6 poll: only the OPEN is replaced; observed highs/lows survive a lagging snapshot', () => {
  it('a high/low the live bar printed after its provisional open is kept', () => {
    let live = provisionalOpen(T0, 20.5)
    live = foldPrice(live, 21.2, null, '5').bar      // traded up after we joined
    live = foldPrice(live, 20.9, null, '5').bar
    const { bar } = reconcileWithServerTail(live, { time: T0, open: 20.0, high: 20.8, low: 19.7, close: 20.6 }, { periodSec: 300 })
    expect(bar).toMatchObject({ open: 20.0, high: 21.2, low: 19.7, close: 20.9 })
    expect(bar.provisional).toBeUndefined()
  })
})
