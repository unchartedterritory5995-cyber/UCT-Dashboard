// app/src/components/chart/engine/ast/colourUserFnFold.test.js
//
// ─── ⭐⭐ R35c + R35d — A COLOUR HELPER FOLDS, AND `color.t` IS ITS LEAF ─────
//
// R35c: `staticColourOf` gains ONE user-function branch, following the pattern
// `textNodeOf` (`pine.js:10041`) already ships for TEXT — `colorNodeOf` says in
// file that it is "THE SAME SHAPE, ONE BRANCH SHORTER", and this is that branch.
// Substitution is the Resolver's frame protocol; numbers go through
// `resolveInFrame` + `constantValueOf`. No new evaluator, no 12th NODE_TYPE.
//
// R35d: `color.t(x)` folds to x's TRANSPARENCY when x folds to a static colour.
// ⛔ It lives HERE, beside `staticColourOf`, and NOT in the Resolver: `color.` is
// mapped to `pine:colour-value` wholesale, and that refusal is CORRECT for a
// screened column — a colour is not a number there. Colour knowledge belongs to
// the colour authority.
//
// ⚰️ WHY R35d IS NOT OPTIONAL, MEASURED: 5 of 5 colour-returning helpers in the
// census's four scripts — and 43 of 43 call sites — route their alpha through
// `color.t`. R35c alone would carry ZERO scripts, which is machinery with no
// consumer.
//
// ⚰️ AND WHY EVERY NUMBER BELOW IS DERIVED. An earlier report gave Clouds' alphas
// as 84 / 38.4. Those came from a probe that hand-substituted
// `bullUserTransparency = 20`; Clouds' real binding is `color.t(bullColor)`, so
// the true figures are 95 / 70 / 47.5. A hand-typed literal would have pinned the
// wrong ones — so the layer alphas are COMPUTED here from the script's own three
// constants, and a hard-coded value fails two of the three layers.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { translatePine } from './pine.js'

const REPO = path.resolve(__dirname, '../../../../../..')
const CLOUDS = fs.readFileSync(path.join(REPO, 'tests/fixtures/member/uncharted-clouds.pine'), 'utf8')
const HEAD = '//@version=5\nindicator("t", overlay=true)\n'

const presOf = (src, i = 0) => {
  const t = translatePine(src, { strict: true })
  return { t, p: ((t.outputs || [])[i] || {}).presentation || {} }
}
const fillsOf = (src) => {
  const t = translatePine(src, { strict: true })
  return { t, fills: ((t.presentation || {}).fills || []) }
}

// ⭐ CLOUDS' OWN CONSTANTS, read as the script declares them (lines 29-32, 96-97).
// The alphas are DERIVED from these, never typed.
const MAX_T = 95
const MIN_T = 45
const LAYERS = 21
const STEP = (MAX_T - MIN_T) / (LAYERS - 1)          // 2.5
const USER_T = 0                                      // color.t(color.teal), opaque
/** getAdjustedTransparency(k, u) with the script's own arithmetic. */
const transparencyAt = (k) => {
  const b = MAX_T - STEP * k
  return Math.min(b + (100 - b) * (USER_T / 100), 100)
}
const opacityAt = (k) => Math.max(0, Math.min(1, 1 - transparencyAt(k) / 100))

describe('R35d — color.t of a static colour folds to its transparency', () => {
  it('⛔⛔ NON-VACUITY — the shape under test really is unfoldable today', () => {
    // If `color.t` ever folds for free, every assertion below passes for the
    // wrong reason. This pins the PREMISE: a literal alpha already works, so the
    // fixture differs from the working case in exactly one way.
    const { p } = presOf(`${HEAD}plot(close, "A", color = color.new(#112233, 40))\n`)
    expect(p.color, 'a literal alpha no longer carries — the premise is gone').toBe('#112233')
    expect(p.opacity).toBeCloseTo(0.6, 10)
  })

  it('⭐ color.t(color.teal) is 0 — a built-in colour is opaque', () => {
    const { p } = presOf(`${HEAD}plot(close, "A", color = color.new(#112233, color.t(color.teal)))\n`)
    expect(p.color).toBe('#112233')
    expect(p.opacity, 'transparency 0 must read as fully opaque').toBeCloseTo(1, 10)
  })

  it('⭐ color.t(color.new(base, 40)) is 40', () => {
    const { p } = presOf(`${HEAD}plot(close, "A", color = color.new(#112233, color.t(color.new(color.teal, 40))))\n`)
    expect(p.opacity, '40% transparent must read as 0.6 opaque').toBeCloseTo(0.6, 10)
  })

  it('⭐ color.t of a NAME bound to an input.color default reads that default', () => {
    const src = `${HEAD}c = input.color(color.new(color.teal, 25), "C")\n`
      + 'plot(close, "A", color = color.new(#112233, color.t(c)))\n'
    const { p } = presOf(src)
    expect(p.opacity, "the input's own default transparency was not read").toBeCloseTo(0.75, 10)
  })

  it('⛔⛔ color.t of color.new(<SERIES>, 30) must NOT read the 30', () => {
    // ⚰️ ADDED BECAUSE A MUTATION ESCAPED. Deleting the "is it a static colour at
    // all?" gate at the top of `colourTransparencyOf` caught NOTHING across the
    // whole file — the existing series control walks a ternary, which falls off
    // the end of the branch list and returns null with or without the gate.
    //
    // ⭐ THE GATE'S REAL JOB IS THIS SHAPE. `color.new(c, 30)` DOES match the
    // `color.new` branch, so without the gate its literal 30 is handed back as
    // the transparency of a colour that is not static at all — a per-bar colour
    // silently acquiring a plan-time alpha, which is the precise direction
    // `color.new`'s own guard exists to refuse.
    const src = `${HEAD}c = close > open ? color.green : color.red\n`
      + 'plot(close, "A", color = color.new(#112233, color.t(color.new(c, 30))))\n'
    const { p } = presOf(src)
    expect(p.color, "a series colour's wrapper alpha was read as static").toBeUndefined()
    expect(p.colorDynamic).toBe(true)
  })

  it('⛔ CONTROL — color.t of a SERIES colour stays dynamic, with the reason', () => {
    // The direction that must not move: a per-bar colour has no plan-time alpha,
    // and inventing one paints a flat band where the author drew a changing one.
    const src = `${HEAD}c = close > open ? color.green : color.red\n`
      + 'plot(close, "A", color = color.new(#112233, color.t(c)))\n'
    const { p } = presOf(src)
    expect(p.color, 'a series colour was folded to a static alpha').toBeUndefined()
    expect(p.colorDynamic, 'and the loss is declared').toBe(true)
  })
})

describe('R35c — a single-expression colour helper is substituted and re-walked', () => {
  it('⛔⛔ NON-VACUITY — Clouds really is the shape under test', () => {
    // 20 fill colour positions, every one a user-function call whose alpha chain
    // reaches `color.t`. Without this, "Clouds carries" could pass on a fixture
    // that never exercised the branch.
    const calls = CLOUDS.match(/fill\([^)]*get(Bull|Bear)FillColor\(/g) || []
    expect(calls.length, 'Clouds no longer colours its fills from a helper').toBe(20)
    expect(/getAdjustedTransparency\([^)]*\)/.test(CLOUDS)).toBe(true)
    expect(/color\.t\(bullColor\)/.test(CLOUDS), 'the color.t leaf is gone').toBe(true)
  })

  it('⛔⛔ CLOUDS — all 20 fills carry a colour PAIR', () => {
    const { fills } = fillsOf(CLOUDS)
    expect(fills.length).toBe(20)
    const carried = fills.filter((f) => f.colorUp && f.colorDown)
    expect(carried.length, 'Clouds still carries no fill colours').toBe(20)
  })

  it('⛔⛔ CLOUDS — the PER-LAYER alpha is real, layers 0 / 10 / 19', () => {
    // ⭐ DERIVED, NOT TYPED. `transparencyAt` runs the script's own arithmetic
    // over its own three constants, so a hard-coded 95 would fail layers 10 and
    // 19 — which is exactly what an earlier hand-substituted 84 would have done.
    const { fills } = fillsOf(CLOUDS)
    for (const k of [0, 10, 19]) {
      expect(fills[k].opacity, `layer ${k} alpha`).toBeCloseTo(opacityAt(k), 10)
    }
    // …and the three must DIFFER, or a flat band would satisfy the line above.
    const seen = new Set([0, 10, 19].map((k) => fills[k].opacity))
    expect(seen.size, 'the per-layer gradient is flat — the feature is lost').toBe(3)
  })

  it('⛔ CLOUDS — the two branches are the author\'s bull and bear colours', () => {
    const { fills } = fillsOf(CLOUDS)
    // teal and maroon, through `input.color`'s defaults (R33a's recursion).
    expect(fills[0].colorUp).toBe('#00897B')
    expect(fills[0].colorDown).toBe('#880E4F')
  })

  it('⭐ THE FRAME CHAIN — two and three levels of colour helper carry', () => {
    const two = `${HEAD}inner(i) => i * 2\nouter(i) => color.new(#112233, inner(i))\n`
      + 'plot(close, "A", color = outer(3))\n'
    const p2 = presOf(two).p
    expect(p2.color).toBe('#112233')
    expect(p2.opacity, 'two-level chain: 3*2 = 6% transparent').toBeCloseTo(0.94, 10)

    const three = `${HEAD}a3(x) => x + 1\na2(x) => a3(x) * 2\na1(i) => color.new(#112233, a2(i))\n`
      + 'plot(close, "A", color = a1(2))\n'
    const p3 = presOf(three).p
    expect(p3.opacity, 'three-level chain: (2+1)*2 = 6% transparent').toBeCloseTo(0.94, 10)
  })

  it('⛔⛔ THE REAL (i)/(ii) BOUNDARY — a body whose TAIL needs a series is declined', () => {
    // ⚰️⚰️ THE SPECIFIED BOUNDARY DOES NOT EXIST, AND THIS TEST IS WHERE THAT WAS
    // FOUND. R35c was written to "REFUSE BY NAME a colour body that is not a
    // single expression". That line is not implementable as stated, because a
    // multi-statement body and a single-expression one are INDISTINGUISHABLE at
    // the binding: a function's locals are ordinary `expr` bindings in its own
    // env and its VALUE is the tail expression, so `bound.value.kind === 'expr'`
    // is true for both. Measured:
    //
    //     pick(i) =>  a = color.teal ; b = a ; b     ->  #00897B
    //     pick2(i) => color.teal                     ->  #00897B
    //     pick3(i) =>  a = close > open ? … ; a      ->  colorDynamic
    //
    // ⭐ AND NOTHING INTERPRETS A STATEMENT TO GET THERE. `b` is followed to `a`
    // and `a` to `color.teal` by the SAME name→`expr` step this function has
    // always used for a top-level name; a local is not a new kind of thing. So
    // the fold does not become (ii) by admitting it — (ii) is a general
    // evaluator, and this is binding-following plus a delegated arithmetic fold.
    //
    // ⛔ THE BOUNDARY THAT IS REAL AND LOAD-BEARING IS THIS ONE: the tail must
    // FOLD. A tail that reaches a series declines, with the reason, and that is
    // what keeps a per-bar colour from being flattened into one.
    const src = `${HEAD}pick(i) =>\n    a = close > open ? color.teal : color.red\n    a\n`
      + 'plot(close, "A", color = pick(0))\n'
    const { p } = presOf(src)
    expect(p.color, 'a series-tailed body was folded to one flat colour').toBeUndefined()
    expect(p.colorDynamic, 'the decline must be declared, not silent').toBe(true)
  })

  it('⚠️ RECORDED DEVIATION — a multi-statement colour body DOES fold', () => {
    // Pinned so the deviation from R35c's written acceptance is a MEASUREMENT a
    // reader trips over, not a sentence in a report they may not read. If the
    // owner rules that this must be refused, this test is the one to invert —
    // and refusing it needs deliberate machinery, because today it is free.
    const src = `${HEAD}pick(i) =>\n    a = color.teal\n    b = a\n    b\n`
      + 'plot(close, "A", color = pick(0))\n'
    expect(presOf(src).p.color).toBe('#00897B')
  })

  it('⛔ CONTROL — the SERIES path is byte-identical (one authority)', () => {
    // The numeric helper the colour fold leans on must be resolved by the SAME
    // Resolver the plot path already uses. If the colour fold grew its own copy,
    // this tree could drift without any colour test noticing.
    // ⚰️ THE FIRST VERSION OF THIS CONTROL READ `outputs[0].compute`, WHICH DOES
    // NOT EXIST — it went red against a product that was working perfectly, which
    // is the guessed-field-name defect this session already paid for once (the
    // pane document's `fills`). The shape is
    // `{kind,title,…,formula,ast,…,presentation,…}`, so the FORMULA is the
    // byte-comparable artifact and that is what this pins.
    const src = `${HEAD}g(i, u) =>\n    b = 95 - 2.5 * i\n    a = b + (100 - b) * (u / 100)\n`
      + '    math.min(a, 100)\nplot(close * g(0, 0), "A")\n'
    const out = (translatePine(src, { strict: true }).outputs || [])[0] || {}
    expect(out.formula, 'the series path stopped substituting the helper the same way')
      .toBe('close * min(95 - 2.5 * 0 + (100 - (95 - 2.5 * 0)) * (0 / 100), 100)')
  })

  it('⚠️ THE UNPREDICTED MOVE, PINNED — an input.int alpha now folds too', () => {
    // ⚰️ THE CENSUS PREDICTED CLOUDS ALONE; the re-baseline moved THREE scripts.
    // The other two are `uncharted-volume` and `uncharted-volume-v2`, and the
    // census could not have predicted them because it enumerated colour-returning
    // USER FUNCTIONS — and this move comes from the other half of R35c, the ALPHA
    // delegation. `avg_transp = input.int(90, 'Avg Vol Line Opacity')` feeds
    // `color.new(color.white, avg_transp)`: the name is not a literal, so the old
    // guard refused it; `constantValueOf` folds a declared input to its own
    // default, which is this engine's existing and deliberate policy.
    //
    // ⚠️ SO THE DISCLOSURE IS WIDER THAN `input.color`: a member who moves this
    // OPACITY slider still gets the author's default rendering. Pinned here so the
    // widening is a measured fact rather than a sentence in a report.
    const src = fs.readFileSync(path.join(REPO, 'tests/fixtures/member/uncharted-volume-v2.pine'), 'utf8')
    const outs = (translatePine(src, { strict: true }).outputs || [])
    const line = outs.find((o) => o.title === 'Avg Vol Line')
    expect(line, 'the specimen plot is gone — this control is vacuous').toBeTruthy()
    expect(line.presentation.color).toBe('#FFFFFF')
    expect(line.presentation.opacity, 'transparency 90 ⇒ opacity 0.10').toBeCloseTo(0.1, 10)
  })

  it('⛔ CONTROL — three scripts outside the census\'s four do not move', () => {
    const specimens = [
      ['tests/fixtures/member/uncharted-volume-v2.pine', { outputs: 5, refusals: 0 }],
      ['corpus/committed/atr-trailing-stop-by-ceyhun__UMldb6tGLd.pine', null],
      ['corpus/committed/cumulative-volume-delta__c772250751.pine', null],
    ]
    for (const [rel, pinned] of specimens) {
      const src = fs.readFileSync(path.join(REPO, rel), 'utf8')
      const t = translatePine(src, { strict: true })
      const shape = { outputs: (t.outputs || []).length, refusals: (t.refusals || []).length }
      expect(shape.outputs, `${rel} declares no outputs — the control is vacuous`)
        .toBeGreaterThan(0)
      if (pinned) expect(shape, `${rel} moved`).toEqual(pinned)
    }
  })
})
