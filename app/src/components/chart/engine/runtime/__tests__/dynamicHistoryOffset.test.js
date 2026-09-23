// app/src/components/chart/engine/runtime/__tests__/dynamicHistoryOffset.test.js
//
// ─── ⭐⭐ `close[i]` — A BAR OFFSET ONLY KNOWN WHILE THE BAR IS RUNNING ──────
//
// Pine permits a SERIES index in `[]`, and the corpus leans on it:
//
//     for i = 0 to 3            →  close[i]
//     FH = FIBS == 1 ? highestbars(high, FPeriod) : 1
//     BB = … bar_index[-FH] …   →  fib-retracement, line 74
//
// This runtime sized every ring before bar 0, so it refused all of them. The
// opcode table has carried the answer's shape as a RESERVED entry since 2F-2,
// with the constraint that gates it:
//
//     READ_HIST_SLOT_DYN: 55
//     // A history offset that is only known while the bar is running … It
//     // cannot be admitted until the ring depth it may reach is statically
//     // bounded, because an offset past the ring would answer `na` where Pine
//     // answers a number: a silent wrong value.
//
// ⭐⭐ THAT CONSTRAINT IS ABOUT A RING, AND TWO OF THE THREE HISTORY READS HAVE
// NO RING. `READ_HIST` indexes a precomputed COLUMN and `READ_SERIES_HIST` a
// price SERIES — both fully materialised before the bar loop starts, so
// `columns[a][bar - n]` answers for ANY `n` with `bar - n >= 0` and there is
// nothing to overflow. Only `READ_HIST_SLOT` reads a ring of bounded depth.
//
// So this serves the two that are materialised and leaves the ring refused,
// which is the reserved opcode's own reasoning applied rather than overridden.
//
// ⛔⛔ THE ROUTING DEFECT UNDERNEATH IT, and it is a shape this engine has paid
// for twice already. `needsRuntime` decides which lane an expression belongs to
// by walking `['left','right','test','yes','no','arg','value']` and `args`. An
// offset node is `{type:'offset', arg, n, tok}` — so the walk descends into
// what is being offset and NEVER into the offset itself. `close[i]` therefore
// looked pure, went to the COLUMNAR lane, and that lane refused
// `pine:undefined` — *"this Pine name was never given a value in the pasted
// script — `i`"* — about a loop counter the script plainly declares.
//
// That is precisely the note already in that function about a method form's
// receiver being glued into the call name, and the one about a field path's
// head: **a walk that cannot see part of a node routes the whole expression to
// the wrong lane, which then refuses with a sentence about something else.**
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import {
  makeIrProgram, SLOT, histDyn, column, series, read, num, emit as irEmit, assign,
} from '../ir.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const N = 8
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1700000000 + i * 86400, o: 100, h: 102 + i, l: 98, c: 100 + i, v: 1000,
}))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const head = '//@version=5\nindicator("t")\n'

function run(src) {
  const built = buildRuntimeIr(src, { bars: BARS, inputs: {} })
  expect(built.ok, built.ok ? '' : `${built.refusal.guard}: ${built.refusal.message}`).toBe(true)
  const program = lowerIrProgram(built.ir)
  const r = execute(program, {
    bars: N, series: SERIES, columns: program.columns, confirmed: true,
    barTimes: BARS.map((b) => b.t),
  })
  return Array.from(r.outputs[0])
}

const refusalOf = (src) => {
  const b = buildRuntimeIr(src, { bars: BARS, inputs: {} })
  expect(b.ok, 'expected a refusal').toBe(false)
  return b.refusal
}

/** `s = 0.0` then three accumulating reads at a LOOP-VARIABLE offset. */
const LOOP = `${head}s = 0.0\nfor i = 0 to 2\n    s := s + close[i]\nplot(s)\n`

describe('⭐⭐ a history offset that is only known while the bar is running', () => {
  it('⭐⭐ a LOOP VARIABLE as the offset — `close[i]`', () => {
    const out = run(LOOP)
    // ⭐ PINE'S OWN ANSWER, derived from the fixture rather than restated: the
    // sum of the last three closes, and `na` on any bar where one of them has
    // not happened yet.
    for (let b = 0; b < N; b += 1) {
      if (b < 2) {
        // ⛔ `na`, NEVER A CLAMP. `close[2]` on bar 1 must not quietly answer
        // with bar 0 — that is how a warm-up becomes a confident wrong number.
        expect(Number.isNaN(out[b]), `bar ${b} should be na`).toBe(true)
      } else {
        expect(out[b], `bar ${b}`).toBeCloseTo(
          BARS[b].c + BARS[b - 1].c + BARS[b - 2].c, 9)
      }
    }
  })

  it('⛔ CONTROL — the fixture can DISTINGUISH a wrong offset', () => {
    // ⭐⭐ NON-VACUITY. Every case here compares numbers; if the closes were
    // flat, reading the wrong bar would produce the right answer and the whole
    // file would pass against a runtime that ignored the offset entirely.
    const distinct = new Set(BARS.map((b) => b.c))
    expect(distinct.size).toBe(N)
    // and a clamp-to-bar-0 implementation would give 300 on bar 2, not 303
    expect(BARS[2].c + BARS[1].c + BARS[0].c).not.toBe(BARS[0].c * 3)
  })

  it('⭐ the SAME sum written with constant offsets agrees', () => {
    // ⛔ THE TWO SPELLINGS MUST BE ONE PROGRAM. This is the differential that
    // catches an off-by-one in the dynamic read: the constant path is the one
    // that already worked.
    expect(run(`${head}plot(close[0] + close[1] + close[2])\n`)).toEqual(run(LOOP))
  })

  it('⛔⛔ CONTROL — over a MUTABLE VARIABLE it still refuses', () => {
    // ⚰️ THE HALF THE RESERVED OPCODE ASKED FOR. A slot's past lives in a RING
    // of bounded depth, so an offset that may reach past it would answer `na`
    // where Pine answers a number — a silent wrong value. Columns and series
    // are materialised and have no such bound; a ring does, and until that
    // bound is static this must keep refusing.
    const r = refusalOf(`${head}var float x = 0.0\nx := close\ns = 0.0\n`
      + 'for i = 0 to 2\n    s := s + x[i]\nplot(s)\n')
    expect(r.guard).toBe('runtime:history-dynamic-offset')
    // ⭐ AND IT SAYS WHY, naming the ring rather than blaming the member.
    expect(r.message).not.toContain('never given a value')
  })

  it('⛔⛔ CONTROL — A REAL TYPO IN THE OFFSET STILL SAYS SO', () => {
    // The whole capability turns on telling "bound, but not constant" from
    // "never bound at all". `zzNope` is bound by nothing.
    const r = refusalOf(`${head}plot(close[zzNope])\n`)
    expect(r.message).toContain('never given a value')
  })

  it('⛔ CONTROL — a constant offset still compiles unchanged', () => {
    expect(run(`${head}plot(close[2])\n`))
      .toEqual(Array.from({ length: N }, (_, b) => (b < 2 ? NaN : BARS[b - 2].c)))
  })

  it('⛔⛔ THE IR REFUSES A DYNAMIC OFFSET OVER A RING, BY ITSELF', () => {
    // ⭐⭐ THE SAFETY ARGUMENT, RAILED WHERE IT IS MADE. The front end refuses
    // this too (the case above), but that is a second place — and a guard
    // nobody has watched fire is not a guard (`lesson_gate_that_cannot_fail`).
    // If a future front end ever emits the node, THIS is what stops a ring
    // being read at an offset it was never sized for.
    const build = (of) => makeIrProgram({
      slots: [{ name: 'x', kind: SLOT.PERSIST }],
      columns: [{ name: 'c', formula: 'close' }],
      statements: [assign(0, num(1)), irEmit(0, histDyn(of, num(1)))],
      outputs: [{ title: 't' }],
    })
    // ⛔ A READ — a ring of depth fixed before bar 0 — must be refused.
    expect(() => build(read(0))).toThrow(/COLUMN or a SERIES/)
    // ⭐ NON-VACUITY: the two materialised targets are accepted by the SAME
    // call, so the refusal is about the target and not about the shape.
    expect(() => build(column(0))).not.toThrow()
    expect(() => build(series('close'))).not.toThrow()
  })

  it('⭐ an offset expression, not just a bare counter — `close[i + 1]`', () => {
    // ⛔ THE RESERVED OPCODE'S OWN EXAMPLE is `x[i + 1]`, so the offset has to
    // be a lowered EXPRESSION rather than a name the runtime happens to hold.
    const out = run(`${head}s = 0.0\nfor i = 0 to 1\n    s := s + close[i + 1]\nplot(s)\n`)
    for (let b = 0; b < N; b += 1) {
      if (b < 2) expect(Number.isNaN(out[b]), `bar ${b}`).toBe(true)
      else expect(out[b], `bar ${b}`).toBeCloseTo(BARS[b - 1].c + BARS[b - 2].c, 9)
    }
  })
})
