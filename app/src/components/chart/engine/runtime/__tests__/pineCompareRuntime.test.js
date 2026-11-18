// app/src/components/chart/engine/runtime/__tests__/pineCompareRuntime.test.js
//
// ⭐⭐ engine NUMBER PENDING (Q-FCMP / Q-FCMP2) — THE RUNTIME LANE compares two floats the way TradingView does:
//   · the VM's own `<` `>` `==` … (a slot against a slot: nothing the columnar lane computes) read the SPY 1D
//     tie bars 5,333 and 5,453 as ties, exactly as Q-FCMP's F05-F07 read them;
//   · the frontend folds a v1-v4 comparison of two compile-time CONSTANTS to its EXACT answer and leaves every
//     other one to the run (vw-fcmp-const-v4 / -v5, TradingView's readings embedded below).
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

// TradingView's readings of vw-fcmp-const-v4 / -v5 on AMEX:SPY 1D (Q-FCMP2 rows 11 / 12), C01-C14
const CONST_V4 = [50, 50, 50, 50, 41, 41, 41, 41, 41, 50, 50, 14, 50, 50]
const CONST_V5 = [41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41]

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
