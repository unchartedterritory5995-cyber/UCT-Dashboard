import { describe, it, expect } from 'vitest'
import { mergePushBar, reconcileWithServerTail, foldPrice, provisionalOpen, mergeRegistryMinute, bucketEndTime } from './liveBarMerge'
import { toChartTime } from '../components/chart/barTime'

// I7 / I8 (audit D5 "ghost wicks"), property form over seeded random sequences:
//   I7  a value a FALLBACK writer put on the bar (Writer A/C tick, a registry minute) never
//       survives a later AUTHORITATIVE push frame for the same bucket;
//   I8  once a bucket has CLOSED, the server's bar (or a push final) is the bar — exactly.
// Equivalent to P0b's developingBar.property rails "KNOWN GAP: the first authoritative push
// frame replaces a provisional open / extremes" and "KNOWN GAP (D5)" (PR #1094), with
// provenance tagged the way the writers now tag it.
const rng = (seed) => () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
const r2 = (x) => Math.round(x * 100) / 100
// Wed 2026-11-11 (EST): 5m bucket 12:45 ET.
const T5 = toChartTime(Math.floor(Date.UTC(2026, 10, 11, 17, 45) / 1000))

// a random authoritative bucket-to-date push tape for one 5m bucket (cumulative O/H/L/C)
function pushTape(r) {
  const o = r2(20 + r() * 80)
  let h = o, l = o, c = o
  const out = []
  for (let k = 1 + Math.floor(r() * 8); k > 0; k--) {
    c = r2(c * (1 + (r() - 0.5) * 0.01)); h = Math.max(h, c); l = Math.min(l, c)
    out.push({ time: T5, open: o, high: h, low: l, close: c, volume: out.length * 10 + 10 })
  }
  return out
}

describe('I7: fallback values never survive an authoritative push frame', () => {
  it('provisional open/extremes seeded by a fallback writer are replaced by the first push frame', () => {
    const r = rng(20000)
    for (let n = 0; n < 300; n++) {
      const tape = pushTape(r)
      const ghost = r2(tape[0].open * (1 + 0.01 + r() * 0.04))
      const m = mergePushBar(provisionalOpen(T5, ghost), tape[0], { tf: '5' })
      expect(m.bar).toMatchObject({ open: tape[0].open, high: tape[0].high, low: tape[0].low })
    }
  })

  it('after any interleaving of fallback ghost prints and push frames, every push frame leaves exactly the authoritative bucket-to-date range', () => {
    const r = rng(20001)
    for (let n = 0; n < 300; n++) {
      const tape = pushTape(r)
      let bar = mergePushBar(null, tape[0], { tf: '5' }).bar
      for (const f of tape.slice(1)) {
        // a burst of fallback (unfiltered) prints, some far outside the true range
        for (let k = Math.floor(r() * 4); k > 0; k--) {
          const ghost = r2(bar.close * (1 + (r() - 0.5) * 0.12))
          bar = foldPrice(bar, ghost, null, '5').bar
        }
        bar = mergePushBar(bar, f, { tf: '5' }).bar
        expect([bar.open, bar.high, bar.low, bar.close]).toEqual([f.open, f.high, f.low, f.close])
      }
    }
  })

  it('a registry (fallback) minute that opened the bucket vouches only for its open', () => {
    const T1 = T5
    const reg = mergeRegistryMinute(null, { time: T1, o: 20.0, h: 21.5, l: 19.0, c: 20.2, v: 5 })
    const m = mergePushBar(reg, { time: T1, open: 20.0, high: 20.4, low: 19.9, close: 20.3, volume: 9 }, { tf: '1' })
    expect(m.bar).toMatchObject({ open: 20.0, high: 20.4, low: 19.9, close: 20.3 })
  })
})

describe('I8: a closed bucket is the server\'s bar, exactly', () => {
  it('a ghost-widened live bar reconciled after the bucket END becomes the server bar', () => {
    const r = rng(21000)
    const end = bucketEndTime(T5, '5')
    for (let n = 0; n < 300; n++) {
      const tape = pushTape(r)
      const server = { ...tape[tape.length - 1] }
      let live = mergePushBar(null, tape[0], { tf: '5' }).bar
      live = foldPrice(live, r2(server.high * (1.01 + r() * 0.04)), null, '5').bar   // ghost high
      live = foldPrice(live, r2(server.low * (0.95 + r() * 0.04)), null, '5').bar    // ghost low
      const { bar, ahead } = reconcileWithServerTail(live, server, { periodSec: 300, nowChart: end + Math.floor(r() * 7200), tf: '5' })
      expect(ahead).toBe(false)
      expect([bar.open, bar.high, bar.low, bar.close, bar.volume]).toEqual([server.open, server.high, server.low, server.close, server.volume])
    }
  })

  it('CONTROL — while the bucket is still forming, the live range is kept (the snapshot lags)', () => {
    const live = { time: T5, open: 20, high: 20.9, low: 19.5, close: 20.6, volume: 7000 }
    const server = { time: T5, open: 20, high: 20.5, low: 19.8, close: 20.3, volume: 6500 }
    const { bar } = reconcileWithServerTail(live, server, { periodSec: 300, nowChart: T5 + 120, tf: '5' })
    expect(bar).toMatchObject({ open: 20, high: 20.9, low: 19.5, close: 20.6 })
  })

  it('a push FINAL replaces fallback ghosts and nothing after it moves the bar', () => {
    let bar = mergePushBar(null, { time: T5, open: 20, high: 20.2, low: 19.9, close: 20.1, volume: 5 }, { tf: '5' }).bar
    bar = foldPrice(bar, 21.5, null, '5').bar
    const fin = { time: T5, open: 20, high: 20.3, low: 19.8, close: 20.25, volume: 50 }
    bar = mergePushBar(bar, fin, { tf: '5', final: true }).bar
    expect([bar.open, bar.high, bar.low, bar.close]).toEqual([20, 20.3, 19.8, 20.25])
    bar = foldPrice(bar, 22, null, '5').bar
    bar = mergePushBar(bar, { time: T5, open: 20, high: 20.6, low: 19.7, close: 20.5, volume: 60 }, { tf: '5' }).bar
    expect([bar.open, bar.high, bar.low, bar.close]).toEqual([20, 20.3, 19.8, 20.25])
  })
})
