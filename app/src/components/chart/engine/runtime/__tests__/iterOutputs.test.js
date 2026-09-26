// app/src/components/chart/engine/runtime/__tests__/iterOutputs.test.js
//
// ─── ⭐⭐ A VALUE PER ITERATION, WHICH NO SERIES CAN HOLD ────────────────────
//
// An output series is indexed BY BAR and is a `Float64Array` by contract — this
// VM refuses a non-numeric output by name, deliberately. A drawing inside
// `for r = 0 to n` needs something that contract cannot express twice over: a
// value per ITERATION, and for a watchlist row, a STRING.
//
// ⛔ SO IT IS A SEPARATE CHANNEL, NOT A WIDENED OUTPUT. Boxing the output path
// was rejected in `vm.js` for a measured reason (it costs the numeric path), and
// widening it here would have re-opened exactly that.
//
// ⛔ THE BUFFER IS OVERWRITTEN EVERY BAR. Only the bar that wrote it last can be
// read back — asserted below, because the whole safety argument of the lane
// (refuse a drawing that is not last-bar guarded) rests on it being true.
import { describe, it, expect } from 'vitest'

import { makeIrProgram, SLOT, EXPR, num, str, emit, emitIter, forStmt, read, binary, series } from '../ir.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'
import { MAX_COLLECTION_CAP } from '../../ast/objectProgram.js'

const N = 3
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k, j) => (
  Float64Array.from({ length: N }, (_, i) => (j + 1) * 100 + i)))

/** One numeric buffer filled by `for r = 0 to 3: buf[r] = r * 2`. */
const numProgram = () => makeIrProgram({
  statements: [
    forStmt({
      slot: 0,
      toSlot: 1,
      stepSlot: 2,
      from: num(0),
      to: num(3),
      step: num(1),
      body: [emitIter(0, read(0), binary('*', read(0), num(2)))],
    }),
    emit(0, num(1)),
  ],
  slots: [
    { name: 'r', kind: SLOT.LOCAL },
    { name: 'r to', kind: SLOT.LOCAL },
    { name: 'r by', kind: SLOT.LOCAL },
  ],
  outputs: [{ call: 'plot', role: 'anchor' }],
  iterOutputs: [{ kind: 'num' }],
})

const run = (ir) => {
  const program = lowerIrProgram(ir)
  return execute(program, {
    bars: N, series: SERIES, columns: program.columns, confirmed: true,
  })
}

describe('⭐⭐ a numeric per-iteration buffer', () => {
  it('holds one value per ITERATION, not per bar', () => {
    const { iters } = run(numProgram())
    expect(iters.length).toBe(1)
    expect(Array.from(iters[0].slice(0, 4))).toEqual([0, 2, 4, 6])
  })

  it('⛔ it is sized by the OBJECT CEILING, never by the bar count', () => {
    // ⚰️ The obvious implementation reuses an output's Float64Array, which is
    // `bars` long. This run has THREE bars and writes FOUR rows; a bar-sized
    // buffer drops the fourth and passes every large-series test there is.
    const { iters } = run(numProgram())
    expect(iters[0].length).toBe(MAX_COLLECTION_CAP)
    expect(iters[0].length).toBeGreaterThan(N)
  })

  it('⛔ a slot past the ceiling is DROPPED, never wrapped or grown', () => {
    const ir = makeIrProgram({
      statements: [
        emitIter(0, num(MAX_COLLECTION_CAP + 5), num(42)),
        emitIter(0, num(-1), num(43)),
        emit(0, num(1)),
      ],
      slots: [],
      outputs: [{ call: 'plot', role: 'anchor' }],
      iterOutputs: [{ kind: 'num' }],
    })
    const { iters } = run(ir)
    // Nothing anywhere in the buffer took either write.
    expect(Array.from(iters[0]).some((v) => v === 42 || v === 43)).toBe(false)
  })
})

describe('⭐⭐ a TEXT per-iteration buffer — the half a Float64Array cannot hold', () => {
  const textProgram = () => makeIrProgram({
    statements: [
      forStmt({
        slot: 0,
        toSlot: 1,
        stepSlot: 2,
        from: num(0),
        to: num(2),
        step: num(1),
        body: [emitIter(0, read(0), str('row'))],
      }),
      emit(0, num(1)),
    ],
    slots: [
      { name: 'r', kind: SLOT.LOCAL },
      { name: 'r to', kind: SLOT.LOCAL },
      { name: 'r by', kind: SLOT.LOCAL },
    ],
    outputs: [{ call: 'plot', role: 'anchor' }],
    iterOutputs: [{ kind: 'text' }],
  })

  it('carries strings, which is what a watchlist row IS', () => {
    const { iters } = run(textProgram())
    expect(Array.isArray(iters[0])).toBe(true)
    expect(iters[0].slice(0, 3)).toEqual(['row', 'row', 'row'])
  })

  it('⛔⛔ AND A TEXT BUFFER CANNOT BE GROWN PAST THE CEILING', () => {
    // ⚰️ THE NUMERIC CASE CANNOT PROVE THIS GUARD. A `Float64Array` silently
    // ignores an out-of-range write, so deleting the range check leaves every
    // numeric assertion green — measured. A text buffer is a plain Array, where
    // `buf[505] = 'x'` GROWS it, and the object envelope that bounds how many
    // rows a table may have would have been routed around without a word.
    const ir = makeIrProgram({
      statements: [
        emitIter(0, num(MAX_COLLECTION_CAP + 5), str('overflow')),
        emit(0, num(1)),
      ],
      slots: [],
      outputs: [{ call: 'plot', role: 'anchor' }],
      iterOutputs: [{ kind: 'text' }],
    })
    const { iters } = run(ir)
    expect(iters[0].length, 'the buffer grew past the object ceiling')
      .toBe(MAX_COLLECTION_CAP)
    expect(iters[0].includes('overflow')).toBe(false)
  })

  it('⛔ an unwritten slot is `undefined`, never the empty string', () => {
    // An empty cell reads as "the value is empty"; an absent one is a different
    // and weaker claim, and the object runtime already treats them differently.
    const { iters } = run(textProgram())
    expect(iters[0][3]).toBeUndefined()
  })

  it('⛔⛔ a NUMBER into a text buffer is a translator defect, not a coercion', () => {
    // `String(NaN)` in a dashboard cell renders "NaN" and reads as data.
    const ir = makeIrProgram({
      statements: [emitIter(0, num(0), num(7)), emit(0, num(1))],
      slots: [],
      outputs: [{ call: 'plot', role: 'anchor' }],
      iterOutputs: [{ kind: 'text' }],
    })
    expect(() => run(ir)).toThrow(/text and got number/)
  })

  it('⛔ and a STRING into a numeric buffer likewise', () => {
    const ir = makeIrProgram({
      statements: [emitIter(0, num(0), str('x')), emit(0, num(1))],
      slots: [],
      outputs: [{ call: 'plot', role: 'anchor' }],
      iterOutputs: [{ kind: 'num' }],
    })
    expect(() => run(ir)).toThrow(/numeric and got string/)
  })
})

describe('⛔ the buffer belongs to ONE bar', () => {
  it('holds the LAST bar that wrote it, which is the safety argument', () => {
    // ⛔⛔ THE WHOLE REASON THE LANE REFUSES A DRAWING THAT IS NOT LAST-BAR
    // GUARDED. If this ever stopped being true — if a buffer accumulated, or
    // were kept per bar — that refusal would look unnecessary and get removed,
    // and a mid-series drawing would start reading another bar's rows.
    const ir = makeIrProgram({
      statements: [emitIter(0, num(0), series('close')), emit(0, num(1))],
      slots: [],
      outputs: [{ call: 'plot', role: 'anchor' }],
      iterOutputs: [{ kind: 'num' }],
    })
    const { iters } = run(ir)
    // close on the LAST bar of the fixture, not the first.
    expect(iters[0][0]).toBe(SERIES[3][N - 1])
    expect(iters[0][0]).not.toBe(SERIES[3][0])
  })
})

describe('⛔ the shape is validated at BUILD, not discovered on a bar', () => {
  it('an undeclared buffer index is refused', () => {
    expect(() => makeIrProgram({
      statements: [emitIter(3, num(0), num(1)), emit(0, num(1))],
      slots: [],
      outputs: [{ call: 'plot', role: 'anchor' }],
      iterOutputs: [{ kind: 'num' }],
    })).toThrow(/iteration buffer 3 outside 1/)
  })

  it('an unknown KIND is refused', () => {
    expect(() => lowerIrProgram(makeIrProgram({
      statements: [emit(0, num(1))],
      slots: [],
      outputs: [{ call: 'plot', role: 'anchor' }],
      iterOutputs: [{ kind: 'float64' }],
    }))).toThrow(/kind must be 'num' or 'text'/)
  })

  it('⛔ CONTROL — an ordinary program declares no buffers at all', () => {
    const { iters } = run(makeIrProgram({
      statements: [emit(0, num(1))],
      slots: [],
      outputs: [{ call: 'plot', role: 'anchor' }],
    }))
    expect(iters).toEqual([])
  })
})
