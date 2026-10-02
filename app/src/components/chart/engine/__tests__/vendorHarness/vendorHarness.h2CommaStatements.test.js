// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.h2CommaStatements.test.js
//
// ─── ⭐⭐ H2 (step 69) — A COMMA LINE OF STATEMENTS, ON REAL BARS ────────────
//
// `ast/pine.js::commaStatementSplit` reads `a = x, b := y` as the statements Pine
// runs, left to right. Two corpus scripts attach at the member door through it:
//
//   pa-zigzag-fibonacci-fan   `int _dir = na , _dir := … nz(_dir[1])` in a helper
//   auto-trendline-dojiemoji  `recent_dn2:=recent_dn1, i_recent_dn2 := …` in an `if`
//
// No TradingView capture of either exists. The evidence is therefore the program's
// second rule: the drawn columns, on NYSE:RDDT's 631 listing bars, against an
// INDEPENDENT per-bar evaluation —
//
//   pa-zigzag      the runtime lane (`computeRuntimeColumns`, its own VM), all 9 plots
//   auto-trendline a hand replay of the script below (the runtime lane refuses its
//                  `switch` without a default, so it cannot be the witness), with the
//                  pivot rule H1 graded against TradingView (a tie on the LEFT pivots)
//
// and argued from Pine semantics: a comma separates statements that run in order.
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import * as registry from '../../nativeRegistry'
import { loadCapture } from './harness'
import { runOurSide, toProductBars, HARNESS_DEF_ID } from './ourSide'
import { computeRuntimeColumns, probeRuntimeProgram } from '../../runtime/runtimeColumns'

const REPO = path.resolve(process.cwd(), '..')
const CORPUS = path.join(REPO, 'corpus', 'committed')
const OBJECTS = 'VITE_PINE_OBJECTS_ONLY_PANE_ENABLED'
const BARS_FROM = 'trendlines-rddt-1d-2026-09-27.json' // RDDT 1D, starts at the listing

const corpus = (slug) => {
  const f = fs.readdirSync(CORPUS).find((x) => x.split('__')[0] === slug)
  return fs.readFileSync(path.join(CORPUS, f), 'utf8')
}
const base = () => {
  const loaded = loadCapture(path.join(REPO, 'tests', 'fixtures', 'vendor', 'harness', BARS_FROM))
  if (!loaded.capture) throw new Error(loaded.reason)
  expect(loaded.capture.history.startsAtBar0).toBe(true) // the listing witness the window needs
  return loaded.capture
}
const isNa = (v) => v === null || v === undefined || Number.isNaN(v)
const columnOf = (plot, n) => Array.from({ length: n }, (_, i) => (plot.column || {})[i])
const host = (source) => {
  const cap = { ...base(), source: { ...base().source, text: source } }
  const ours = runOurSide(cap)
  registry.uninstallUserDefinition(HARNESS_DEF_ID)
  return { cap, ours }
}

afterEach(() => {
  registry.uninstallUserDefinition(HARNESS_DEF_ID)
  vi.unstubAllEnvs()
})

describe('H2 — pa-zigzag-fibonacci-fan: host lane equals the runtime lane on every bar', () => {
  it('⭐⭐ all nine plots, every drawn bar the same value, every withheld bar withheld by both', () => {
    vi.stubEnv(OBJECTS, '1')
    const source = corpus('pa-zigzag-fibonacci-fan')
    const { cap, ours } = host(source)
    expect(ours.ok, ours.refusal).toBe(true)
    const probe = probeRuntimeProgram(source)
    expect(probe.ok).toBe(true)
    const n = cap.bars.rows.length
    expect(ours.plots.length).toBe(9)
    let drawn = 0
    ours.plots.forEach((p, k) => {
      const ourCol = columnOf(p, n)
      const rt = computeRuntimeColumns({ id: 'x', compute: { fn: 'x', source, outputs: { v: k } } },
        toProductBars(cap), { tf: 'D', newestBarIsForming: false, historyFromListing: true }).v
      for (let i = 0; i < n; i += 1) {
        expect(isNa(ourCol[i]), `${p.title} bar ${i}`).toBe(isNa(rt[i]))
        if (!isNa(ourCol[i])) {
          drawn += 1
          expect(Math.abs(ourCol[i] - rt[i]), `${p.title} bar ${i}`).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(rt[i])))
        }
      }
    })
    expect(drawn).toBeGreaterThan(9 * 250) // non-vacuity: hundreds of drawn bars per plot
  })
})

/** The script's own arithmetic, bar by bar (auto-trendline-dojiemoji, inputs as given). */
function replayAutoTrendline(bars, { showHH, showLH, showLL, showHL, showCross }, n = 10) {
  const H = bars.map((b) => b.h); const L = bars.map((b) => b.l); const C = bars.map((b) => b.c)
  const N = bars.length
  // ta.pivothigh(n, n) at bar t: candidate c = t - n; a LEFT bar may equal it, a RIGHT bar may not
  const piv = (src, t, hi) => {
    const c = t - n
    if (c - n < 0 || t >= N) return NaN
    const v = src[c]
    for (let j = c - n; j < c; j += 1) if (hi ? src[j] > v : src[j] < v) return NaN
    for (let j = c + 1; j <= c + n; j += 1) if (hi ? src[j] >= v : src[j] <= v) return NaN
    return v
  }
  const nn = (v) => !Number.isNaN(v)
  let up1 = NaN, up2 = NaN, dn1 = NaN, dn2 = NaN, iu1 = NaN, iu2 = NaN, id1 = NaN, id2 = NaN
  let yuPrev = NaN, ydPrev = NaN
  const out = { HH: [], LH: [], LL: [], HL: [], 'Crossed upper trendline': [], 'Crossed lower trendline': [] }
  for (let t = 0; t < N; t += 1) {
    const upf = t >= 1 && nn(piv(H, t - 1, true))
    const dnf = t >= 1 && nn(piv(L, t - 1, false))
    if (dnf) { dn2 = dn1; id2 = id1; dn1 = L[t - n - 1]; id1 = t - n - 1 }
    if (upf) { up2 = up1; iu2 = iu1; up1 = H[t - n - 1]; iu1 = t - n - 1 }
    const gt = (a, b) => nn(a) && nn(b) && a > b
    const lt = (a, b) => nn(a) && nn(b) && a < b
    const slope = (xA, yA, xB, yB) => ([xA, yA, xB, yB].every(nn) && xB !== xA ? (yB - yA) / (xB - xA) : NaN)
    const md = slope(id1, dn1, id2, dn2); const yd = nn(md) ? md * t + dn1 - md * id1 : NaN
    const mu = slope(iu1, up1, iu2, up2); const yu = nn(mu) ? mu * t + up1 - mu * iu1 : NaN
    const cross = (a, b, ap, bp) => [a, b, ap, bp].every(nn) && ((a > b && ap <= bp) || (a < b && ap >= bp))
    const cPrev = t ? C[t - 1] : NaN
    out.HH.push(showHH && upf && gt(up1, up2)); out.LH.push(showLH && upf && lt(up1, up2))
    out.LL.push(showLL && dnf && lt(dn1, dn2)); out.HL.push(showHL && dnf && gt(dn1, dn2))
    out['Crossed upper trendline'].push(showCross && cross(C[t], yu, cPrev, yuPrev))
    out['Crossed lower trendline'].push(showCross && cross(C[t], yd, cPrev, ydPrev))
    yuPrev = yu; ydPrev = yd
  }
  return out
}

describe('H2 — auto-trendline-dojiemoji: host lane equals a hand replay of the script', () => {
  const allOn = (s) => s
    .replace('input.bool(false, title="LL"', 'input.bool(true, title="LL"')
    .replace('input.bool(false, title="HH"', 'input.bool(true, title="HH"')
    .replace('input.bool(false, title="Show crosses"', 'input.bool(true, title="Show crosses"')

  for (const [label, edit, flags] of [
    ['as published', (s) => s, { showHH: false, showLH: true, showLL: false, showHL: true, showCross: false }],
    ['every marker switched on', allOn, { showHH: true, showLH: true, showLL: true, showHL: true, showCross: true }],
  ]) {
    it(`⭐⭐ ${label}: every bar the host draws is the replay's answer, and it draws the replay's every mark`, () => {
      vi.stubEnv(OBJECTS, '1')
      const source = edit(corpus('auto-trendline-dojiemoji'))
      if (label !== 'as published') expect(source).not.toBe(corpus('auto-trendline-dojiemoji')) // the edit landed
      const { cap, ours } = host(source)
      expect(ours.ok, ours.refusal).toBe(true)
      const n = cap.bars.rows.length
      const want = replayAutoTrendline(toProductBars(cap), flags)
      let marks = 0
      for (const p of ours.plots) {
        const expected = want[p.title]
        expect(expected, p.title).toBeTruthy()
        if (!p.column) { // a constant-false row the pane does not draw
          expect(expected.some(Boolean), p.title).toBe(false)
          continue
        }
        const col = columnOf(p, n)
        for (let i = 0; i < n; i += 1) {
          if (isNa(col[i])) continue // withheld by name (the window had not settled)
          expect(col[i] !== 0, `${p.title} bar ${i}`).toBe(expected[i])
        }
        // ⛔ withholding must not hide a mark: every replay mark is a drawn bar
        expected.forEach((on, i) => { if (on) { expect(isNa(col[i]), `${p.title} bar ${i} withheld`).toBe(false); marks += 1 } })
      }
      expect(marks).toBeGreaterThan(label === 'as published' ? 5 : 50) // non-vacuity
    })
  }
})
