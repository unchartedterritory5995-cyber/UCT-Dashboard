import { describe, it, expect, beforeEach } from 'vitest'
import { createFakeChart } from './fakeLwc.testutil'
import { createDiffRenderer, createSeriesPainter, MAX_HISTORICAL_UPDATES } from './diffRenderer'
import { toSeries, composePoints, _resetAdapterMemos } from './adapter'
import { toChartTime } from '../../components/chart/barTime'
import { rightMarginBars, lastCandlePos, frameAfterKeyChange, frameAfterPrepend, xOfLogical } from './framing'

// ─── INVARIANTS (property style, seeded) ───────────────────────────────────────
//  P1  After every render the series hold EXACTLY adapter(base ⊕ tail) — candle + volume.
//  P2  Minimal: a devRev-only change, an append / seal and a ≤MAX_HISTORICAL_UPDATES
//      correction never setData(); a devRev-only change is ≤ 1 update per series.
//      setData happens only on key / view-transform change, prepend or rebase.
//  P3  No update() at a time older than the last painted one, except LWC's historical
//      update on a time the series holds (the fake throws otherwise, like LWC).
//  F1  The newest bar's pixel x and the bar spacing are invariant across key changes.
//  F2  A left prepend moves no on-screen bar (right edge included).
//  F3  No blank frame once something was painted (an empty key change holds).
// All prices synthetic.

const rng = (seed) => () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
const D0 = Date.UTC(2026, 6, 1)
const STEP = { '1': 60, '5': 300, '15': 900 }
// Intraday index → a bar inside 09:00-16:00 ET on a weekday (k business days from Nov 10),
// like real equity data: never the repeated fall-back hour, where two instants share one
// chart time (barTime.js header).
const _bday = (k) => {
  let d = Date.UTC(2026, 10, 10), n = 0
  const dir = k < 0 ? -1 : 1
  while (n !== k) { d += dir * 86400000; const wd = new Date(d).getUTCDay(); if (wd !== 0 && wd !== 6) n += dir }
  return d
}
const _etNine = (dayMs) => { const ms = dayMs + 13 * 3600000; return Math.floor((toChartTime(ms / 1000) === ms / 1000 - 4 * 3600 ? ms : ms + 3600000) / 1000) }
const tOf = (tf, i) => {
  if (tf === 'D') return new Date(D0 + i * 86400000).toISOString().slice(0, 10)
  const perDay = (7 * 3600) / STEP[tf]
  const k = Math.floor(i / perDay)
  return _etNine(_bday(k)) + (i - k * perDay) * STEP[tf]
}
const bar = (tf, i, r) => {
  const o = 50 + (i % 23) * 0.1, c = o + (r() - 0.5) * 0.4
  return { t: tOf(tf, i), o, h: Math.max(o, c) + r() * 0.2, l: Math.min(o, c) - r() * 0.2, c, v: 100 + Math.floor(r() * 900) }
}

// A tiny store stand-in: frozen snapshots with the BARSTORE-SPEC shape, mutations bump
// baseRev (sealed bars) or devRev (developing only).
function makeStore(r) {
  const keys = new Map()
  const st = (key, tf) => {
    if (!keys.has(key)) {
      const n = 80 + Math.floor(r() * 200)
      const sealed = Array.from({ length: n }, (_, i) => bar(tf, i, r))
      keys.set(key, { key, tf, start: 0, sealed, dev: bar(tf, n, r), baseRev: 1, devRev: 1 })
    }
    return keys.get(key)
  }
  const snap = (s) => Object.freeze({
    key: s.key, bars: s.sealed, developing: s.dev ? { ...s.dev, rev: s.devRev, src: 'server' } : null,
    baseRev: s.baseRev, devRev: s.devRev, status: 'current',
  })
  return {
    get: (key, tf) => snap(st(key, tf)),
    tick(key, tf) {
      const s = st(key, tf)
      if (!s.dev) return 'none'
      const c = s.dev.c + (r() - 0.5) * 0.2
      s.dev = { ...s.dev, c, h: Math.max(s.dev.h, c), l: Math.min(s.dev.l, c), v: s.dev.v + Math.floor(r() * 50) }
      s.devRev++
      return 'tick'
    },
    seal(key, tf) {
      const s = st(key, tf)
      const nextI = s.start + s.sealed.length + (s.dev ? 1 : 0)
      if (s.dev) s.sealed = [...s.sealed, s.dev]
      s.dev = r() < 0.85 ? bar(tf, nextI, r) : null
      s.baseRev++
      return 'seal'
    },
    devAgain(key, tf) {   // a new developing bucket opens after a seal left none
      const s = st(key, tf)
      if (s.dev) return 'none'
      s.dev = bar(tf, s.start + s.sealed.length, r)
      s.devRev++
      return 'tick'
    },
    correct(key, tf, k) {
      const s = st(key, tf)
      const idx = new Set()
      while (idx.size < k) idx.add(s.sealed.length - 1 - Math.floor(r() * Math.min(12, s.sealed.length)))
      s.sealed = s.sealed.map((b, i) => (idx.has(i) ? { ...b, c: b.c + 0.01, h: b.h + 0.02 } : b))
      s.baseRev++
      return k <= MAX_HISTORICAL_UPDATES ? 'correct' : 'rebase'
    },
    prepend(key, tf) {
      const s = st(key, tf)
      const add = 20 + Math.floor(r() * 120)
      const older = Array.from({ length: add }, (_, j) => bar(tf, s.start - add + j, r))
      s.start -= add
      s.sealed = [...older, ...s.sealed]
      s.baseRev++
      return 'prepend'
    },
    refresh(key, tf) { st(key, tf).baseRev++; return 'refresh' },   // same bars, new baseRev
  }
}

const KEYS = [['AAA', '1'], ['AAA', '5'], ['AAA', '15'], ['BBB', '5'], ['BBB', 'D'], ['CCC', 'D'], ['CCC', '1']]

function setup() {
  const chart = createFakeChart()
  const candle = chart.addSeries('candle')
  const volume = chart.addSeries('volume')
  const renderer = createDiffRenderer({ timeScale: chart.timeScale(), candle, volume, defaultVisibleBars: 65, plotWidthPx: chart.width })
  return { chart, candle, volume, renderer }
}
const strip = (d) => d.map(p => ({ ...p }))

describe('diffRenderer × fake LWC: random snapshot sequences', () => {
  beforeEach(() => _resetAdapterMemos())

  for (const seed of [1, 7, 42, 1234, 99991]) {
    it(`seed=${seed}: P1 P2 P3 F1 F2 F3 over 400 steps`, () => {
      const r = rng(seed)
      const store = makeStore(r)
      const { chart, candle, volume, renderer } = setup()
      let [sym, tf] = KEYS[0]
      let view = { tf, showExtended: r() < 0.5, heikinAshi: false }
      const key = () => `${sym}_${tf}`
      const paint = () => renderer.render(toSeries(store.get(key(), tf), view))
      paint()
      let painted = false
      const seen = {}
      for (let step = 0; step < 400; step++) {
        const roll = r()
        let kind
        const callsBefore = [candle.calls.length, volume.calls.length]
        const beforeFrame = chart.frame(candle)
        let oldTime = null, oldX = null
        if (roll < 0.40) kind = store.tick(key(), tf)
        else if (roll < 0.55) kind = store.seal(key(), tf)
        else if (roll < 0.60) kind = store.devAgain(key(), tf)
        else if (roll < 0.66) kind = store.correct(key(), tf, 1 + Math.floor(r() * 6))
        else if (roll < 0.70) {
          kind = store.prepend(key(), tf)
          const d = candle.data(); oldTime = d[Math.floor(d.length / 2)]?.time; oldX = chart.xOfTime(oldTime)
        } else if (roll < 0.73) kind = store.refresh(key(), tf)
        else if (roll < 0.76) { view = { ...view, heikinAshi: !view.heikinAshi }; kind = 'vtid' }
        else if (roll < 0.79) {   // user zoom, right-anchored at the policy margin
          const n = candle.data().length, W = 20 + Math.floor(r() * 200)
          chart.timeScale().setVisibleLogicalRange({ from: n - 1 + rightMarginBars(W, chart.width) - W, to: n - 1 + rightMarginBars(W, chart.width) })
          kind = 'zoom'
        } else {
          let next
          do { next = KEYS[Math.floor(r() * KEYS.length)] } while (next[0] === sym && next[1] === tf)
          ;[sym, tf] = next
          view = { ...view, tf, showExtended: r() < 0.5 }
          kind = 'switch'
        }
        if (kind === 'zoom' || kind === 'none') continue
        const zf = chart.frame(candle)
        const res = toSeries(store.get(key(), tf), view)
        const out = renderer.render(res)
        const nC = candle.calls.length - callsBefore[0], nV = volume.calls.length - callsBefore[1]
        const newC = candle.calls.slice(callsBefore[0]), newV = volume.calls.slice(callsBefore[1])
        const ctx = { seed, step, kind, op: out.candle.op }
        // P1
        expect({ ctx, d: strip(candle.data()) }).toEqual({ ctx, d: composePoints(res.base.candles, res.tail.candles) })
        expect({ ctx, d: strip(volume.data()) }).toEqual({ ctx, d: composePoints(res.base.volume, res.tail.volume) })
        // P2
        const sets = [...newC, ...newV].filter(c => c[0] === 'setData').length
        if (kind === 'tick') { expect({ ctx, sets, nC, nV }).toMatchObject({ ctx, sets: 0 }); expect(nC).toBeLessThanOrEqual(1); expect(nV).toBeLessThanOrEqual(1) }
        if (kind === 'seal' || kind === 'refresh') expect({ ctx, sets }).toEqual({ ctx, sets: 0 })
        // A correction is incremental unless Heikin-Ashi is on (an older bar re-derives every later HA bar).
        if (kind === 'correct' && !view.heikinAshi) expect({ ctx, sets }).toEqual({ ctx, sets: 0 })
        if (kind === 'rebase' || (kind === 'correct' && view.heikinAshi)) expect(sets, JSON.stringify(ctx)).toBeLessThanOrEqual(2)
        if (kind === 'refresh') expect({ ctx, nC }).toEqual({ ctx, nC: 0 })
        // A prepend the view filters away entirely (pre-market history in RTH view) changes nothing.
        if (kind === 'prepend') expect({ ctx, op: out.candle.op }).toEqual({ ctx, op: candle.data().length > beforeFrame.n ? 'prepend' : 'noop' })
        if (kind === 'switch' || kind === 'vtid') expect({ ctx, sets }).toEqual({ ctx, sets: 2 })
        // F1: newest bar x + spacing invariant across a key change
        const f = chart.frame(candle)
        if (kind === 'switch' && painted) expect({ ctx, x: f.x, sp: f.sp }).toEqual({ ctx, x: zf.x, sp: zf.sp })
        // F2: prepend moves nothing on screen
        if (kind === 'prepend') {
          expect({ ctx, x: f.x }).toEqual({ ctx, x: beforeFrame.x })
          expect({ ctx, x: chart.xOfTime(oldTime) }).toEqual({ ctx, x: oldX })
        }
        // seal / tick while right-anchored: LWC's shiftVisibleRangeOnNewBar keeps newest x
        if ((kind === 'seal' || kind === 'tick') && !beforeFrame.blank && !f.blank) expect({ ctx, x: f.x }).toEqual({ ctx, x: beforeFrame.x })
        // F3
        expect({ ctx, blank: !!f.blank }).toEqual({ ctx, blank: false })
        painted = true
        seen[kind] = (seen[kind] || 0) + 1
        seen['op:' + out.candle.op] = (seen['op:' + out.candle.op] || 0) + 1
      }
      // Non-vacuous: every mutation kind and every incremental op was exercised.
      for (const k of ['tick', 'seal', 'correct', 'rebase', 'prepend', 'refresh', 'vtid', 'switch', 'op:tail', 'op:append', 'op:correct', 'op:prepend']) expect({ k, n: seen[k] > 0 }).toEqual({ k, n: true })
    })
  }

  it('F3/K4: switching to a key with no bars yet holds the outgoing frame; the real snapshot then frames at the outgoing x', () => {
    const r = rng(5)
    const store = makeStore(r)
    const { chart, candle, renderer } = setup()
    renderer.render(toSeries(store.get('AAA_5', '5'), { tf: '5', showExtended: true }))
    const before = chart.frame(candle)
    const empty = Object.freeze({ key: 'ZZZ_5', bars: [], developing: null, baseRev: 1, devRev: 0, status: 'empty' })
    const out = renderer.render(toSeries(empty, { tf: '5', showExtended: true }))
    expect(out.held).toBe(true)
    expect(chart.frame(candle)).toEqual(before)
    renderer.render(toSeries(store.get('ZZZ_5', '5'), { tf: '5', showExtended: true }))
    const after = chart.frame(candle)
    expect({ x: after.x, sp: after.sp }).toEqual({ x: before.x, sp: before.sp })
    // 'unavailable' may paint an empty series explicitly.
    const out2 = renderer.render(toSeries({ ...empty, key: 'YYY_5' }, { tf: '5', showExtended: true }), { allowEmpty: true })
    expect(out2.held).toBe(false)
    expect(candle.data()).toEqual([])
  })

  it('first paint frames at defaultVisibleBars with the policy right margin (newest candle at lastCandlePos of the plot)', () => {
    const r = rng(9)
    const store = makeStore(r)
    const { chart, candle, renderer } = setup()
    const out = renderer.render(toSeries(store.get('AAA_1', '1'), { tf: '1', showExtended: true }))
    const n = candle.data().length
    expect(out.range).toEqual({ from: n - 1 + rightMarginBars(65, 600) - 65, to: n - 1 + rightMarginBars(65, 600) })
    expect(chart.timeScale().getVisibleLogicalRange()).toEqual(out.range)
  })
})

describe('series painter edge rules', () => {
  const pts = (n, off = 0) => Array.from({ length: n }, (_, i) => ({ time: 1000 + i * 60, value: i + off }))
  const ids = (baseRev, key = 'K') => ({ key, frameId: key, vtid: 'v', baseRev })
  it('a vanished developing point without a base change falls back to setData (never leaves a stale bar)', () => {
    const chart = createFakeChart(); const s = chart.addSeries('s'); const p = createSeriesPainter(s)
    p.paint({ ...ids(1), base: pts(5), tail: [{ time: 1300, value: 9 }] })
    const r = p.paint({ ...ids(1), base: pts(5), tail: [] })
    expect(r.op).toBe('rebase')
    expect(s.data()).toEqual(pts(5))
  })
  it(`more than ${MAX_HISTORICAL_UPDATES} corrected older bars → one setData, not a burst of historical updates`, () => {
    const chart = createFakeChart(); const s = chart.addSeries('s'); const p = createSeriesPainter(s)
    p.paint({ ...ids(1), base: pts(20), tail: [] })
    const fixed = pts(20).map((q, i) => (i >= 10 && i < 16 ? { ...q, value: q.value + 100 } : q))
    s.calls.length = 0
    expect(p.paint({ ...ids(2), base: fixed, tail: [] }).op).toBe('rebase')
    expect(s.calls).toEqual([['setData', 20]])
  })
  it('a correction at a time the series holds uses LWC historical update', () => {
    const chart = createFakeChart(); const s = chart.addSeries('s'); const p = createSeriesPainter(s)
    p.paint({ ...ids(1), base: pts(20), tail: [{ time: 1000 + 20 * 60, value: 1 }] })
    const fixed = pts(20).map((q, i) => (i === 17 ? { ...q, value: -1 } : q))
    s.calls.length = 0
    expect(p.paint({ ...ids(2), base: fixed, tail: [{ time: 1000 + 20 * 60, value: 1 }] }).op).toBe('correct')
    expect(s.calls).toEqual([['updateHistorical', 1000 + 17 * 60]])
  })
  it('a tail point at the last base time replaces it (session preview on the newest daily bar)', () => {
    const chart = createFakeChart(); const s = chart.addSeries('s'); const p = createSeriesPainter(s)
    const base = [{ time: '2026-11-09', value: 1 }, { time: '2026-11-10', value: 2 }]
    p.paint({ ...ids(1), base, tail: [] })
    s.calls.length = 0
    p.paint({ ...ids(1), base, tail: [{ time: '2026-11-10', value: 3 }] })
    expect(s.calls).toEqual([['update', '2026-11-10']])
    expect(s.data()).toEqual([base[0], { time: '2026-11-10', value: 3 }])
  })
})

describe('framing contract (pure)', () => {
  it('right-margin policy: the W-R pinNewestRange margin, StockChart lastCandlePos values', () => {
    // StockChart: LAST_CANDLE_POS 0.95, MIN_RIGHT_GAP_PX 34, MAX_RIGHT_GAP_FRAC 0.16.
    expect(lastCandlePos(null)).toBe(0.95)
    expect(lastCandlePos(1200)).toBeCloseTo(0.95, 12)       // wide: the 5% fraction wins
    expect(lastCandlePos(400)).toBeCloseTo(1 - 34 / 400, 12) // narrow: the 34px minimum wins
    expect(lastCandlePos(150)).toBeCloseTo(0.84, 12)         // thin: capped at 16%
    for (const [W, px] of [[65, 900], [390, 600], [52, 300], [120, 180]]) {
      const n = 500
      const pin = { from: (n - 1) + W * (1 - lastCandlePos(px)) - W, to: (n - 1) + W * (1 - lastCandlePos(px)) }   // W-R pinNewestRange(n-1, W, px)
      expect(frameAfterKeyChange({ n, prevRange: { from: 0, to: W }, plotWidthPx: px })).toEqual(pin)
    }
  })
  it('K1: newest x is a function of (W, pad, width) only — invariant over n', () => {
    const r = rng(3)
    for (let k = 0; k < 200; k++) {
      const W = 10 + Math.floor(r() * 300)
      const prevRange = { from: 0, to: W }
      const xs = new Set()
      for (let j = 0; j < 5; j++) {
        const n = 1 + Math.floor(r() * 30000)
        const range = frameAfterKeyChange({ n, prevRange, plotWidthPx: 600 })
        xs.add(Math.round(xOfLogical(range, n - 1, 600) * 1e9))
        expect(range.to - range.from).toBe(W)
        expect(range.to).toBe(n - 1 + rightMarginBars(W, 600))
      }
      expect(xs.size).toBe(1)
    }
  })
  it('K2: a prepend shifts the range by exactly the bars added (no bar moves)', () => {
    const r = rng(4)
    for (let k = 0; k < 200; k++) {
      const prev = { from: r() * 1000, to: 1000 + r() * 1000 }
      const add = 1 + Math.floor(r() * 5000)
      const next = frameAfterPrepend(prev, add)
      const i = Math.floor(r() * 2000)
      expect(xOfLogical(next, i + add, 600)).toBeCloseTo(xOfLogical(prev, i, 600), 9)
    }
  })
})
