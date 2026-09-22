// app/src/components/chart/engine/runtime/__tests__/udtRecords.test.js
//
// ─── ⭐⭐ A USER-DEFINED TYPE IS A VALUE THIS LANE CARRIES ───────────────────
//
// `type Foo` / `Foo.new(…)` / `f.field` / `f.field := x` — the backbone of every
// modern order-block and market-structure script in the corpus. `records.js`
// holds the value model and the reasons; this file is where each half is proved
// to RUN, and where the shapes that must still refuse are pinned.
//
// ⛔⛔ EVERY FIXTURE HERE FEEDS A COMPUTED ARGUMENT, NOT A LITERAL. A record
// built from `Point.new(1.0, 2)` folds to two constants and the binding code
// never executes — so the whole capability could be deleted and these cases
// would still pass. The fields are built from `close`, `high`, `bar_index` and
// from other fields, so a broken field read answers the wrong NUMBER rather
// than the wrong shape.
//
// ⛔ AND EVERY "IT WORKS" CASE HAS A DISCRIMINATOR. `plot(p.x)` where `p.x` was
// seeded from `close` is satisfied by a field read that works AND by a lane that
// quietly answered `close` without ever building a record. The cases below move
// the value — `+ 1`, `:= … + 1`, a second field, a second instance — so the two
// answers differ.
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { collectUdtTypes } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'
import { udtRecord, isUdtRecord, fieldGet, fieldSet, RecordError } from '../records.js'
import { kindOf } from '../collections.js'
import { isDrawingHandle, drawingHandle } from '../handles.js'
import { makeProgram, OP } from '../program.js'

const N = 4
const BARS = Array.from({ length: N }, (_, i) => (
  { t: 1700000000 + i * 86400, o: 99 + i, h: 101 + i, l: 98 + i, c: 100 + i, v: 1000 + i }))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const head = '//@version=6\nindicator("t", overlay = true)\n'

function runPine(src, opts = {}) {
  const built = buildRuntimeIr(head + src, { bars: BARS, inputs: {}, ...opts })
  if (!built.ok) {
    throw new Error(`refused: ${built.refusal.guard} — ${built.refusal.message}`)
  }
  const program = lowerIrProgram(built.ir)
  const { outputs } = execute(program, {
    bars: N, series: SERIES, columns: program.columns, confirmed: true,
  })
  return Array.from(outputs[0])
}

const refusalOf = (src, opts = {}) => {
  const built = buildRuntimeIr(head + src, { bars: BARS, inputs: {}, ...opts })
  expect(built.ok, 'expected a refusal, got a program').toBe(false)
  return built.refusal
}

// ⭐ The value the fixtures are built from, so an expectation is derived rather
// than typed — a hand-written `[101, 102, 103, 104]` drifts the day a bar moves.
const closes = BARS.map((b) => b.c)
const highs = BARS.map((b) => b.h)

describe('the value model', () => {
  it('a record answers its own TYPE NAME to `kindOf`, and is not a drawing', () => {
    const r = udtRecord('orderBlock', ['top', 'bottom'], [1, 2])
    expect(isUdtRecord(r)).toBe(true)
    // ⛔ THE LOAD-BEARING HALF. `handles.js` says a `{family, site}` duck test
    // "would start answering true for a member's own object the day a UDT can".
    // It can now, so this is the case that proves it did not.
    expect(isDrawingHandle(r)).toBe(false)
    expect(kindOf(r)).toBe('orderBlock')
    // CONTROL — the three kinds it must not be confused with.
    expect(kindOf(1)).toBe('number')
    expect(kindOf('x')).toBe('string')
    expect(kindOf(drawingHandle('box', 0))).toBe('drawing')
  })

  it('a drawing handle is NOT a record either — the test is symmetric', () => {
    expect(isUdtRecord(drawingHandle('line', 3))).toBe(false)
  })

  it('a record is MUTABLE and its field set is SEALED', () => {
    const r = udtRecord('Zone', ['top'], [1])
    fieldSet(r, 'top', 9)
    expect(fieldGet(r, 'top')).toBe(9)
    expect(() => fieldSet(r, 'nope', 1)).toThrow(RecordError)
    expect(() => fieldGet(r, 'nope')).toThrow(RecordError)
  })

  it('reading a field of `na` is a NAMED error, never an `na` answer', () => {
    // ⛔ Same trade `collections.js::at` makes for an out-of-range read: a
    // blank cell is indistinguishable from "no data for this symbol".
    expect(() => fieldGet(NaN, 'top')).toThrow(/user-defined type/)
    expect(() => fieldSet(null, 'top', 1)).toThrow(/user-defined type/)
  })

  it('a mismatched field/value count is refused at CONSTRUCTION', () => {
    expect(() => udtRecord('Zone', ['a', 'b'], [1])).toThrow(RecordError)
  })

  it('⛔ AND THE PROGRAM VALIDATOR REFUSES THE SAME MISMATCH AT BUILD', () => {
    // ⭐ A hand-built program, because the front end always emits the right
    // count — so nothing reachable through Pine can exercise this arm, and a
    // guard nobody has seen fire is not a guard. `records.js` refuses the same
    // mismatch at RUN time; this is the half that names the PRODUCER.
    // ⛔ It matters more than it looks: `udtRecord` pairs `fields[i]` with
    // `values[i]`, so a construction one value short pairs every field after
    // the gap with the WRONG value — each of them a real number of the right
    // kind, and invisible downstream.
    const base = {
      code: [OP.CONST, 0, 0, OP.RECORD, 0, 1, OP.EMIT, 0, 0, OP.HALT, 0, 0],
      consts: [1], columns: [], outputs: [{ call: 'plot' }],
      recordTypes: [{ type: 'Zone', fields: ['top', 'bottom'] }],
    }
    expect(() => makeProgram(base)).toThrow(/declares 2 field\(s\)/)
    // CONTROL — the SAME program with the matching count builds.
    expect(() => makeProgram({
      ...base,
      code: [OP.CONST, 0, 0, OP.CONST, 0, 0, OP.RECORD, 0, 2, OP.EMIT, 0, 0, OP.HALT, 0, 0],
    })).not.toThrow()
  })

  it('⛔ a record type naming one field TWICE is refused at build', () => {
    // `udtRecord` builds its field table with the LAST value winning, so a
    // duplicate makes one supplied value permanently unreachable.
    expect(() => makeProgram({
      code: [OP.HALT, 0, 0], consts: [], columns: [], outputs: [],
      recordTypes: [{ type: 'Zone', fields: ['top', 'top'] }],
    })).toThrow(/names a field twice/)
  })
})

describe('reading a type declaration', () => {
  it('fields come off the member\'s OWN LINES, defaults and generics included', async () => {
    const { lexPine, blockStatements } = await import('../../ast/pine.js')
    const src = `${head}type Zone
    float top = 0.0
    int   hits
    box   b = na
    array<line> ls
`
    const l = lexPine(src)
    const types = collectUdtTypes(blockStatements(l.tokens, l.indents, 0))
    const z = types.get('Zone')
    expect(z.fields.map((f) => f.name)).toEqual(['top', 'hits', 'b', 'ls'])
    expect(z.fields.map((f) => f.type)).toEqual(['float', 'int', 'box', 'array'])
    // ⭐ `stripTypeArguments` moved `<line>` onto the token in the LEXER.
    expect(z.fields[3].typeArgs).toEqual(['line'])
    // a default is held as TOKENS and parsed at construction
    expect(z.fields[0].def).not.toBeNull()
    expect(z.fields[1].def).toBeNull()
  })

  it('⛔ `type = input(…)` IS A BINDING, NOT A DECLARATION', async () => {
    // ⚰️ 1 of the 17 scripts on the `runtime:udt` census row was this shape —
    // `screener-mean-reversion-channel`, which declares no type at all.
    const { lexPine, blockStatements } = await import('../../ast/pine.js')
    const src = `${head}type = input.string("SuperSmoother", title = "Filter Type")\n`
    const l = lexPine(src)
    expect(collectUdtTypes(blockStatements(l.tokens, l.indents, 0)).size).toBe(0)
  })

  it('and it still COMPILES as an ordinary binding', () => {
    expect(runPine(
      'type = input.string("SuperSmoother", title = "Filter Type")\n'
      + 'plot(type == "SuperSmoother" ? close : 0)\n')).toEqual(closes)
  })
})

describe('construction and field access, end to end', () => {
  it('a NON-`var` construction rebuilds the record every bar, from COMPUTED values', () => {
    // ⭐ THE DISCRIMINATOR: `p.x + p.y` cannot be answered by any single
    // series, and the `+ 1.0` moves it off `close` outright — so a lane that
    // dropped the construction and handed back `close` answers the wrong
    // NUMBER here rather than the wrong shape.
    expect(runPine(
      'type Point\n'
      + '    float x = 0.0\n'
      + '    float y = 0.0\n'
      + 'p = Point.new(close, high)\n'
      + 'p.x := p.x + 1.0\n'
      + 'plot(p.x + p.y)\n'))
      .toEqual(closes.map((c, i) => c + 1 + highs[i]))
  })

  it('⛔⛔ A `var` RECORD IS BUILT ONCE AND SURVIVES THE BAR', () => {
    // ⭐ The SAME program with `var` in front must answer DIFFERENTLY, and that
    // is the whole of Pine's `var`: the construction runs on bar 0 only, so `x`
    // accumulates off bar 0's `close` while `y` never moves.
    // ⛔ A lane that rebuilt the record every bar passes the case above and
    // fails this one — which is exactly why both are here.
    expect(runPine(
      'type Point\n'
      + '    float x = 0.0\n'
      + '    float y = 0.0\n'
      + 'var Point p = Point.new(close, high)\n'
      + 'p.x := p.x + 1.0\n'
      + 'plot(p.x + p.y)\n'))
      .toEqual([1, 2, 3, 4].map((n) => closes[0] + n + highs[0]))
  })

  it('NAMED arguments bind by field name, and omitted fields take their DEFAULT', () => {
    expect(runPine(
      'type Point\n'
      + '    float x = 0.0\n'
      + '    float y = 0.0\n'
      + '    float z = 7.0\n'
      // ⛔ out of declaration order on purpose: a lane that filled positionally
      // and ignored the names would put `high` in `x`.
      + 'var Point p = Point.new(y = close, x = high)\n'
      + 'plot(p.x * 1000 + p.y + p.z)\n'))
      .toEqual(closes.map(() => highs[0] * 1000 + closes[0] + 7))
  })

  it('a CHAINED field path reads through a nested record', () => {
    expect(runPine(
      'type Inner\n'
      + '    float top = 0.0\n'
      + 'type Outer\n'
      + '    Inner info\n'
      + 'var Outer o = Outer.new(Inner.new(close))\n'
      + 'o.info.top := o.info.top + 2.0\n'
      + 'plot(o.info.top)\n'))
      .toEqual([1, 2, 3, 4].map((n) => closes[0] + 2 * n))
  })

  it('⛔ TWO INSTANCES ARE TWO RECORDS — a write to one never reaches the other', () => {
    // A lane that interned the construction, or that scalarised one slot per
    // FIELD NAME, passes every single-instance case above and fails this.
    expect(runPine(
      'type Point\n'
      + '    float x = 0.0\n'
      + 'var Point a = Point.new(close)\n'
      + 'var Point b = Point.new(high)\n'
      + 'a.x := a.x + 100.0\n'
      + 'plot(b.x)\n'))
      .toEqual(closes.map(() => highs[0]))
  })

  it('⛔⛔ A RECORD IS A REFERENCE — aliasing shares the instance', () => {
    // Pine's UDTs are reference types. `records.js` explains why a copy-on-write
    // record is the dangerous answer; this is the case that would catch one.
    expect(runPine(
      'type Point\n'
      + '    float x = 0.0\n'
      + 'var Point a = Point.new(close)\n'
      + 'var Point b = a\n'
      + 'b.x := b.x + 5.0\n'
      + 'plot(a.x)\n'))
      .toEqual([1, 2, 3, 4].map((n) => closes[0] + 5 * n))
  })

  it('⛔⛔ `var Foo x = na` THEN `x := Foo.new(…)` — the WRITTEN TYPE decides', () => {
    // ⭐ The corpus's most common declaration shape, and the one an
    // initialiser-only rule cannot serve: the initialiser is `na` and produces
    // no type at all, while the line that DOES produce one is an ASSIGNMENT,
    // which declares nothing. Without the annotation every later `info.top`
    // refuses as an unbound name.
    expect(runPine(
      'type Info\n'
      + '    float top = 0.0\n'
      + 'var Info info = na\n'
      + 'if bar_index == 0\n'
      + '    info := Info.new(close)\n'
      + 'plot(info.top)\n'))
      .toEqual(closes.map(() => closes[0]))
  })

  it('a record survives a bar — `var` keeps the SAME instance', () => {
    // ⭐ The accumulation is what proves it: a fresh record every bar would
    // answer `close + 1` on every bar instead of climbing.
    expect(runPine(
      'type Acc\n'
      + '    float n = 0.0\n'
      + 'var Acc a = Acc.new(0.0)\n'
      + 'a.n := a.n + 1.0\n'
      + 'plot(a.n)\n'))
      .toEqual([1, 2, 3, 4])
  })
})

describe('records in collections — the corpus\'s dominant shape', () => {
  it('`array<Foo>` holds records and an element read carries the TYPE', () => {
    expect(runPine(
      'type Zone\n'
      + '    float top = 0.0\n'
      + '    float hits = 0.0\n'
      + 'var array<Zone> zones = array.new<Zone>()\n'
      + 'if bar_index == 0\n'
      + '    array.push(zones, Zone.new(close, 0.0))\n'
      + 'z = array.get(zones, 0)\n'
      + 'z.hits := z.hits + 1.0\n'
      // ⭐ `z.hits` climbing proves the ELEMENT was mutated in place — a copy
      // out of the array would answer 1 on every bar.
      + 'plot(z.hits * 1000 + z.top)\n'))
      .toEqual([1, 2, 3, 4].map((n) => n * 1000 + closes[0]))
  })

  it('the METHOD form of the element read carries it too', () => {
    expect(runPine(
      'type Zone\n'
      + '    float top = 0.0\n'
      + 'var array<Zone> zones = array.new<Zone>()\n'
      + 'if bar_index == 0\n'
      + '    zones.push(Zone.new(close))\n'
      + 'plot(zones.get(0).top)\n'))
      .toEqual(closes.map(() => closes[0]))
  })
})

describe('a field that holds a DRAWING — composing with handles.js', () => {
  const OWNED = { objectTrees: [] }

  it('a `box.new(…)` into a field is admitted as an opaque HANDLE', () => {
    // ⭐ `handles.js`'s whole argument, arriving through the UDT door: the
    // object pass owns the drawing, this lane carries the result. Without it
    // the write refuses at `runtime:object-op` and every order-block script in
    // the corpus dies on its own declaration.
    expect(runPine(
      'type Zone\n'
      + '    float top = 0.0\n'
      + '    box  b = na\n'
      + 'var Zone z = Zone.new(close, na)\n'
      + 'z.b := box.new(bar_index, high, bar_index + 1, low)\n'
      + 'plot(z.top)\n', OWNED)).toEqual(closes.map(() => closes[0]))
  })

  it('⛔ AND ONLY UNDER OWNERSHIP — with no object pass it still refuses BY NAME', () => {
    const r = refusalOf(
      'type Zone\n'
      + '    box b = na\n'
      + 'var Zone z = Zone.new(na)\n'
      + 'z.b := box.new(bar_index, high, bar_index + 1, low)\n'
      + 'plot(close)\n')
    expect(r.guard).toBe('runtime:object-op')
  })

  it('⛔ A CREATE BURIED IN AN EXPRESSION IS REFUSED, NOT UNWRAPPED', () => {
    // `cond ? box.new(…) : na` makes a drawing on SOME bars; one handle for
    // both arms would hand back a drawing the object program did not make.
    const r = refusalOf(
      'type Zone\n'
      + '    box b = na\n'
      + 'var Zone z = Zone.new(na)\n'
      + 'z.b := close > 0 ? box.new(bar_index, high, bar_index + 1, low) : na\n'
      + 'plot(close)\n', OWNED)
    expect(r.guard).toBe('runtime:object-op')
  })
})

describe('what still refuses, and by WHICH name', () => {
  it('a field the type does not declare names the TYPE and the FIELD', () => {
    const r = refusalOf(
      'type Point\n'
      + '    float x = 0.0\n'
      + 'var Point p = Point.new(close)\n'
      + 'plot(p.tpo)\n')
    // ⚰️ It used to reach the COLUMNAR lane and answer `pine:builtin` — "the
    // engine grammar does not hold `p.tpo`" — which sends the member looking
    // for a built-in namespace called `p`.
    expect(r.guard).toBe('runtime:udt-field')
    expect(r.message).toContain('p.tpo')
    expect(r.message).toContain('Point')
  })

  it('a misspelt field on the WRITE side is named the same way', () => {
    const r = refusalOf(
      'type Point\n'
      + '    float x = 0.0\n'
      + 'var Point p = Point.new(close)\n'
      + 'p.tpo := 1.0\n'
      + 'plot(close)\n')
    expect(r.guard).toBe('runtime:udt-field')
    expect(r.message).toContain('Point')
  })

  it('a named argument no field answers to is refused at the CONSTRUCTION', () => {
    const r = refusalOf(
      'type Point\n'
      + '    float x = 0.0\n'
      + 'var Point p = Point.new(nope = close)\n'
      + 'plot(p.x)\n')
    expect(r.guard).toBe('runtime:udt-field')
    expect(r.message).toContain('nope')
  })

  it('a Pine 6 `method` gets its OWN guard, not `runtime:udt`', () => {
    // ⛔ A method needs the function table to bind a receiver as argument 0 and
    // `ufcs.js` to route the call form to it — separately schedulable, so
    // separately named. One label over both is the mis-sizing this row was.
    const r = refusalOf(
      'type Point\n'
      + '    float x = 0.0\n'
      + 'method bump(Point this, float d) =>\n'
      + '    this.x := this.x + d\n'
      + '    this.x\n'
      + 'plot(close)\n')
    expect(r.guard).toBe('runtime:udt-method')
    expect(r.message).toContain('bump')
  })

  it('⛔ A NAMESPACE THAT IS NOT A DECLARED TYPE IS UNTOUCHED', () => {
    // `syminfo.tickerid` is a dotted name whose head this lane holds nothing
    // for; the UDT path must not claim it. It refuses in the lane that owns it.
    const r = refusalOf('plot(syminfo.nonsense)\n')
    expect(r.guard).not.toBe('runtime:udt-field')
  })
})
