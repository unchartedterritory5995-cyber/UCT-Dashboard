// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.rt6RuntimeColour.test.js
//
// ─── ⭐⭐ RT6 — A RUNTIME ROW CARRIES ITS PER-BAR COLOUR, FROM THE SAME RUN ─────
//
// Lane H4 measured the wall: a runtime document could carry a row's colour only
// as one static colour, so `plot(x, color = cond ? a : b)` was withheld and six
// loop scripts (atr-stepped-pdf-ma-loxx, kalman-price-filter, nadaraya-watson,
// deadband-hysteresis-filter, fvg-trend, parabolic-sar) drew nothing. RT6 makes
// the colour an output of the run that computes the value (`plotColours`), and the
// row reads it per bar through the renderer the host lane's rows use
// (`pool.columnColorsForPlot` → `packedPointColour`).
//
// Two kinds of evidence, never mixed:
//   · fvg-trend HAS a TradingView capture (RDDT 1D, from the listing): its plot
//     colour and its `bgcolor(…, transp=90)` are graded by the harness itself
//     (`gradeCapture`), the verdict a member's chart would get;
//   · the other five have NO capture: each colour column is held to a HAND REPLAY
//     of the script's own colour rule, written here from Pine's semantics (an `na`
//     comparison is false; a `var` keeps its value; `color.new(c, 40)` is `c` at
//     opacity 153/255) over the run's own value column — on NYSE:RDDT's 631
//     listing bars, the bars H4's value replays used. Queued for capture (CAP3):
//     `docs/pine/capture-queue-2026-10-03-rt6-colour.md`.
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'
import { loadCapture, gradeCapture } from './harness'
import { toProductBars } from './ourSide'
import { computeRuntimeColumns } from '../../runtime/runtimeColumns'
import { columnColorsForPlot, packedPointColour, bindingKey } from '../../pool'
import { paintColoursFor } from '../../binder'
import { pineColourHex } from '../../pinePalette'

const REPO = path.resolve(process.cwd(), '..')
const CORPUS = path.join(REPO, 'corpus', 'committed')
const HARNESS = path.join(REPO, 'tests', 'fixtures', 'vendor', 'harness')
const FVG = 'fvg-trend-rddt-1d-2026-09-27.json' // RDDT 1D, starts at the listing
const DEF_ID = 'u_member-pane-rt6'

afterEach(() => { vi.unstubAllEnvs() })

const flagsOn = () => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
}
const corpus = (slug) => {
  const f = fs.readdirSync(CORPUS).find((x) => x.split('__')[0] === slug)
  return fs.readFileSync(path.join(CORPUS, f), 'utf8')
}
let CAP = null
const cap = () => {
  if (CAP) return CAP
  const loaded = loadCapture(path.join(HARNESS, FVG))
  if (!loaded.capture) throw new Error(loaded.reason)
  expect(loaded.capture.history.startsAtBar0).toBe(true)
  CAP = loaded.capture
  return CAP
}
const bars = () => toProductBars(cap())
const isNa = (v) => v === null || v === undefined || Number.isNaN(v)
const up = (s) => (s == null ? s : String(s).toUpperCase())
/** `#RRGGBB` at Pine transparency `t` — the vendor's own opacity byte. */
const atT = (hex, t) => (t > 0 ? `${hex}${Math.round((1 - t / 100) * 255).toString(16).padStart(2, '0')}` : hex).toUpperCase()

/** The runtime document for a corpus script, its columns on the RDDT listing bars,
 *  and a reader for one row's drawn colour per bar. */
function runtimeDoc(slug) {
  flagsOn()
  const d = memberPaneDefinition({ source: corpus(slug), id: DEF_ID })
  expect(d.ok, `${slug}: ${d.reason} ${JSON.stringify(d.runtimeDeclined || null)}`).toBe(true)
  expect(d.lane).toBe('runtime')
  const cols = computeRuntimeColumns(d.definition, bars(), { tf: 'D', newestBarIsForming: false, historyFromListing: true, symbol: { ticker: 'RDDT', exchange: 'NYSE' } })
  const plotOf = (title) => {
    const row = d.rows.find((r) => r.label === title)
    expect(row, `${slug}: row ${title}`).toBeTruthy()
    return d.definition.plots.find((p) => p.key === row.key)
  }
  const coloursOf = (title) => {
    const plot = plotOf(title)
    const cc = columnColorsForPlot(plot)
    expect(cc && cc.packed, `${slug}: ${title} reads a packed colour column`).toBeTruthy()
    const col = cols[cc.key]
    expect(col, `${slug}: colour column ${cc.key}`).toBeTruthy()
    return col.map((c) => up(packedPointColour(cc.packed, c)))
  }
  const valueOf = (title) => cols[plotOf(title).key]
  const paintColours = (kind) => {
    const pcols = new Map(Object.keys(cols).map((k) => [bindingKey('rt6', k), cols[k]]))
    return (d.definition.paints || []).filter((p) => p.kind === kind)
      .map((p) => paintColoursFor(p, 'rt6', pcols, bars().length).map(up))
  }
  return { d, cols, coloursOf, valueOf, paintColours }
}

/** Compare a drawn colour column to a replay where the value is drawn; returns
 *  how many bars wore each colour (non-vacuity: every rule must show both sides). */
function sameColours(got, want, value, label) {
  const tally = new Map()
  let compared = 0
  for (let i = 0; i < want.length; i += 1) {
    if (isNa(value[i])) continue
    compared += 1
    expect(got[i], `${label} bar ${i}`).toBe(want[i])
    tally.set(want[i], (tally.get(want[i]) || 0) + 1)
  }
  expect(compared).toBeGreaterThan(400)
  return tally
}

describe('RT6 — fvg-trend against its TradingView capture (RDDT 1D)', () => {
  it('⭐⭐ the runtime document draws the per-bar plot colour and the `bgcolor(…, transp=90)`, and both agree with TradingView', () => {
    flagsOn()
    const c = cap()
    const v = gradeCapture(c).verdict
    expect(v.verdict).not.toBe('DIVERGE')
    const counter = v.plots.find((p) => p.title === 'fvgCounter')
    expect(counter.verdict).toBe('MATCH')
    expect(counter.color).toBe('compared')
    const bg = v.paints.rows.find((r) => r.kind === 'bgcolor')
    expect(bg.state).toBe('agree')
    // ⚠️ what keeps it from MATCH is NOT a colour: `plot(0, color=color.black)` is a
    // column that reads no bar, which the host translator hides (`hiddenReason:
    // 'constant'`) on both lanes. Named so a later change to that rule reads here.
    const zero = v.plots.find((p) => p.verdict === 'INCONCLUSIVE')
    expect(zero && zero.reason).toMatch(/did not carry this output/)
  })

  it('the transparency rides the paint as written: `transp=90` over an opaque ternary', () => {
    const { d } = runtimeDoc('fvg-trend')
    expect(d.definition.paints).toEqual([
      expect.objectContaining({ kind: 'bgcolor', colorPacked: { transparency: 90 } }),
    ])
  })
})

describe('RT6 — the five loop scripts with no capture, held to a hand replay of their colour rule', () => {
  it('kalman-price-filter: `color.new(barColour, 40)` over a `var` trend colour, and its `barcolor`', () => {
    const { coloursOf, valueOf, paintColours } = runtimeDoc('kalman-price-filter-backquant')
    const v = valueOf('Kalman')
    let trend = 0
    let colour = '#FFFFFF'
    const want = []
    const wantBar = []
    for (let i = 0; i < v.length; i += 1) {
      if (i > 0 && v[i] > v[i - 1]) trend = 1
      if (i > 0 && v[i] < v[i - 1]) trend = -1
      if (trend === 1) colour = '#33FF00'
      if (trend === -1) colour = '#FF0000'
      want.push(atT(colour, 40))
      wantBar.push(colour)
    }
    const tally = sameColours(coloursOf('Kalman'), want, v, 'kalman')
    expect(tally.get(atT('#33FF00', 40))).toBeGreaterThan(50)
    expect(tally.get(atT('#FF0000', 40))).toBeGreaterThan(50)
    const [bar] = paintColours('barcolor')
    expect(bar.length).toBe(v.length)
    for (let i = 0; i < v.length; i += 1) expect(bar[i], `kalman barcolor bar ${i}`).toBe(wantBar[i])
  })

  it('deadband-hysteresis-filter: `color.new(barColour, 40)` from `input.color`s, and its `barcolor`', () => {
    const { coloursOf, valueOf, paintColours } = runtimeDoc('deadband-hysteresis-filter-backquant')
    const v = valueOf('DBHF')
    let trend = 0
    let colour = '#FFFFFF'
    const want = []
    const wantBar = []
    for (let i = 0; i < v.length; i += 1) {
      if (i > 0 && v[i] > v[i - 1]) trend = 1
      if (i > 0 && v[i] < v[i - 1]) trend = -1
      if (trend === 1) colour = '#33FF00'
      if (trend === -1) colour = '#FF0000'
      want.push(atT(colour, 40))
      wantBar.push(colour)
    }
    const tally = sameColours(coloursOf('DBHF'), want, v, 'deadband')
    expect(tally.get(atT('#33FF00', 40))).toBeGreaterThan(20)
    expect(tally.get(atT('#FF0000', 40))).toBeGreaterThan(20)
    const [bar] = paintColours('barcolor')
    for (let i = 0; i < v.length; i += 1) expect(bar[i], `deadband barcolor bar ${i}`).toBe(wantBar[i])
  })

  it('nadaraya-watson: `smoothColors` off, so the rate rule `yhat1[1] < yhat1 ? bullish : bearish`', () => {
    const { coloursOf, valueOf } = runtimeDoc('nadaraya-watson-rational-quadratic-kernel-non-repainting')
    const v = valueOf('Rational Quadratic Kernel Estimate')
    const want = v.map((x, i) => (i > 0 && v[i - 1] < x ? '#3AFF17' : '#FD1707'))
    const tally = sameColours(coloursOf('Rational Quadratic Kernel Estimate'), want, v, 'nw')
    expect(tally.get('#3AFF17')).toBeGreaterThan(50)
    expect(tally.get('#FD1707')).toBeGreaterThan(50)
  })

  it('atr-stepped-pdf-ma: `contSwitch == 1 ? green : red`, the switch replayed from the stepped line', () => {
    const { d, coloursOf, valueOf } = runtimeDoc('atr-stepped-pdf-ma-loxx')
    const v = valueOf('ATR-Stepped, PDF MA')
    let sw = 0
    const want = []
    for (let i = 0; i < v.length; i += 1) {
      const a = v[i]; const b = i > 0 ? v[i - 1] : NaN; const c = i > 1 ? v[i - 2] : NaN
      const crossUp = a > b && b <= c
      const crossDn = a < b && b >= c
      sw = crossUp ? 1 : crossDn ? -1 : sw
      want.push(sw === 1 ? '#2DD204' : '#D2042D')
    }
    const tally = sameColours(coloursOf('ATR-Stepped, PDF MA'), want, v, 'atr-stepped')
    expect(tally.get('#2DD204')).toBeGreaterThan(20)
    expect(tally.get('#D2042D')).toBeGreaterThan(20)
    // `colorbars` defaults false: its `barcolor` paints nothing, on TradingView too.
    expect(d.definition.paints).toBeUndefined()
  })

  it('parabolic-sar (v4): `trend > 0 ? colup : coldn`, the SAR replayed whole (value AND colour)', () => {
    const { coloursOf, valueOf } = runtimeDoc('parabolic-sar')
    const rows = bars()
    const high = rows.map((r) => r.h)
    const low = rows.map((r) => r.l)
    const start = 0.02; const increment = 0.02; const maximum = 0.2
    let trend = 0; let sar = NaN; let ep = 0; let af = 0
    const sars = []
    const trends = []
    for (let i = 0; i < rows.length; i += 1) {
      // `trend := nz(trend[1])` … `sar := sar[1]` — the previous bar's values
      if (trend === 0 && i > 0) {
        trend = high[i] >= high[i - 1] || low[i] >= low[i - 1] ? 1 : -1
        sar = trend > 0 ? low[i - 1] : high[i - 1]
        ep = trend > 0 ? high[i - 1] : low[i - 1]
        af = start
      } else if (i > 0) {
        let next = sar
        if (trend > 0) {
          if (high[i - 1] > ep) { ep = high[i - 1]; af = Math.min(maximum, af + increment) }
          next = sar + af * (ep - sar)
          next = Math.min(Math.min(low[i - 1], i > 1 ? low[i - 2] : NaN), next)
          if (next > low[i]) { trend = -1; next = ep; ep = low[i]; af = start }
        } else {
          if (low[i - 1] < ep) { ep = low[i - 1]; af = Math.min(maximum, af + increment) }
          next = sar + af * (ep - sar)
          next = Math.max(Math.max(high[i - 1], i > 1 ? high[i - 2] : NaN), next)
          if (next < high[i]) { trend = 1; next = ep; ep = high[i]; af = start }
        }
        sar = next
      }
      sars.push(sar)
      trends.push(trend)
    }
    const v = valueOf('Parabolic SAR')
    // the value replay first: if it agrees, the trend it carries is the script's
    let agree = 0
    for (let i = 0; i < v.length; i += 1) {
      expect(isNa(v[i]), `psar bar ${i} na-ness`).toBe(isNa(sars[i]))
      if (!isNa(v[i])) { expect(Math.abs(v[i] - sars[i])).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(v[i]))); agree += 1 }
    }
    expect(agree).toBeGreaterThan(600)
    const lime = up(pineColourHex('color.lime', 4))
    const red = up(pineColourHex('color.red', 4))
    expect(lime).toMatch(/^#[0-9A-F]{6}$/)
    const want = trends.map((t) => (t > 0 ? lime : red))
    const tally = sameColours(coloursOf('Parabolic SAR'), want, v, 'psar')
    expect(tally.get(lime)).toBeGreaterThan(100)
    expect(tally.get(red)).toBeGreaterThan(100)
  })
})
