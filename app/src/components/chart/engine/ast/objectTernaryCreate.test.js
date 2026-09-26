// app/src/components/chart/engine/ast/objectTernaryCreate.test.js
//
// ─── ⭐⭐ A CONDITIONAL CREATE — `x := cond ? line.new(…) : na` ──────────────
//
// ⚰️ THE READER SAW A CREATE ONLY WHERE THE CALL WAS THE WHOLE RIGHT-HAND SIDE.
// `emitFromRhs` opens with `rhs[0].kind !== 'ident'` → return, and then demands
// that first token BE `<family>.new`. A right-hand side that opens with a
// CONDITION — the corpus's commonest way to write "draw this only when …" —
// matched nothing, fell through every branch of the walk, and left NO op and NO
// diagnostic. An UNCOUNTED DROP, which this reader's own header calls the worst
// shape a gap can take: `array.push(…)` at least says `coll:push`.
//
// ⭐ MEASURED ON `corpus/committed`, 2026-09-22, before a line was written:
//     46 create sites in 17 scripts sit in a ternary arm
//     for 7 of those scripts it is the ONLY create shape in the file, so the
//        object pass collected zero creates and the script was reported as
//        drawing nothing
//     `liquidity-pools__fa7b28e733.pine` — one of the FOUR scripts that draw
//        end to end today — writes SIX of them, and shipped a drawing built
//        from 2 ops while its own source asks for more.
//
// ⭐⭐ AND IT IS NOT A NEW CAPABILITY, WHICH IS THE WHOLE ARGUMENT FOR IT.
// `x := cond ? line.new(…) : na` and
//     if cond
//         x := line.new(…)
// are ONE Pine operation written two ways. The second has been collected since
// C3B: the walk pushes `{toks: cond, negate: false}` onto the guard stack and
// `emitFromRhs` stamps it onto the create. The ternary needed the same stack
// entry from a different token span — no new op kind, no new runtime, no new
// validator rule. `sameProgramTwoSpellings` below is the rail that says so, and
// it is the one that would go red if this ever grew its own opinion.
//
// ⛔⛔ THE `var` INITIALISER IS DELIBERATELY NOT SPLIT, AND IS COUNTED INSTEAD.
// `var line x = cond ? line.new(…) : na` evaluates its initialiser ONCE, on the
// first bar, and Pine leaves `x` as `na` forever if `cond` was false there. A
// guarded `once` create would instead fire on the first bar `cond` becomes
// true — a line on a member's chart that their script never drew. Refusing and
// SAYING SO is the only answer available without a second op kind.
import { describe, it, expect } from 'vitest'

import { translatePine } from './pine'
import { assertObjectProgram, bindObjectProgram } from './objectProgram'
import { evaluateObjects } from '../objectRuntime'

const head = '//@version=6\nindicator("t", overlay = true)\n'
const T = (src, opts = {}) => translatePine(head + src, { strict: true, objects: true, ...opts })
const opsOf = (t) => ((t.objects || {}).ops || [])
const kindsOf = (t) => opsOf(t).map((o) => o.k)
const dropsOf = (t) => ((t.objectDiagnostics || {}).dropReasons || {})
const unsupportedOf = (t) => ((t.objectDiagnostics || {}).unsupported || [])

/** ⛔ CONTROL, on every case: the object pass RAN. An empty `ops` satisfies
 *  almost any check written over it, so "no create" and "the reader threw" have
 *  to be told apart before anything else is asserted. */
const ranCleanly = (t) => {
  expect(t.objectDiagnostics, 'the object pass produced no diagnostics at all').toBeTruthy()
  expect(t.objectDiagnostics.failed, `the object reader threw: ${t.objectDiagnostics.error}`)
    .toBeUndefined()
}

// ⭐⭐ EVERY COORDINATE COMES FROM SERIES DATA. A fixture built from literals
// folds to `{v:'const'}` before it reaches any binding code, so the binding
// stays unrailed and a mutation that broke it would survive untouched.
const DECL = 'var line l = na\n'
const TERNARY = `${DECL}l := close > open ? line.new(bar_index - 2, high, bar_index, low) : na\n`
const IF_FORM = `${DECL}if close > open\n    l := line.new(bar_index - 2, high, bar_index, low)\n`

describe('⭐⭐ the reader collects a create written in a ternary arm', () => {
  it('emits the CREATE at all', () => {
    const t = T(TERNARY)
    ranCleanly(t)
    expect(kindsOf(t), 'a conditional create collected nothing and said nothing')
      .toEqual(['create'])
  })

  it('⭐⭐ SAME PROGRAM, TWO SPELLINGS — the ternary and the `if` agree', () => {
    // ⛔ THE LOAD-BEARING RAIL. If this reader ever grows its own opinion about
    // what a conditional create means, the two spellings diverge here first —
    // and a drawing that differs by how its author punctuated it is the failure
    // this whole change exists to avoid.
    const a = T(TERNARY)
    const b = T(IF_FORM)
    ranCleanly(a)
    ranCleanly(b)
    const strip = (t) => opsOf(t).map((o) => ({
      k: o.k, family: o.family, into: o.into, once: o.once, when: o.when, props: o.props,
    }))
    expect(strip(a)).toEqual(strip(b))
  })

  it('⭐ the guard is the CONDITION, carried as a tree — not a folded constant', () => {
    const create = opsOf(T(TERNARY))[0]
    expect(create.when, 'the create came through unguarded — it would draw every bar')
      .toBeTruthy()
    expect(create.when.v).toBe('tree')
    // ⛔ and the coordinates are still bound to the script's own expressions
    expect(create.props.y1.v).toBe('tree')
    expect(create.props.y2.v).toBe('tree')
    expect(create.props.y1.tree).not.toBe(create.props.y2.tree)
  })

  it('⛔ the program VALIDATES — the shape is one the runtime accepts', () => {
    expect(() => assertObjectProgram(T(TERNARY).objects)).not.toThrow()
  })

  it('⭐ the ELSE arm creates too, under the NEGATED condition', () => {
    const t = T(`${DECL}l := close > open ? na : line.new(bar_index - 2, high, bar_index, low)\n`)
    ranCleanly(t)
    expect(kindsOf(t)).toEqual(['create'])
    const create = opsOf(t)[0]
    expect(create.when).toBeTruthy()
    // ⛔⛔ THE DISCRIMINATOR IS THE TREE, NOT ITS INDEX. Both spellings intern
    // their guard as tree 0, so comparing `when` across two translations
    // compares `{v:'tree',tree:0}` with itself and passes for a reader that
    // dropped `negate` entirely. What has to differ is the EXPRESSION.
    const guardTreeOf = (tt) => JSON.stringify((tt.objects.trees || [])[opsOf(tt)[0].when.tree])
    expect(guardTreeOf(t)).not.toBe(guardTreeOf(T(TERNARY)))
    // …and it differs by being a NEGATION of the same condition.
    expect(guardTreeOf(t).length).toBeGreaterThan(guardTreeOf(T(TERNARY)).length)
  })

  it('⭐ BOTH arms may create — two ops, complementary guards', () => {
    const t = T(`${DECL}l := close > open ? line.new(bar_index - 2, high, bar_index, low)`
      + ' : line.new(bar_index - 3, low, bar_index, high)\n')
    ranCleanly(t)
    expect(kindsOf(t)).toEqual(['create', 'create'])
    const [a, b] = opsOf(t)
    expect(a.when).not.toEqual(b.when)
  })

  it('⭐ a CHAINED ternary reaches the second create too', () => {
    const t = T(`${DECL}l := close > open ? line.new(bar_index - 2, high, bar_index, low)`
      + ' : close < open ? line.new(bar_index - 3, low, bar_index, high) : na\n')
    ranCleanly(t)
    expect(kindsOf(t)).toEqual(['create', 'create'])
  })

  it('⭐ a BARE ternary statement draws too — no handle involved', () => {
    const t = T('close > open ? label.new(bar_index, high, "up") : na\n')
    ranCleanly(t)
    expect(kindsOf(t)).toEqual(['create'])
    expect(opsOf(t)[0].into).toBe(null)
    expect(opsOf(t)[0].when.v).toBe('tree')
  })
})

describe('⛔⛔ what this reader will NOT read, it COUNTS', () => {
  it('a `var` INITIALISER is refused by name, never guessed at', () => {
    // See the header: `var` runs its initialiser once, on bar 0. A guarded
    // `once` create fires on the first bar the condition turns true instead,
    // which draws a line the script does not.
    const t = T('var line l = close > open ? line.new(bar_index - 2, high, bar_index, low) : na\n')
    ranCleanly(t)
    expect(kindsOf(t)).toEqual([])
    expect(unsupportedOf(t), 'the refused shape left no trace at all')
      .toContain('line.new')
  })

  it('a create this reader cannot lift out of the arm is COUNTED', () => {
    // The call is not the whole arm, so `argsOf`'s span guard refuses it —
    // and the point of this case is that the refusal is VISIBLE.
    const t = T(`${DECL}l := close > open ? line.copy(line.new(bar_index - 2, high, bar_index, low)) : na\n`)
    ranCleanly(t)
    expect(kindsOf(t)).toEqual([])
    expect(unsupportedOf(t)).toContain('line.new')
  })

  it('⛔ CONTROL — a ternary with no create in it is untouched, and silent', () => {
    // ⭐⭐ THE FIXTURE THAT MAKES THE ONES ABOVE MEAN ANYTHING. A reader that
    // shouted `unsupported` at every ternary it met would pass both cases above
    // and bury every real diagnostic in the corpus under noise.
    const t = T(`${DECL}y = close > open ? high : low\nl := line.new(bar_index - 2, y, bar_index, y)\n`)
    ranCleanly(t)
    expect(kindsOf(t)).toEqual(['create'])
    expect(unsupportedOf(t)).toEqual([])
    // and the create is the UNCONDITIONAL one — the ternary was a VALUE
    expect(opsOf(t)[0].when).toBe(null)
  })

  it('⛔ CONTROL — an ordinary unconditional create is byte-identical', () => {
    const t = T(`${DECL}l := line.new(bar_index - 2, high, bar_index, low)\n`)
    ranCleanly(t)
    expect(kindsOf(t)).toEqual(['create'])
    expect(opsOf(t)[0].when).toBe(null)
    expect(dropsOf(t)).toEqual({})
  })
})

describe('⭐⭐ and the DRAWING only appears on the bars the condition holds', () => {
  it('runs through the object runtime and draws on those bars alone', () => {
    const t = T(TERNARY)
    const program = bindObjectProgram(t.objects, (i) => i)
    const create = program.ops.find((o) => o.k === 'create')
    expect(create, 'nothing to run').toBeTruthy()

    const bars = 6
    const series = {}
    for (let i = 0; i < (t.objects.trees || []).length; i += 1) {
      series[i] = Array.from({ length: bars }, (_, b) => (i + 1) * 10 + b)
    }
    // ⛔ THE GUARD MOVES. A condition true on every bar cannot tell a reader
    // that honours it from one that drops it.
    series[create.when.node] = [1, 0, 1, 0, 0, 1]

    const r = evaluateObjects(program, {
      barCount: bars,
      readNode: (node, bar) => (series[node] ? series[node][bar] : NaN),
      readTime: (bar) => 1_700_000_000 + bar * 86400,
    })
    expect(r.live.length, 'the conditional create drew on the wrong number of bars').toBe(3)
    const y1 = r.live.map((o) => o.props.y1)
    expect(y1).toEqual([0, 2, 5].map((b) => series[create.props.y1.node][b]))
    // ⛔ CONTROL ON THE CONTROL: a value identical on every bar is what a folded
    // constant looks like, so the fixture only means something if these move.
    expect(new Set(y1).size).toBe(3)
  })
})
