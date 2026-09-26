// app/src/components/chart/engine/runtime/__tests__/drawingArrays.test.js
//
// ─── ⭐⭐ `array.new_box()` IS `array.new<box>()` — THE DRAWING ARRAY ────────
//
// A Pine script that draws more than one of anything keeps its drawings in an
// array: `var box[] zones = array.new_box()`, then push a box per zone and
// delete the oldest. Measured over the 266-script committed corpus, that is not
// a niche idiom — it is the dominant one:
//
//     array.new_line   108 sites / 28 scripts
//     array.new_box     83 sites / 27 scripts
//     array.new_label   46 sites / 18 scripts
//     array.new_linefill 1 site  /  1 script
//
// The runtime lane refused all four by name, at `runtime:array`, with the
// sentence *"the runtime has no collections yet"* — which has not been true
// since the typed constructors landed. It has collections; what it did not have
// was these four SPELLINGS of the one it already implements.
//
// ⛔⛔ AND THE ELEMENT IS STILL NOT SERVED, DELIBERATELY. An `array<box>` holds
// DRAWING HANDLES, and the drawing handles belong to the object program — this
// lane has no value for one and must not invent it. So the split is:
//
//   * a ZERO-LENGTH array is served, for every type, because a zero-length
//     array has no element and the fill value cannot be reached;
//   * an EXPLICIT initial value is served, because the member supplied it;
//   * a SIZED drawing array with no initial value is REFUSED BY NAME, because
//     the value Pine fills it with is a null drawing handle and this lane has
//     no such value. Answering `na` would make `na(array.get(zones, i))` read
//     TRUE for a box the object program had already drawn.
//
// ⭐ THE ZERO CASE IS THE ONE THAT MOVES SCRIPTS. Counted across the corpus's
// 237 drawing-constructor sites, ~93% are `()` or `(0)`.
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

/** The build verdict without running — for the refusal cases. */
const build = (src) => buildRuntimeIr(head + src, { bars: BARS, inputs: {} })

const DRAWING = ['box', 'line', 'label', 'linefill']

describe('⭐⭐ the drawing arrays exist', () => {
  it('every drawing constructor is in the table, delegating to the generic one', () => {
    // ⛔ THE ROSTER IS DERIVED FROM `OBJECT_NAMESPACES`-shaped truth, not from a
    // list typed twice: the loop below reads the same four names the corpus
    // census counted, and a missing one fails BY NAME rather than as a count.
    for (const ty of DRAWING) {
      expect(ARRAY_FNS[`array.new_${ty}`], `array.new_${ty}`).toBeTruthy()
    }
  })

  it('⭐ an empty drawing array is a real, growable, EMPTY array', () => {
    expect(run('var a = array.new_box()\nplot(array.size(a))')).toEqual([0, 0, 0])
    expect(run('var a = array.new_line()\nplot(array.size(a))')).toEqual([0, 0, 0])
    expect(run('var a = array.new_label()\nplot(array.size(a))')).toEqual([0, 0, 0])
    expect(run('var a = array.new_linefill()\nplot(array.size(a))')).toEqual([0, 0, 0])
  })

  it('⛔ CONTROL: the zeros above are a SIZE, not a refused build answering na', () => {
    // Without this, four `[0,0,0]`s are satisfied by a harness that returned a
    // blank column for every one of them
    // (`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`).
    expect(run('var a = array.new_box()\narray.push(a, close)\nplot(array.size(a))'))
      .toEqual([1, 2, 3])
  })

  it('⭐ an EXPLICIT zero size is served too — `array.new_box(0)`', () => {
    // The corpus's second-commonest spelling. `(0)` reaches the element-default
    // lookup that `()` skips entirely, so it is a different code path and needs
    // its own case.
    expect(run('var a = array.new_box(0)\nplot(array.size(a))')).toEqual([0, 0, 0])
    expect(run('var a = array.new_line(0)\nplot(array.size(a))')).toEqual([0, 0, 0])
    expect(run('var a = array.new_label(0)\nplot(array.size(a))')).toEqual([0, 0, 0])
  })

  it('⭐⭐ A COMPUTED SIZE OF ZERO IS SERVED — the case a literal cannot rail', () => {
    // ⛔⛔ A LITERAL `0` CAN FOLD BEFORE THE RUNTIME EVER SEES IT. A rail built
    // only from `array.new_box(0)` stays green against a fix applied at fold
    // time and against one applied in the VM, so it cannot tell which layer is
    // carrying the behaviour. `array.size(empty)` is computed in the VM on
    // every bar, so this case can only pass if the VM's own constructor serves
    // a zero size.
    expect(run('var e = array.new_float()\nvar a = array.new_box(array.size(e))\nplot(array.size(a))'))
      .toEqual([0, 0, 0])
  })

  it('⛔ CONTROL: the same computed shape with a NON-zero size still refuses', () => {
    // The zero case must be about the SIZE, not about the type — so a computed
    // size the array actually has to fill has to keep refusing, or the sentence
    // above is a lie about the reason.
    const b = build('var e = array.new_float(2, 1.0)\n'
      + 'var a = array.new_box(array.size(e))\nplot(array.size(a))')
    expect(b.ok).toBe(true) // it BUILDS — the refusal is the VM's, at run time
    expect(() => run('var e = array.new_float(2, 1.0)\n'
      + 'var a = array.new_box(array.size(e))\nplot(array.size(a))'))
      .toThrow(/drawing handle/)
  })
})

describe('⛔ a sized drawing array with no initial value is refused BY NAME', () => {
  it('`array.new_box(5)` says what is actually unknown — a drawing handle', () => {
    // ⚰️ It used to say "the runtime has no collections yet", which stopped
    // being true when the typed constructors landed, and pointed the next
    // engineer at collections rather than at the object program.
    expect(() => run('var a = array.new_box(5)\nplot(array.size(a))'))
      .toThrow(/drawing handle/)
    expect(() => run('var a = array.new_line(3)\nplot(array.size(a))'))
      .toThrow(/drawing handle/)
  })

  it('⛔ CONTROL: with an initial value supplied, the same call runs', () => {
    // The refusal is about the element this lane cannot produce, not about the
    // type — so a member who supplies one must get their array.
    expect(run('var a = array.new_box(5, na)\nplot(array.size(a))')).toEqual([5, 5, 5])
  })

  it('⭐⭐ A COMPUTED SIZE WITH AN EXPLICIT `na` — the corpus\'s own shape', () => {
    // `array.new_box(array.size(vpRed), na)` is written verbatim in the corpus.
    // With a literal size the size never leaves the fold, so a binding that
    // dropped the computed argument would stay green on every case above.
    expect(run('var e = array.new_float(4, 1.0)\n'
      + 'var a = array.new_box(array.size(e), na)\nplot(array.size(a))'))
      .toEqual([4, 4, 4])
  })
})

describe('⭐ the zero-size fix is general, not a drawing special case', () => {
  it('`array.new_bool(0)` and `array.new_string(0)` are served', () => {
    // ⛔ A ZERO-LENGTH ARRAY HAS NO ELEMENT, so the unmeasured element default
    // cannot be reached — refusing it refused a case the reason cannot apply
    // to. Serving it here is the same rule as the drawing zero above, and it
    // is what makes that rule a rule rather than a carve-out.
    expect(run('var a = array.new_bool(0)\nplot(array.size(a))')).toEqual([0, 0, 0])
    expect(run('var a = array.new_string(0)\nplot(array.size(a))')).toEqual([0, 0, 0])
  })

  it('⛔ CONTROL: a NON-zero `array.new_bool(2)` still refuses, unchanged', () => {
    expect(() => run('var a = array.new_bool(2)\nplot(array.size(a))'))
      .toThrow(/has not been measured/)
  })
})

describe("⭐ the corpus's own declaration shapes reach the lane", () => {
  it('a type-annotated `var box[] zones = array.new_box()` builds', () => {
    // `market-structure-break-order-block` and `order-blocks` both write the
    // type twice — once in the annotation and once in the constructor's name.
    expect(run('var box[] zones = array.new_box()\nplot(array.size(zones))')).toEqual([0, 0, 0])
    expect(run('var line[] lv = array.new_line()\nplot(array.size(lv))')).toEqual([0, 0, 0])
  })
})
