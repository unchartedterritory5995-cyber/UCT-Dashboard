// app/src/components/chart/engine/runtime/__tests__/taChangeLength.test.js
//
// ─── ⭐⭐ ENGINE NUMBER PENDING (U-STMT PR 1) — `ta.change(source, length)` ON THE RUNTIME LANE ──────
//
// The host has translated `ta.change(source, length)` to Pine's published definition since 2026-10-29
// (`pine.js`, the `mom` expansion: `source - source[length]`, a bool source and a length that is not a
// whole number refused). On the runtime lane a PURE source reaches that rule through the columnar
// resolver; a source held in a SLOT (`var x`, a reassigned name) came to `pineRuntimeFrontend.js`'s
// `changeTarget` branch and was refused as "a closed-table gap", which it had stopped being. That
// refusal held committed:machine-learning-moving-average-backquant__4d7ff59e68 off the chart (its only
// wall, `float featureMomentum = ta.change(compositeFeature, 3)`).
//
// Evidence (docs/pine/evidence/2026-11-18-ustmt-change-length/EVIDENCE.md):
//   v6 reference `ta.change(source, length)`: "Compares the current `source` value to its value `length`
//   bars ago and returns the difference." v4 `change(source, length)`: "Difference between current value
//   and previous, x - x[y]." Capture vw-w4-arm-runs row E01, `plot(ta.change(close, 2))`, is
//   close - close[2] on every graded bar (NYSE:RDDT 1D, AMEX:SPY 1D).
//
// ⭐⭐ AND THE SAME BRANCH HELD A SILENT WRONG VALUE, FOUND BY THIS WORK. It lowered `x - x[1]` off the
// slot's EVERY-BAR ring wherever the call stood, with no region check. Pine keeps a `ta.change` call's
// history per call site (C48): in a `?:` arm the one-argument form is the previous RUN's value
// (vw-arm-history T05 / K03), and `c ? ta.change(x) : 0` over a slot `x` drew the bar-back difference
// instead (RDDT bar 2: 13.80 where the call site's rule answers 9.36). Now: the one-argument form in an
// arm takes the witnessed per-run rule (`servedCondCall`), and anything else in a region that does not
// run on every bar asks `r4Guard` (drawn only while the region has run on every bar, the run stopped by
// name at the first skipped bar: HIST-S3). The pure-source path has always done both.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { runtimeClockOpts } from '../../ast/pineRuntimeClock.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'
import { probeRuntimeProgram } from '../runtimeColumns.js'
import { runGuardOf, runRefusalOf } from './condHistoryOutcome.js'

const REPO = path.resolve(process.cwd(), '..')
const load = (f) => JSON.parse(fs.readFileSync(path.join(REPO, 'tests/fixtures/vendor/harness', f), 'utf8'))
const RDDT = load('vw-w4-arm-runs-rddt-1d-2026-11-16.json')
const SPY = load('vw-w4-arm-runs-spy-1d-2026-11-16.json')
const BACKQUANT = fs.readFileSync(path.join(REPO,
  'corpus/committed/machine-learning-moving-average-backquant__4d7ff59e68.pine'), 'utf8')
const T = 60000

const barsOf = (cap) => cap.bars.rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v: v == null ? 0 : v }))
const seriesOf = (bars) => ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(bars.map((b) => b[k])))
/** The capture's plot `title`, bar by bar (`na` as NaN). */
const vendorRow = (cap, title) => {
  const k = cap.study.plots.findIndex((p) => p.title === title)
  expect(k, `plot ${title} in ${cap.id}`).toBeGreaterThanOrEqual(0)
  return cap.plotValues.rows.map((r) => (r[k + 1] == null ? NaN : r[k + 1]))
}
const head = '//@version=6\nindicator("t")\n'
const slotX = 'var x = 0.0\nx := close\n'

/** Every output of `src` over the capture's bars; throws with the guard when the build refuses. */
function run(src, cap = RDDT) {
  const bars = barsOf(cap)
  const built = buildRuntimeIr(src, { bars, inputs: {}, ...runtimeClockOpts(false) })
  if (!built.ok) throw new Error(`refused ${built.refusal.guard}: ${built.refusal.message}`)
  const program = lowerIrProgram(built.ir, { historyFromListing: true })
  const r = execute(program, { bars: bars.length, series: seriesOf(bars), columns: program.columns, confirmed: true })
  return r.outputs.map((o) => Array.from(o))
}
const refusalOf = (src, cap = RDDT) => {
  const b = buildRuntimeIr(src, { bars: barsOf(cap), inputs: {}, ...runtimeClockOpts(false) })
  return b.ok ? null : b.refusal
}
const same = (a, b) => (Number.isNaN(a) && Number.isNaN(b)) || a === b
/** Bars where `ours` and `theirs` differ, the newest bar left out when the capture says it was forming. */
function differ(cap, ours, theirs) {
  const last = cap.newestBarIsForming ? ours.length - 1 : ours.length
  const out = []
  for (let i = 0; i < last; i += 1) if (!same(ours[i], theirs[i]) && !(Math.abs(ours[i] - theirs[i]) < 1e-9)) out.push(i)
  return out
}

describe('R1 — the witness: E01, ta.change(close, 2) on every bar, over a SLOT source', () => {
  for (const cap of [RDDT, SPY]) {
    it(`${cap.id}: a slot's ta.change(x, 2) is TradingView's E01 on every graded bar`, () => {
      const e01 = vendorRow(cap, 'E01_change2_every_bar')
      const [ours] = run(`${head}${slotX}plot(ta.change(x, 2))\n`, cap)
      expect(ours).toHaveLength(e01.length)
      expect(differ(cap, ours, e01)).toEqual([])
      // ⛔ non-vacuous: the column is not all `na`, and it is not the one-bar change
      expect(ours.filter((v) => Number.isFinite(v)).length).toBeGreaterThan(e01.length - 4)
      const [one] = run(`${head}${slotX}plot(ta.change(x))\n`, cap)
      expect(differ(cap, one, e01).length).toBeGreaterThan(100)
    }, T)
  }
  it('the pure source (the columnar rule the host serves) answers the same column: one definition, two routes', () => {
    const [slot] = run(`${head}${slotX}plot(ta.change(x, 2))\n`)
    const [pure] = run(`${head}plot(ta.change(close, 2))\n`)
    expect(differ(RDDT, slot, pure)).toEqual([])
  }, T)
})

describe('R2 — one definition: ta.change(x, n) is x - x[n] wherever it stands', () => {
  const pairs = {
    'a literal length': ['ta.change(x, 3)', 'x - x[3]'],
    'an input length': ['ta.change(x, len)', 'x - x[len]'],
    'the named arguments, in either order': ['ta.change(length = 2, source = x)', 'x - x[2]'],
    'an expression over a slot (hoisted)': ['ta.change(x * 2, 3)', 'x * 2 - x[3] * 2'],
  }
  for (const [name, [a, b]] of Object.entries(pairs)) {
    it(name, () => {
      const pre = `${head}len = input.int(4, "len")\n${slotX}`
      const [ours] = run(`${pre}plot(${a})\n`)
      const [hand] = run(`${pre}plot(${b})\n`)
      expect(differ(RDDT, ours, hand)).toEqual([])
    }, T)
  }
  it('inside a user function called on every bar: the call site\'s ring, x - x[2]', () => {
    const [ours] = run(`${head}${slotX}f(v) =>\n    ta.change(v, 2)\nplot(f(x))\n`)
    const [hand] = run(`${head}${slotX}plot(x - x[2])\n`)
    expect(differ(RDDT, ours, hand)).toEqual([])
  }, T)
})

describe('R3 — a `?:` arm keeps the call site\'s history (W4-A1, vw-arm-history K03)', () => {
  it('the two-argument form in an arm is never drawn off the every-bar ring: the run stops by name', () => {
    // C01 is NOT x - x[2] once the arm skips a bar (174 of 316 RDDT runs differ), so the every-bar value is
    // drawn only while the arm has run on every bar, and RDDT's arm skips bar 1
    const src = `${head}${slotX}up = close > open\nplot(up ? ta.change(x, 2) : 0.0)\n`
    expect(runGuardOf(src, { bars: barsOf(RDDT) })).toBe('runtime:conditional-history')
    const c01 = vendorRow(RDDT, 'C01_change2_in_true_arm')
    const [bars] = run(`${head}${slotX}up = close > open\nplot(up ? x - x[2] : 0.0)\n`)
    expect(differ(RDDT, bars, c01).length, 'the every-bar reading would have been wrong').toBeGreaterThan(100)
  }, T)
  it('⭐ the one-argument form over a SLOT in an arm is the previous RUN\'s value, as over a pure source', () => {
    const [slot] = run(`${head}${slotX}plot(close > open ? ta.change(x) : 0.0)\n`)
    const [pure] = run(`${head}plot(close > open ? ta.change(close) : 0.0)\n`)
    expect(differ(RDDT, slot, pure)).toEqual([])
    // RDDT bar 2 (up; the previous up bar is bar 0): 59.8 - 50.44, never 59.8 - 46 (the bar before)
    const bars = barsOf(RDDT)
    expect(bars[2].c > bars[2].o && !(bars[1].c > bars[1].o) && bars[0].c > bars[0].o).toBe(true)
    expect(slot[2]).toBeCloseTo(bars[2].c - bars[0].c, 9)
    expect(slot[2]).not.toBeCloseTo(bars[2].c - bars[1].c, 3)
  }, T)
})

describe('R4 — a block that does not run on every bar', () => {
  const blockHead = `${head}${slotX}float y = na\n`
  it('the two-argument form: drawn only while the block runs on every bar, stopped by name at the first skip', () => {
    expect(runGuardOf(`${blockHead}if close > open\n    y := ta.change(x, 2)\nplot(y)\n`, { bars: barsOf(RDDT) }))
      .toBe('runtime:conditional-history')
  }, T)
  it('⭐ the one-argument form over a slot: the same (it was drawn off the every-bar ring, silently)', () => {
    const r = runRefusalOf(`${blockHead}if close > open\n    y := ta.change(x)\nplot(y)\n`, { bars: barsOf(RDDT) })
    expect(r && r.guard).toBe('runtime:conditional-history')
    expect(r.message).toMatch(/ta\.change/)
  }, T)
  it('in a loop: refused by name (several steps a bar)', () => {
    expect(runGuardOf(`${blockHead}for i = 0 to 2\n    y := ta.change(x, 2)\nplot(y)\n`, { bars: barsOf(RDDT) }))
      .toBe('runtime:conditional-history')
  }, T)
  it('a block on an INPUT runs on every bar or on none: served, x - x[3] (backquant\'s shape)', () => {
    const [y] = run(`${blockHead}mode = input.string("on", "mode", ["on", "off"])\nif mode == "on"\n    y := ta.change(x, 3)\nplot(y)\n`)
    const [hand] = run(`${head}${slotX}plot(x - x[3])\n`)
    expect(differ(RDDT, y, hand)).toEqual([])
  }, T)
})

describe('R5 — a bool source is not a difference: refused by name, in the host\'s words', () => {
  it('a slot bool', () => {
    const r = refusalOf(`${head}var b = false\nb := close > open\nplot(ta.change(b, 2) ? 1 : 0)\n`)
    expect(r && r.guard).toBe('runtime:statement')
    expect(r.message).toMatch(/true\/false/)
    expect(r.message).toMatch(/x != x\[length\]/)
  })
  it('control: a pure bool keeps the host\'s own refusal', () => {
    const r = refusalOf(`${head}b = close > open\nplot(ta.change(b, 2) ? 1 : 0)\n`)
    expect(r && r.guard).toBe('pine:arity')
  })
})

describe('R6 — a length that is not a whole number of bars fixed before bar 0, or a wrong shape: refused by name', () => {
  const cases = {
    'a series length': ['ta.change(x, bar_index % 3 + 1)', /whole number of bars/],
    'zero': ['ta.change(x, 0)', /whole number of bars, 1 or more/],
    'a fraction': ['ta.change(x, 1.5)', /whole number of bars/],
    'three arguments': ['ta.change(x, 2, 3)', /3 arguments/],
    'an unknown named argument': ['ta.change(x, bars = 2)', /named argument `bars`/],
    'a positional after a named one': ['ta.change(source = x, 2)', /positional argument after a named one/],
  }
  for (const [name, [call, rx]] of Object.entries(cases)) {
    it(name, () => {
      const r = refusalOf(`${head}${slotX}plot(${call})\n`)
      expect(r && r.guard, call).toBe('runtime:statement')
      expect(r.message).toMatch(rx)
    })
  }
})

describe('R7 — the script it frees: backquant builds on the runtime lane', () => {
  it('committed:machine-learning-moving-average-backquant__4d7ff59e68 builds, every output carried', () => {
    const p = probeRuntimeProgram(BACKQUANT)
    expect(p.ok, p.ok ? '' : `${p.refusal.guard}: ${p.refusal.message}`).toBe(true)
    expect(p.outputs.length).toBe(7)
    expect(BACKQUANT).toMatch(/ta\.change\(compositeFeature, 3\)/)
  }, T)
})
