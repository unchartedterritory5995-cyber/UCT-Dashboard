/**
 * ⭐ THE WINDOW START ANCHORED TO A DATE: THE SAME PICTURE, FEWER LIBRARY REBUILDS (2026-11-24, next-row drawing).
 *
 * Two render-window facades over the real library members run (the production build through the build's edits,
 * src/testing/chartLibraryBuilds.js), handed the same daily board the same way: candles (the window's primary), volume,
 * the four default moving averages, and the future-axis line; framed as the chart frames a load (the newest bar pinned
 * near the right, in full-history indices through the facade). One starts each new load's window on the 250-row index
 * step (`anchor: 'index'`, how every load started before), the other on the first bar of a calendar month
 * (`renderWindowStartFor`, the default now). Stepping through a list of names that show the same recent sessions:
 *   1. what is DRAWN is identical: every canvas call the chart makes to draw itself (method and arguments, to 1e-4 of a
 *      pixel), the visible logical range in full-history indices, the visible time range, every series' rows in view,
 *      every series' price-scale range;
 *   2. while the library holds a different number of bars;
 *   3. and the switches between names deep enough for a window change the library's time points (a FULL update and a
 *      time-scale rebuild) on the index step and not on the date anchor;
 *   4. scrolling left through history: the same picture at every step, and the window still reaches left ahead of the
 *      view on both (where each extends is printed: the date anchor's start differs by less than a month of bars, so
 *      it extends at a slightly different scroll position, the same way).
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { loadChartLibraryBuilds, libraryWorkCounter } from '../../testing/chartLibraryBuilds'
import { installRecordingCanvas } from '../../testing/stockChartLibraryTrace'
import { createWindowedChart, rawOf, renderWindowRows, renderWindowStartFor, renderWindowStart, RENDER_WINDOW_OFF_KEY } from './windowedChart'

// ── a canvas that records every call, so two charts' drawings can be compared call for call ─────────────────────────
let rec
let lib
beforeAll(async () => {
  rec = installRecordingCanvas()
  localStorage.removeItem(RENDER_WINDOW_OFF_KEY)
  lib = (await loadChartLibraryBuilds()).patched
})
const r4 = (x) => rec.r4(x)
const frame = () => new Promise((r) => setTimeout(r, 60))

// ── the names: the same recent sessions (ending Friday 2026-11-13), different history depths ───────────────────────────
const DAY = 86_400_000
const iso = (ms) => new Date(ms).toISOString().slice(0, 10)
function sessions(n) {
  const out = []
  for (let ms = Date.UTC(2026, 10, 13); out.length < n; ms -= DAY) { const wd = new Date(ms).getUTCDay(); if (wd !== 0 && wd !== 6) out.push(iso(ms)) }
  return out.reverse()
}
const FUTURE = (() => { const out = []; for (let ms = Date.UTC(2026, 10, 14); out.length < 40; ms += DAY) { const wd = new Date(ms).getUTCDay(); if (wd !== 0 && wd !== 6) out.push({ time: iso(ms) }) } return out })()
function name(n, k) {
  const t = sessions(n)
  const candles = t.map((time, i) => { const c = 40 * k + Math.sin(i / 17) * 5 * k + Math.cos(i / 5) * k + i * 0.002; return { time, open: c - 0.4, high: c + 1.1 + (i % 3) * 0.2, low: c - 1.3, close: c } })
  const closes = candles.map((c) => c.close)
  const sma = (p) => t.map((time, i) => (i + 1 < p ? { time } : { time, value: closes.slice(i + 1 - p, i + 1).reduce((a, b) => a + b, 0) / p }))
  const ema = (p) => { let e = null; const a = 2 / (p + 1); return t.map((time, i) => { e = e == null ? closes[i] : e + a * (closes[i] - e); return i + 1 < p ? { time } : { time, value: e } }) }
  return {
    n, candles,
    vol: t.map((time, i) => ({ time, value: 1e6 + ((i * 7919 * k) % 400000), color: i % 2 ? '#2faf68' : '#df4646' })),
    ma: [ema(9), ema(20), sma(50), sma(200)],
  }
}
const NAMES = { AAA: name(8003, 1), BBB: name(6512, 2), CCC: name(7104, 3), DDD: name(1200, 4), EEE: name(6512, 5) }
const STEPS = ['AAA', 'BBB', 'CCC', 'DDD', 'AAA', 'EEE', 'BBB']

function board(anchor) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const raw = lib.createChart(el, { width: 900, height: 500 })
  const counter = libraryWorkCounter()
  const keyOf = new Map()
  const add = raw.addSeries.bind(raw)
  raw.addSeries = (...a) => {
    const s = add(...a)
    const key = keyOf.size
    keyOf.set(s, key)
    const set = s.setData.bind(s)
    s.setData = (d) => { if (counter.setData(key, d.map((r) => r.time))) b.full += 1; return set(d) }
    return s
  }
  const chart = createWindowedChart(raw, { anchor })
  const S = {
    candles: chart.addSeries(lib.CandlestickSeries, {}),
    vol: chart.addSeries(lib.HistogramSeries, { priceScaleId: 'vol', priceFormat: { type: 'volume' } }),
    ma: [0, 1, 2, 3].map(() => chart.addSeries(lib.LineSeries, { lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false })),
    fut: chart.addSeries(lib.LineSeries, { color: 'rgba(0,0,0,0)', priceScaleId: '', lastValueVisible: false, priceLineVisible: false }),
  }
  chart.window.setPrimary(S.candles)
  const b = { anchor, raw, chart, S, full: 0, futSet: false }
  /** A new load, as updateChart hands it over, then the frame the chart opens on (newest bar near the right). */
  b.load = (sym) => {
    const d = NAMES[sym]
    chart.window.setWindow(renderWindowRows(67, 0), { span: 67 })
    S.candles.setData(d.candles)
    S.vol.setData(d.vol)
    d.ma.forEach((rows, i) => S.ma[i].setData(rows))
    if (!b.futSet) { S.fut.setData(FUTURE); b.futSet = true }   // same last session: the future axis is set once
    chart.timeScale().setVisibleLogicalRange({ from: d.n - 1 - 64, to: d.n - 1 + 3 })
  }
  return b
}

/** What is drawn and shown, through the facade (full-history indices), and every canvas call of a full redraw. */
function picture(b, sym) {
  const ts = b.chart.timeScale()
  const r = ts.getVisibleLogicalRange()
  const all = [b.S.candles, b.S.vol, ...b.S.ma]
  const inView = []
  for (let i = Math.floor(r.from); i <= Math.ceil(r.to); i++) inView.push(all.map((s) => JSON.stringify(s.dataByIndex(i) ?? null)).join(';'))
  const drawing = rec.drawingOf(b.raw)
  return {
    sym,
    range: [r4(r.from), r4(r.to)],
    times: ts.getVisibleRange(),
    inView,
    scales: all.map((s) => { const v = rawOf(s).priceScale().getVisibleRange(); return v ? [r4(v.from), r4(v.to)] : null }),
    drawing,
  }
}

// ⛔ The boards are loaded together and settle together (the library's first paint measures the price axis and can
// move the plot's left edge): a picture taken one frame later on one board than on the other differs on IDENTICAL
// boards (the first run of this file, both boards on the index step: the visible time range's first bar differed).
// The CONTROL board (`ctl`, the index step like `idx`) must draw exactly what `idx` draws: the comparison is fair.
async function loadAll(boards, sym) {
  for (const b of boards) b.load(sym)
  await frame()
  await frame()
}

describe('the window start anchored to a date: the same picture, fewer library rebuilds', () => {
  const rows = []
  let idx
  let date
  let ctl
  beforeAll(async () => {
    idx = board('index')
    date = board('date')
    ctl = board('index')
    for (const sym of STEPS) {
      const f0 = { index: idx.full, date: date.full }
      await loadAll([idx, date, ctl], sym)
      rows.push({
        sym,
        pics: [picture(idx, sym), picture(date, sym)],
        control: picture(ctl, sym),
        held: [rawOf(idx.S.candles).data().length, rawOf(date.S.candles).data().length],
        starts: [idx.chart.window.windowStartTime(), date.chart.window.windowStartTime()],
        full: [idx.full - f0.index, date.full - f0.date],
      })
    }
    // eslint-disable-next-line no-console
    console.log('[window anchor]\n' + rows.map((r) => `${r.sym}: held ${r.held.join(' / ')} starts ${r.starts.join(' / ')} FULL ${r.full.join(' / ')} drawing calls ${r.pics[0].drawing.length}`).join('\n'))
  }, 120_000)

  it('CONTROL: two boards on the same anchor draw the same picture (the comparison is fair)', () => {
    for (const r of rows) expect(r.control, r.sym).toEqual(r.pics[0])
  })

  it('1. every step draws the same picture: canvas calls, visible range (full indices), times, rows in view, price scales', () => {
    for (const r of rows) {
      const [a, b] = r.pics
      expect(a.drawing.length, r.sym).toBeGreaterThan(500)                      // a real drawing (non-vacuity)
      expect(a.inView.length, r.sym).toBeGreaterThan(60)
      expect(b.range, r.sym).toEqual(a.range)
      expect(b.times, r.sym).toEqual(a.times)
      expect(b.scales, r.sym).toEqual(a.scales)
      expect(b.inView, r.sym).toEqual(a.inView)
      const diff = a.drawing.findIndex((x, i) => x !== b.drawing[i])
      if (diff >= 0 || a.drawing.length !== b.drawing.length) {
        throw new Error(`${r.sym}: the drawings differ at call ${diff}: ${a.drawing[diff]} vs ${b.drawing[diff]}`)
      }
    }
  })

  it('2. while the library holds a different number of bars (and the date anchor starts on a month\'s first session)', () => {
    const windowed = rows.filter((r) => r.sym !== 'DDD')
    expect(windowed.some((r) => r.held[0] !== r.held[1])).toBe(true)
    for (const r of windowed) {
      expect(String(r.starts[1]).slice(8), r.sym).toMatch(/^0[1-5]$/)        // the first session of its month
      expect(r.held[1], r.sym).toBeGreaterThanOrEqual(600)
      expect(r.held[1] - 600, r.sym).toBeLessThan(25)                       // at most a month of sessions more
    }
    const d = rows.find((r) => r.sym === 'DDD')
    expect(d.held).toEqual([1200, 1200])                                     // too short for a window: every bar, both
  })

  it('3. a switch between names deep enough for a window: a FULL update on the index step, none on the date anchor', () => {
    const got = rows.map((r) => `${r.sym} ${r.full.join('/')}`)
    expect(got).toEqual([
      'AAA 2/2',   // the first load: the candles' points, then the future axis's
      'BBB 1/0',   // another depth
      'CCC 1/0',
      'DDD 1/1',   // no window: every bar
      'AAA 1/1',   // back to a window
      'EEE 1/0',
      'BBB 0/0',   // the same depth as EEE: the index step lands on the same date too
    ])
  })

  it('4. scrolling left through history: the same picture at every step, the window reaching left ahead of the view', async () => {
    const steps = []
    let r = idx.chart.timeScale().getVisibleLogicalRange()
    for (let k = 0; k < 40; k++) {
      const next = { from: r.from - 40, to: r.to - 40 }
      idx.chart.timeScale().setVisibleLogicalRange(next)
      date.chart.timeScale().setVisibleLogicalRange(next)
      await frame()
      await frame()
      const [a, b] = [picture(idx, 'BBB'), picture(date, 'BBB')]
      expect(b.range, `step ${k}`).toEqual(a.range)
      expect(b.inView, `step ${k}`).toEqual(a.inView)
      expect(b.scales, `step ${k}`).toEqual(a.scales)
      expect(b.drawing, `step ${k}`).toEqual(a.drawing)
      for (const x of [idx, date]) {
        expect(x.chart.window.windowStart(), `${x.anchor} step ${k}: the view inside the window`).toBeLessThan(Math.floor(a.range[0] + 0.5))
      }
      steps.push(`${Math.round(next.from)}: ws ${idx.chart.window.windowStart()} / ${date.chart.window.windowStart()}`)
      r = next
    }
    // eslint-disable-next-line no-console
    console.log('[window anchor] scrolling left (view from: index-step start / date-anchored start)\n' + steps.join('\n'))
    expect(new Set(steps.map((s) => s.split('ws ')[1].split(' / ')[1])).size).toBeGreaterThan(2)   // the date anchor extended, repeatedly
  })

  it('the date anchor itself: the first session of the month holding the latest start; intraday keeps the index step', () => {
    const c = NAMES.BBB.candles
    const k = renderWindowStartFor(c, 600)
    expect(c[k].time.slice(0, 7)).toBe(c[c.length - 600].time.slice(0, 7))
    expect(c[k - 1].time.slice(0, 7)).not.toBe(c[k].time.slice(0, 7))
    expect(renderWindowStartFor(NAMES.AAA.candles, 600) && NAMES.AAA.candles[renderWindowStartFor(NAMES.AAA.candles, 600)].time).toBe(c[k].time)
    const intraday = Array.from({ length: 5000 }, (_x, i) => ({ time: 1_790_000_000 + i * 1800 }))
    expect(renderWindowStartFor(intraday, 600)).toBe(renderWindowStart(5000, 600))
    expect(renderWindowStartFor(NAMES.DDD.candles, 600)).toBe(0)
  })
})
