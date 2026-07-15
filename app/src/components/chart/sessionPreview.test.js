import { describe, it, expect } from 'vitest'
import {
  aggregateExtBars,
  applySessionCandle,
  computeSessionTagLines,
  etDateStr,
  etMinutes,
} from './sessionPreview'

// UTC seconds for a given ET wall-clock on Mon 2026-06-15 (EDT = UTC-4).
const etSec = (h, m = 0) => Math.floor(Date.UTC(2026, 5, 15, h + 4, m, 0) / 1000)
const TODAY = '2026-06-15'

describe('ET helpers', () => {
  it('etDateStr / etMinutes convert a UTC second to ET date + minutes', () => {
    expect(etDateStr(etSec(8, 30))).toBe(TODAY)
    expect(etMinutes(etSec(8, 30))).toBe(8 * 60 + 30)
    expect(etMinutes(etSec(16, 0))).toBe(16 * 60)
  })
})

describe('aggregateExtBars — pre-market window (4:00–9:30)', () => {
  const bars = [
    { t: etSec(3, 55), o: 9, h: 9, l: 9, c: 9, v: 100 },   // 3:55 — before window, excluded
    { t: etSec(4, 0), o: 10, h: 11, l: 9.5, c: 10.5, v: 200 },
    { t: etSec(7, 30), o: 10.5, h: 12, l: 10, c: 11.8, v: 300 },
    { t: etSec(9, 25), o: 11.8, h: 11.9, l: 11.5, c: 11.6, v: 150 },
    { t: etSec(9, 35), o: 11.6, h: 13, l: 11.6, c: 12.9, v: 999 }, // RTH — excluded
  ]
  it('aggregates only in-window bars, open=first / high=max / low=min / close=last', () => {
    const a = aggregateExtBars(bars, { session: 'pre', todayEt: TODAY })
    expect(a).toEqual({ open: 10, high: 12, low: 9.5, close: 11.6, volume: 650 })
  })
  it('ignores bars from other days', () => {
    const a = aggregateExtBars(bars, { session: 'pre', todayEt: '2026-06-16' })
    expect(a).toBeNull()
  })
  it('returns null with no bars', () => {
    expect(aggregateExtBars([], { session: 'pre', todayEt: TODAY })).toBeNull()
    expect(aggregateExtBars(null, { session: 'pre', todayEt: TODAY })).toBeNull()
  })
})

describe('aggregateExtBars — post-market window (16:00–20:00)', () => {
  const bars = [
    { t: etSec(15, 55), o: 20, h: 20, l: 20, c: 20, v: 1 },  // RTH — excluded
    { t: etSec(16, 5), o: 20, h: 21, l: 19.8, c: 20.9, v: 500 },
    { t: etSec(18, 0), o: 20.9, h: 22, l: 20.5, c: 21.7, v: 400 },
    { t: etSec(20, 0), o: 21.7, h: 21.7, l: 21.7, c: 21.7, v: 9 }, // 20:00 — boundary excluded
  ]
  it('aggregates the post-market prints', () => {
    const a = aggregateExtBars(bars, { session: 'post', todayEt: TODAY })
    expect(a).toEqual({ open: 20, high: 22, low: 19.8, close: 21.7, volume: 900 })
  })
})

describe('applySessionCandle — daily pre-market appends a NEW candle', () => {
  const rth = [
    { t: '2026-06-11', o: 8, h: 9, l: 7, c: 8.5, v: 1000 },
    { t: '2026-06-12', o: 8.5, h: 10, l: 8, c: 9.0, v: 1200 },  // yesterday
  ]
  const extAgg = { open: 9.2, high: 9.8, low: 9.1, close: 9.6, volume: 300 }
  it('adds a today bar seeded from the pre-market aggregate + live close', () => {
    const out = applySessionCandle(rth, { curTime: TODAY, extAgg, extPrice: 9.7 })
    expect(out).toHaveLength(3)
    expect(out[2]).toEqual({ t: TODAY, o: 9.2, h: 9.8, l: 9.1, c: 9.7, v: 300 })
    // original array untouched
    expect(rth).toHaveLength(2)
  })
  it('live price beyond the aggregate widens high/low', () => {
    const out = applySessionCandle(rth, { curTime: TODAY, extAgg, extPrice: 10.4 })
    expect(out[2].h).toBe(10.4)
    expect(out[2].c).toBe(10.4)
  })
  it('single-point candle when only a live price exists (no bars yet)', () => {
    const out = applySessionCandle(rth, { curTime: TODAY, extAgg: null, extPrice: 9.3 })
    expect(out[2]).toEqual({ t: TODAY, o: 9.3, h: 9.3, l: 9.3, c: 9.3, v: 0 })
  })
})

describe('applySessionCandle — post-market EXTENDS the current bar', () => {
  const rth = [
    { t: '2026-06-12', o: 8.5, h: 10, l: 8, c: 9.0, v: 1200 },
    { t: TODAY, o: 9.0, h: 9.5, l: 8.8, c: 9.4, v: 2000 },  // today's RTH candle
  ]
  const extAgg = { open: 9.4, high: 9.9, low: 9.3, close: 9.8, volume: 400 }
  it('widens today high/low, moves close, keeps open + adds volume', () => {
    const out = applySessionCandle(rth, { curTime: TODAY, extAgg, extPrice: 9.85 })
    expect(out).toHaveLength(2)
    expect(out[1]).toEqual({ t: TODAY, o: 9.0, h: 9.9, l: 8.8, c: 9.85, v: 2400 })
  })
  it('post-market dip below the RTH low widens the low', () => {
    const dip = { open: 9.4, high: 9.4, low: 8.5, close: 8.6, volume: 100 }
    const out = applySessionCandle(rth, { curTime: TODAY, extAgg: dip, extPrice: 8.6 })
    expect(out[1].l).toBe(8.5)
    expect(out[1].c).toBe(8.6)
  })
})

describe('applySessionCandle — guards', () => {
  it('no-op when nothing to add', () => {
    const rth = [{ t: TODAY, o: 1, h: 2, l: 1, c: 1.5, v: 10 }]
    expect(applySessionCandle(rth, { curTime: TODAY, extAgg: null, extPrice: null })).toBe(rth)
  })
  it('no-op when curTime is older than the last bar', () => {
    const rth = [{ t: TODAY, o: 1, h: 2, l: 1, c: 1.5, v: 10 }]
    const out = applySessionCandle(rth, { curTime: '2026-06-10', extAgg: null, extPrice: 1.6 })
    expect(out).toBe(rth)
  })
  it('returns input unchanged when empty', () => {
    expect(applySessionCandle([], { curTime: TODAY, extAgg: null, extPrice: 5 })).toEqual([])
  })
})

describe('computeSessionTagLines', () => {
  const rth = [
    { t: '2026-06-12', o: 8, h: 10, l: 8, c: 9.0, v: 1 },
    { t: TODAY, o: 9, h: 9.5, l: 8.8, c: 9.4, v: 1 },
  ]
  const colors = { upColor: '#0f0', downColor: '#f00', extColor: '#f5a623' }
  it('green tag locked at the last RTH close, colored by day direction', () => {
    const lines = computeSessionTagLines({ rthBars: rth, session: 'post', extPrice: 9.7, ...colors })
    const rthTag = lines.find(l => l._sessionTag === 'rth')
    expect(rthTag.price).toBe(9.4)
    expect(rthTag.color).toBe('#0f0')   // 9.4 >= 9.0 → up
    expect(rthTag.lineVisible).toBe(true)
  })
  it('down day colors the RTH tag with the down color', () => {
    const down = [{ t: '2026-06-12', o: 8, h: 10, l: 8, c: 9.5, v: 1 }, { t: TODAY, o: 9, h: 9.5, l: 8, c: 9.0, v: 1 }]
    const lines = computeSessionTagLines({ rthBars: down, session: 'pre', extPrice: null, ...colors })
    expect(lines.find(l => l._sessionTag === 'rth').color).toBe('#f00')
  })
  it('orange ext tag shows the live ext price, chip-only, titled by session', () => {
    const pre = computeSessionTagLines({ rthBars: rth, session: 'pre', extPrice: 9.7, ...colors })
    const ext = pre.find(l => l._sessionTag === 'ext')
    expect(ext).toMatchObject({ price: 9.7, color: '#f5a623', title: 'Pre', lineVisible: false })
    const post = computeSessionTagLines({ rthBars: rth, session: 'post', extPrice: 9.7, ...colors })
    expect(post.find(l => l._sessionTag === 'ext').title).toBe('Post')
  })
  it('omits the ext tag when there is no live ext price', () => {
    const lines = computeSessionTagLines({ rthBars: rth, session: 'pre', extPrice: null, ...colors })
    expect(lines.some(l => l._sessionTag === 'ext')).toBe(false)
    expect(lines).toHaveLength(1)
  })
})
