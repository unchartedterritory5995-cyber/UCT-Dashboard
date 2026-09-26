// app/src/components/chart/engine/runtime/__tests__/elseGuardShape.test.js
//
// ─── ⭐⭐ A DRAWING IN AN `else` BRANCH ──────────────────────────────────────
//
// ⚰️⚰️ ANY drawing statement inside ANY `else` arm refused, and the content was
// irrelevant: a `table.cell` with a literal string, a `box.delete`, a
// `set_bgcolor`, an `else if` arm — all of them `pine:statement`, *"this Pine
// line is not a shape the translator reads"*. Two separate `if`s expressing the
// same thing compiled and drew.
//
// ⭐⭐ THE CAUSE WAS TWO SPELLINGS OF ONE GUARD. The object pass turns `else`
// into "not the previous condition" and SYNTHESISED that node itself:
//
//     if / else        {type:'op',    name:'!',   args:[…]}   <- built here
//     a written `not`  {type:'unary', op:'not',   arg:…}      <- the parser's
//
// `resolve` accepts `op` on the way in, so the columnar lane never noticed. The
// RUNTIME lane reads what the PARSER emits, so under `objectRawTrees` it met a
// node shape it does not know and refused a guard it could have lowered — about
// a node the engine had just built for itself.
//
// ⛔⛔ AND THE FIX WAS ALREADY WRITTEN DOWN, IN A COMMENT DIRECTLY ABOVE THE
// OFFENDING LINE. It said, in as many words: *"SYNTHESISED IN THE PARSER'S
// SHAPE, NOT THE RESOLVER'S … it broke the moment a second reader existed …
// refused a guard it could have lowered with `pine:statement`, about a node this
// file had just built."* The prose described the corrected behaviour and the two
// lines under it still emitted `{type:'op'}`. A comment asserting an agreement
// nobody wired is this repo's most repeated defect
// (`lesson_a_comment_claiming_agreement_is_not_agreement`), and this is the
// version of it that costs the product: `else` appears in 1,328 lines across 141
// corpus scripts, 120 of which draw.
//
// ⛔⛔ AND THE COMMENT'S REMEDY WAS HALF RIGHT, WHICH COST 28 TESTS. Emitting
// the parser's shape UNCONDITIONALLY — exactly what that paragraph prescribes —
// turns this family green and breaks the VENDOR PARITY suite, every drawn-cell
// comparison against the TradingView captures, with *"an object tree refused —
// the cells below would be NaN"*.
//
// ⭐⭐ THERE IS NO SINGLE CORRECT SHAPE. THERE ARE TWO. `canonicalOf` hands back
// the RAW parse node under `objectRawTrees` and a RESOLVED canonical node
// otherwise, so the WRAPPER has to follow the same flag that chose the INNER
// node — a parser wrapper round a canonical node is a hybrid neither reader can
// read. The comment's DIAGNOSIS was exact and its claim that *"every reader
// downstream takes the parser's shape"* is false: the object reader on the
// canonical path takes the resolver's.
//
// ⭐ SO THIS FILE RAILS BOTH SHAPES, NOT ONLY THE OUTCOME. Asserting "it builds"
// alone would go green again the day some reader learns to accept `op`; asserting
// only the RAW shape is what made the first fix look finished.
import { describe, it, expect } from 'vitest'

import { translatePine } from '../../ast/pine.js'
import { buildObjectLane, runObjectLane } from '../objectLane.js'

const N = 60
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1700000000 + i * 86400,
  o: 100 + (i % 7), h: 104 + (i % 5), l: 96 - (i % 3), c: 100 + (i % 11), v: 1000000 + i,
}))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))

const H = '//@version=6\nindicator("t", overlay=true)\n'
const T = 'var t = table.new(position.top_right, 1, 1)\n'
const Q = String.fromCharCode(34)

/** `if / else`, a drawing in each arm. */
const IF_ELSE = `${T}if barstate.islast\n    table.cell(t,0,0,${Q}a${Q})\n`
  + `else\n    table.cell(t,0,0,${Q}b${Q})\n`
/** The same meaning written as two independent `if`s — the shape that worked. */
const TWO_IFS = `${T}if barstate.islast\n    table.cell(t,0,0,${Q}a${Q})\n`
  + `if not barstate.islast\n    table.cell(t,0,0,${Q}b${Q})\n`

const pass = (body) => translatePine(H + body, {
  strict: true, objects: true, objectRawTrees: true, objectIterTrees: true,
})
const treesOf = (body) => ((pass(body).objects || {}).trees) || []
const lane = (body) => buildObjectLane(H + body, {
  tf: 'D', newestBarIsForming: false, bars: BARS,
})

describe('⭐⭐ a drawing inside an `else` arm', () => {
  it('⭐⭐ BUILDS — and it did not', () => {
    const r = lane(IF_ELSE)
    const ref = r.refusal || {}
    expect(r.ok, `refused ${r.lane}/${ref.guard}: ${ref.message}`).toBe(true)
  })

  it('⭐⭐ and it DRAWS when run, which a build alone does not say', () => {
    // ⛔ A BUILD IS NOT A DRAW. This repo spent a day quoting a build count as
    // the product metric; the executing census exists because of it.
    const r = lane(IF_ELSE)
    expect(r.ok).toBe(true)
    const run = runObjectLane(r, {
      bars: N, series: SERIES, confirmed: true, readTime: (i) => BARS[i].t,
    })
    expect(Array.isArray(run.live) ? run.live.length : 0).toBeGreaterThan(0)
  })

  it('⛔⛔ THE GUARD IS THE PARSER\'S SHAPE — `unary`/`not`, never `op`/`!`', () => {
    // ⭐ THE LOAD-BEARING ASSERTION. "It builds" goes green again the day a
    // reader learns to accept `op`, which is the second authority the fix
    // exists to remove. The SHAPE is the contract.
    const trees = treesOf(IF_ELSE)
    expect(trees.length, 'the else guard was not interned at all').toBeGreaterThan(0)
    const guard = trees[0]
    expect(guard.type, 'the object pass is still synthesising the resolver shape')
      .toBe('unary')
    expect(guard.op).toBe('not')
    expect(guard.arg, 'a unary node carries `arg`, not `args`').toBeTruthy()
    expect(guard.args, 'an `op`-shaped node leaked through').toBeUndefined()
  })

  it('⛔ the AND composition is the parser\'s shape too', () => {
    // The same line built `{type:'op', name:'&&'}` for a second guard, and the
    // same comment named it. Two guards stack when an `else` sits inside an
    // outer `if`.
    const nested = `${T}if close > open\n    if barstate.islast\n`
      + `        table.cell(t,0,0,${Q}a${Q})\n    else\n        table.cell(t,0,0,${Q}b${Q})\n`
    const r = lane(nested)
    expect(r.ok, `nested else refused ${(r.refusal || {}).guard}`).toBe(true)
    const stacked = treesOf(nested).filter((t) => t && t.type === 'binary' && t.op === 'and')
    expect(stacked.length, 'no `and`-composed guard was interned').toBeGreaterThan(0)
    for (const t of treesOf(nested)) {
      expect(t.type, `an \`op\` node survived: ${JSON.stringify(t).slice(0, 80)}`).not.toBe('op')
    }
  })

  it('⛔⛔ AND THE CANONICAL PATH KEEPS THE RESOLVER SHAPE — there are TWO', () => {
    // ⚰️⚰️ THE HALF THAT COST 28 TESTS. Emitting the parser's shape
    // UNCONDITIONALLY — which is exactly what the comment in `pine.js` prescribed
    // — turns the `else` family green and breaks the VENDOR PARITY suite, every
    // drawn-cell comparison against the TradingView captures, with "an object
    // tree refused — the cells below would be NaN".
    //
    // ⭐⭐ `canonicalOf` hands back the RAW parse node under `objectRawTrees` and
    // a RESOLVED canonical node otherwise, so wrapping a canonical node in a
    // parser node builds a hybrid neither reader can read. There is no single
    // correct shape: there are two, chosen by the same flag that chose the
    // inner node. This is the half a test asserting only the raw path cannot see.
    const canonical = translatePine(H + IF_ELSE, { strict: true, objects: true })
    const trees = ((canonical.objects || {}).trees) || []
    expect(trees.length, 'the canonical path interned no guard').toBeGreaterThan(0)
    expect(trees[0].type, 'the canonical path must keep the resolver shape').toBe('op')
    expect(trees[0].name).toBe('!')
    expect(trees[0].args, 'an `op` node carries `args`').toBeTruthy()
  })

  it('⭐ PARITY — `if/else` emits the same ops as the two-`if` spelling', () => {
    // ⭐ The two-`if` form compiled throughout, so it is the reference answer.
    const a = pass(IF_ELSE)
    const b = pass(TWO_IFS)
    expect(((a.objects || {}).ops || []).map((o) => o.k))
      .toEqual(((b.objects || {}).ops || []).map((o) => o.k))
  })

  it('⛔ CONTROL — the two-`if` spelling still builds, so parity is not two failures', () => {
    // ⭐ NON-VACUITY. If the reference spelling broke, the parity test above
    // would compare two empty programs and pass while nothing worked.
    const r = lane(TWO_IFS)
    expect(r.ok, `the reference spelling refused ${(r.refusal || {}).guard}`).toBe(true)
    expect(((pass(TWO_IFS).objects || {}).ops || []).length).toBeGreaterThan(1)
  })

  it('⛔ an `else if` arm draws too', () => {
    const chain = `${T}if close > open\n    table.cell(t,0,0,${Q}a${Q})\n`
      + `else if close < open\n    table.cell(t,0,0,${Q}b${Q})\n`
    const r = lane(chain)
    expect(r.ok, `else-if refused ${(r.refusal || {}).guard}`).toBe(true)
  })
})
