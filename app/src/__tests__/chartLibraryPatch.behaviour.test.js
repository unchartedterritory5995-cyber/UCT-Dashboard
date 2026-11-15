// What the patched chart library DOES, measured against the shipped one.
//
// Both are the real production build of lightweight-charts, read from the installed package: one
// as shipped, one through `patchLightweightCharts` (the same function the build runs). They drive
// two real charts through the same long seeded sequence of data operations, and everything the
// public API can report, plus every string the library draws, must be identical after every step.
// Then the work is COUNTED: a flip of every series visits (series x series x points) rows as
// shipped and (series x points) patched, and leaving any one edit out puts its share back.
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PATCHES, patchLightweightCharts } from '../../scripts/chartLibraryPatch.mjs'

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const SHIPPED = readFileSync(path.join(APP, 'node_modules', 'lightweight-charts', 'dist', 'lightweight-charts.production.mjs'), 'utf8')

const libs = {}
let load
// every string the library draws while `drawn` is an array (tick labels, axis labels)
let drawn = null

beforeAll(async () => {
  // jsdom has no 2D context and no layout
  const ctx = new Proxy({}, {
    get: (_t, k) => {
      if (k === 'canvas') return { width: 800, height: 400 }
      if (k === 'measureText') return () => ({ width: 30, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 })
      if (k === 'createLinearGradient') return () => ({ addColorStop() {} })
      if (k === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) })
      if (k === 'fillText') return (text) => { if (drawn) drawn.push(String(text)) }
      return () => {}
    },
    set: () => true,
  })
  HTMLCanvasElement.prototype.getContext = () => ctx
  Object.defineProperty(window, 'devicePixelRatio', { value: 1, configurable: true })
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get() { return 800 }, configurable: true })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { get() { return 400 }, configurable: true })

  // Each variant is the library's own text, evaluated: the file is one import, a body and one
  // export, so it becomes a function of its one dependency. (A module file cannot be used: the
  // test runner only imports from the project, and these variants must not be written into it.)
  const canvas = await import('fancy-canvas')
  const IMPORT = /import\{([^}]*)\}from"fancy-canvas";/
  const EXPORT = /export\{([^}]*)\};?\s*$/
  load = (code) => {
    const imported = IMPORT.exec(code)
    const exported = EXPORT.exec(code)
    if (!imported || !exported || code.split(/\bimport\b/).length !== 2 || code.split(/\bexport\b/).length !== 2) {
      throw new Error('the library file is no longer one import, a body and one export; this test cannot evaluate it')
    }
    const takes = imported[1].split(',').map((x) => x.trim().split(' as ')).map(([from, to]) => `${from}:${to || from}`).join(',')
    const gives = exported[1].split(',').map((x) => x.trim().split(' as ')).map(([local, name]) => `${name || local}:${local}`).join(',')
    const body = code.replace(IMPORT, () => `const{${takes}}=uctCanvas;`).replace(EXPORT, () => `return{${gives}}`)
    return new Function('uctCanvas', `"use strict";${body}`)(canvas)
  }
  libs.shipped = load(SHIPPED)
  libs.patched = load(patchLightweightCharts(SHIPPED))
  for (let i = 0; i < PATCHES.length; i++) libs[`without${i + 1}`] = load(patchLightweightCharts(SHIPPED, [PATCHES[i].name]))
})

// ── a deterministic chart ────────────────────────────────────────────────────
const prng = (seed) => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 }
const pad = (n) => String(n).padStart(2, '0')

/** `count` weekday dates ending 2026-11-12, oldest first, leaving out the weekdays numbered in `skip`. */
function days(count, skip) {
  const out = []
  const d = new Date('2026-11-12T00:00:00Z')
  let k = 0
  while (out.length < count) {
    const wd = d.getUTCDay()
    if (wd !== 0 && wd !== 6) {
      if (!skip.has(k)) out.push(`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`)
      k++
    }
    d.setUTCDate(d.getUTCDate() - 1)
  }
  return out.reverse()
}

/**
 * One symbol's data for `nSeries` series: candles, volume, then lines (some with a blank warm-up,
 * some coloured per point). `t` is the times: date strings (a daily chart) or numbers (intraday).
 * On a daily chart series 2 gives its times as {year, month, day} objects, so WHICH series a time
 * point takes its original time from is visible in what the chart reports.
 */
function symbol(t, base, nSeries, seed) {
  const rnd = prng(seed)
  let p = base
  const ohlc = []
  const vol = []
  const close = []
  for (let i = 0; i < t.length; i++) {
    const o = p
    p = Math.max(0.5, p * (1 + (rnd() - 0.5) * 0.04))
    ohlc.push({ time: t[i], open: o, high: Math.max(o, p) * 1.01, low: Math.min(o, p) * 0.99, close: p })
    vol.push({ time: t[i], value: 1e5 + rnd() * 9e6, color: p >= o ? '#22aa66' : '#aa3333' })
    close.push(p)
  }
  const asDay = (s) => ({ year: Number(s.slice(0, 4)), month: Number(s.slice(5, 7)), day: Number(s.slice(8, 10)) })
  const series = [ohlc, vol]
  for (let k = 2; k < nSeries; k++) {
    const warm = k % 3 === 0 ? 0 : 5 + k
    const time = (i) => (k === 2 && typeof t[i] === 'string' ? asDay(t[i]) : t[i])
    series.push(t.map((_x, i) => (i < warm ? { time: time(i) } : k % 4 === 1 ? { time: time(i), value: close[i] + k, color: i % 7 ? '#3399ff' : '#ff9933' } : { time: time(i), value: close[i] * (1 + k / 100) })))
  }
  return { t, series }
}

function build(lib, nSeries) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const chart = lib.createChart(el, { width: 800, height: 400 })
  const S = [chart.addSeries(lib.CandlestickSeries, {}, 0), chart.addSeries(lib.HistogramSeries, { priceScaleId: 'vol' }, 0)]
  for (let k = 2; k < nSeries; k++) S.push(chart.addSeries(lib.LineSeries, { lastValueVisible: false, priceLineVisible: false }, k % 3))
  const setAll = (d) => { for (let k = 0; k < S.length; k++) S[k].setData(d.series[k]) }
  const done = () => { chart.remove(); el.remove() }
  return { chart, S, setAll, done }
}

/** Everything the public API can say about the chart's data and time scale, and every string it draws. */
function report(chart, S, sets) {
  const ts = chart.timeScale()
  const out = [JSON.stringify(ts.getVisibleLogicalRange()), JSON.stringify(ts.getVisibleRange())]
  for (let k = 0; k < S.length; k++) {
    const d = S[k].data()
    out.push(JSON.stringify(d))
    for (const idx of [-3, 0, 1, 7, 99, d.length - 2, d.length - 1, d.length + 5]) out.push(JSON.stringify(S[k].dataByIndex(idx, (k % 3) - 1) ?? null))
    out.push(JSON.stringify(S[k].barsInLogicalRange({ from: 10.5, to: 220 })))
  }
  for (const x of [5, 200, 500, 790]) out.push(JSON.stringify(ts.coordinateToTime(x)), String(ts.coordinateToLogical(x)))
  for (const d of sets) for (const i of [0, 3, d.t.length - 1]) out.push(String(ts.timeToCoordinate(d.t[i])), String(ts.timeToIndex(d.t[i], true)))
  drawn = []
  try { chart.takeScreenshot() } finally { out.push(JSON.stringify(drawn)); drawn = null }
  return out.join('|')
}

/** A long seeded mix of whole-chart flips, single-series replacements, clears, updates, new bars and pops. */
function run(lib, nSeries, steps) {
  const A = symbol(days(320, new Set([4, 40, 201])), 100, nSeries, 11)
  const B = symbol(days(300, new Set([7, 150])), 40, nSeries, 22)
  const C = symbol(days(90, new Set()), 12, nSeries, 33)
  const I = symbol(Array.from({ length: 260 }, (_x, i) => 1_793_000_000 + i * 300), 55, nSeries, 44)
  const sets = [A, B, C, I]
  const { chart, S, setAll, done } = build(lib, nSeries)
  const rnd = prng(20261113)
  const reports = []
  const kinds = new Map()
  const did = (k) => kinds.set(k, (kinds.get(k) || 0) + 1)
  setAll(A)
  reports.push(report(chart, S, sets))
  for (let step = 0; step < steps; step++) {
    const r = rnd()
    const k = Math.floor(rnd() * S.length)
    const d = sets[Math.floor(rnd() * sets.length)]
    try {
      if (r < 0.28) { setAll(d); did('flip') }
      else if (r < 0.46) { S[k].setData(d.series[k]); did('one series') }
      else if (r < 0.54) { S[k].setData([]); did('clear') }
      else if (r < 0.62) { S[k].setData(d.series[k].slice(Math.floor(rnd() * 60))); did('shorter') }
      else if (r < 0.76) {
        const cur = S[k].data()
        if (cur.length) {
          const last = { ...cur[cur.length - 1] }
          if ('value' in last) last.value *= 1.01
          else if ('close' in last) last.close *= 1.01
          S[k].update(last)
          did('update')
        }
      } else if (r < 0.88) {
        const cur = S[0].data()
        if (cur.length) {
          const lastTime = cur[cur.length - 1].time
          let time
          if (typeof lastTime === 'number') time = lastTime + 300 * (1 + Math.floor(rnd() * 3))
          else {
            const nd = new Date(lastTime + 'T00:00:00Z')
            nd.setUTCDate(nd.getUTCDate() + 1 + Math.floor(rnd() * 3))
            time = nd.toISOString().slice(0, 10)
          }
          S[0].update({ time, open: 5, high: 6, low: 4, close: 5.5 })
          const own = S[k].data()
          const ownTime = own.length ? own[own.length - 1].time : null
          if (k > 1 && typeof ownTime === typeof time && ownTime < time) S[k].update({ time, value: 3 + rnd() })
          did('new bar')
        }
      } else if (r < 0.94) {
        if (S[k].data().length > 3) { S[k].pop(1 + Math.floor(rnd() * 2)); did('pop') }
      } else {
        chart.timeScale().setVisibleLogicalRange({ from: d.t.length - 120, to: d.t.length + 6 })
        did('view')
      }
    } catch (e) {
      reports.push('threw: ' + String(e && e.message))
      did('threw')
    }
    reports.push(report(chart, S, sets))
  }
  done()
  return { reports, kinds }
}

/** Row visits and date conversions made by ONE flip of every series, after both symbols have been shown once. */
function work(lib, nSeries, points) {
  const A = symbol(days(points, new Set([4, 40, 201])), 100, nSeries, 11)
  const B = symbol(days(points - 20, new Set([7, 150])), 40, nSeries, 22)
  const { setAll, done } = build(lib, nSeries)
  setAll(A); setAll(B); setAll(A)
  const forEach = Map.prototype.forEach
  const utc = Date.UTC
  let rows = 0
  let dates = 0
  Map.prototype.forEach = function counted(cb, thisArg) {
    return forEach.call(this, function each(v, k, m) { rows++; return cb.call(thisArg, v, k, m) })
  }
  Date.UTC = function counted(...a) { dates++; return utc.apply(Date, a) }
  try { setAll(B) } finally { Map.prototype.forEach = forEach; Date.UTC = utc }
  done()
  return { rows, dates }
}

/** The library's own converter from a time to its internal form (what the third edit changes). */
function converter(lib) {
  const { chart, done } = build(lib, 2)
  const convert = chart.horzBehaviour().createConverterToInternalObj([{ time: '2024-01-02' }])
  done()
  return convert
}

describe('the patched chart library behaves exactly as the shipped one', () => {
  it('reports and draws the same thing after every step of a long mixed sequence', () => {
    const a = run(libs.shipped, 9, 170)
    const b = run(libs.patched, 9, 170)
    expect(b.reports.length).toBe(a.reports.length)
    for (let i = 0; i < a.reports.length; i++) {
      if (a.reports[i] !== b.reports[i]) throw new Error(`the patched library diverged at step ${i}`)
    }
    // the sequence really exercised every kind of operation, really moved the chart, and the
    // library really drew its labels into the report
    for (const kind of ['flip', 'one series', 'clear', 'shorter', 'update', 'new bar', 'pop', 'view']) {
      expect(a.kinds.get(kind) || 0, kind).toBeGreaterThanOrEqual(3)
    }
    expect(a.kinds.get('threw') || 0).toBe(0)
    expect(new Set(a.reports).size).toBeGreaterThan(120)
    expect(a.reports[0].slice(a.reports[0].lastIndexOf('|'))).toMatch(/"Nov"/)
    // a time point reports the time in the form its FIRST series gave it: both forms appear
    expect(a.reports.some((r) => r.includes('{"year":2026'))).toBe(true)
    expect(a.reports.some((r) => r.includes('"2026-11-12"'))).toBe(true)
  })

  it('CONTROL: the comparison can see a difference (a library that drops one row is caught)', () => {
    const a = run(libs.shipped, 9, 40)
    const broken = { ...libs.shipped, createChart: (...args) => {
      const chart = libs.shipped.createChart(...args)
      const add = chart.addSeries.bind(chart)
      chart.addSeries = (...s) => {
        const series = add(...s)
        const data = series.data.bind(series)
        series.data = () => { const d = data(); return d.length > 5 ? d.slice(0, -1) : d }
        return series
      }
      return chart
    } }
    const b = run(broken, 9, 40)
    expect(b.reports).not.toEqual(a.reports)
  })
})

describe('the remembered date conversion gives the answer the library computes', () => {
  const DATES = ['2024-01-02', '2024-02-29', '1970-01-01', '1999-12-31', '2000-01-01', '2026-11-13', '1987-10-19', '2038-01-19']

  it('first call and remembered call both equal the shipped answer, key for key', () => {
    const shipped = converter(libs.shipped)
    const patched = converter(libs.patched)
    for (const d of DATES) {
      const want = JSON.stringify(shipped(d))
      expect(want).toContain(String(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10))) / 1000))
      expect(JSON.stringify(patched(d)), `${d} first`).toBe(want)
      expect(JSON.stringify(patched(d)), `${d} remembered`).toBe(want)
    }
    // {year, month, day} input and a bad string go the library's own way
    const day = { year: 2024, month: 2, day: 29 }
    expect(JSON.stringify(patched(day))).toBe(JSON.stringify(shipped(day)))
    let message = null
    try { shipped('not a date') } catch (e) { message = e.message }
    expect(message).toBeTruthy()
    expect(() => patched('not a date')).toThrow(message)
    expect(() => patched('not a date')).toThrow(message)
  })

  it('every call returns its own objects: changing one answer changes no later answer', () => {
    const patched = converter(libs.patched)
    const want = JSON.stringify(patched('2024-03-15'))
    const a = patched('2024-03-15')
    const b = patched('2024-03-15')
    expect(a).not.toBe(b)
    const inner = Object.values(a).find((v) => v && typeof v === 'object')
    expect(inner).toBeTruthy()
    expect(Object.values(b)).not.toContain(inner)
    for (const k of Object.keys(inner)) inner[k] = 99
    for (const k of Object.keys(a)) if (typeof a[k] === 'number') a[k] = 1
    expect(JSON.stringify(patched('2024-03-15'))).toBe(want)
  })

  it('remembers a date after its first conversion, and stops remembering new ones at 50,000', () => {
    const lib = load(patchLightweightCharts(SHIPPED)) // its own memory: this test fills it
    const convert = converter(lib)
    const utc = Date.UTC
    let calls = 0
    const counted = (fn) => { calls = 0; Date.UTC = function c(...a) { calls++; return utc.apply(Date, a) }; try { fn() } finally { Date.UTC = utc } return calls }
    expect(counted(() => convert('2031-05-05'))).toBe(1)
    expect(counted(() => convert('2031-05-05'))).toBe(0)
    // one date is remembered; 50,000 more distinct days from 1850-01-01 fill the memory at the 49,999th
    const d = new Date(Date.UTC(1850, 0, 1))
    const filled = []
    for (let i = 0; i < 50000; i++) {
      filled.push(`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`)
      convert(filled[i])
      d.setUTCDate(d.getUTCDate() + 1)
    }
    expect(counted(() => convert(filled[0]))).toBe(0)
    expect(counted(() => convert(filled[49998])), 'the 50,000th date remembered').toBe(0)
    expect(counted(() => convert(filled[49999])), 'the first date past the limit').toBe(1)
    expect(counted(() => convert(filled[49999]))).toBe(1)
    // past the limit the answer is still the library's
    expect(JSON.stringify(convert(filled[49999]))).toBe(JSON.stringify(converter(libs.shipped)(filled[49999])))
    expect(counted(() => convert('2031-05-05'))).toBe(0)
  })
})

describe('the patched chart library does the work once per series, not once per pair of series', () => {
  const S = 12
  const P = 400
  // one flip may visit each (series, point) pair a small fixed number of times
  const LINEAR = 4 * S * P

  it('as shipped, a flip visits rows in proportion to series x series x points', () => {
    const w = work(libs.shipped, S, P)
    expect(w.rows).toBeGreaterThan(1.5 * S * S * P)
    expect(w.dates).toBeGreaterThan(0.9 * S * (P - 20))
  })

  it('patched, a flip visits rows in proportion to series x points and converts no date twice', () => {
    const w = work(libs.patched, S, P)
    expect(w.rows).toBeLessThan(LINEAR)
    // series 2 gives {year, month, day} times, which are never strings to remember
    expect(w.dates).toBe(P - 20)
  })

  it('doubling the series doubles the patched work and quadruples the shipped work', () => {
    const p1 = work(libs.patched, 6, P).rows
    const p2 = work(libs.patched, 12, P).rows
    const s1 = work(libs.shipped, 6, P).rows
    const s2 = work(libs.shipped, 12, P).rows
    expect(p2 / p1).toBeLessThan(2.4)
    expect(s2 / s1).toBeGreaterThan(3.4)
  })

  it('each edit is needed: leaving any one out puts its work back', () => {
    const full = work(libs.patched, S, P)
    const no1 = work(libs.without1, S, P)
    const no2 = work(libs.without2, S, P)
    const no3 = work(libs.without3, S, P)
    expect(no1.rows, PATCHES[0].name).toBeGreaterThan(LINEAR)
    expect(no2.rows, PATCHES[1].name).toBeGreaterThan(LINEAR)
    expect(no3.dates, PATCHES[2].name).toBeGreaterThan(0.9 * S * (P - 20))
    // and each edit removes only its own work
    expect(no3.rows).toBe(full.rows)
    expect(no1.dates).toBe(full.dates)
    expect(no2.dates).toBe(full.dates)
  })
})
