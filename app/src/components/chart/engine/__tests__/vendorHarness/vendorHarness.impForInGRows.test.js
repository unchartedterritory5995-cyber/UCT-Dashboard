// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.impForInGRows.test.js
//
// ─── ⭐⭐⭐ IMP-1 — THE WALKED LIST CHANGED IN THE WALK, THROUGH THE RUNTIME LANE, AGAINST TRADINGVIEW ───
//
// ⭐ THE WITNESS — `vw-forin-collections-2-rddt-1d-2026-10-02` (NYSE:RDDT 1D, from the listing;
// probe `tools/visual_conformance/probes/vw-forin-collections-2.pine`, Pine v5). Captured in October
// and graded on NO lane until now: the member door's host lane refuses the probe (`pine:reassign`)
// and the runtime lane refused every G-row by name (`forInRule.js::forInMutationRefusal`). This rail
// runs the CAPTURE'S OWN PROGRAM, unchanged, through the runtime lane (`buildRuntimeIr` with
// `objectsInRun`, `pane: true`, lowered by `lowerIrProgram`, run by the VM over the capture's bars)
// and compares each G-row and the control on every captured bar:
//
//   G01 the body REMOVES the element it stands on   3 passes over five
//   G02 the body POPS                               3
//   G03 the body UNSHIFTS (4 at most)               7 passes over three
//   G04 the body INSERTS at 0 (4 at most)           7
//   G05 the body CLEARS on its first pass           1
//   G06 the body REASSIGNS the list variable        5: the walk keeps the list it started with
//   G07 a HELPER handed the list shifts it          3: the helper's change is the walk's change
//   C00 bar_index
//
// The S/P rows of the same probe (sized and non-`var` drawing lists, `label.all` positions) ask
// other questions; the vendor harness corpus grades them with the rest of the capture.
//
// ⭐ CONTROLS: the two models the capture rules out are written out below and must NOT match — a
// walk of the list the loop STARTED with (a copy: every G-row 5 / 3 passes) and a walk that re-reads
// the list VARIABLE every pass (G06: 1 pass) — so this rail tells the rule from its alternatives.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../../runtime/lowerIr.js'
import { execute } from '../../runtime/vm.js'
import { forInHelperHeldRefusal } from '../../ast/forInRule.js'

const DIR = path.resolve(process.cwd(), '..', 'tests/fixtures/vendor/harness')
const CAP = JSON.parse(fs.readFileSync(path.join(DIR, 'vw-forin-collections-2-rddt-1d-2026-10-02.json'), 'utf8'))
const PROBE = path.resolve(process.cwd(), '..', 'tools/visual_conformance/probes/vw-forin-collections-2.pine')

const barsOf = (cap) => cap.bars.rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v: v == null ? 0 : v }))
const seriesOf = (bars) => ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(bars.map((b) => b[k])))
/** The capture's row titled `title`, aligned to its bars by time (NaN for `na`). */
const rowOf = (cap, title) => {
  const plot = cap.study.plots.find((p) => p.title === title)
  expect(plot, title).toBeTruthy()
  const at = cap.plotValues.fields.indexOf(plot.id)
  const byTime = new Map(cap.plotValues.rows.map((r) => [r[0], r[at] == null ? NaN : r[at]]))
  return cap.bars.rows.map((b) => (byTime.has(b[0]) ? byTime.get(b[0]) : undefined))
}
const TITLES = CAP.study.plots.map((p) => p.title)
const G_TITLES = TITLES.filter((t) => /^G0[1-7]_/.test(t) || t === 'C00_bar_index_CONTROL')

// ⛔ G07 is HELD in the product (`pineRuntimeFrontend.js::FOR_IN_HELPER_SERVED`, queue row Q-IMP-H): the
// one sample script it frees diverges from its own capture on a defect outside the walk. The grading
// below runs the machinery with the test-only `forInHelpersServed`, so G07 is proven against
// TradingView while it stays shut; the last case pins that the product still refuses it by name.
const SERVE_G07 = { forInHelpersServed: true }
function runLane(src, cap = CAP, extra = SERVE_G07) {
  const bars = barsOf(cap)
  const built = buildRuntimeIr(src, { bars, inputs: {}, objectsInRun: true, pane: true, tf: 'D', basePeriod: 'D', ...extra })
  if (!built.ok) throw new Error(`refused ${built.refusal.guard}: ${built.refusal.message}`)
  const program = lowerIrProgram(built.ir, { historyFromListing: true })
  const r = execute(program, {
    bars: bars.length, series: seriesOf(bars), columns: program.columns, confirmed: true, barTimes: bars.map((b) => b.t),
  })
  return { outputs: r.outputs.map((o) => Array.from(o)), bars }
}
const same = (a, b) => (Number.isNaN(a) && Number.isNaN(b)) || (!Number.isNaN(a) && !Number.isNaN(b) && Math.abs(a - b) <= 1e-9)
/** The named rows, every captured bar: how many were compared, and the mismatches per title. */
function gradeRows(outputs, titles) {
  const bad = {}
  let compared = 0
  for (const title of titles) {
    const k = TITLES.indexOf(title)
    rowOf(CAP, title).forEach((tv, i) => {
      if (tv === undefined) return
      compared += 1
      if (!same(outputs[k][i], tv)) (bad[title] = bad[title] || []).push({ i, tv, us: outputs[k][i] })
    })
  }
  return { compared, bad }
}
const lastOf = (outputs, title) => outputs[TITLES.indexOf(title)][CAP.bars.rows.length - 1]

describe('IMP-1 — the capture', () => {
  it('is the committed probe, from the listing, ran to the last bar, and asks G01-G07', () => {
    expect(CAP.source.text.replace(/\r\n/g, '\n').trim()).toBe(fs.readFileSync(PROBE, 'utf8').replace(/\r\n/g, '\n').trim())
    expect(CAP.history.startsAtBar0).toBe(true)
    expect(CAP.study.status.type).toBe(2)
    expect(G_TITLES).toEqual(['G01_forin_passes_body_removes', 'G02_forin_passes_body_pops',
      'G03_forin_passes_body_unshifts', 'G04_forin_passes_body_inserts', 'G05_forin_passes_body_clears',
      'G06_forin_passes_body_reassigns', 'G07_forin_passes_helper_shifts', 'C00_bar_index_CONTROL'])
    // TradingView's answers on the last bar, read off the capture
    const last = CAP.plotValues.rows.at(-1)
    expect(G_TITLES.slice(0, 7).map((t) => last[CAP.plotValues.fields.indexOf(CAP.study.plots.find((p) => p.title === t).id)]))
      .toEqual([3, 3, 7, 7, 1, 5, 3])
  })
})

describe('⭐⭐⭐ IMP-1 — the probe, unchanged, MATCHES G01-G07 through the runtime lane', () => {
  it('every G-row and the control, on every captured bar', () => {
    const { outputs } = runLane(CAP.source.text)
    const g = gradeRows(outputs, G_TITLES)
    expect(g.compared).toBe(G_TITLES.length * CAP.bars.rows.length)
    expect(g.bad).toEqual({})
  }, 240000)
})

describe('⛔ G07 HELD — the product refuses the probe at its helper walk, by name', () => {
  it('without the test-only option the build refuses `for l in hs` (G07) with the held sentence', () => {
    const bars = barsOf(CAP)
    const built = buildRuntimeIr(CAP.source.text, { bars, inputs: {}, objectsInRun: true, pane: true, tf: 'D', basePeriod: 'D' })
    expect(built.ok).toBe(false)
    expect(built.refusal.guard).toBe('runtime:loop')
    expect(built.refusal.message).toBe(`a loop in a form this lane does not iterate — \`for … in\`: ${forInHelperHeldRefusal('hs')}`)
  })
})

describe('⛔ CONTROLS — the two models the capture rules out read differently here', () => {
  const src = CAP.source.text.replace(/\r\n/g, '\n')
  it('a walk of the list the loop STARTED with (a copy) makes 5 / 3 / 3 / 5 / 5 passes for G02-G05 and G07', () => {
    // (G01 is left live: over a copy its `array.remove(rm, i)` would index past the shrinking list)
    let byHand = src
    for (const name of ['pp', 'un', 'ins', 'cl', 'hs']) {
      const line = `    for l in ${name}\n`
      expect(byHand.includes(line), name).toBe(true)
      byHand = byHand.replace(line, `    line[] ${name}Copy = array.copy(${name})\n    for l in ${name}Copy\n`)
    }
    const { outputs } = runLane(byHand)
    const titles = ['G02_forin_passes_body_pops', 'G03_forin_passes_body_unshifts', 'G04_forin_passes_body_inserts',
      'G05_forin_passes_body_clears', 'G07_forin_passes_helper_shifts']
    expect(titles.map((t) => lastOf(outputs, t))).toEqual([5, 3, 3, 5, 5])
    // …where TradingView made 3 / 7 / 7 / 1 / 3
    expect(titles.map((t) => rowOf(CAP, t).at(-1))).toEqual([3, 7, 7, 1, 3])
  }, 240000)
  it('a walk that re-reads the list VARIABLE every pass makes 1 pass for G06, not 5', () => {
    const live = src.replace('    for l in ra\n        line.set_x2(l, bar_index + 3)\n        ra := rb\n        p6 += 1\n',
      '    while p6 < array.size(ra)\n        line.set_x2(array.get(ra, p6), bar_index + 3)\n        ra := rb\n        p6 += 1\n')
    expect(live).not.toBe(src)
    const { outputs } = runLane(live)
    expect(lastOf(outputs, 'G06_forin_passes_body_reassigns')).toBe(1)
  }, 240000)
})
