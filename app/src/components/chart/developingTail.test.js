import { describe, it, expect } from 'vitest'
import { composeDevelopingTail, aggregateToTf } from './developingTail'
import { bucketStartUnix } from './barTime'

// Synthetic 1m truth for Wed 2026-11-11 (EST, UTC-5) RTH from 09:30 up to `asOf`.
const et = (h, m) => Math.floor(Date.UTC(2026, 10, 11, h + 5, m) / 1000)
const truth = (asOf) => {
  const out = []
  for (let t = et(9, 30); t <= asOf && t < et(16, 0); t += 60) {
    const k = (t / 60) % 89
    const o = 30 + (k % 11) * 0.1, c = o + ((k % 3) - 1) * 0.05
    out.push({ t, o, h: Math.max(o, c) + 0.02 + (k % 4) * 0.01, l: Math.min(o, c) - 0.02 - (k % 5) * 0.01, c, v: 10 + k })
  }
  return out
}
const rng = (seed) => () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }

describe('composeDevelopingTail — INVARIANT: the composed series equals the server aggregation', () => {
  it('for random (now, cache cut, source tf, target tf), every composed bucket equals agg(truth)', () => {
    const r = rng(42)
    let composed = 0
    for (let n = 0; n < 400; n++) {
      const now = et(9, 31) + Math.floor(r() * (6 * 3600 + 25 * 60))
      const T = ['5', '15', '30', '60'][Math.floor(r() * 4)]
      const opts = ['1', '5', '15', '30'].filter(s => Number(s) < Number(T) && Number(T) % Number(s) === 0)
      const S = opts[Math.floor(r() * opts.length)]
      const cut = et(9, 30) + Math.floor(r() * (now - et(9, 30)))
      const base = aggregateToTf(truth(cut), T)
      const src = aggregateToTf(truth(now), S)
      const out = composeDevelopingTail(base, T, [{ tf: S, bars: src }], { nowSec: now + 30 })
      if (out === base) continue
      composed++
      expect(out).toEqual(aggregateToTf(truth(now), T))
    }
    expect(composed).toBeGreaterThan(200)
  })

  it('refuses a source that is NOT current, does not reach back to the cut, or does not divide the target', () => {
    const now = et(12, 47)
    const base = aggregateToTf(truth(et(11, 40)), '15')
    // stale source (ends 12:30)
    expect(composeDevelopingTail(base, '15', [{ tf: '5', bars: aggregateToTf(truth(et(12, 30)), '5') }], { nowSec: now })).toBe(base)
    // source that starts after the cut
    expect(composeDevelopingTail(base, '15', [{ tf: '5', bars: aggregateToTf(truth(now), '5').filter(b => b.t > et(12, 0)) }], { nowSec: now })).toBe(base)
    // coarser / non-dividing source
    expect(composeDevelopingTail(base, '15', [{ tf: '30', bars: aggregateToTf(truth(now), '30') }], { nowSec: now })).toBe(base)
    expect(composeDevelopingTail(base, '5', [{ tf: '5', bars: aggregateToTf(truth(now), '5') }], { nowSec: now })).toBe(base)
  })

  it('60m follows the TradingView session grid (09:30, 10:30 … 15:30 half bar)', () => {
    const now = et(15, 50)
    const base = aggregateToTf(truth(et(13, 0)), '60')
    const out = composeDevelopingTail(base, '60', [{ tf: '5', bars: aggregateToTf(truth(now), '5') }], { nowSec: now })
    expect(out.map(b => b.t)).toEqual([9.5, 10.5, 11.5, 12.5, 13.5, 14.5, 15.5].map(h => et(Math.floor(h), (h % 1) * 60)))
    expect(out.every(b => bucketStartUnix(b.t, 60, { grid: 'session' }) === b.t)).toBe(true)
  })
})
