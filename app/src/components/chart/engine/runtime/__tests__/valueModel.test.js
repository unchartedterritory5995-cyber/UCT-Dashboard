// app/src/components/chart/engine/runtime/__tests__/valueModel.test.js
//
// ─── A SLOT IS A VALUE, NOT A DOUBLE ────────────────────────────────────────
//
// Series, columns, the history ring, the window buffers and the carried-state
// store are numeric BY CONSTRUCTION — they serve numeric builtins — and they
// stay `Float64Array`. The stack, the bar frame and the persistent slots are
// where a member's own values live, and a member's values include strings.
//
// ⚰️ WHAT THIS REPLACES: `Float64Array.from(['abc'])` is `[NaN]`. A string const
// did not fail, did not warn, and did not arrive — it became `na` somewhere
// between the front end and the first bar, and every downstream reader saw a
// perfectly ordinary missing number.
//
// ⭐ HOW THE ROUND TRIP IS OBSERVED WITHOUT A NEW API. `execute` returns
// `{outputs, budget}` and exposes no slots, so the string is read back through
// `EMIT`'s own type guard: a string reaching a plot THROWS naming `string`,
// while a slot that had silently coerced would hand `EMIT` a number and emit
// `na` without a word. The assertion is therefore on the throw, and the
// CONTROL below proves the same program shape does not throw for a number —
// otherwise "it throws" would be true for the wrong reason.
import { describe, it, expect } from 'vitest'
import { makeProgram, OP } from '../program.js'
import { makeContext, execute } from '../vm.js'

const BARS = 4
const zeros = () => new Float64Array(BARS)
// ⛔ FIVE series, in `SERIES_NAMES` order (open, high, low, close, volume) —
// `makeContext` refuses any other count, and the program below never reads them.
const ctx = () => makeContext({
  bars: BARS,
  series: [zeros(), zeros(), zeros(), Float64Array.from([1, 2, 3, 4]), zeros()],
  columns: [],
})

// ⛔ `code` IS A FLAT TRIPLE ARRAY — `[op, a, b, op, a, b, …]`, and `pc` counts
// triples (`program.js`'s own contract). A nested `[[op,a,b], …]` is refused at
// the boundary, which is the shape this file was written with first.
/** store const 0 into local 0, read it back, hand it to output 0. */
const roundTrip = (constant) => makeProgram({
  code: [
    OP.CONST, 0, 0,
    OP.STORE_LOCAL, 0, 0,
    OP.LOAD_LOCAL, 0, 0,
    OP.EMIT, 0, 0,
    OP.HALT, 0, 0,
  ],
  consts: [constant],
  locals: 1,
  outputs: ['value'],
})

describe('the value model', () => {
  it('keeps a string const a string', () => {
    const p = makeProgram({ code: [OP.HALT, 0, 0], consts: ['hello'], outputs: [] })
    expect(p.consts[0]).toBe('hello')
  })

  it('refuses a const that is neither a number nor a string, by name', () => {
    expect(() => makeProgram({ code: [OP.HALT, 0, 0], consts: [{}], outputs: [] }))
      .toThrow(/const 0/)
  })

  it('refuses a text op the VM has no implementation for, by name, at BUILD', () => {
    // ⛔ A name with no implementation would otherwise surface on some bar as a
    // runtime error — which reads to a member as a data problem rather than the
    // compiler bug it is. Found unproven by a mutation run: nothing else in the
    // suite builds a program with a bogus text op.
    expect(() => makeProgram({
      code: [OP.HALT, 0, 0], consts: [], outputs: [], textOps: ['str.nosuchthing'],
    })).toThrow(/no implementation for `str\.nosuchthing`/)
  })

  it('CONTROL: a real text op name is accepted', () => {
    // Without this, "it throws" above is equally satisfied by a check that
    // rejects every name.
    const p = makeProgram({
      code: [OP.HALT, 0, 0], consts: [], outputs: [], textOps: ['str.upper'],
    })
    expect(Array.from(p.textOps)).toEqual(['str.upper'])
  })

  it('round-trips a string through a local slot', () => {
    // If the slot coerced, EMIT would receive NaN — a number — and emit `na`
    // silently. The throw IS the evidence the string survived.
    expect(() => execute(roundTrip('NASDAQ:AAPL'), ctx(), {}))
      .toThrow(/string/)
  })

  it('CONTROL: the same program shape with a NUMBER does not throw, and emits it', () => {
    const out = execute(roundTrip(42), ctx(), {})
    expect(Array.from(out.outputs[0])).toEqual([42, 42, 42, 42])
  })

  it('CONTROL: na is still NaN, and still reaches a plot as na', () => {
    const out = execute(roundTrip(NaN), ctx(), {})
    expect(Array.from(out.outputs[0]).every(Number.isNaN)).toBe(true)
  })

  it('CONTROL: outputs and series are still typed arrays', () => {
    const c = ctx()
    expect(c.series[3]).toBeInstanceOf(Float64Array)
    const out = execute(roundTrip(7), c, {})
    expect(out.outputs[0]).toBeInstanceOf(Float64Array)
  })
})
