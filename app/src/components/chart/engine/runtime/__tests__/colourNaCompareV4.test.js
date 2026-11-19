// app/src/components/chart/engine/runtime/__tests__/colourNaCompareV4.test.js
//
// ─── ⭐⭐ ENGINE 82 (CO-1) — A PINE v4 COLOUR COMPARED WITH `na` ───────────────────────
//
// Engine 65 (TC) served `==` / `!=` between two colours and refused a colour against the literal `na`
// by name, until probe `vw-tc1-colour-na-compare` was captured. It is: vw-tc1-colour-na-compare-rddt-
// 1d-2026-11-16 (Pine v4, NYSE:RDDT 1D, 667 bars) answers `c != na` (C1) and `c == na` (C2) with 0 on
// EVERY bar, both where `c` is a colour and where it is `na`, exactly as a number beside the literal
// `na` (N1 / N2), which this lane already answered 0; `na(c)` (C3) is the test that sees the `na`.
// So in v4 the colour comparison is lowered as the number one is. Every other version is not captured
// and keeps the refusal, by name. reference:engulfing-sinyal (v4, `alertcondition(Bueng != na, …)`) is
// the sample script it frees (licence-held, so it is not read here).
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { runtimeClockOpts } from '../../ast/pineRuntimeClock.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const REPO = path.resolve(process.cwd(), '..')
const CAP = JSON.parse(fs.readFileSync(path.join(REPO,
  'tests/fixtures/vendor/harness/vw-tc1-colour-na-compare-rddt-1d-2026-11-16.json'), 'utf8'))
const BARS = CAP.bars.rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v: v == null ? 0 : v }))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const T = 60000

const vendorRow = (title) => {
  const k = CAP.study.plots.findIndex((p) => p.title === title)
  expect(k, title).toBeGreaterThanOrEqual(0)
  return CAP.plotValues.rows.map((r) => (r[k + 1] == null ? NaN : r[k + 1]))
}
function run(src) {
  const b = buildRuntimeIr(src, { bars: BARS, inputs: {}, ...runtimeClockOpts(false) })
  if (!b.ok) throw new Error(`refused ${b.refusal.guard}: ${b.refusal.message}`)
  const program = lowerIrProgram(b.ir, { historyFromListing: true })
  return execute(program, { bars: BARS.length, series: SERIES, columns: program.columns, confirmed: true })
    .outputs.map((o) => Array.from(o))
}
const refusalOf = (src) => {
  const b = buildRuntimeIr(src, { bars: BARS, inputs: {}, ...runtimeClockOpts(false) })
  return b.ok ? null : b.refusal
}
const body = 'up = close > open\nc = up ? color.yellow : na\nx = up ? close : na\n'
const v4 = `//@version=4\nstudy("t")\n${body}`
/** Graded bars: every bar but a newest one the capture says was still forming. */
const graded = (n) => (CAP.newestBarIsForming ? n - 1 : n)

describe('CO-1 — Pine v4: `colour != na` and `colour == na` read false on every bar, as TradingView answers', () => {
  for (const [row, expr] of [['C1', 'c != na'], ['C2', 'c == na']]) {
    it(`${row}: \`${expr}\` equals the capture on every graded bar`, () => {
      const theirs = vendorRow(row)
      const [ours] = run(`${v4}plot(${expr} ? 1 : 0)\n`)
      const bad = []
      for (let i = 0; i < graded(ours.length); i += 1) if (ours[i] !== theirs[i]) bad.push(i)
      expect(bad).toEqual([])
      // ⛔ non-vacuous: the capture holds both kinds of bar, a colour and an `na`
      expect(BARS.filter((b) => b.c > b.o).length).toBeGreaterThan(100)
      expect(BARS.filter((b) => !(b.c > b.o)).length).toBeGreaterThan(100)
    }, T)
  }
  it('and it is the NUMBER rule (N1 / N2): one answer for both kinds', () => {
    const [n1, c1] = run(`${v4}plot(x != na ? 1 : 0)\nplot(c != na ? 1 : 0)\n`)
    expect(c1).toEqual(n1)
  }, T)
})

describe('CO-1 — every other version is not captured: refused by name', () => {
  for (const ver of [5, 6]) {
    it(`v${ver}`, () => {
      const r = refusalOf(`//@version=${ver}\nindicator("t")\n${body}plot(c != na ? 1 : 0)\n`)
      expect(r && r.guard).toBe('runtime:colour')
      expect(r.message).toMatch(/captured for Pine v4 only/)
    })
  }
  it('v3 (no capture holds it)', () => {
    const r = refusalOf('//@version=3\nstudy("t")\nup = close > open\nc = up ? #FFFF00 : na\nplot(c != na ? 1 : 0)\n')
    expect(r && r.guard).toBe('runtime:colour')
  })
})
