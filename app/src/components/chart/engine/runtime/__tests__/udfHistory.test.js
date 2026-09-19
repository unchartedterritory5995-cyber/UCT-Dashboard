// app/src/components/chart/engine/runtime/__tests__/udfHistory.test.js
//
// ─── ⭐⭐⭐ P7.2 — HISTORY OVER A FUNCTION-LOCAL SERIES ───────────────────────
//
// The census said this is where the demand actually is: 21 of the 24 scripts
// that call a windowed builtin over runtime state do it INSIDE a UDF, over that
// function's parameters. `HMA(src, len) => wma(src, len)` needs the last n values
// of `src`, and `src` is a frame slot that does not survive the invocation.
//
// ⛔⛔ THE TWO THINGS THIS FILE KEEPS APART (§13):
//
//   THE LIVE FRAME VALUE      cleared on every invocation, because a Pine local
//                             read before assignment is `na`
//   THE COMMITTED SERIES      produced by that local at that CALL SITE, addressable
//                             as `x[n]` on later bars
//
// Implementing history by carrying the frame value forward would collapse them and
// turn every ordinary local into an accidental `var`. They are separate stores:
// the invocation writes a HELD cell on RET, and the end-of-bar phase commits from
// there — which is also why a bar on which the site never runs re-commits rather
// than blanking (vendor-pinned; see `vendorSkippedCallHistory.test.js`).
//
// ⭐ AND THE RING IS PER CALL SITE, addressed off `historyBase` exactly as
// persistent state is addressed off `persistBase`. That is 2E's vendor-confirmed
// rule extended from live state to committed history.

import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'
import { translatePine } from '../../ast/pine.js'
import { parseFormula } from '../../ast/parse.js'
import { interpret } from '../../ast/interpret.js'

const N = 24
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1700000000 + i * 86400, o: 100 + i, h: 102 + i, l: 98 + i, c: 100 + i, v: 1000 + i,
}))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const head = '//@version=5\nindicator("t")\n'

function build(src) {
  const built = buildRuntimeIr(src, { bars: BARS, inputs: {} })
  if (!built.ok) throw new Error(`refused ${built.refusal.guard}: ${built.refusal.message}`)
  return built
}
function runPine(src, limits) {
  const built = build(src)
  const program = lowerIrProgram(built.ir)
  const r = execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true }, limits)
  return { out: Array.from(r.outputs[0]), outs: r.outputs.map((o) => Array.from(o)), program, budget: r.budget }
}
const na = (xs, i) => Number.isNaN(xs[i])

describe('⭐⭐ a UDF parameter has history, per call site', () => {
  it('`v[1]` inside a function is the previous bar of what that site passed', () => {
    const { out, program } = runPine(`${head}f(v) =>\n    v[1]\nplot(f(close))\n`)
    expect(program.history).toHaveLength(1)
    expect(program.history[0].site).toBe(0)
    expect(na(out, 0)).toBe(true)
    for (let i = 1; i < N; i += 1) expect(out[i], `bar ${i}`).toBe(BARS[i - 1].c)
  })

  it('⭐⭐⭐ TWO call sites over one function do NOT share history', () => {
    // ⛔ The defect this forbids is silent: one ring would make `f(open*10)`
    // answer with `close`'s history and still draw a plausible line. It is the
    // same independence 2E vendor-pinned for persistent state.
    const { outs, program } = runPine(`${head}f(v) =>\n    v[1]\nplot(f(close))\nplot(f(open * 10))\n`)
    expect(program.history.map((h) => h.site)).toEqual([0, 1])
    for (let i = 1; i < N; i += 1) {
      expect(outs[0][i], `close site bar ${i}`).toBe(BARS[i - 1].c)
      expect(outs[1][i], `open site bar ${i}`).toBe(BARS[i - 1].o * 10)
    }
    // ⛔ NON-VACUITY: the two series must actually differ, or sharing would pass
    expect(outs[0][5]).not.toBe(outs[1][5])
  })

  it('⭐ deeper offsets inside a function', () => {
    const { out, program } = runPine(`${head}f(v) =>\n    v[3]\nplot(f(close))\n`)
    expect(program.history[0].depth).toBe(3)
    for (let i = 0; i < 3; i += 1) expect(na(out, i), `bar ${i}`).toBe(true)
    for (let i = 3; i < N; i += 1) expect(out[i], `bar ${i}`).toBe(BARS[i - 3].c)
  })

  it('⭐ a RUNTIME-MUTATED argument reaches the parameter\'s history correctly', () => {
    const src = `${head}f(v) =>\n    v[1]\nvar acc = 0.0\nacc := acc + close\nplot(f(acc))\n`
    const { out } = runPine(src)
    let a = 0
    const seen = []
    for (let i = 0; i < N; i += 1) { a += BARS[i].c; seen.push(a) }
    expect(na(out, 0)).toBe(true)
    for (let i = 1; i < N; i += 1) expect(out[i], `bar ${i}`).toBe(seen[i - 1])
  })
})

describe('⭐⭐ ordinary locals, `var` locals, and nesting', () => {
  it('an ORDINARY function local bears history and is still invocation-local', () => {
    const { out, program } = runPine(`${head}f(v) =>\n    x = v * 2\n    x[1]\nplot(f(close))\n`)
    expect(program.history[0].persist).toBe(false)
    for (let i = 1; i < N; i += 1) expect(out[i], `bar ${i}`).toBe(BARS[i - 1].c * 2)
  })

  it('⛔ …and the LIVE read is this invocation\'s value, not the ring\'s (§13/§21)', () => {
    // ⚰️ The first version of this test read `x` before declaring it, to show the
    // local was `na`. That is not valid Pine — `pine:undefined`, correctly — so it
    // proved nothing about history. This one uses BOTH readings of the same local
    // in one expression: if history had been implemented by carrying the frame
    // value forward, the live `x` would equal `x[1]` and the difference would
    // collapse to 0.
    const { out } = runPine(`${head}f(v) =>\n    x = v * 3\n    x - x[1]\nplot(f(close))\n`)
    expect(na(out, 0)).toBe(true)
    // close climbs by exactly 1 per bar, so 3*(close - close[1]) is 3 — never 0
    for (let i = 1; i < N; i += 1) expect(out[i], `bar ${i}`).toBe(3)
  })

  it('⭐ a function-local `var` has BOTH live persistence and history', () => {
    const src = `${head}f(v) =>\n    var c = 0.0\n    c := c + v\n    c[1]\nplot(f(1))\n`
    const { out, program } = runPine(src)
    expect(program.history[0].persist).toBe(true)
    expect(na(out, 0)).toBe(true)
    // c counts invocations; c[1] is the previous bar's count
    for (let i = 1; i < N; i += 1) expect(out[i], `bar ${i}`).toBe(i)
  })

  it('⭐ NESTED functions keep separate rings', () => {
    const { out, program } = runPine(`${head}g(w) =>\n    w[1]\nf(v) =>\n    g(v) + v[1]\nplot(f(close))\n`)
    expect(program.history).toHaveLength(2)
    expect(new Set(program.history.map((h) => h.site)).size).toBe(2)
    for (let i = 1; i < N; i += 1) expect(out[i], `bar ${i}`).toBe(BARS[i - 1].c * 2)
  })
})

describe('⭐⭐ a skipped call site HOLDS — the vendor ruling, at source level', () => {
  it('after the site starts running, history is the previous BAR', () => {
    const src = `${head}f(v) =>\n    v[1]\nfloat p = na\nif close > 105\n    p := f(close)\nplot(p)\n`
    const { out } = runPine(src)
    for (let i = 0; i < N; i += 1) {
      const ran = BARS[i].c > 105
      const prevRan = i > 0 && BARS[i - 1].c > 105
      if (!ran) expect(na(out, i), `bar ${i} did not call`).toBe(true)
      else if (!prevRan) expect(na(out, i), `bar ${i} first call`).toBe(true)
      else expect(out[i], `bar ${i}`).toBe(BARS[i - 1].c)
    }
  })

  it('⭐⭐ with a GAP, the held value is what the ring commits', () => {
    // The site runs every third bar. `v[3]` reaches the bar three back, which the
    // series HELD from the previous execution — so it equals the last executed
    // value, while `v[4]` reaches one bar further and finds the execution before.
    const probe = (back) => `${head}f(v) =>\n    v[${back}]\ngo = bar_index % 3 == 0\nfloat p = na\nif go\n    p := f(bar_index)\nplot(bar_index, "A")\nplot(p, "B")\nplot(go ? 1 : 0, "D")\n`
    const gapsFor = (back) => {
      const [A, B, D] = runPine(probe(back)).outs
      const s = new Set()
      for (let i = 0; i < N; i += 1) if (D[i] === 1 && !Number.isNaN(B[i])) s.add(A[i] - B[i])
      return [...s]
    }
    expect(gapsFor(1)).toEqual([3])
    expect(gapsFor(3)).toEqual([3])
    expect(gapsFor(4)).toEqual([6])
  })
})

describe('⭐⭐ graph-vs-runtime differential for UDF history (§34)', () => {
  const CASES = ['close', 'close * 2', 'high - low', '(open + close) / 2']
  for (const e of CASES) {
    it(`⭐ a UDF that merely wraps (${e})[1] agrees with the columnar lane`, () => {
      // ⭐ THE HYBRID-B SEAM. A function that changes nothing must not change the
      // number: the runtime's per-call-site ring and the columnar lane's whole
      // series describe the same Pine series.
      const { out } = runPine(`${head}f(v) =>\n    v[1]\nplot(f(${e}))\n`)
      const t = translatePine(`${head}plot((${e})[1])\n`)
      expect(t.ok, JSON.stringify(t.refusal || {})).toBe(true)
      const parsed = parseFormula(t.outputs[0].formula)
      expect(parsed.ok).toBe(true)
      const col = interpret(parsed.ast, BARS, {})
      for (let i = 0; i < N; i += 1) {
        const a = typeof col === 'number' ? col : col[i]
        if (Number.isNaN(a)) expect(na(out, i), `bar ${i}`).toBe(true)
        else expect(out[i], `bar ${i}`).toBeCloseTo(a, 12)
      }
    })
  }
})

describe('⭐ static demand and resource accounting inside frames (§36/§37)', () => {
  it('a function local nobody looks back at gets NO ring', () => {
    const { program } = runPine(`${head}f(v) =>\n    a = v * 2\n    b = v + 1\n    a + b[1]\nplot(f(close))\n`)
    expect(program.history.map((h) => h.name)).toEqual(['f.b'])
  })

  it('⭐ rings are counted PER CALL SITE, so two sites cost twice', () => {
    const one = runPine(`${head}f(v) =>\n    v[2]\nplot(f(close))\n`)
    const two = runPine(`${head}f(v) =>\n    v[2]\nplot(f(close))\nplot(f(open))\n`)
    expect(one.budget.counts.HISTORY_SLOTS).toBe(1)
    expect(one.budget.counts.HISTORY_VALUES).toBe(2)
    expect(two.budget.counts.HISTORY_SLOTS).toBe(2)
    expect(two.budget.counts.HISTORY_VALUES).toBe(4)
  })

  it('⛔ the ceiling stops BY NAME, and one more cell runs', () => {
    const src = `${head}f(v) =>\n    v[3]\nplot(f(close))\nplot(f(open))\n`
    let err = null
    try { runPine(src, { HISTORY_VALUES: 5 }) } catch (e) { err = e }
    expect(err && err.limit).toBe('HISTORY_VALUES')
    expect(() => runPine(src, { HISTORY_VALUES: 6 })).not.toThrow()
  })
})
