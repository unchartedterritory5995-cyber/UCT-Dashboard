// app/src/components/chart/supportLoop/assistantRecipes.values.test.js
//
// ─── ⭐ A RECIPE THAT RUNS IS NOT YET A RECIPE THAT IS RIGHT (2026-11-19) ─────────────
//
// `assistantRecipes.json` proves each recipe RUNS (the paste check, and a real compute on both
// histories). This file holds what each one PLOTS to an independent calculation: plain loops over
// the same bars, written from the recipe's stated rule, sharing no code with the engine. A recipe
// the assistant starts from is copied into answers members put on charts, so a wrong number here
// is a wrong number there, many times.
//
// ⛔ EVERY RECIPE IS EITHER VALUE-CHECKED HERE OR NAMED IN `NOT_VALUE_CHECKED` WITH ITS REASON. A
// recipe added to the folder with neither fails the first test.
//
// Drawings (lines, boxes, labels, the table's text) are not compared: what is compared is every
// PLOTTED column, which for these recipes carries the same state the drawings are made from.

import { describe, it, expect, beforeAll, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import * as registry from '../engine/nativeRegistry'
import { memberPaneDefinition } from '../builder/memberPane/memberPaneDefinition'
import { __permitRuntimePaneForTests } from '../engine/runtimePaneGate'
import { __allowEveryRuntimeScriptForTests } from '../engine/runtimeKill'
import RECIPE_INDEX from './assistantRecipes/index.json'
import GENERATED from './assistantRecipes.json'
import { recipeBars, recipeContext } from './assistantRecipes'

const HERE = path.resolve(process.cwd(), 'src/components/chart/supportLoop')
const flagOf = (rel) => (fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8').match(/source\.(VITE_[A-Z0-9_]+)\s*===\s*'1'/) || [])[1]
vi.stubEnv(flagOf('src/components/chart/engine/objectsOnlyPaneGate.js'), '1')
vi.stubEnv(flagOf('src/components/chart/engine/runtimePaneGate.js'), '1')

/** A recipe with no value check is named here with its reason. None today: a recipe whose numbers
 *  could not be held to a calculation (a table built on weekly and monthly reads) was removed instead. */
const NOT_VALUE_CHECKED = {}

const BARS = { daily: recipeBars('daily'), intraday: recipeBars('intraday') }
const sourceOf = (id) => fs.readFileSync(path.join(HERE, 'assistantRecipes', `${id}.pine`), 'utf8')
const chartOf = (id) => RECIPE_INDEX.recipes.find((r) => r.id === id).chart
let made = 0

/** The engine's own columns for a recipe, in plot order, on a chart whose history reaches the listing. */
function engineColumns(id, source = sourceOf(id), bars = null) {
  const chart = chartOf(id)
  const pane = memberPaneDefinition({ source, id: `u_value_${made += 1}`, name: 'recipe' })
  expect(pane.ok, `${id}: ${pane.reason || ''}`).toBe(true)
  const cols = registry.computeFor(pane.definition, bars || BARS[chart], undefined, recipeContext(chart, 'fromListing'))
  expect(registry.columnErrors(cols) || {}, id).toEqual({})
  return Object.keys(cols).map((k) => Array.from(cols[k]))
}

const NAN = Number.NaN
const ok = (x) => Number.isFinite(x)
const close2 = (a, b, rel) => Math.abs(a - b) <= Math.max(1e-9, rel * Math.max(Math.abs(a), Math.abs(b)))

/** Compare one engine column with a reference over [from, to): same bars have a value, and the values agree. */
function same(got, want, label, { from = 0, to = want.length, rel = 1e-9 } = {}) {
  expect(got.length, label).toBe(want.length)
  let compared = 0
  for (let i = from; i < to; i += 1) {
    const g = got[i], w = want[i]
    if (!ok(w)) { expect(ok(g), `${label}: bar ${i}: the engine has ${g} where the rule has no value`).toBe(false); continue }
    expect(ok(g), `${label}: bar ${i}: the engine has no value and the rule gives ${w}`).toBe(true)
    expect(close2(g, w, rel), `${label}: bar ${i}: engine ${g} != reference ${w}`).toBe(true)
    compared += 1
  }
  expect(compared, `${label}: nothing was compared`).toBeGreaterThan(0)
  return compared
}

// ── plain helpers, written here and used only here ────────────────────────────────────
const H = (b) => b.map((x) => x.h), L = (b) => b.map((x) => x.l), C = (b) => b.map((x) => x.c), V = (b) => b.map((x) => x.v)

/** A confirmed pivot: the value `right` bars back when it is above (below) every bar `left` before and `right` after it. */
function pivot(series, left, right, i, high) {
  const j = i - right
  if (j - left < 0) return NAN
  const v = series[j]
  for (let k = j - left; k <= j + right; k += 1) {
    if (k === j) continue
    if (high ? series[k] >= v : series[k] <= v) return NAN
  }
  return v
}

const maxOf = (s, i, n) => { let m = -Infinity; for (let k = i - n + 1; k <= i; k += 1) m = Math.max(m, s[k]); return m }
const minOf = (s, i, n) => { let m = Infinity; for (let k = i - n + 1; k <= i; k += 1) m = Math.min(m, s[k]); return m }

function ema(src, n) {
  const a = 2 / (n + 1), out = []
  for (let i = 0; i < src.length; i += 1) out.push(i === 0 ? src[0] : a * src[i] + (1 - a) * out[i - 1])
  return out
}

function wilderRsi(c, n) {
  const out = new Array(c.length).fill(NAN)
  let up = 0, down = 0
  for (let i = 1; i < c.length; i += 1) {
    const ch = c[i] - c[i - 1], g = Math.max(ch, 0), l = Math.max(-ch, 0)
    if (i <= n) { up += g / n; down += l / n } else { up = (up * (n - 1) + g) / n; down = (down * (n - 1) + l) / n }
    if (i >= n) out[i] = down === 0 ? 100 : 100 - 100 / (1 + up / down)
  }
  return out
}

const dayKey = (t) => (typeof t === 'string' ? t : new Date(t * 1000).toISOString().slice(0, 10))
const ymd = (t) => dayKey(t).split('-').map(Number)

beforeAll(() => { __permitRuntimePaneForTests(); __allowEveryRuntimeScriptForTests() })

const CHECKS = {
  'zigzag-percent': () => {
    const b = BARS.daily, want = []
    let dir = 0, extreme = NAN, extremeBar = NAN, lastY = NAN
    for (let i = 0; i < b.length; i += 1) {
      if (!ok(extreme)) { extreme = b[i].c; extremeBar = i; lastY = b[i].c }
      if (dir >= 0 && b[i].h > extreme) { extreme = b[i].h; extremeBar = i; dir = 1 }
      if (dir <= 0 && b[i].l < extreme) { extreme = b[i].l; extremeBar = i; dir = -1 }
      const down = dir === 1 && b[i].l <= extreme * (1 - 8 / 100)
      const up = dir === -1 && b[i].h >= extreme * (1 + 8 / 100)
      if (down || up) { lastY = extreme; dir = down ? -1 : 1; extreme = down ? b[i].l : b[i].h; extremeBar = i }
      want.push(lastY)
    }
    expect(extremeBar).toBeGreaterThan(0)
    expect(new Set(want).size, 'the walk never reverses 8%: nothing is shown').toBeGreaterThan(10)
    const [swing] = engineColumns('zigzag-percent')
    same(swing, want, 'zigzag: last confirmed swing')
  },

  'supply-demand-zones': () => {
    const b = BARS.daily, h = H(b), l = L(b), want = []
    const supply = [], demand = []
    let deleted = 0
    for (let i = 0; i < b.length; i += 1) {
      const ph = pivot(h, 10, 10, i, true), pl = pivot(l, 10, 10, i, false)
      if (ok(ph)) { supply.push(ph); if (supply.length > 6) supply.shift() }
      if (ok(pl)) { demand.push(pl); if (demand.length > 6) demand.shift() }
      for (let k = supply.length - 1; k >= 0; k -= 1) if (b[i].c > supply[k]) { supply.splice(k, 1); deleted += 1 }
      for (let k = demand.length - 1; k >= 0; k -= 1) if (b[i].c < demand[k]) { demand.splice(k, 1); deleted += 1 }
      want.push(supply.length + demand.length)
    }
    expect(deleted, 'no zone was ever closed through').toBeGreaterThan(5)
    const [standing] = engineColumns('supply-demand-zones')
    same(standing, want, 'zones standing')
  },

  'volume-profile': () => {
    const b = BARS.daily, last = b.length - 1, n = 60, rows = 24
    const hi = maxOf(H(b), last, n), lo = minOf(L(b), last, n), step = (hi - lo) / rows
    const vols = new Array(rows).fill(0)
    for (let i = 0; i < n; i += 1) vols[Math.min(rows - 1, Math.floor((b[last - i].c - lo) / step))] += b[last - i].v
    const top = Math.max(...vols)
    let poc = NAN
    for (let r = 0; r < rows; r += 1) if (vols[r] === top) poc = lo + (r + 0.5) * step
    const want = new Array(b.length).fill(NAN)
    want[last] = poc
    const [got] = engineColumns('volume-profile')
    same(got, want, 'point of control')
    expect(vols.filter((v) => v > 0).length).toBeGreaterThan(8)
  },

  'vwap-deviation-bands': () => {
    const b = BARS.intraday
    const want = [[], [], [], [], []]
    let sumV = 0, sumPV = 0, sumP2V = 0, resets = 0
    for (let i = 0; i < b.length; i += 1) {
      if (i > 0 && ymd(b[i].t)[2] !== ymd(b[i - 1].t)[2]) { sumV = 0; sumPV = 0; sumP2V = 0; resets += 1 }
      const src = (b[i].h + b[i].l + b[i].c) / 3
      sumV += b[i].v; sumPV += src * b[i].v; sumP2V += src * src * b[i].v
      const vwap = sumPV / sumV, dev = Math.sqrt(Math.max(sumP2V / sumV - vwap * vwap, 0))
      ;[vwap, vwap + dev, vwap - dev, vwap + 2 * dev, vwap - 2 * dev].forEach((x, k) => want[k].push(x))
    }
    expect(resets).toBe(39)
    const got = engineColumns('vwap-deviation-bands')
    expect(got).toHaveLength(5)
    // a band is a small difference of large sums: held to a millionth of the price
    ;['VWAP', 'upper 1', 'lower 1', 'upper 2', 'lower 2'].forEach((name, k) => same(got[k], want[k], `vwap bands: ${name}`, { rel: 1e-6 }))
    // the bands are VWAP's own, not a deviation of the close: they open at zero width on each day's first bar
    expect(Math.abs(want[1][78] - want[0][78])).toBeLessThan(1e-6)
    expect(want[1][78 + 40] - want[0][78 + 40]).toBeGreaterThan(0)
  },

  'rsi-divergence': () => {
    const b = BARS.daily, c = C(b), l = L(b), h = H(b), R = 5
    const osc = wilderRsi(c, 14)
    const [rsi, ob, os, bull, bear] = engineColumns('rsi-divergence')
    same(rsi, osc, 'RSI', { from: 600, rel: 1e-6 })
    expect(ob.every((x) => x === 70) && os.every((x) => x === 30)).toBe(true)
    // the pivots are read from the ENGINE's RSI (equal to the reference above to a millionth), so a
    // tie in the eighth decimal cannot make the two disagree about which bar is a pivot
    const lows = [], highs = []
    const wantBull = [], wantBear = []
    for (let i = 0; i < b.length; i += 1) {
      const pl = i >= 600 && ok(pivot(rsi, 5, R, i, false)), ph = i >= 600 && ok(pivot(rsi, 5, R, i, true))
      if (pl) lows.push(i)
      if (ph) highs.push(i)
      const pb = lows.length >= 2 ? lows[lows.length - 2] : -1, hb = highs.length >= 2 ? highs[highs.length - 2] : -1
      wantBull.push(pl && pb >= 0 && l[i - R] < l[pb - R] && rsi[i - R] > rsi[pb - R] ? 1 : 0)
      wantBear.push(ph && hb >= 0 && h[i - R] > h[hb - R] && rsi[i - R] < rsi[hb - R] ? 1 : 0)
    }
    expect(wantBull.reduce((a, x) => a + x, 0), 'no bullish divergence on the walk').toBeGreaterThan(2)
    expect(wantBear.reduce((a, x) => a + x, 0), 'no bearish divergence on the walk').toBeGreaterThan(2)
    same(bull, wantBull, 'bullish divergence', { from: 700 })
    same(bear, wantBear, 'bearish divergence', { from: 700 })
  },

  'market-structure': () => {
    const b = BARS.daily, h = H(b), l = L(b), want = [], labels = []
    let lastHigh = NAN, lastLow = NAN, hh = false, hl = false, shown = 0
    for (let i = 0; i < b.length; i += 1) {
      const ph = pivot(h, 5, 5, i, true), pl = pivot(l, 5, 5, i, false)
      if (ok(ph)) { hh = ok(lastHigh) && ph > lastHigh; if (ok(lastHigh)) shown += 1; lastHigh = ph }
      if (ok(pl)) { hl = ok(lastLow) && pl > lastLow; if (ok(lastLow)) shown += 1; lastLow = pl }
      shown = Math.min(shown, 40)                                   // the oldest labels are deleted past 40
      want.push(hh && hl ? 1 : (!hh && !hl && ok(lastHigh) && ok(lastLow) ? -1 : 0))
      labels.push(shown)
    }
    expect(new Set(want)).toEqual(new Set([1, -1, 0]))
    const [trend, count] = engineColumns('market-structure')
    same(trend, want, 'structure')
    same(count, labels, 'labels on the chart')
    expect(labels[labels.length - 1]).toBe(40)
  },

  'gap-zones': () => {
    const b = BARS.daily, up = [0], down = [0], open = [0]
    const ups = [], downs = []                          // each open gap, as the far side price that fills it
    let filled = 0, trimmed = 0
    for (let i = 1; i < b.length; i += 1) {
      const gapUp = b[i].l > b[i - 1].h && (b[i].l - b[i - 1].h) / b[i - 1].h * 100 >= 1
      const gapDown = b[i].h < b[i - 1].l && (b[i - 1].l - b[i].h) / b[i - 1].l * 100 >= 1
      up.push(gapUp ? 1 : 0)
      down.push(gapDown ? 1 : 0)
      if (gapUp) { ups.push(b[i - 1].h); if (ups.length > 20) { ups.shift(); trimmed += 1 } }       // the box's bottom
      if (gapDown) { downs.push(b[i - 1].l); if (downs.length > 20) { downs.shift(); trimmed += 1 } } // the box's top
      for (let k = ups.length - 1; k >= 0; k -= 1) if (b[i].l <= ups[k] && !gapUp) { ups.splice(k, 1); filled += 1 }
      for (let k = downs.length - 1; k >= 0; k -= 1) if (b[i].h >= downs[k] && !gapDown) { downs.splice(k, 1); filled += 1 }
      open.push(ups.length + downs.length)
    }
    expect(up.reduce((a, x) => a + x, 0), 'the walk has no gap up').toBeGreaterThan(3)
    expect(down.reduce((a, x) => a + x, 0), 'the walk has no gap down').toBeGreaterThan(3)
    expect(filled, 'no gap is ever filled').toBeGreaterThan(5)
    expect(Math.max(...open), 'no gap ever stays open').toBeGreaterThan(1)
    expect(trimmed).toBeGreaterThanOrEqual(0)
    const [gotOpen, gotUp, gotDown] = engineColumns('gap-zones')
    same(gotOpen, open, 'open gaps', { from: 1 })
    same(gotUp, up, 'gap up', { from: 1 })
    same(gotDown, down, 'gap down', { from: 1 })
  },

  'regression-channel': () => {
    const b = BARS.daily, c = C(b), n = 100
    const mid = [], upper = [], lower = []
    for (let i = 0; i < c.length; i += 1) {
      if (i < n - 1) { mid.push(NAN); upper.push(NAN); lower.push(NAN); continue }
      // least squares of the last n closes against 0..n-1 (the newest bar is x = n - 1)
      let sx = 0, sy = 0, sxy = 0, sxx = 0
      for (let k = 0; k < n; k += 1) { const y = c[i - n + 1 + k]; sx += k; sy += y; sxy += k * y; sxx += k * k }
      const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx), intercept = (sy - slope * sx) / n
      let sq = 0
      for (let k = 0; k < n; k += 1) sq += (c[i - n + 1 + k] - (intercept + slope * k)) ** 2
      const dev = Math.sqrt(sq / n), at = intercept + slope * (n - 1)
      mid.push(at); upper.push(at + 2 * dev); lower.push(at - 2 * dev)
    }
    const got = engineColumns('regression-channel')
    // the line is exact; the engine's slope is a difference of two fitted values, so the band is held to a millionth
    same(got[0], mid, 'regression line', { from: n, rel: 1e-9 })
    same(got[1], upper, 'upper', { from: n, rel: 1e-6 })
    same(got[2], lower, 'lower', { from: n, rel: 1e-6 })
    // ⛔ and it is NOT two deviations of the close: on a trending stretch that band is far wider
    let apart = 0
    for (let i = n; i < c.length; i += 1) {
      let m = 0, s2 = 0
      for (let k = 0; k < n; k += 1) m += c[i - k] / n
      for (let k = 0; k < n; k += 1) s2 += (c[i - k] - m) ** 2 / n
      if (Math.abs((mid[i] + 2 * Math.sqrt(s2)) - upper[i]) / upper[i] > 0.01) apart += 1
    }
    expect(apart, 'the two bands never differ by 1%: the walk cannot tell them apart').toBeGreaterThan(200)
  },

  'schaff-trend-cycle': () => {
    const b = BARS.daily, c = C(b)
    const fast = ema(c, 23), slow = ema(c, 50), m = c.map((_, i) => fast[i] - slow[i])
    const want = []
    let k1 = NAN, d1 = NAN, k2 = NAN, stc = NAN
    const d1s = []
    for (let i = 0; i < c.length; i += 1) {
      if (i < 9) { d1s.push(NAN); want.push(NAN); continue }
      const lo1 = minOf(m, i, 10), r1 = maxOf(m, i, 10) - lo1
      k1 = r1 > 0 ? (m[i] - lo1) / r1 * 100 : (ok(k1) ? k1 : 0)
      d1 = ok(d1) ? d1 + 0.5 * (k1 - d1) : k1
      d1s.push(d1)
      if (i < 18) { want.push(NAN); continue }
      const lo2 = minOf(d1s, i, 10), r2 = maxOf(d1s, i, 10) - lo2
      k2 = r2 > 0 ? (d1 - lo2) / r2 * 100 : (ok(k2) ? k2 : 0)
      stc = ok(stc) ? stc + 0.5 * (k2 - stc) : k2
      want.push(stc)
    }
    const [got, upper, lower] = engineColumns('schaff-trend-cycle')
    // the two averages are seeded differently on the first bars; long after, the cycle is the same number
    same(got, want, 'Schaff Trend Cycle', { from: 1500, rel: 1e-6 })
    expect(upper.every((x) => x === 75) && lower.every((x) => x === 25)).toBe(true)
    const tail = want.slice(1500)
    expect(Math.min(...tail)).toBeLessThan(5)
    expect(Math.max(...tail)).toBeGreaterThan(95)
    // ⛔ one stage is a different indicator: the first stage alone is not the cycle
    let differs = 0
    for (let i = 1500; i < c.length; i += 1) if (Math.abs(d1s[i] - want[i]) > 1) differs += 1
    expect(differs).toBeGreaterThan(100)
  },

  'weekday-returns-table': () => {
    const b = BARS.daily, last = b.length - 1, n = 500
    const sums = new Array(7).fill(0), counts = new Array(7).fill(0)
    for (let i = 0; i < n; i += 1) {
      const at = last - i
      const d = new Date(`${b[at].t}T00:00:00Z`).getUTCDay()          // 0 is Sunday, as `dayofweek - 1` is
      sums[d] += b[at].c / b[at - 1].c - 1
      counts[d] += 1
    }
    expect(counts[0] + counts[6]).toBe(0)
    expect(counts.slice(1, 6).every((k) => k === 100)).toBe(true)
    let best = NAN
    for (let d = 0; d < 7; d += 1) if (counts[d] > 0) { const avg = sums[d] / counts[d] * 100; if (!ok(best) || avg > best) best = avg }
    const want = new Array(b.length).fill(NAN)
    want[last] = best
    const [got] = engineColumns('weekday-returns-table')
    same(got, want, 'best day\'s average return')
  },

  'prior-day-levels': () => {
    const b = BARS.daily
    const prior = (f) => b.map((_, i) => (i === 0 ? NAN : b[i - 1][f]))
    const [hi, lo, cl] = engineColumns('prior-day-levels')
    same(hi, prior('h'), 'prior day high')
    same(lo, prior('l'), 'prior day low')
    same(cl, prior('c'), 'prior day close')
  },

  'anchored-vwap-date': () => {
    const b = BARS.daily, want = []
    let sumV = 0, sumPV = 0, started = 0
    for (let i = 0; i < b.length; i += 1) {
      const [y, m, d] = ymd(b[i].t)
      const on = y > 2026 || (y === 2026 && (m > 1 || (m === 1 && d >= 1)))
      if (on) { sumV += b[i].v; sumPV += (b[i].h + b[i].l + b[i].c) / 3 * b[i].v; started += 1 }
      want.push(on ? sumPV / sumV : NAN)
    }
    expect(started, 'the anchor is not inside the walk').toBeGreaterThan(100)
    expect(started).toBeLessThan(b.length - 100)
    const [got] = engineColumns('anchored-vwap-date')
    same(got, want, 'anchored VWAP', { rel: 1e-9 })
  },

  'opening-range': () => {
    const b = BARS.intraday, hi = [], lo = []
    let dayStart = NAN, orHigh = NAN, orLow = NAN
    for (let i = 0; i < b.length; i += 1) {
      const newDay = i > 0 && ymd(b[i].t)[2] !== ymd(b[i - 1].t)[2]
      if (newDay) { dayStart = b[i].t * 1000; orHigh = b[i].h; orLow = b[i].l }
      const inRange = ok(dayStart) && b[i].t * 1000 - dayStart < 30 * 60000
      if (inRange && !newDay) { orHigh = Math.max(orHigh, b[i].h); orLow = Math.min(orLow, b[i].l) }
      hi.push(!inRange ? orHigh : NAN)
      lo.push(!inRange ? orLow : NAN)
    }
    const [gotHi, gotLo] = engineColumns('opening-range')
    same(gotHi, hi, 'opening range high')
    same(gotLo, lo, 'opening range low')
    // the range is the first SIX five-minute bars of a day, held for the rest of it
    const day2 = 78 * 2
    expect(hi[day2 + 6]).toBe(Math.max(...b.slice(day2, day2 + 6).map((x) => x.h)))
    expect(hi[day2 + 77]).toBe(hi[day2 + 6])
    expect(ok(hi[day2 + 5])).toBe(false)
  },

  'fibonacci-swings': () => {
    const b = BARS.daily, h = H(b), l = L(b), hi = [], lo = [], golden = []
    let swingHigh = NAN, swingLow = NAN, highBar = NAN, lowBar = NAN, ups = 0, downs = 0
    for (let i = 0; i < b.length; i += 1) {
      const ph = pivot(h, 10, 10, i, true), pl = pivot(l, 10, 10, i, false)
      if (ok(ph)) { swingHigh = ph; highBar = i - 10 }
      if (ok(pl)) { swingLow = pl; lowBar = i - 10 }
      hi.push(swingHigh); lo.push(swingLow)
      if (ok(swingHigh) && ok(swingLow)) {
        // measured DOWN from the high when the high is the later swing, UP from the low otherwise
        const up = highBar > lowBar
        if (up) ups += 1; else downs += 1
        golden.push(up ? swingHigh - (swingHigh - swingLow) * 0.618 : swingLow + (swingHigh - swingLow) * 0.618)
      } else golden.push(NAN)
    }
    const [gotHi, gotLo, gotGolden] = engineColumns('fibonacci-swings')
    same(gotHi, hi, 'swing high')
    same(gotLo, lo, 'swing low')
    same(gotGolden, golden, '61.8% level')
    expect(new Set(hi.filter(ok)).size).toBeGreaterThan(20)
    expect(ups).toBeGreaterThan(100)
    expect(downs).toBeGreaterThan(100)
  },

  'auto-trendlines': () => {
    const b = BARS.daily, h = H(b), l = L(b), res = [], sup = []
    let h1 = NAN, h1x = NAN, h2 = NAN, h2x = NAN, l1 = NAN, l1x = NAN, l2 = NAN, l2x = NAN
    for (let i = 0; i < b.length; i += 1) {
      const ph = pivot(h, 10, 10, i, true), pl = pivot(l, 10, 10, i, false)
      if (ok(ph)) { h1 = h2; h1x = h2x; h2 = ph; h2x = i - 10 }
      if (ok(pl)) { l1 = l2; l1x = l2x; l2 = pl; l2x = i - 10 }
      res.push(ok(h1) ? h2 + (h2 - h1) / (h2x - h1x) * (i - h2x) : NAN)
      sup.push(ok(l1) ? l2 + (l2 - l1) / (l2x - l1x) * (i - l2x) : NAN)
    }
    const [gotRes, gotSup] = engineColumns('auto-trendlines')
    same(gotRes, res, 'resistance line here', { rel: 1e-9 })
    same(gotSup, sup, 'support line here', { rel: 1e-9 })
  },
}

describe('what each recipe plots equals an independent calculation', () => {
  it('every recipe is value-checked here, or named with the reason it is not', () => {
    const ids = RECIPE_INDEX.recipes.map((r) => r.id)
    expect([...Object.keys(CHECKS), ...Object.keys(NOT_VALUE_CHECKED)].sort()).toEqual([...ids].sort())
    expect(Object.keys(CHECKS).filter((id) => id in NOT_VALUE_CHECKED)).toEqual([])
    for (const why of Object.values(NOT_VALUE_CHECKED)) expect(why.length).toBeGreaterThan(20)
  })

  for (const id of Object.keys(CHECKS)) {
    it(`${id}`, () => { CHECKS[id]() }, 300_000)
  }

  // ⛔ A BATCH RUN REACHES `barstate.islast` ONCE, WITH EVERY LIST STILL EMPTY, so the code that
  // deletes the last picture before drawing the next never runs in any proof above. A live chart
  // runs it every time a bar arrives. Here every recipe that redraws on the last bar is run with
  // that condition true on EVERY bar: its delete-and-redraw path runs hundreds of times, must
  // finish, and must leave the same last-bar numbers. (Found the hard way: a drawing deleted in
  // one call with `array.pop` stays in its list on this engine, and such a loop never ends.)
  const REDRAWS = RECIPE_INDEX.recipes.map((r) => r.id).filter((id) => sourceOf(id).includes('barstate.islast'))
  it('the recipes that redraw on the last bar are the ones expected', () => {
    expect(REDRAWS.sort()).toEqual(['fibonacci-swings', 'volume-profile', 'weekday-returns-table'])
  })
  for (const id of REDRAWS) {
    it(`${id}: its redraw runs on every bar and ends with the same numbers`, () => {
      const bars = BARS[chartOf(id)].slice(0, 800)
      const every = sourceOf(id).split('barstate.islast').join('true')
      expect(every).not.toBe(sourceOf(id))
      const once = engineColumns(id, sourceOf(id), bars)
      const always = engineColumns(id, every, bars)                    // a refusal (a loop that never ends) fails inside
      const last = bars.length - 1
      expect(always).toHaveLength(once.length)
      for (let k = 0; k < once.length; k += 1) {
        if (ok(once[k][last])) expect(close2(always[k][last], once[k][last], 1e-9), `${id}: output ${k + 1} on the last bar`).toBe(true)
      }
      expect(once.some((col) => ok(col[last])), `${id}: nothing to compare on the last bar`).toBe(true)
    }, 300_000)
  }

  // ⛔ WHY THERE IS NO "TREND ON THE WEEKLY AND MONTHLY" TABLE RECIPE. A weekly read has no value on the
  // chart's NEWEST bar while that week is forming, and neither has anything computed from it: reading
  // it one bar back, `nz()`, and `na(x) ? x[1] : x` were each tried and each is blank on that bar (since
  // engine 84, #1996, one bar back draws there: it is the bar before's settled merge, not this bar's). A
  // table written on the last bar from such a read cannot be right on most days, so the recipe was
  // removed rather than shipped; the limit is said to the assistant (`RUN_STOP_WORDS`).
  // ⭐ It follows the generated answer (`stops`, regenerated after an engine change), so an engine fix
  // is never a red here: while the stop stands, every rewrite is blank on that bar; once it does not,
  // the plain read has a value there AND THE RECIPE CAN COME BACK (`write_recipes.py`, studio track).
  it('a weekly read on a mid-week newest bar: blank under every rewrite while that stop stands, a value once it does not', () => {
    const stands = GENERATED.stops.find((s) => s.id === 'higher-timeframe-newest-bar').standing
    const midWeek = BARS.daily.slice(0, -3)
    const last = midWeek.length - 1
    expect(new Date(`${midWeek[last].t}T00:00:00Z`).getUTCDay()).toBe(2)                     // a Tuesday
    const L = String.fromCharCode(10)
    const script = (line) => ['//@version=5', 'indicator("probe")', 'wk = request.security(syminfo.tickerid, "W", close > open ? 1 : 0)',
      line, 'plot(shown, "Shown")', 'plot(wk, "Read")'].join(L) + L
    const run = (line) => {
      const pane = memberPaneDefinition({ source: script(line), id: `u_value_${made += 1}`, name: 'probe' })
      expect(pane.ok, pane.reason || '').toBe(true)
      const cols = registry.computeFor(pane.definition, midWeek, undefined, recipeContext('daily', 'fromListing'))
      expect(registry.columnErrors(cols) || {}).toEqual({})
      return Object.keys(cols).map((k) => Array.from(cols[k]))
    }
    for (const line of ['shown = wk', 'shown = wk[1]', 'shown = nz(wk)', 'shown = na(wk) ? wk[1] : wk']) {
      const [shown, read] = run(line)
      expect(ok(read[last - 1]), line).toBe(true)                    // the bar before has it, on any engine
      expect(ok(shown[last - 1]), line).toBe(true)
      if (stands) {
        expect(ok(read[last]), line).toBe(false)
        // ⭐ engine 84 (HTF-NEWEST-NARROW, #1996): ONE BAR BACK is the bar before's merge, a settled value, so
        // `wk[1]` draws on the newest bar (as TradingView does); everything that reads `wk` ON that bar stays blank
        expect(ok(shown[last]), `${line}: has a value on the newest bar`).toBe(line === 'shown = wk[1]')
      } else if (line === 'shown = wk') {
        expect(ok(read[last]) && ok(shown[last]), line).toBe(true)
      }
    }
  }, 300_000)

  // ⭐ WHY EVERY RECIPE DELETES IN TWO STEPS. While the engine's one-call delete stood
  // (`RUN_STOP_PROBES['delete-in-one-call']`), a trim written as ONE call inside a `while` never ended
  // and the run said so. ⚰️ 2026-11-19: this test asserted that as today's fact; an engine train fixed
  // the delete and master went red on the fix. It follows the generated answer now: while the stop
  // stands the run is refused by its loop limit; once it does not, the one-call script runs and ends
  // with the recipe's own numbers. The two-step form is right either way, so the recipes keep it.
  it('a trim written as ONE call inside a `while`: refused by the loop limit while that stop stands, the recipe\'s own numbers once it does not', () => {
    const LF = String.fromCharCode(10)
    const twice = `if array.size(marks) > keep${LF}    oldLabel = array.shift(marks)${LF}    label.delete(oldLabel)${LF}`
    const src = sourceOf('market-structure')
    expect(src.split(twice).length - 1).toBe(2)
    const oneCall = src.split(twice).join('').replace('trend = higherHigh',
      `while array.size(marks) > keep${LF}    label.delete(array.shift(marks))${LF}trend = higherHigh`)
    expect(oneCall).toContain('label.delete(array.shift(marks))')
    const pane = memberPaneDefinition({ source: oneCall, id: `u_value_${made += 1}`, name: 'recipe' })
    expect(pane.ok).toBe(true)                                       // ⛔ the paste check passes it on any engine
    const cols = registry.computeFor(pane.definition, BARS.daily, undefined, recipeContext('daily', 'fromListing'))
    const errors = Object.values(registry.columnErrors(cols) || {}).map((e) => e.guard)
    const stands = GENERATED.stops.find((s) => s.id === 'delete-in-one-call').standing
    if (stands) {
      expect(errors).toContain('runtime:limit')
    } else {
      expect(errors).toEqual([])
      const got = Object.keys(cols).map((k) => Array.from(cols[k]))
      const want = engineColumns('market-structure')
      expect(got).toHaveLength(want.length)
      for (let k = 0; k < want.length; k += 1) same(got[k], want[k], `one-call trim, output ${k + 1}`)
      // "Labels on the chart" (the second plot) never passes the recipe's own `keep`, and reaches it
      expect(src).toContain('keep = input.int(40, "Labels kept"')
      expect(Math.max(...got[1].filter(ok))).toBe(40)
    }
  }, 300_000)

  it('CONTROL: the comparison can fail (a recipe with one number changed is a different column)', () => {
    const changed = sourceOf('regression-channel').replace('mult = input.float(2.0, "Deviations"', 'mult = input.float(2.5, "Deviations"')
    expect(changed).not.toBe(sourceOf('regression-channel'))
    const [mid, upper] = engineColumns('regression-channel')
    const [mid2, upper2] = engineColumns('regression-channel', changed)
    const i = mid.length - 1
    expect(mid2[i]).toBe(mid[i])
    expect(upper2[i]).toBeGreaterThan(upper[i])
    expect(() => same(upper2, upper, 'control', { from: 100, rel: 1e-6 })).toThrow()
  }, 300_000)
})
