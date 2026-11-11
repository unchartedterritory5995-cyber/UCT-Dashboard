import { describe, it, expect, beforeEach } from 'vitest'
import {
  toSeries, legacyBars, staticSnapshot, composePoints, chartTimeOf, viewTransformId,
  BASE_MEMO_MAX, _resetAdapterMemos,
} from './adapter'
import { toChartTime, etDateOf } from '../../components/chart/barTime'

// Adapter contracts (all prices synthetic):
//  A1  chart time is converted per bar, DST-correct; D/W/M strings pass through untouched.
//  A2  SPLIT TRANSPARENCY: where the store draws the sealed/developing line never changes
//      the composed series — base ⊕ tail ≡ the same bars with no developing bar, for any
//      view (ETH/RTH, HA, replayIndex, replayCutoff). Tail times are ≥ the last base time.
//  A3  legacyBars is today's {t,o,h,l,c,v} array, identity-stable per snapshot.
//  A4  memo invalidation: (key, baseRev, vtid) is the identity; a new baseRev or a new
//      bars array always recomputes; the memo is bounded.
//  A5  staticSnapshot is identity-stable per array and repaints on a new array.

const rng = (seed) => () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
const etUnix = (y, mo, d, h, m) => {
  const wall = Date.UTC(y, mo - 1, d, h, m) / 1000
  return toChartTime(wall + 14400) === wall ? wall + 14400 : wall + 18000
}
const bar = (t, r) => { const o = 20 + r(), c = 20 + r(); return { t, o, h: Math.max(o, c) + r() * 0.1, l: Math.min(o, c) - r() * 0.1, c, v: Math.floor(r() * 1000) } }

function intradaySeries(r, tf = '5') {
  const step = Number(tf) * 60
  const out = []
  for (const [mo, d] of [[10, 29], [10, 30], [11, 2], [11, 3]]) {
    for (let t = etUnix(2026, mo, d, 4, 0); t < etUnix(2026, mo, d, 20, 0); t += step) if (r() < 0.9) out.push(bar(t, r))
  }
  return out
}
function dailySeries(r, n = 120) {
  const out = []
  let d = Date.UTC(2026, 3, 1)
  while (out.length < n) { const wd = new Date(d).getUTCDay(); if (wd && wd !== 6) out.push(bar(new Date(d).toISOString().slice(0, 10), r)); d += 86400000 }
  return out
}
const snap = (key, sealed, dev, baseRev = 1, devRev = 1) => Object.freeze({ key, bars: sealed, developing: dev, baseRev, devRev })
const composed = (r) => ({ c: composePoints(r.base.candles, r.tail.candles), v: composePoints(r.base.volume, r.tail.volume), l: composePoints(r.base.closes, r.tail.closes) })

beforeEach(() => _resetAdapterMemos())

describe('A1 chart time', () => {
  it('per-bar ET offset: 09:30 EDT (Oct 30) and 09:30 EST (Nov 2) both label 09:30', () => {
    for (const [mo, d] of [[10, 30], [11, 2]]) {
      const t = etUnix(2026, mo, d, 9, 30)
      expect(((chartTimeOf(t) % 86400) + 86400) % 86400).toBe(9.5 * 3600)
    }
  })
  it('D/W/M strings pass through; a unix D/W/M bar (store unit: 00:00 UTC of the label date) keeps its label', () => {
    expect(chartTimeOf('2026-11-10')).toBe('2026-11-10')
    const r = rng(1)
    for (const [tf, label] of [['D', '2026-11-10'], ['W', '2026-11-13'], ['M', '2026-11-01']]) {
      const t = Date.UTC(...label.split('-').map((x, i) => Number(x) - (i === 1 ? 1 : 0))) / 1000
      const s = toSeries(snap('X_' + tf, [bar(t, r)], null), { tf })
      expect(s.base.candles[0].time).toBe(label)
      expect(legacyBars(snap('X_' + tf, [bar(t, r)], null))[0].t).toBe(label)
    }
  })
})

describe('A2 split transparency (property)', () => {
  for (const seed of [3, 17, 256, 4096]) {
    it(`seed=${seed}`, () => {
      const r = rng(seed)
      for (let k = 0; k < 40; k++) {
        const tf = r() < 0.5 ? '5' : 'D'
        const all = tf === 'D' ? dailySeries(r) : intradaySeries(r)
        const view = {
          tf,
          showExtended: r() < 0.5,
          heikinAshi: r() < 0.5,
          replayIndex: r() < 0.3 ? Math.floor(r() * all.length) : null,
          replayCutoff: r() < 0.2 ? (tf === 'D' ? all[Math.floor(r() * all.length)].t : etDateOf(all[Math.floor(r() * all.length)].t)) : null,
        }
        const whole = composed(toSeries(snap(`S${k}_${tf}`, all, null, 1), view))
        const split = toSeries(snap(`S${k}_${tf}`, all.slice(0, -1), { ...all[all.length - 1], rev: 3, src: 'push' }, 2), view)
        expect(composed(split)).toEqual(whole)
        const lastBase = split.base.candles[split.base.candles.length - 1]
        for (const p of split.tail.candles) if (lastBase) expect(p.time >= lastBase.time).toBe(true)
        expect(split.tail.candles.length).toBeLessThanOrEqual(2)
        // filteredBars ≡ today's filteredBars (no session candle in this view)
        expect(split.filteredBars().map(b => b.t)).toEqual(toSeries(snap(`S${k}_${tf}`, all, null, 1), view).filteredBars().map(b => b.t))
      }
    })
  }
})

describe('A3 legacyBars', () => {
  it('sealed + developing in {t,o,h,l,c,v}; identity-stable per snapshot; sealed array reused', () => {
    const r = rng(2)
    const all = intradaySeries(r)
    const s = snap('X_5', all.slice(0, -1), { ...all[all.length - 1], rev: 9, src: 'server' })
    const a = legacyBars(s)
    expect(a).toEqual(all)
    expect(Object.keys(a[a.length - 1]).sort()).toEqual(['c', 'h', 'l', 'o', 't', 'v'])
    expect(legacyBars(s)).toBe(a)
    expect(a[0]).toBe(s.bars[0])   // no per-bar copy on intraday
    expect(legacyBars(snap('X_5', s.bars, null))).toBe(s.bars)
  })
  it('a developing bar not newer than the last sealed bar is not a candle (store S3)', () => {
    const r = rng(3)
    const all = dailySeries(r, 10)
    const s = snap('X_D', all, { ...all[all.length - 1] })
    expect(legacyBars(s)).toEqual(all)
    expect(toSeries(s, { tf: 'D' }).tail.candles).toEqual([])
  })
})

describe('A4 memo invalidation', () => {
  it('(key, baseRev, vtid) identity → same base; baseRev bump, new bars array or a view change → recomputed', () => {
    const r = rng(4)
    const all = intradaySeries(r)
    const sealed = all.slice(0, -1)
    const v = { tf: '5', showExtended: true }
    const a = toSeries(snap('X_5', sealed, all[all.length - 1], 1, 1), v)
    const b = toSeries(snap('X_5', sealed, { ...all[all.length - 1], c: 1 }, 1, 2), v)   // devRev only
    expect(b.base.candles).toBe(a.base.candles)
    expect(b.tail.candles).not.toEqual(a.tail.candles)
    const c = toSeries(snap('X_5', sealed, all[all.length - 1], 2, 2), v)
    expect(c.base.candles).not.toBe(a.base.candles)
    const changed = sealed.map((x, i) => (i === 3 ? { ...x, c: x.c + 1 } : x))
    const d = toSeries(snap('X_5', changed, all[all.length - 1], 2, 2), v)   // same baseRev, new array (defensive)
    expect(d.base.candles[3].close).toBe(changed[3].c)
    const e = toSeries(snap('X_5', changed, all[all.length - 1], 2, 2), { ...v, heikinAshi: true })
    expect(e.vtid).not.toBe(d.vtid)
    expect(e.base.candles).not.toBe(d.base.candles)
  })
  it('bounded: more than BASE_MEMO_MAX keys evicts the oldest (recompute, never stale)', () => {
    const r = rng(5)
    const sealed = dailySeries(r, 5)
    const first = toSeries(snap('K0_D', sealed, null), { tf: 'D' })
    for (let i = 1; i <= BASE_MEMO_MAX + 2; i++) toSeries(snap(`K${i}_D`, sealed, null), { tf: 'D' })
    const again = toSeries(snap('K0_D', sealed, null), { tf: 'D' })
    expect(again.base.candles).not.toBe(first.base.candles)
    expect(again.base.candles).toEqual(first.base.candles)
  })
  it('viewTransformId ignores the session candle inputs (tail-only) and nothing else', () => {
    const base = { tf: 'D', showExtended: false, heikinAshi: false, replayIndex: null, replayCutoff: null }
    expect(viewTransformId({ ...base, sessionCandle: { curTime: 'x', extPrice: 1 } })).toBe(viewTransformId(base))
    for (const k of ['tf', 'showExtended', 'heikinAshi', 'replayIndex', 'replayCutoff']) {
      const alt = { ...base, [k]: k === 'tf' ? '5' : k === 'replayIndex' ? 3 : k === 'replayCutoff' ? '2026-01-01' : true }
      expect(viewTransformId(alt)).not.toBe(viewTransformId(base))
    }
  })
})

describe('A5 staticSnapshot (barsOverride consumers)', () => {
  it('identity-stable per array, frozen, no developing; a new array is a new baseRev', () => {
    const r = rng(6)
    const bars = dailySeries(r, 30)
    const a = staticSnapshot(bars, { key: 'MB', tf: 'D' })
    expect(staticSnapshot(bars, { key: 'MB', tf: 'D' })).toBe(a)
    expect(Object.isFrozen(a)).toBe(true)
    expect(a.developing).toBe(null)
    const b = staticSnapshot([...bars], { key: 'MB', tf: 'D' })
    expect(b.baseRev).not.toBe(a.baseRev)
    expect(composed(toSeries(a, { tf: 'D' })).c).toEqual(bars.map(x => ({ time: x.t, open: x.o, high: x.h, low: x.l, close: x.c })))
  })
})
