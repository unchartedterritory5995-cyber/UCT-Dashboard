// ─── ⭐⭐ C29 — `na` in a comparison (C14) and in a history offset (C9) ──────────
//
// Read off the NEW captures, never a typed copy of their numbers:
//
//   vw-ne-na-spy-1d-2026-09-30     every comparison with an `na` operand is FALSE,
//                                  `!=` included; `not (x == close)` is TRUE.
//   vw-offset-na-spy-1d-2026-09-30 `close[na]` reads the CURRENT bar's close.
//   vw-mbb-auto-spy-1d-2026-09-30  with no `max_bars_back`, dynamic offsets up to
//                                  399 run and read the vendor's own bars.
//
// ⚠️ The probes key their `na` pattern on `bar_index`, and the capture's window
// starts at the vendor's bar B0 (its own `*00_bar_index_CONTROL` column) while our
// `bar_index` starts at 0 on the same 300 bars. Each script below reads
// `(bar_index + B0)` — B0 taken FROM THE CAPTURE — so the na pattern is the
// vendor's bar for bar. A plot constant over the series is read `+ close * 0` so
// the member door carries it (it hides a constant row by design).

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { runOurSide, enterMemberDoor, toProductBars, HARNESS_DEF_ID } from './ourSide'
import * as registry from '../../nativeRegistry'
import { objectReaderFor } from '../../objectColumns'
import { evaluateObjects } from '../../objectRuntime'
import { foldScalar } from '../../ast/bind'
import { AUTO_MAX_BARS_BACK } from '../../ast/objectProgram'

const H = path.resolve(process.cwd(), '..', 'tests/fixtures/vendor/harness')
const load = (n) => JSON.parse(fs.readFileSync(path.join(H, n), 'utf8'))

beforeAll(() => { vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1') })
afterAll(() => { vi.unstubAllEnvs() })

function vendorColumns(cap) {
  const titleOf = new Map(cap.study.plots.map((p) => [p.id, p.title]))
  const out = new Map()
  cap.plotValues.fields.forEach((f, i) => {
    if (f !== 'time') out.set(titleOf.get(f), cap.plotValues.rows.map((r) => r[i]))
  })
  return out
}
const b0Of = (cap) => vendorColumns(cap).get(cap.study.plots[0].title)[0]

/** The live labels' y per bar, of a script run on a capture's bars. */
function labelYs(cap, source) {
  const door = enterMemberDoor(source)
  try {
    expect(door.def, door.refusal || '').toBeTruthy()
    const bars = toProductBars(cap)
    const reader = objectReaderFor(door.def, bars, { inputs: undefined, tf: 'D', newestBarIsForming: false })
    expect(reader).toBeTruthy()
    const run = evaluateObjects(reader.program, {
      barCount: bars.length, readNode: reader.readNode, readTime: reader.readTime, readUnknown: reader.readUnknown,
    })
    const byBar = new Map()
    for (const o of run.live || []) if (o.family === 'label') byBar.set(o.props.x, o.props.y)
    return { byBar, run, bars, program: reader.program }
  } finally { registry.uninstallUserDefinition(HARNESS_DEF_ID) }
}

describe('C29 rule 6 — a comparison with an `na` operand is false, `!=` included', () => {
  it('vw-ne-na: every Q row equals the vendor on all 300 bars', () => {
    const cap = load('vw-ne-na-spy-1d-2026-09-30.json')
    const B0 = b0Of(cap)
    const src = cap.source.text.split('\n')
      .map((l) => l.replace(/bar_index % 2/g, `(bar_index + ${B0}) % 2`))
      .map((l) => l.replace(/^plot\((.*?),(\s*)("Q\d+_[A-Za-z_]+")\)$/, (m, e, sp, t) => (
        t.startsWith('"Q00') ? m : `plot((${e.trim()}) + close * 0,${sp}${t})`))).join('\n')
    const ours = runOurSide({ ...cap, source: { ...cap.source, text: src } })
    expect(ours.ok, ours.refusal).toBe(true)
    const vend = vendorColumns(cap)
    let compared = 0
    for (const p of ours.plots) {
      if (p.title.startsWith('Q00')) continue
      expect(p.column, `${p.title}: ${p.missingReason}`).toBeTruthy()
      const v = vend.get(p.title)
      const col = Array.from(p.column)
      for (let i = 0; i < v.length; i++) { expect(col[i], `${p.title} bar ${i}`).toBe(v[i]); compared++ }
    }
    expect(compared).toBe(11 * 300)
    // non-vacuity: the capture really has both na and non-na bars, and `!=` false on the na ones
    const naBars = vend.get('Q01_x_is_na').filter((v) => v === 1).length
    expect(naBars).toBe(150)
    expect(vend.get('Q02_x_ne_close').every((v) => v === 0)).toBe(true)
    expect(vend.get('Q09_not_x_eq_close').filter((v, i) => vend.get('Q01_x_is_na')[i] === 1).every((v) => v === 1)).toBe(true)
  })

  it('the bind fold agrees: `na != 1` folds to 0, not JavaScript\'s 1', () => {
    const na = { type: 'op', name: '/', args: [{ type: 'num', value: 0 }, { type: 'num', value: 0 }] }
    expect(foldScalar({ type: 'op', name: '!=', args: [na, { type: 'num', value: 1 }] }, {})).toBe(0)
    expect(foldScalar({ type: 'op', name: '==', args: [na, { type: 'num', value: 1 }] }, {})).toBe(0)
    expect(foldScalar({ type: 'op', name: '!=', args: [{ type: 'num', value: 2 }, { type: 'num', value: 1 }] }, {})).toBe(1)
  })
})

describe('C29 rule 7 — `x[na]` is `x`; no `max_bars_back` reaches the measured 399', () => {
  it('vw-offset-na: `close[e]` with `e` na on a third of the bars is the vendor\'s E02 on every bar', () => {
    const cap = load('vw-offset-na-spy-1d-2026-09-30.json')
    const B0 = b0Of(cap)
    const vend = vendorColumns(cap)
    const src = [
      '//@version=6',
      'indicator("c29 offset na", overlay = true, max_bars_back = 500, max_labels_count = 500)',
      `int e = (bar_index + ${B0}) % 3 == 0 ? na : 1`,
      'label.new(bar_index, close[e])',
    ].join('\n')
    const { byBar } = labelYs(cap, src)
    const want = vend.get('E02_close_at_e')
    expect(vend.get('E01_e_is_na').filter((v) => v === 1).length).toBe(100)
    let compared = 0
    for (let i = 1; i < want.length; i++) { // bar 0 of OUR window has no bar 0-1 to read
      expect(byBar.get(i), `bar ${i}`).toBeCloseTo(want[i], 9)
      compared++
    }
    expect(compared).toBe(299)
  })

  it('vw-mbb-auto: no `max_bars_back`, a dynamic offset is served and reads the vendor bar it names', () => {
    const cap = load('vw-mbb-auto-spy-1d-2026-09-30.json')
    const bars = toProductBars(cap)
    // the capture: offsets up to 399, never na, never an error
    const vend = vendorColumns(cap)
    expect(Math.max(...vend.get('M01_k'))).toBe(399)
    expect(vend.get('M03_close_at_k_is_na').every((v) => v === 0)).toBe(true)
    const src = [
      '//@version=6',
      'indicator("c29 mbb auto", overlay = true, max_labels_count = 500)',
      'int k = bar_index % 7 * 40',
      'label.new(bar_index, close[k])',
    ].join('\n')
    const { byBar, program } = labelYs(cap, src)
    const at = JSON.stringify(program)
    expect(at).toContain('"auto":true')
    let compared = 0
    for (let i = 0; i < bars.length; i++) {
      const k = (i % 7) * 40
      const want = i - k >= 0 ? bars[i - k].c : NaN
      if (Number.isNaN(want)) expect(Number.isNaN(byBar.get(i)), `bar ${i}`).toBe(true)
      else { expect(byBar.get(i), `bar ${i}`).toBe(want); compared++ }
    }
    expect(compared).toBe(bars.filter((_, i) => i - (i % 7) * 40 >= 0).length)
    expect(compared).toBeGreaterThan(150)
  })

  it('past the measured bound an undeclared read is WITHHELD, never read and never an error', () => {
    const cap = load('vw-mbb-auto-spy-1d-2026-09-30.json')
    const src = [
      '//@version=6',
      'indicator("c29 mbb beyond", overlay = true, max_labels_count = 500)',
      `int k = bar_index >= 200 ? ${AUTO_MAX_BARS_BACK} : 1`,
      'label.new(bar_index, close[k])',
    ].join('\n')
    const { byBar, run } = labelYs(cap, src)
    expect(run.error || null).toBe(null)
    for (let i = 200; i < 300; i++) expect(byBar.has(i), `bar ${i} drawn past the bound`).toBe(false)
    expect(byBar.get(150)).toBe(toProductBars(cap)[149].c)
    expect(run.stats.atBeyondAutoBuffer).toBe(100)
  })
})
