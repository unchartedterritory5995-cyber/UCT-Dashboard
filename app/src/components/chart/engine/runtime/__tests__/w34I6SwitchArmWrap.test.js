// app/src/components/chart/engine/runtime/__tests__/w34I6SwitchArmWrap.test.js
//
// ⭐⭐ W34-I6a — A `switch` ARM WHOSE VALUE WRAPS ONTO A CONTINUATION LINE.
//
// THE RULE THIS RAIL RESTS ON (Pine Script User Manual, "Script structure" -> "Line
// wrapping", https://www.tradingview.com/pine-script-docs/language/script-structure/#line-wrapping):
//
//   "each wrapped line after the first can use any indentation length _except_ multiples
//    of four", "because Pine uses four-space or tab indentations to define local code
//    blocks." Between brackets, "all code between those characters _does not_ have any
//    restriction on indentation length." And: "A local block must be indented by a tab
//    or four spaces."
//
// The shared splitter (`pine.js::blockStatements`) reads the `=>` of an arm as a block
// opener, so `c => a` / `     and b` put the continuation in the arm's `sub`, and the
// runtime lane refused "a branch of `…` ends in a block this lane reads no value from".
// The fix is runtime-side (`pineRuntimeFrontend.js::wrappedArmOf`): an inline arm whose
// deeper lines all start, outside brackets, at an indent that is not a multiple of four is
// one expression. Shapes the rule does not settle stay refused BY NAME.
//
// Synthetic shapes only; no licence-held script text.
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

// 5,000 deterministic bars (an LCG walk), so every arm is taken many times.
const N = 5000
const BARS = (() => {
  let s = 12345
  const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648 }
  const out = []
  let c = 100
  for (let i = 0; i < N; i += 1) {
    const o = c + (rnd() - 0.5) * 2
    c = Math.max(1, o + (rnd() - 0.5) * 3)
    const h = Math.max(o, c) + rnd() * 1.5
    const l = Math.min(o, c) - rnd() * 1.5
    out.push({ t: 1600000000 + i * 86400, o, h, l, c, v: 1000 + Math.floor(rnd() * 500) })
  }
  return out
})()
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const HEAD = '//@version=5\nindicator("t")\n'

const build = (src, extra = {}) => buildRuntimeIr(src, { bars: BARS, inputs: {}, ...extra })
function run(src) {
  const built = build(src)
  expect(built.ok, built.ok ? '' : `${built.refusal.guard}: ${built.refusal.message}`).toBe(true)
  const program = lowerIrProgram(built.ir)
  const r = execute(program, {
    bars: N, series: SERIES, columns: program.columns, confirmed: true, barTimes: BARS.map((b) => b.t),
  })
  return Array.from(r.outputs[0])
}
const refusalOf = (src, extra) => {
  const b = build(src, extra)
  expect(b.ok, 'expected a refusal').toBe(false)
  return b.refusal
}
const same = (a, b) => {
  expect(a.length).toBe(b.length)
  for (let i = 0; i < a.length; i += 1) {
    if (Number.isNaN(a[i])) expect(Number.isNaN(b[i]), `bar ${i}`).toBe(true)
    else expect(b[i], `bar ${i}`).toBe(a[i])
  }
}

// ── A float switch at the top level. Arm 1 wraps over two lines at indents 5 and 6 (neither a
// multiple of four). Arm 2 holds a bracket open across a line at indent 8 twice: once from the
// arm's own line, once from a wrapped line (`math.min(open[3],` / `        low[2])`); the bracket
// rule allows any indent there, so neither line is a block.
const FLOAT_ONE = `${HEAD}m = bar_index % 4
v = switch m
    0 => (close - open) / (high - low + 1)
    1 => (close[1] - open[1]) * 2 + math.abs(close - close[2]) / 3 - low[1] * 0.01
    2 => math.max(high - low, (high[1] - low[1]) * 0.5) + close[3] * 0.001 - math.min(open[3], low[2]) * 0.002
    => -1.0
plot(v)
`
const FLOAT_WRAP = `${HEAD}m = bar_index % 4
v = switch m
    0 => (close - open) / (high - low + 1)
    1 => (close[1] - open[1]) * 2
     + math.abs(close - close[2]) / 3
      - low[1] * 0.01
    2 => math.max(high - low,
        (high[1] - low[1]) * 0.5)
     + close[3] * 0.001 - math.min(open[3],
        low[2]) * 0.002
    => -1.0
plot(v)
`

// ── The shape of the census script, synthetic: a bool `if … else if …` whose second branch is a
// `switch`, inside a function, two of four arms wrapped one space past the arm (`and …`).
const fnSrc = (wrap) => `${HEAD}g(mode) =>
    r = if mode == 'Off'
        (low > high[2])
    else if mode == 'On'
        switch bar_index % 4
            0 => (low > high[2]) and (high > high[1])
            1 => ((low > high[2]) and ((high[1] - low[1]) >= (0.5 * (high - low))) and (high > high[1]))
${wrap
    ? `            2 => ((low > high[2]) and ((high[1] - low[1]) >= (0.2 * (high - low))))
             and ((close[2] - open[2] > 0 and close[1] - open[1] > 0) or math.abs((close[1] - open[1]) / (high[1] - low[1] + 1)) > 0.3)
            3 => ((low > high[1]) or (close > open))
             and ((close[2] - open[2] > 0) and math.abs((close[1] - open[1]) / (high[1] - low[1] + 1)) > 0.2)
             and math.abs((close - open) / (high - low + 1)) > 0.1`
    : `            2 => ((low > high[2]) and ((high[1] - low[1]) >= (0.2 * (high - low)))) and ((close[2] - open[2] > 0 and close[1] - open[1] > 0) or math.abs((close[1] - open[1]) / (high[1] - low[1] + 1)) > 0.3)
            3 => ((low > high[1]) or (close > open)) and ((close[2] - open[2] > 0) and math.abs((close[1] - open[1]) / (high[1] - low[1] + 1)) > 0.2) and math.abs((close - open) / (high - low + 1)) > 0.1`}
    r
plot(g('On') ? 1 : 0)
`

describe('⭐⭐ W34-I6a a wrapped `switch` arm is one expression', () => {
  it('⛔ CONTROL — the fixture can distinguish the arms', () => {
    const out = run(FLOAT_ONE)
    const seen = new Set(out.filter((x) => !Number.isNaN(x)).map((x) => Math.round(x * 1e6)))
    expect(seen.size).toBeGreaterThan(100)
    const b = run(fnSrc(false))
    expect(new Set(b).size).toBe(2)
    // every arm of the fn shape decides some bars both ways
    for (let arm = 0; arm < 4; arm += 1) {
      const vals = new Set(b.filter((_, i) => i > 3 && i % 4 === arm))
      expect(vals.size, `arm ${arm}`).toBe(2)
    }
  })

  it('⭐⭐ differential, top level: wrapped arms equal one-line arms over 5,000 bars', () => {
    same(run(FLOAT_ONE), run(FLOAT_WRAP))
  })

  it('⭐⭐ differential, in a function, nested in `if … else if`: wrapped equals one-line', () => {
    same(run(fnSrc(false)), run(fnSrc(true)))
  })

  it('⭐ the same wrapped switch as a top-level binding of an `if … else if` (no function)', () => {
    const top = (src) => src.replace(/^g\(mode\) =>\n/m, '').replace(/\n    r\nplot\(g\('On'\) \? 1 : 0\)\n$/, '\nplot(r ? 1 : 0)\n')
      .replace(/^    /gm, '').replace(/mode == /g, '"On" == ')
    same(run(top(fnSrc(false))), run(top(fnSrc(true))))
  })

  it('⛔ CONTROL — an arm with a real 4-space sub-block keeps today\'s refusal', () => {
    const src = `${HEAD}m = bar_index % 2\nv = switch m\n    0 => close\n        open\n    => high\nplot(v)\n`
    const r = refusalOf(src)
    expect(r.guard).toBe('runtime:block-value')
    expect(r.message).toMatch(/ends in a block this lane reads no value from/)
  })

  it('⛔ CONTROL — `c =>` with its value block on the next line keeps today\'s (block) reading', () => {
    const blk = `${HEAD}m = bar_index % 2\nv = switch m\n    0 =>\n        close - open\n    => high\nplot(v)\n`
    const one = `${HEAD}m = bar_index % 2\nv = switch m\n    0 => close - open\n    => high\nplot(v)\n`
    same(run(one), run(blk))
  })

  it('⛔ a wrapped line AND a block-indent line under one arm is refused BY NAME', () => {
    const src = `${HEAD}m = bar_index % 2\nv = switch m\n    0 => close\n     + open\n        high\n    => high\nplot(v)\n`
    const r = refusalOf(src)
    expect(r.guard).toBe('runtime:block-value')
    expect(r.message).toMatch(/wraps onto a continuation line and also has a line at a block indent/)
  })

  it('⭐ review N1: a switch nested in an arm (`0 => switch k`) is not read as a mixed wrap', () => {
    // The outer arm's raw body holds the inner arms (indent 8) AND the inner wrap (indent 9);
    // it is the inner switch's block, not the outer arm's wrap. The inner arm's wrap is joined on
    // its own level, so the nested switch serves and equals its one-line form.
    const nested = (wrap) => `${HEAD}m = bar_index % 2\nk = bar_index % 3\nv = switch m\n    0 => switch k\n        0 => close${wrap ? '\n         + open' : ' + open'}\n        => low\n    => high\nplot(v)\n`
    same(run(nested(false)), run(nested(true)))
  })

  it('⛔ at the object door the wrapped arm keeps master\'s reading (refused, not joined)', () => {
    // The door does not join (`atObjectDoor`), so master's arm check still sees a block under the
    // arm and answers as master did. Joined, the arm would be one expression and pass that check.
    const r = refusalOf(FLOAT_WRAP, { objectDoor: true })
    expect(r.guard).toBe('runtime:object-door')
    expect(r.message).toMatch(/`v = switch …`: a value arm that ends in a block/)
    // ⛔ control: the same switch with one-line arms passes that check at the door
    const one = build(FLOAT_ONE, { objectDoor: true })
    expect(one.ok || !/a value arm that ends in a block/.test(one.refusal.message)).toBe(true)
  })
})

// ⭐ Rail gaps (review W34-I6a N3): a wrapped DEFAULT arm and a tab-led wrap, each served and each
// equal to its one-line form. Both rest on the manual sentences quoted at the top: a wrapped line
// may use "any indentation length _except_ multiples of four", and "Pine uses four-space or tab
// indentations to define local code blocks" (so a tab is one block level, a tab + a space is not).
describe('⭐ W34-I6a N3 rail gaps: the default arm and tab indentation', () => {
  it('⭐ a wrapped DEFAULT arm (`=> a` / `     - b`) equals its one-line form', () => {
    const one = `${HEAD}m = bar_index % 3\nv = switch m\n    0 => close\n    => high - low * 0.5 + open[1] * 0.25\nplot(v)\n`
    const wrap = `${HEAD}m = bar_index % 3\nv = switch m\n    0 => close\n    => high\n     - low * 0.5\n      + open[1] * 0.25\nplot(v)\n`
    const out = run(one)
    expect(new Set(out.filter((x, i) => i % 3 !== 0 && !Number.isNaN(x))).size).toBeGreaterThan(100)
    same(out, run(wrap))
  })
  it('⭐ tab-indented arms with a tab + space wrap equal the one-line form', () => {
    const one = `${HEAD}m = bar_index % 2\nv = switch m\n\t0 => close + open * 0.5 - low[1] * 0.25\n\t=> high\nplot(v)\n`
    const wrap = `${HEAD}m = bar_index % 2\nv = switch m\n\t0 => close\n\t + open * 0.5\n\t  - low[1] * 0.25\n\t=> high\nplot(v)\n`
    same(run(one), run(wrap))
  })
  it('⛔ CONTROL — tab + tab under an arm is a block indent (eight columns): refused by name, not joined', () => {
    const r = refusalOf(`${HEAD}m = bar_index % 2\nv = switch m\n\t0 => close\n\t\t+ open * 0.5\n\t=> high\nplot(v)\n`)
    expect(r.guard).toBe('runtime:block-value')
    expect(r.message).toMatch(/ends in a block this lane reads no value from/)
  })
})
