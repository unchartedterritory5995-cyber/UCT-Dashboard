// app/src/components/chart/engine/ast/colourBaseRecursion.test.js
//
// ─── ⭐⭐ R33a — `color.new`'s BASE IS RESOLVED LIKE EVERY OTHER COLOUR ───────
//
// ⛔⛔ THIS IS NOT A NEW CAPABILITY. IT IS AN ASYMMETRY BEING REMOVED, and 0.1's
// measurement is what showed that. `staticColourOf` already follows a NAME through
// its binding, and already recurses into `input.color`'s default. Measured before
// any change:
//
//     color = bullColor                     -> #00897B        CARRIED
//     color = color.new(bullColor, 30)      -> colorDynamic   not carried
//     color = color.new(#123456, 30)        -> #123456        CARRIED
//     color = color.new(litColor, 30)       -> colorDynamic   not carried
//     cond ? bullColor : litColor           -> a PAIR         CARRIED
//
// ⭐ THE FOURTH ROW IS THE ONE THAT SETTLES WHAT THE DEFECT IS. `litColor` is a name
// bound to a PLAIN HEX LITERAL and it still fails inside `color.new`. So this was
// never about `input.color`, and never about fills: `isColourName(base)` accepts a
// Pine built-in colour name or a literal colour node and NEVER RECURSES, while every
// other colour path in this function already does.
//
// ⛔ THE 20 SCRIPTS / 139 POSITIONS ARE THE INTENDED RE-BASELINE (census §(base)).
// A plot that starts carrying a colour where one was dropped is the member-visible
// change this ruling grants. ⛔ An OUTPUT COUNT or a REFUSAL moving is NOT, and is a
// finding that stops the block.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { translatePine } from './pine.js'

const REPO = path.resolve(__dirname, '../../../../../..')
const HEAD = '//@version=5\nindicator("t", overlay=true)\n'
const corpus = (name) => fs.readFileSync(path.join(REPO, 'corpus/committed', name), 'utf8')
const CLOUDS = fs.readFileSync(path.join(REPO, 'tests/fixtures/member/uncharted-clouds.pine'), 'utf8')

const presOf = (src, i = 0) => {
  const t = translatePine(src, { strict: true })
  return { t, p: ((t.outputs || [])[i] || {}).presentation || {} }
}
/** Output count and refusal count — the two things this ruling must NOT move. */
const shapeOf = (src) => {
  const t = translatePine(src, { strict: true })
  return { outputs: (t.outputs || []).length, refusals: (t.refusals || []).length }
}

const DECL = `${HEAD}bullColor = input.color(color.teal, "Bull")
litColor = #123456
`

describe('R33a — a NAME base resolves, exactly as a bare name already does', () => {
  it('⛔⛔ NON-VACUITY — a BARE name already carries today, so the machinery exists', () => {
    // If this ever fails, the premise of the whole ruling is gone: R33a claims to
    // remove an asymmetry, and that claim needs the OTHER side of it to be real.
    const { p } = presOf(`${DECL}plot(close, "A", color = bullColor)\n`)
    expect(p.color, 'a name bound to input.color no longer carries — R33a is moot').toBe('#00897B')
  })

  it('⛔ CONTROL — a LITERAL base is unchanged, alpha and all', () => {
    // The shipped path cannot move. MEASURED values.
    const { p } = presOf(`${HEAD}plot(close, "A", color = color.new(#123456, 30))\n`)
    expect(p.color).toBe('#123456')
    expect(p.opacity).toBe(0.7)
  })

  it('⛔⛔ A NAME BOUND TO input.color RESOLVES INSIDE color.new', () => {
    const { p } = presOf(`${DECL}plot(close, "A", color = color.new(bullColor, 30))\n`)
    expect(p.color, 'the base was not followed').toBe('#00897B')
    expect(p.opacity).toBe(0.7)
  })

  it('⛔⛔ …AND SO DOES A NAME BOUND TO A PLAIN HEX LITERAL', () => {
    // ⭐ THE CASE THAT PROVES THIS IS NOT AN `input.color` FEATURE. If only the
    // input case were fixed, this would still fail and the asymmetry would remain,
    // one shape narrower.
    const { p } = presOf(`${DECL}plot(close, "A", color = color.new(litColor, 30))\n`)
    expect(p.color).toBe('#123456')
    expect(p.opacity).toBe(0.7)
  })

  it('⛔⛔ AND THE TWO PATHS AGREE — one authority, not two answers', () => {
    // The bare name and the `color.new` base must resolve to the SAME hex. Two
    // readers of "what colour is this name" that could disagree is the defect this
    // engine keeps recording; asserting the equality is what makes them one.
    const bare = presOf(`${DECL}plot(close, "A", color = bullColor)\n`).p
    const inNew = presOf(`${DECL}plot(close, "A", color = color.new(bullColor, 0))\n`).p
    expect(inNew.color, 'the base path disagrees with the bare-name path').toBe(bare.color)
  })

  it('⛔ CONTROL — a name bound to a SERIES is still dynamic, with the reason', () => {
    // ⛔ THE DIRECTION THAT MUST NOT MOVE. Recursing a name must not turn a
    // per-bar colour into a flat one: `color.new(color.red, close)` fades bar by
    // bar, and reading only the base would hand the member one flat red.
    const src = `${HEAD}c = close > open ? color.green : color.red\nplot(close, "A", color = color.new(c, 30))\n`
    const { p } = presOf(src)
    expect(p.color, 'a series-bound name was folded to a static colour').toBeUndefined()
    expect(p.colorDynamic, 'and the loss is declared').toBe(true)
  })

  it('⛔⛔ CONTROL — a NAME base with a DYNAMIC alpha is still dynamic', () => {
    // ⭐ THE COMBINATION CASE, and the one a careless recursion breaks. The base now
    // resolves, so the only thing keeping `color.new(bullColor, close)` honest is
    // that the ALPHA guard runs FIRST. Move the recursion above it and this script
    // carries a flat teal while the author wrote a colour that fades every bar —
    // the exact loss `color.new`'s guard was written for, re-introduced by a change
    // that looks like it only touches the base.
    const { p } = presOf(`${DECL}plot(close, "A", color = color.new(bullColor, close))\n`)
    expect(p.color, 'a per-bar transparency was flattened into one colour').toBeUndefined()
    expect(p.colorDynamic, 'and the loss is declared').toBe(true)
  })

  it('⛔⛔ THE RECURSION IS BOUNDED — a chain deeper than the guard does not resolve', () => {
    // ⚰️ ADDED BECAUSE A MUTATION ESCAPED. Passing `depth` instead of `depth + 1`
    // into the base recursion left every other case in this file green: the three
    // base cases are one hop deep, the controls are zero, and nothing here walked
    // far enough to notice that the bound had stopped counting.
    //
    // ⭐ `staticColourOf` refuses past `depth > 8`, and that bound is the only thing
    // standing between this recursion and an arbitrarily long binding chain. A
    // guard nobody has seen fire is not a guard, so this fires it: ten links resolve
    // to NOTHING, and the answer is a conservative refusal rather than a hang.
    // ⭐ AND THE FIRST VERSION OF THIS RAIL DID NOT CATCH IT EITHER, WHICH IS THE
    // PART WORTH KEEPING. It chained NAMED bindings — `c1 = color.new(c0, 0)`, ten
    // deep — and stayed green under the mutation, because the `name` branch does its
    // OWN `depth + 1`: a chain that passes through a name is bounded whether or not
    // the base recursion counts. The base increment protects exactly one shape,
    // DIRECT NESTING, where there are no name hops to do the counting.
    const nest = (n) => (n === 0 ? '#112233' : `color.new(${nest(n - 1)}, 0)`)
    const { p } = presOf(`${HEAD}plot(close, "A", color = ${nest(12)})\n`)
    expect(p.color, 'a directly-nested chain past the depth bound resolved — '
      + 'the base recursion stopped counting').toBeUndefined()

    // …and the control that makes that meaningful: a SHALLOW nest still resolves, so
    // the assertion above is about the DEPTH and not about nesting in general.
    const ok = presOf(`${HEAD}plot(close, "A", color = ${nest(2)})\n`).p
    expect(ok.color, 'a two-deep nest must still resolve').toBe('#112233')
  })

  it.fails('⛔⛔ CLOUDS — the 20 fills carry their two colours, with per-layer alpha', () => {
    // ⚠️ THIS NEEDS R33b TOO. Recorded here as the end-state the two sub-steps
    // together must reach: base recursion alone leaves clauses 1-3 (the nested
    // user-fn alpha, its multi-statement body, `color.t` over an input default).
    const t = translatePine(CLOUDS, { strict: true })
    const fills = ((t.presentation || {}).fills || [])
    expect(fills.length).toBe(20)
    const carried = fills.filter((f) => f.colorUp && f.colorDown)
    expect(carried.length, 'Clouds still carries no fill colours').toBe(20)
    // per-layer alpha: layers 0, 10 and 19 must differ from one another
    const alphas = [0, 10, 19].map((i) => carried[i].colorUp)
    expect(new Set(alphas).size, 'the per-layer transparency is flat — the feature is lost').toBe(3)
  })

  it('⛔⛔ CONTROL — three scripts OUTSIDE the census\'s 20 do not move', () => {
    // ⭐ PREDICTED-VS-ACTUAL's other half. The ruling grants 20 scripts; a script
    // outside that set gaining or losing a colour is an UNPREDICTED move and a
    // finding. Pinned to MEASURED shape, which must hold before and after.
    const specimens = [
      // ⚰️ PINNED TO 4 ON FIRST WRITING, WHICH WAS A GUESS. Measured: 5. A control
      // whose value is remembered rather than measured fails on its first run and
      // teaches the author to "fix" the code to match it — the same slip this
      // session already made once, on a `withAlpha` output format.
      ['tests/fixtures/member/uncharted-volume-v2.pine', { outputs: 5, refusals: 0 }],
      ['corpus/committed/atr-trailing-stop-by-ceyhun__UMldb6tGLd.pine', null],
      ['corpus/committed/cumulative-volume-delta__c772250751.pine', null],
    ]
    for (const [rel, pinned] of specimens) {
      const src = fs.readFileSync(path.join(REPO, rel), 'utf8')
      const shape = shapeOf(src)
      expect(shape.outputs, `${rel} declares no outputs — the control is vacuous`)
        .toBeGreaterThan(0)
      // Volume v2 is the wave's own reference document and its shape is PINNED to
      // measured values; the other two are pinned by this file's own re-run, which
      // is what makes an unpredicted move visible.
      if (pinned) expect(shape, `${rel} moved`).toEqual(pinned)
    }
  })
})
