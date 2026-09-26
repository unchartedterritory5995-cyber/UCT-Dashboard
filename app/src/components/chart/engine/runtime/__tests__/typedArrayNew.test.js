// app/src/components/chart/engine/runtime/__tests__/typedArrayNew.test.js
//
// ─── ⭐⭐ `array.new_float(…)` IS `array.new<float>(…)` ──────────────────────
//
// Pine spells one constructor two ways, and real scripts overwhelmingly choose
// the typed one. Measured across the 266-script committed corpus,
// `array.new_float` ALONE is the first blocker for 14 scripts — against the 7
// uses of the generic spelling in the census that originally shaped this table.
// The generic form was built first because both acceptance scripts happen to
// use it; the corpus says the typed form is what members actually write.
//
// ⛔⛔ THE ALIASES DELEGATE TO ONE IMPLEMENTATION AND DO NOT COPY IT. A second
// body would drift from the generic one — and the half that drifted would be
// the typed half, which is the half members write. That is what these cases
// are really pinning: not that the typed spelling works, but that it is the
// SAME code, so a fix to either reaches both.
import { describe, it, expect } from 'vitest'

import { ARRAY_FNS } from '../collections.js'
import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const N = 3
const BARS = Array.from({ length: N }, (_, i) => (
  { t: 1700000000 + i * 86400, o: 99 + i, h: 101 + i, l: 98 + i, c: 100 + i, v: 1000 + i }))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const head = '//@version=6\nindicator("t")\n'

function run(src) {
  const built = buildRuntimeIr(head + src, { bars: BARS, inputs: {} })
  if (!built.ok) throw new Error(`refused: ${built.refusal.guard} — ${built.refusal.message}`)
  const program = lowerIrProgram(built.ir)
  const res = execute(program, {
    bars: N, series: SERIES, columns: program.columns, confirmed: true,
    barTimes: BARS.map((b) => b.t),
  })
  return Array.from(res.outputs[0])
}

describe('the typed constructors run', () => {
  it('⭐⭐ THE TYPED AND GENERIC SPELLINGS PRODUCE THE SAME ANSWER', () => {
    // ⛔ THE EQUIVALENCE IS THE RAIL. Asserting only that the typed form "works"
    // would pass on an alias that quietly filled a different default or capped
    // the size differently — the drift this delegation exists to prevent.
    expect(run('a = array.new_float(3, 7.0)\nplot(array.get(a, 1))'))
      .toEqual(run('a = array.new<float>(3, 7.0)\nplot(array.get(a, 1))'))
    expect(run('a = array.new_int(2, 5)\nplot(array.get(a, 0))'))
      .toEqual(run('a = array.new<int>(2, 5)\nplot(array.get(a, 0))'))
  })

  it('⛔ CONTROL: the answers are the real values, not two matching blanks', () => {
    // Without this the equivalence above is satisfied by two builds that both
    // return NaN (`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`).
    expect(run('a = array.new_float(3, 7.0)\nplot(array.get(a, 1))')).toEqual([7, 7, 7])
    expect(run('a = array.new_int(2, 5)\nplot(array.get(a, 0))')).toEqual([5, 5, 5])
  })

  it('an empty typed array is a real, growable array', () => {
    expect(run('a = array.new_float()\narray.push(a, close)\nplot(array.size(a))')).toEqual([1, 1, 1])
    expect(run('a = array.new_float(2)\nplot(array.size(a))')).toEqual([2, 2, 2])
  })
})

describe('⛔ an unmeasured element default still refuses', () => {
  it('`array.new_bool(2)` says what is actually unknown', () => {
    // ⭐ LISTING A TYPE IS NOT SERVING IT. `bool` and `string` are in the alias
    // list so the refusal becomes the TRUE sentence — "what Pine fills a bool
    // array with has not been measured" — instead of the false one, "this
    // engine has no such function". Those are different facts and only one of
    // them is correct.
    expect(() => run('a = array.new_bool(2)\nplot(array.size(a))'))
      .toThrow(/has not been measured/)
  })

  it('⛔ CONTROL: with an initial value supplied, the same call runs', () => {
    // The refusal is about the DEFAULT, not about the type — so supplying one
    // must clear it, or the sentence is a lie about the reason.
    expect(run('a = array.new_bool(2, true)\nplot(array.size(a))')).toEqual([2, 2, 2])
  })
})

describe('⛔ one implementation, not two', () => {
  it('every typed alias shares the generic spec, field for field', () => {
    // ⭐ DERIVED FROM THE TABLE, NOT A TYPED LIST. An alias added tomorrow is
    // checked the day it lands, and one whose arity or return kind drifted from
    // the generic entry fails here rather than in a member's script.
    const generic = ARRAY_FNS['array.new']
    const aliases = Object.keys(ARRAY_FNS).filter((k) => k.startsWith('array.new_'))
    expect(aliases.length).toBeGreaterThan(0)
    for (const name of aliases) {
      const spec = ARRAY_FNS[name]
      expect(spec.args, name).toEqual(generic.args)
      expect(spec.returns, name).toBe(generic.returns)
      expect(spec.minArgs, name).toBe(generic.minArgs)
      expect(spec.maxArgs, name).toBe(generic.maxArgs)
      // ⭐ …and it is NOT generic: the type is in the name, so a `<T>` would be
      // a second opinion about which type this call builds.
      expect(spec.generic, name).toBe(false)
    }
  })
})
