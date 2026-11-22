import { describe, it, expect, beforeEach } from 'vitest'
import { createFakeChart } from './testing/fakeLwc'
import { createDiffRenderer, createSeriesPainter } from './diffRenderer'
import { toSeries, composePoints, _resetAdapterMemos } from './adapter'
import { rightMarginBars } from './framing'

// Framing against a time scale that indexes the UNION of all series' times (as LWC does),
// the fake LWC's strictness, and the session-preview tail through the renderer.
// All prices synthetic.

const T0 = Math.floor(Date.UTC(2026, 10, 10, 14, 30) / 1000)   // 09:30 ET
const bars = (n, step, t0 = T0, k = 0) => Array.from({ length: n }, (_, i) => {
  const o = 30 + ((i + k) % 11) * 0.1, c = o + 0.05
  return { t: t0 + i * step, o, h: c + 0.1, l: o - 0.1, c, v: 100 + i }
})
const snap = (key, all, baseRev = 1) => Object.freeze({ key, bars: all.slice(0, -1), developing: { ...all[all.length - 1], rev: 1, src: 'server' }, baseRev, devRev: 1 })

function setup() {
  const chart = createFakeChart()
  const candle = chart.addSeries('candle')
  const volume = chart.addSeries('volume')
  const compare = chart.addSeries('compare')
  const renderer = createDiffRenderer({ timeScale: chart.timeScale(), candle, volume, defaultVisibleBars: 65, plotWidthPx: chart.width })
  return { chart, candle, volume, compare, renderer }
}
// A compare/overlay series holding EXTRA interior times the candles do not have.
const overlayInput = (res, key) => {
  const c = composePoints(res.base.candles, res.tail.candles)
  const pts = []
  for (let i = 0; i < c.length; i++) {
    pts.push({ time: c[i].time, value: i })
    if (i < c.length - 1 && i % 3 === 0) pts.push({ time: c[i].time + 30, value: i + 0.5 })   // off-grid interior
  }
  return { key, frameId: key, vtid: 'cmp', baseRev: res.baseRev, base: pts, tail: [] }
}

beforeEach(() => _resetAdapterMemos())

describe('K1 with overlay times in the index space', () => {
  it('the newest candle is framed from the time scale, not the candle count (newest x invariant)', () => {
    const { chart, candle, compare, renderer } = setup()
    const a = toSeries(snap('AAA_5', bars(300, 300)), { tf: '5', showExtended: true })
    renderer.render(a, { overlays: [{ id: 'cmp', series: compare, input: overlayInput(a, 'AAA_5') }] })
    const before = chart.frame(candle)
    // The control: the count-based index is wrong here (the overlay added interior slots).
    expect(chart.timeScale().timeToIndex(before.time)).not.toBe(candle.data().length - 1)
    for (const [key, n, step] of [['BBB_1', 500, 60], ['CCC_15', 120, 900], ['AAA_5', 300, 300]]) {
      const r = toSeries(snap(key, bars(n, step, T0, n)), { tf: key.split('_')[1], showExtended: true })
      const out = renderer.render(r, { overlays: [{ id: 'cmp', series: compare, input: overlayInput(r, key) }] })
      expect(out.range).not.toBe(null)
      const f = chart.frame(candle)
      expect({ key, x: f.x, sp: f.sp }).toEqual({ key, x: before.x, sp: before.sp })
    }
  })

  it('reserve keeps that many slots between the newest candle and the margin', () => {
    const { chart, candle, renderer } = setup()
    const r = toSeries(snap('AAA_5', bars(200, 300)), { tf: '5', showExtended: true })
    const out = renderer.render(r, { reserve: 2 })
    const idx = chart.timeScale().timeToIndex(chart.frame(candle).time)
    expect(out.range.to).toBeCloseTo(idx + 2 + rightMarginBars(65, 600), 12)
  })

  it('K2 with overlay times: a prepend moves no on-screen bar', () => {
    const { chart, candle, compare, renderer } = setup()
    const all = bars(400, 300)
    const r1 = toSeries(snap('AAA_5', all.slice(150), 1), { tf: '5', showExtended: true })
    renderer.render(r1, { overlays: [{ id: 'cmp', series: compare, input: overlayInput(r1, 'AAA_5') }] })
    const probe = candle.data()[40].time
    const x0 = chart.xOfTime(probe), f0 = chart.frame(candle)
    const r2 = toSeries(snap('AAA_5', all, 2), { tf: '5', showExtended: true })
    const out = renderer.render(r2, { overlays: [{ id: 'cmp', series: compare, input: overlayInput(r2, 'AAA_5') }] })
    expect(out.candle.op).toBe('prepend')
    expect(chart.xOfTime(probe)).toBe(x0)
    expect(chart.frame(candle).x).toBe(f0.x)
  })
})

describe('fake LWC strictness (so the renderer tests prove something)', () => {
  it('setData rejects unsorted or duplicate times, like LWC', () => {
    const s = createFakeChart().addSeries('s')
    expect(() => s.setData([{ time: 2, value: 1 }, { time: 1, value: 1 }])).toThrow()
    expect(() => s.setData([{ time: 1, value: 1 }, { time: 1, value: 2 }])).toThrow()
  })
  it('a historical update on a time the series lacks corrupts a row silently (LWC 5.2) — the painter never issues one', () => {
    const chart = createFakeChart(); const s = chart.addSeries('s')
    s.setData([{ time: 60, value: 1 }, { time: 180, value: 2 }])
    s.update({ time: 120, value: 9 }, true)
    expect(s.corrupted).toBe(true)
    // The painter: a correction at a time the series does not hold is a setData.
    const s2 = chart.addSeries('s2'); const p = createSeriesPainter(s2)
    const ids = (b) => ({ key: 'K', frameId: 'K', vtid: 'v', baseRev: b })
    p.paint({ ...ids(1), base: [{ time: 60, value: 1 }, { time: 180, value: 2 }, { time: 240, value: 3 }], tail: [] })
    const r = p.paint({ ...ids(2), base: [{ time: 60, value: 1 }, { time: 120, value: 9 }, { time: 240, value: 3 }], tail: [] })
    expect(r.op).toBe('rebase')
    expect(s2.corrupted).toBe(false)
  })
})

describe('session-preview tail through the renderer (D/W/M extended preview)', () => {
  const daily = (n) => Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(2026, 6, 1) + i * 86400000).toISOString().slice(0, 10)
    return { t: d, o: 40, h: 41, l: 39, c: 40.5, v: 1000 + i }
  })
  it('ext-price ticks are tail update()s only; a next-day preview candle appends; the frame never moves', () => {
    const { chart, candle, volume, renderer } = setup()
    const all = daily(120)
    const s = Object.freeze({ key: 'AAA_D', bars: all, developing: null, baseRev: 1, devRev: 0 })
    const last = all[all.length - 1].t
    renderer.render(toSeries(s, { tf: 'D' }))
    const f0 = chart.frame(candle)
    candle.calls.length = 0; volume.calls.length = 0
    // Post-market: the preview extends the newest bar in place (same time).
    for (const px of [40.7, 41.4, 38.9]) {
      const r = toSeries(s, { tf: 'D', sessionCandle: { curTime: last, extAgg: { open: 40.5, high: 41.5, low: 38.8, close: px, volume: 50 }, extPrice: px } })
      expect(r.sessionApplied).toBe(true)
      renderer.render(r)
      expect(candle.data()).toEqual(composePoints(r.base.candles, r.tail.candles))
      expect(chart.frame(candle).x).toBe(f0.x)
    }
    expect([...candle.calls, ...volume.calls].every(c => c[0] === 'update')).toBe(true)
    // Pre-market of the next day: the preview is a NEW candle on the right.
    const nextDay = '2026-12-01'
    const r = toSeries(s, { tf: 'D', sessionCandle: { curTime: nextDay, extAgg: null, extPrice: 41 } })
    renderer.render(r)
    expect(candle.data()[candle.data().length - 1].time).toBe(nextDay)
    expect(candle.data()).toEqual(composePoints(r.base.candles, r.tail.candles))
    expect(candle.calls.filter(c => c[0] === 'setData')).toEqual([])
    // Preview switched off: the painted preview point must vanish → one correct setData.
    renderer.render(toSeries(s, { tf: 'D' }))
    expect(candle.data()).toEqual(toSeries(s, { tf: 'D' }).base.candles)
    expect(candle.corrupted || volume.corrupted).toBe(false)
  })
})
