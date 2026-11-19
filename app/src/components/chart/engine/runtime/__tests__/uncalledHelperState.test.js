// app/src/components/chart/engine/runtime/__tests__/uncalledHelperState.test.js
//
// ─── ⭐⭐ ENGINE 84 (S14 fix 1) — A FUNCTION BODY'S STATE SITES ARE NUMBERED IN ITS OWN FRAME ───
//
// A carried built-in (`ta.barssince`), a two-input one (`ta.valuewhen`), a window (`ta.highest`) and a variable's
// history ring (`y[1]`) each live, per CALL SITE, at that site's base plus the body's own index. The IR's check
// (`ir.js::validateIr`) and the bytecode verifier (`program.js::validateProgram`) read a body's index against the
// WHOLE program's table, which holds no instance for a function nothing calls, so an uncalled helper failed the
// whole program as an engine exception (S14 relabelled it `runtime:lower`: "carried site 0 outside 0", "history
// over a variable must name the HISTORY slot", "READ_HIST_SLOT 1 outside 1"). Six scripts of the coverage sample
// carried that wall. TradingView never runs a function nothing calls, so the program is the program without it.
// Both checks now read a body's index against that function's own counts, check each call site's block against
// the table, and check each instance's own rule over the table, where every call site's instance is.
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'
import { validateIr } from '../ir.js'
import { validateProgram } from '../program.js'

const N = 80
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1700000000 + i * 86400, o: 100 + ((i * 7) % 11), h: 112 + ((i * 3) % 7), l: 90 - (i % 5), c: 100 + ((i * 5) % 13), v: 1000 + i,
}))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const HEAD = '//@version=5\nindicator("t")\n'

function build(src) {
  const b = buildRuntimeIr(src, { bars: BARS, inputs: {} })
  if (!b.ok) throw new Error(`refused ${b.refusal.guard}: ${b.refusal.message}`)
  return b
}
function run(src) {
  const program = lowerIrProgram(build(src).ir, { historyFromListing: true })
  return execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true }).outputs.map((o) => Array.from(o))
}
const same = (a, b) => a.length === b.length && a.every((x, i) => (Number.isNaN(x) && Number.isNaN(b[i])) || x === b[i])

const BODY = 'up = close > open\nplot(ta.barssince(up))\nplot(ta.valuewhen(up, close, 1))\nplot(ta.highest(high, 5))\ny = close * 2\nplot(y - y[1])\n'
const HELPERS = {
  'a carried built-in (ta.barssince)': 'f(bool c) =>\n    b = ta.barssince(c)\n    b <= 5\n',
  'a two-input carried built-in (ta.valuewhen)': 'f(bool c, float x) =>\n    ta.valuewhen(c, x, 0)\n',
  'a window (ta.highest)': 'f(float x) =>\n    ta.highest(x, 5)\n',
  'a variable\'s history ring (y[1])': 'f(float x) =>\n    y = x * 2\n    y > y[1]\n',
  // two rings: the second reads at frame index 1, which the bytecode check's floor of 1 does not cover
  'two variables\' history rings (y[1], z[1])': 'f(float x) =>\n    y = x * 2\n    z = x * 3\n    y > y[1] and z > z[1]\n',
  'all four at once': 'f(bool c, float x) =>\n    b = ta.barssince(c)\n    v = ta.valuewhen(c, x, 0)\n    h = ta.highest(x, 5)\n    y = x * 2\n    b + v + h + (y > y[1] ? 1 : 0)\n',
}

describe('S14 fix 1 — a helper nothing calls changes nothing: the script is the script without it', () => {
  const without = run(`${HEAD}${BODY}`)
  it('the body draws something (a rail over nothing passes)', () => {
    expect(without.length).toBe(4)
    expect(without.every((o) => o.some((v) => Number.isFinite(v)))).toBe(true)
  })
  for (const [what, helper] of Object.entries(HELPERS)) {
    it(`an uncalled helper holding ${what} builds, and every output is bar for bar the script without it`, () => {
      const outs = run(`${HEAD}${helper}${BODY}`)
      expect(outs.length).toBe(without.length)
      outs.forEach((o, k) => expect(same(o, without[k]), `output ${k}`).toBe(true))
    })
    // ⭐ and beside a body that keeps NO state of its own: the main program's tables are then empty, so a
    // body's index cannot hide inside them (with the body above, a top-level `ta.barssince` fills `carried`)
    it(`an uncalled helper holding ${what}, beside a body with no state, builds and is \`plot(close)\``, () => {
      const outs = run(`${HEAD}${helper}plot(close)\n`)
      expect(outs.length).toBe(1)
      expect(same(outs[0], run(`${HEAD}plot(close)\n`)[0])).toBe(true)
    })
  }
})

describe('S14 fix 1 — CONTROLS: a called helper keeps its own state per call site, as before', () => {
  it('one helper called at two sites is two recurrences, each equal to the same built-in at the top level', () => {
    const helper = 'f(float x) =>\n    b = ta.barssince(x > x[1])\n    h = ta.highest(x, 4)\n    b + h\n'
    const viaHelper = run(`${HEAD}${helper}plot(f(close))\nplot(f(open))\n`)
    const top = run(`${HEAD}plot(ta.barssince(close > close[1]) + ta.highest(close, 4))\n`
      + 'plot(ta.barssince(open > open[1]) + ta.highest(open, 4))\n')
    expect(same(viaHelper[0], top[0])).toBe(true)
    expect(same(viaHelper[1], top[1])).toBe(true)
    expect(same(viaHelper[0], viaHelper[1])).toBe(false)
  })
  it('an uncalled helper beside a called one: the called one still computes, the uncalled one costs nothing', () => {
    const outs = run(`${HEAD}g(bool c) =>\n    ta.barssince(c)\nk(float x) =>\n    ta.barssince(x > x[1])\nplot(k(close))\n`)
    const top = run(`${HEAD}plot(ta.barssince(close > close[1]))\n`)
    expect(same(outs[0], top[0])).toBe(true)
  })
})

describe('S14 fix 1 — the checks can still fail (each is the frame\'s, not gone)', () => {
  const src = `${HEAD}f(float x) =>\n    b = ta.barssince(x > x[1])\n    v = ta.valuewhen(x > x[1], x, 0)\n    b + v\nplot(f(close))\n`
  const clone = (v) => JSON.parse(JSON.stringify(v, (k, x) => (typeof x === 'number' && Number.isNaN(x) ? '__NaN__' : x)),
    (k, x) => (x === '__NaN__' ? NaN : x))

  it('the IR as built passes both checks (the control for the tampered cases below)', () => {
    const ir = build(src).ir
    expect(() => validateIr(clone(ir))).not.toThrow()
    expect(() => validateProgram(lowerIrProgram(clone(ir)))).not.toThrow()
  })
  it('IR: a body\'s carried site past its function\'s own count is refused', () => {
    const ir = clone(build(src).ir)
    ir.functions[0].carriedCount = 0
    expect(() => validateIr(ir)).toThrow(/carried site 0 outside 0/)
  })
  it('IR: a body\'s two-input carried site past its function\'s own count is refused', () => {
    const ir = clone(build(src).ir)
    ir.functions[0].carried2Count = 0
    expect(() => validateIr(ir)).toThrow(/carried2 site 0 outside 0/)
  })
  it('IR: a call site whose carried block lies past the table is refused', () => {
    const ir = clone(build(src).ir)
    ir.callSites[0].carriedBase = ir.carried.length
    expect(() => validateIr(ir)).toThrow(/carriedBase .* lies outside/)
  })
  // (a lowered program is frozen: each tampered copy is a new object over new arrays)
  it('program: a carried instance with no length is refused over the table', () => {
    const prog = lowerIrProgram(clone(build(src).ir))
    const bad = { ...prog, carried: prog.carried.map((c, i) => (i === 0 ? { ...c, n: 0 } : c)) }
    expect(() => validateProgram(bad)).toThrow(/needs a length of at least 1/)
  })
  it('program: a CARRIED operand past every frame and the table is refused', () => {
    const prog = lowerIrProgram(clone(build(src).ir))
    const bad = { ...prog, functions: prog.functions.map((f) => ({ ...f, carriedCount: 0 })), carried: [] }
    expect(() => validateProgram(bad)).toThrow(/CARRIED 0 outside 0 carried sites/)
  })
  it('program: a READ_HIST_SLOT operand past every frame and the table is refused', () => {
    // two rings, so one operand is 1: the bound keeps its floor of 1 (`Math.max(…, 1)`), which index 0 always meets
    const prog = lowerIrProgram(clone(build(`${HEAD}f(float x) =>\n    y = x * 2\n    z = x * 3\n    y - y[1] + z - z[1]\nplot(f(close))\n`).ir))
    expect(() => validateProgram(prog)).not.toThrow()
    // ⭐ engine 84 train (#1961 x e82's #1963, the same function): the table keeps ONE ring, so the operand-0 read
    // still has its ring at the call site and #1963's per-call-site DEPTH check passes it; the operand-1 read is then
    // past every frame and the table, and the BOUND is what refuses it (with every ring gone, below, the operand-0
    // read meets #1963's check first in pc order, and that check is what refuses the program)
    const bad = { ...prog, functions: prog.functions.map((f) => ({ ...f, historyCount: 0 })), history: prog.history.slice(0, 1) }
    expect(() => validateProgram(bad)).toThrow(/READ_HIST_SLOT 1 outside 1 history slots/)
    const none = { ...prog, functions: prog.functions.map((f) => ({ ...f, historyCount: 0 })), history: [] }
    expect(() => validateProgram(none)).toThrow(/READ_HIST_SLOT 0 of `f` has no ring at one of its call sites/)
  })
})
