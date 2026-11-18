// app/src/components/chart/engine/runtime/__tests__/pineCompareRuntime.test.js
//
// ⭐⭐ engine 78 (#1858) (Q-FCMP / Q-FCMP2) — THE RUNTIME LANE compares two floats the way TradingView does:
//   · the VM's own `<` `>` `==` … (a slot against a slot: nothing the columnar lane computes) read the SPY 1D
//     tie bars 5,333 and 5,453 as ties, exactly as Q-FCMP's F05-F07 read them;
//   · the frontend folds a v1-v4 comparison of two compile-time CONSTANTS to its EXACT answer and leaves every
//     other one to the run (vw-fcmp-const-v4 / -v5, TradingView's readings read off the committed captures).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const SPY = JSON.parse(readFileSync('../tests/fixtures/vendor/harness/vw-float-compare-tolerance-spy-1d-2026-11-18.json', 'utf8'))
const BARS = SPY.bars.rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const TV = new Map(SPY.plotValues.rows.map((r, i) => [i, r]))

function run(src, bars = BARS, series = SERIES) {
  const b = buildRuntimeIr(src, { bars, inputs: {} })
  if (!b.ok) throw new Error(`refused ${b.refusal.guard}: ${b.refusal.message}`)
  const program = lowerIrProgram(b.ir)
  const r = execute(program, { bars: bars.length, series, columns: program.columns, confirmed: true })
  return r.outputs.map((o) => Array.from(o))
}

describe('the VM compares within the epsilon: SPY 1D bars 5,333 and 5,453 are ties (Q-FCMP F05-F07)', () => {
  // `var` slots, so the comparison is the VM's own instruction, not a column the host lane computed
  const src = `//@version=6
indicator("t")
var float up = na
var float down = na
up := high - high[1]
down := low[1] - low
plot(up > down ? 1 : 0)
plot(up < down ? 1 : 0)
plot(up == down ? 1 : 0)
`
  it('reads every bar of the capture as TradingView did', () => {
    const [gt, lt, eq] = run(src)
    let compared = 0
    for (let i = 1; i < BARS.length; i += 1) {
      const tv = TV.get(i)
      // F05 / F06 / F07 are plot_5 / plot_6 / plot_7 (row index 6 / 7 / 8)
      expect([gt[i], lt[i], eq[i]], `bar ${i}`).toEqual([tv[6], tv[7], tv[8]])
      compared += 1
    }
    expect(compared).toBe(BARS.length - 1)
    expect([gt[5333], eq[5333], gt[5453], eq[5453]]).toEqual([0, 1, 0, 1])
  })
})

describe('the runtime lane, made to run each committed probe itself, reads every row on every bar as TradingView', () => {
  // A member's pane draws these probes on the HOST lane (the door picks it, both lanes: the harness rail is
  // vendorHarness.fcmpAcceptance.test.js). This drives the RUNTIME lane over each one, so its comparisons are
  // measured against the same captures and not only by the tie bars above.
  const D = '1d-2026-11-18'
  const ids = [`vw-float-compare-tolerance-spy-${D}`, `vw-float-compare-tolerance-rddt-${D}`,
    `vw-fcmp-magnitude-spy-${D}`, `vw-fcmp-magnitude-rddt-${D}`, `vw-fcmp-form-spy-${D}`, `vw-fcmp-form-rddt-${D}`,
    `vw-fcmp-form-v5-spy-${D}`, `vw-fcmp-form-v4-spy-${D}`, `vw-fcmp-form-v4-rddt-${D}`, `vw-fcmp-form-v3-spy-${D}`,
    `vw-fcmp-form-v2-spy-${D}`, `vw-fcmp-form-v1-spy-${D}`, `vw-fcmp-const-v4-spy-${D}`, `vw-fcmp-const-v5-spy-${D}`]
  for (const id of ids) {
    it(id, () => {
      const cap = JSON.parse(readFileSync(`../tests/fixtures/vendor/harness/${id}.json`, 'utf8'))
      const bars = cap.bars.rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }))
      const series = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(bars.map((b) => b[k])))
      const outs = run(cap.source.text, bars, series)
      expect(outs.length).toBe(cap.study.plots.length)
      const off = []
      cap.study.plots.forEach((p, k) => {
        const at = cap.plotValues.fields.indexOf(p.id)
        cap.plotValues.rows.forEach((r, i) => {
          const tv = r[at]
          const ours = outs[k][i]
          const same = tv === null ? ours !== ours : Math.abs(ours - tv) <= 1e-9 * Math.max(1, Math.abs(tv))
          if (!same) off.push(`${p.title} bar ${i}: ours ${ours}, TradingView ${tv}`)
        })
      })
      expect(off.slice(0, 5), `${off.length} cells off`).toEqual([])
    })
  }
})

// TradingView's readings of vw-fcmp-const-v4 / -v5 on AMEX:SPY 1D (Q-FCMP2 rows 11 / 12), C01-C14, read off the
// committed captures (the last bar: each row is a pair of constants, the same on every bar)
const tvLast = (name) => {
  const cap = JSON.parse(readFileSync(`../tests/fixtures/vendor/harness/${name}-spy-1d-2026-11-18.json`, 'utf8'))
  const last = cap.plotValues.rows[cap.plotValues.rows.length - 1]
  return cap.study.plots.map((p) => last[cap.plotValues.fields.indexOf(p.id)]).slice(1)
}
const CONST_V4 = tvLast('vw-fcmp-const-v4')
const CONST_V5 = tvLast('vw-fcmp-const-v5')

describe('v1-v4 compare two compile-time constants exactly; v5 tolerantly (vw-fcmp-const-v4 / -v5)', () => {
  const few = BARS.slice(0, 30)
  const fewSeries = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(few.map((b) => b[k])))
  for (const [v, want] of [[4, CONST_V4], [5, CONST_V5]]) {
    it(`v${v}: every row the runtime lane can prove is TradingView's`, () => {
      const src = readFileSync(`../tools/visual_conformance/probes/vw-fcmp-const-v${v}.pine`, 'utf8')
      const outs = run(src, few, fewSeries)
      const last = outs.map((o) => o[o.length - 1])
      for (let k = 1; k <= 14; k += 1) expect(last[k], `C${String(k).padStart(2, '0')}`).toBe(want[k - 1])
    })
  }
})

// ⭐ engine NUMBER PENDING (Q-FCMP3): vw-fcmp-arrays, rows A01-A16, READ OFF the committed captures (AMEX:SPY 1D,
// 8,510 bars, and NYSE:RDDT 1D, 669 bars, from the listing; run fcmp3b-2026-11-18, packet sha256
// b400024aa71d2d2c895f04bf449f4cb310dd28e49d25f988cd002d2a9f0ad0ef). array.lastindexof reads TOLERANT (A02-A04), the
// three binary searches EXACT (A07-A09, A11-A14); the rest are controls both rules answer alike.
describe('the runtime lane runs vw-fcmp-arrays as TradingView did (Q-FCMP3, every row, every bar, both symbols)', () => {
  for (const sym of ['spy', 'rddt']) {
    it(`vw-fcmp-arrays-${sym}-1d-2026-11-18: lastindexof tolerant, binary searches exact, every control as read`, () => {
      const cap = JSON.parse(readFileSync(`../tests/fixtures/vendor/harness/vw-fcmp-arrays-${sym}-1d-2026-11-18.json`, 'utf8'))
      const bars = cap.bars.rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }))
      const series = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(bars.map((b) => b[k])))
      const outs = run(cap.source.text, bars, series)
      expect(outs.length).toBe(17)
      const off = []
      cap.study.plots.forEach((pl, k) => {
        const at = cap.plotValues.fields.indexOf(pl.id)
        cap.plotValues.rows.forEach((r, i) => { if (outs[k][i] !== r[at]) off.push(`${pl.title} bar ${i}: ours ${outs[k][i]}, TradingView ${r[at]}`) })
      })
      expect(off.slice(0, 5), `${off.length} cells off`).toEqual([])
      // the rows that separate the rules read as measured: lastindexof tolerant, the searches exact
      const last = cap.plotValues.rows[cap.plotValues.rows.length - 1]
      const tv = cap.study.plots.slice(1).map((pl) => last[cap.plotValues.fields.indexOf(pl.id)])
      expect(tv).toEqual([2, 2, 0, 0, -1, 1, -1, -1, -1, -1, 0, 0, 2, 2, 0, 2])
    })
  }
})
