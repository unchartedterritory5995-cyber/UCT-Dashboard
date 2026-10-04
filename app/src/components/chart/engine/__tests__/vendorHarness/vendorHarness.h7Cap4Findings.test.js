// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.h7Cap4Findings.test.js
//
// H7 (2026-10-04, step 92) - the engine fixes CAP4's captures proved, each graded
// against those captures (the CAP4 pins in `vendorHarness.cap4Captures.test.js` /
// `cap4-verdicts.json` carry the whole-capture grade; this file holds the pieces
// a whole-capture grade cannot see, and the controls that keep each fix honest).
//
//   1. format.volume - a cell that formats `array.get(vals, i)` per pass of a loop
//      (Q-H5a's own shape) is read on the host lane (`pine.js::loopFromGetOf`,
//      `{t:'val', volume}`), rendered by `volumeNumberText`.
//   2. ta.wma rule A (Q-RT8a) - `wmaRuleAParity.test.js` + the Python twin; the
//      plain-form ratchet's bar 0 (R01) is diagnosed and pinned, not fixed (below).
//   3. Empty / all-na reductions are `na` on the runtime lane (Q-RT7a), and
//      `fixnan` is served on the host lane as `valuewhenOccurrence` (Q-RT7b).
//   4. A v4 `fill` with no `transp` holds 90 (Q-RT8d, the fill-state sidecar).
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { loadCapture, HARNESS_DIR, REPO, withDoorState } from './harness'
import { toProductBars, runOurSide } from './ourSide'
import { translatePine } from '../../ast/pine'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'
import { computeRuntimeColumns } from '../../runtime/runtimeColumns'

const T = 600000
const cap = (id) => loadCapture(path.join(HARNESS_DIR, `${id}.json`)).capture
const probe = (name) => fs.readFileSync(path.join(REPO, 'tools/visual_conformance/probes', name), 'utf8')
const tvCol = (c, title) => {
  const p = c.study.plots.find((x) => x.title === title)
  expect(p, title).toBeTruthy()
  const at = c.plotValues.fields.indexOf(p.id)
  return c.plotValues.rows.map((r) => r[at])
}
/** every text node of every cell op, loops included */
const cellTexts = (t) => {
  const out = []
  const walk = (ops) => {
    for (const o of ops || []) {
      if (o.k === 'cell' && o.props && o.props.text) out.push(o.props.text)
      if (o.k === 'loop') walk(o.body)
    }
  }
  walk(t.objects && t.objects.ops)
  return out
}
const findVal = (node) => {
  if (!node || typeof node !== 'object') return null
  if (node.t === 'val') return node
  for (const v of Object.values(node)) {
    const hit = findVal(v)
    if (hit) return hit
  }
  return null
}

describe('H7 1 - format.volume per pass of a loop over a constant array (CAP4 Q-H5a)', () => {
  it('the probe\'s loop cell is a per-pass VOLUME value over the array\'s own elements, in index order', () => {
    const t = translatePine(probe('vw-h5-format-volume.pine'), { strict: true })
    expect(t.objectDiagnostics.loopValuesUnresolved).toBe(0)
    const v = cellTexts(t).map((x) => findVal(x.node)).find((x) => x && x.volume)
    expect(v).toMatchObject({ t: 'val', volume: true })
    expect(v.fmt).toBeUndefined()
    expect(v.v).toMatchObject({ v: 'wget', order: 'unshift' })
    // index, size, then one slot per element of `array.from(...)` (16)
    expect(v.v.args).toHaveLength(2 + 16)
    expect(v.v.args[1]).toEqual({ v: 'const', value: 16 })
  })
  it('control: an array the script CHANGES keeps the refusal (a per-pass value the source could move)', () => {
    // the loop's bound is written as a literal so the loop itself is still read; only
    // the per-pass value is in question
    const base = probe('vw-h5-format-volume.pine').replace('array.size(vals) - 1', '15')
    const ok = translatePine(base, { strict: true })
    expect(cellTexts(ok).map((x) => findVal(x.node)).find((x) => x && x.volume), 'non-vacuity: the literal bound reads').toBeTruthy()
    const t = translatePine(base.replace('var table t', 'array.set(vals, 0, 5.0)\nvar table t'), { strict: true })
    expect(t.objectDiagnostics.loopValuesUnresolved).toBeGreaterThan(0)
    expect(cellTexts(t).map((x) => findVal(x.node)).find((x) => x && x.volume)).toBeFalsy()
  })
  // ⭐ these three the vector model does NOT refuse (measured with the source guard
  // off: each read as the unchanged elements) - the guard in `loopFromGetOf` is what
  // keeps them out, and this is its rail.
  for (const [what, ins] of [['array.reverse', 'array.reverse(vals)\n'], ['the sort method', 'vals.sort()\n'], ['an alias that changes it', 'w = vals\nw.set(0, 5.0)\n']]) {
    it(`control: ${what} keeps the refusal (the source guard)`, () => {
      const base = probe('vw-h5-format-volume.pine').replace('array.size(vals) - 1', '15')
      const t = translatePine(base.replace('var table t', `${ins}var table t`), { strict: true })
      expect(cellTexts(t).map((x) => findVal(x.node)).find((x) => x && x.volume)).toBeFalsy()
    })
  }
  it('control: a format other than format.volume through a name keeps the refusal', () => {
    const src = probe('vw-h5-format-volume.pine').replace('str.tostring(array.get(vals, i), format.volume)', 'str.tostring(array.get(vals, i), format.percent)')
    const t = translatePine(src, { strict: true })
    expect(t.objectDiagnostics.loopValuesUnresolved).toBeGreaterThan(0)
  })
})

// ⛔ R01 / S01 / S04 bar 0 is DIAGNOSED, NOT FIXED. `x = init` then `x := … x[1] …`
// (the plain mutable form) folds to `accum(0 / 0, update)`. From the listing the pass
// holds TWO bar-0 readings - the seed itself (`na`) and the update run from `na` - and
// draws bar 0 only where they agree (`interpret.js::listingPass`). For the supertrend
// ratchet they do not (`na` vs `0`), so bar 0 is withheld; TradingView runs the update
// (0). The plain form ALWAYS means the update reading, but saying so needs a mark in the
// tree (C29 carries one only inside a SWITCHED seed), and the mark measured +2 evaluation
// units: keltner-center-of-gravity RDDT went 128 -> 130 and lost its object lane to
// `budget:nodes`. Reverted; the shape is pinned here so the next lane sees it.
describe('H7 2 - the plain-form ratchet\'s bar 0 is withheld where TradingView draws the update (diagnosis, CAP4 Q-RT8a R01)', () => {
  it('TradingView: R01 is 0 on bar 0, na on 1-8, real from 9', () => {
    const tv = tvCol(cap('vw-rt8-runtime-followups-rddt-1d-2026-10-04'), 'R01 mid')
    expect(tv[0]).toBe(0)
    expect(tv.slice(1, 9).every((x) => x === null)).toBe(true)
  })
  it('ours, from the listing: the two bar-0 readings disagree and bar 0 is withheld; bar 1 on is the update', () => {
    const base = cap('vw-rt8-runtime-followups-rddt-1d-2026-10-04')
    const text = '//@version=6\nindicator("t", overlay = true)\nx = 5.0\nx := close[1] < nz(x[1]) ? 1.0 : 7.0\nplot(x, "o")\n'
    const r = withDoorState('on', () => runOurSide({ ...base, source: { ...base.source, text } }))
    const p = r.plots.find((x) => x.title === 'o')
    expect(p.formula).toMatch(/^accum\(0 \/ 0, /)
    expect(Number.isFinite(p.column[0])).toBe(false) // Pine: 7 (the update from na)
    expect(Array.from(p.column.slice(1, 6))).toEqual([7, 7, 7, 7, 7])
  }, T)
})

describe('H7 3 - empty / all-na reductions and fixnan (CAP4 Q-RT7a / Q-RT7b)', () => {
  const ID = 'vw-rt7-empty-reduce-fixnan-spy-1d-2026-10-04'
  /** The member door's runtime FALLBACK for a script the host lane translates: the
   *  same door call, handed its own host translation marked refused (RT8's idiom). */
  const forcedRuntime = (source) => withDoorState('runtime', () => {
    const host = memberPaneDefinition({ source, id: 'u_h7rt7forced1' })
    const refused = { ...host.translation, ok: false, refusals: [{ guard: 'h7:forced', message: 'forced to the runtime lane for grading' }] }
    return memberPaneDefinition({ source, id: 'u_h7rt7forced1', translation: refused })
  })
  // ⚠️ E01-E06 are CONSTANT plots, which the member pane hides on both lanes
  // (`hiddenReason: 'constant'`, RT6's rail) - so each is plotted here over the bars
  // (`close * 0 + …`): the same reduction, made a row the run must compute.
  it('the RUNTIME lane runs the probe on all 8477 SPY bars with no stop: E01-E06 na on every bar, F01/F02a/F02b TradingView\'s', () => {
    const c = cap(ID)
    const src = c.source.text.replace(/plot\(array\.(max|min|sum|avg)\((e|nn)\), /g, 'plot(close * 0 + array.$1($2), ')
    expect(src.match(/close \* 0 \+ array\./g)).toHaveLength(6)
    const d = forcedRuntime(src)
    expect(d.ok, JSON.stringify(d.runtimeDeclined || d.reason)).toBe(true)
    expect(d.lane).toBe('runtime')
    const cols = withDoorState('runtime', () => computeRuntimeColumns(d.definition, toProductBars(c),
      { tf: 'D', newestBarIsForming: false, historyFromListing: true, barIndexFromFirstBar: true, symbol: { ticker: 'SPY', exchange: 'AMEX' } }))
    const colOf = (label) => {
      const r = d.rows.find((x) => x.label === label)
      expect(r, label).toBeTruthy()
      return cols[r.key]
    }
    for (const t of ['E01_max_empty', 'E02_min_empty', 'E03_sum_empty', 'E04_avg_empty', 'E05_sum_all_na', 'E06_avg_all_na']) {
      const col = colOf(t)
      expect(col.length, t).toBe(8477)
      expect(Array.from(col).every((x) => !Number.isFinite(x)), t).toBe(true)
      expect(new Set(tvCol(c, t)), t).toEqual(new Set([null]))
    }
    for (const t of ['F01_fixnan', 'F02a_fixnan_in_fn', 'F02b_fixnan_in_fn_second_site']) {
      const ours = Array.from(colOf(t))
      const want = tvCol(c, t)
      let real = 0
      want.forEach((w, i) => {
        if (w === null) { expect(Number.isFinite(ours[i]), `${t} bar ${i}`).toBe(false); return }
        real += 1
        expect(Math.abs(ours[i] - w), `${t} bar ${i}`).toBeLessThan(1e-9)
      })
      expect(real).toBeGreaterThan(8000)
    }
  }, T)
  it('fixnan is `valuewhenOccurrence(not na(x), x, 0)` on the host lane; a second argument or a member\'s own fixnan keeps its meaning', () => {
    const head = '//@version=6\nindicator("t")\n'
    const f = translatePine(`${head}plot(fixnan(close > open ? close : na), "f")\n`, { strict: true })
    expect(f.outputs[0].refusal).toBeFalsy()
    expect(f.outputs[0].formula).toMatch(/valuewhenOccurrence\(/)
    const two = translatePine(`${head}plot(fixnan(close, 1), "f")\n`, { strict: true })
    expect(two.outputs[0].refusal && two.outputs[0].refusal.guard).toBe('pine:na')
    const own = translatePine(`${head}fixnan(s) => s * 2\nplot(fixnan(close), "f")\n`, { strict: true })
    expect(String(own.outputs[0].formula || '')).not.toMatch(/valuewhenOccurrence/)
  })
})

describe('H7 4 - a v4 fill with no `transp` holds 90 (CAP4 Q-RT8d, the fill-state sidecar)', () => {
  const SIDE = JSON.parse(fs.readFileSync(path.join(REPO, 'docs/pine/vendor-harness/cap4-rt8d-fill-state-2026-10-04.json'), 'utf8')).read
  const opacityOf = (transparency) => 1 - transparency / 100
  it('the translation carries TradingView\'s transparency on both fills: 90 by default, 60 as written', () => {
    const t = translatePine(probe('vw-rt8-v4-fill-transp.pine'), { strict: true })
    const [v01, v02] = t.presentation.fills
    expect(v01.opacity).toBeCloseTo(opacityOf(SIDE.stateFA.fill_0.transparency), 12)
    expect(v02.opacity).toBeCloseTo(opacityOf(SIDE.stateFA.fill_1.transparency), 12)
    expect([v01.colorUp, v01.colorDown]).toEqual([SIDE.statePal.palette_0.colors['0'].color, SIDE.statePal.palette_0.colors['1'].color])
  })
  it('the member\'s document draws V01 at that opacity (the band on the A/B pair)', () => {
    const c = cap('vw-rt8-v4-fill-transp-rddt-1d-2026-10-04')
    const d = withDoorState('on', () => memberPaneDefinition({ source: c.source.text, id: 'u_h7fillv4001' }))
    expect(d.ok).toBe(true)
    const band = d.definition.plots.find((p) => p.fill)
    expect(band).toBeTruthy()
    expect(band.fillOpacity).toBeCloseTo(opacityOf(SIDE.defaultsFA.fill_0.transparency), 12)
  }, T)
  it('control: the same fill in v5 takes no style default (its colour is the whole answer)', () => {
    const v5 = probe('vw-rt8-v4-fill-transp.pine').replace('//@version=4', '//@version=5').replace('study(', 'indicator(')
      .replace(/sma\(/g, 'ta.sma(').replace(', transp = 60', '')
    const t = translatePine(v5, { strict: true })
    expect(t.presentation.fills[0].opacity).toBeUndefined()
  })
})
