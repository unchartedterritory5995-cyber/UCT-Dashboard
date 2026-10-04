// app/src/components/chart/engine/runtime/__tests__/rt7ArrayNa.test.js
//
// ─── ⭐⭐ RT7 — A REDUCTION SKIPS ITS `na` ELEMENTS, AND `na` IS FOUND NOWHERE: MEASURED ─
//
// `vw-array-na-spy-1d-2026-10-02` is TradingView running the probe
// `tools/visual_conformance/probes/vw-array-na.pine` (Q-C47-3) on SPY 1D. This rail runs
// the SAME probe text through the runtime lane on the capture's own bars and holds EVERY
// plot to the capture on EVERY bar. The runtime used to stop at N01 by name
// (`array.min over an na element`); the answers are now the vendor's:
//   min/max/sum/avg skip `na` (avg is the mean of the real elements), min of an all-`na`
//   array is `na`, `indexof` / `includes` of `na` find nothing (-1 / false).
// ⛔ What stays unmeasured stays a named stop: `sum` / `avg` over zero real elements.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const REPO = path.resolve(process.cwd(), '..')
const CAP = JSON.parse(fs.readFileSync(path.join(REPO, 'tests/fixtures/vendor/harness/vw-array-na-spy-1d-2026-10-02.json'), 'utf8'))
const PROBE = fs.readFileSync(path.join(REPO, 'tools/visual_conformance/probes/vw-array-na.pine'), 'utf8')

function run(src, rows) {
  const bars = rows.map((r) => ({ t: r[0], o: r[1], h: r[2], l: r[3], c: r[4], v: r[5] }))
  const built = buildRuntimeIr(src, { bars, inputs: {} })
  if (!built.ok) throw new Error(`refused: ${built.refusal.guard} — ${built.refusal.message}`)
  const program = lowerIrProgram(built.ir)
  const series = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(bars.map((b) => b[k])))
  const { outputs } = execute(program, { bars: bars.length, series, columns: program.columns, confirmed: true })
  return outputs.map((o) => Array.from(o, (v) => (Number.isFinite(v) ? v : null)))
}

describe('⭐⭐ RT7 — the vw-array-na probe, run by the runtime lane, equals TradingView on every bar', () => {
  it('the capture is the probe (source text agrees line for line on the code)', () => {
    const code = (t) => t.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('//'))
    expect(code(CAP.source.text)).toEqual(code(PROBE))
    expect(CAP.bars.rows.length).toBeGreaterThanOrEqual(200)
  })

  it('N01..N12 equal the capture on every bar (N00 is bar_index from the listing, not the window)', () => {
    const rows = CAP.bars.rows
    const ours = run(PROBE, rows)
    const fields = CAP.plotValues.fields
    expect(ours.length).toBe(fields.length - 1)
    const byTime = new Map(CAP.plotValues.rows.map((r) => [r[0], r]))
    let compared = 0
    for (let k = 2; k < fields.length; k += 1) { // plot_1 .. plot_12
      for (let b = 0; b < rows.length; b += 1) {
        const vr = byTime.get(rows[b][0])
        if (!vr) continue
        expect(ours[k - 1][b], `${fields[k]} bar ${b}`).toBe(vr[k])
        compared += 1
      }
    }
    expect(compared).toBeGreaterThanOrEqual(12 * 200)
    // the measured values, stated (non-vacuity: a lane that answered na everywhere fails)
    expect(ours.slice(1).map((c) => c[0])).toEqual([1, 3, 6, 2, null, -1, 0, 2, -1, 2, 1, 0])
  })
})

describe('⛔ RT7 — what the capture does not pin stays a named stop', () => {
  const rows = CAP.bars.rows.slice(0, 5)
  const head = '//@version=6\nindicator("t")\n'
  // ⚰️ H7 (step 92h) — the stop this pinned is ANSWERED now: CAP4 Q-RT7a
  // (`vw-rt7-empty-reduce-fixnan-spy-1d-2026-10-04`) reads all four as `na` on every
  // bar with no runtime error. `vendorHarness.h7Cap4Findings.test.js` grades the run.
  it('`array.sum` / `array.avg` of an EMPTY array, or of an all-na array, are na (H7, measured) - not 0, not a stop', () => {
    for (const e of ['array.sum(array.new_float(0))', 'array.avg(array.new_float(0))', 'array.sum(array.new_float(2))', 'array.avg(array.new_float(2))']) {
      expect(run(`${head}plot(${e})\n`, rows)[0], e).toEqual([null, null, null, null, null])
    }
  })
  it('a negative index counts from the end in v6 only; below -size it stops in every version', () => {
    const v5 = '//@version=5\nindicator("t")\n'
    const three = 'a = array.from(1.0, 2.0, 3.0)\n'
    expect(run(`${head}${three}plot(array.get(a, -1))\nplot(array.get(a, -3))\n`, rows).map((c) => c[0])).toEqual([3, 1])
    expect(() => run(`${head}${three}plot(array.get(a, -4))\n`, rows)).toThrow(/index -4 is outside/)
    expect(() => run(`${v5}${three}plot(array.get(a, -1))\n`, rows)).toThrow(/index -1 is outside/)
  })
  it('`array.max` / `array.min` of an EMPTY array answer na (zero real elements, as N05), and never stop', () => {
    const out = run(`${head}plot(array.max(array.new_float(0)))\nplot(array.min(array.new_float(0)))\nplot(array.max(array.from(close)))\n`, rows)
    expect(out[0]).toEqual([null, null, null, null, null])
    expect(out[1]).toEqual([null, null, null, null, null])
    expect(out[2]).toEqual(rows.map((r) => r[4])) // control: a real element is answered
  })
})
