// app/src/components/chart/engine/ast/fillColourCarriage.test.js
//
// ─── ⭐⭐ a6 / H.2 / R10 — A FILL CARRIES THE COLOUR IT WAS GIVEN ───────────
//
// H.2 ruled Clouds' 20 `fill()` calls to be item (j)'s rendering problem, and made a6
// owe (j) fills that PRESERVE their colour arguments so (j) need not re-parse source.
//
// ⭐⭐ MEASURING FIRST FOUND THE OBLIGATION ALREADY MET, AND a6.0 IS WHAT COMPLETED IT.
// The carrier is NOT the note — it is `presentation.fills`, which already existed,
// already resolves the two plot handles to output indices, and already had `color` and
// `opacity` fields in `resolveFillHandles`. The fill collector populates them from
// `outputPresentation(fargs, {env})` — literally the same call a `plot()` makes, which
// is R10's "no second colour path" requirement satisfied by construction rather than
// by a new rule. What was missing was only `color.rgb`'s alpha, and a6.0 fixed that in
// `colourHelperAlpha` for every caller at once.
//
// ⛔ SO THIS FILE ADDS NO ENGINE CHANGE. It is the acceptance that the contract holds,
// because an obligation nobody asserts is an obligation that regresses quietly.
//
// ⚰️ AND THE OBLIGATION CANNOT BE DEMONSTRATED ON CLOUDS ITSELF, which is the finding
// worth carrying into (j). Clouds' fills read
//
//     fill(p1, p2, color = isBullish ? getBullFillColor(0) : getBearFillColor(0))
//
// — a conditional over two USER-DEFINED FUNCTIONS. `staticColourOf` correctly folds
// neither, so all 20 of Clouds' fills carry no colour, and that is right rather than a
// gap: there is no single colour to carry. **Item (j) must render a CONDITIONAL fill,
// not a static one**, and this test records that so (j) does not start by looking for
// a colour that was never there.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { translatePine } from './pine.js'

const HEAD = '//@version=6\nindicator("t", overlay=true)\n'
const TWO = `${HEAD}p1 = plot(close, "a")\np2 = plot(open, "b")\n`
const CLOUDS = fs.readFileSync(path.resolve(
  __dirname, '../../../../../../tests/fixtures/member/uncharted-clouds.pine'), 'utf8')

const fillsOf = (src) => {
  const t = translatePine(src, { strict: true })
  return { t, fills: (t.presentation && t.presentation.fills) || [] }
}

describe('a6 / R10 — the fill note contract', () => {
  it('⭐⭐ a literal colour WITH alpha reaches the fill, both halves', () => {
    // Two different colours at the same alpha, so a hard-coded value satisfies one and
    // fails the other — the `:121` lesson from a6.0, applied here deliberately.
    const green = fillsOf(`${TWO}fill(p1, p2, color=color.rgb(0, 255, 0, 80))\n`).fills[0]
    expect(green.color).toBe('#00FF00')
    expect(green.opacity, '80% transparent is 0.2 opaque').toBeCloseTo(0.2, 5)

    const blue = fillsOf(`${TWO}fill(p1, p2, color=color.new(color.blue, 30))\n`).fills[0]
    expect(blue.color).toBe('#2962FF')
    expect(blue.opacity).toBeCloseTo(0.7, 5)
  })

  it('⭐ the handles are resolved to output indices, which is what (j) consumes', () => {
    const { fills } = fillsOf(`${TWO}fill(p1, p2, color=color.rgb(0, 255, 0, 80))\n`)
    expect(fills.length).toBe(1)
    expect(fills[0].a).toBe(0)
    expect(fills[0].b).toBe(1)
  })

  it('⛔⛔ CONTROL — a DYNAMIC fill colour is never FLATTENED into a guessed one', () => {
    // R10: inventing a flat colour for a conditional fill would paint one band
    // where the author drew two, confidently.
    //
    // ⭐ THE TITLE MOVED WITH THE ASSERTION (j.3b). It read *"arrives with NO
    // colour"*, which was true when a fill could hold only `color`, and became
    // misleading the moment the carrier landed: a foldable conditional now arrives
    // with a PAIR. What this control always actually pinned — and still pins — is
    // that no FLAT colour is guessed, which is the half that would lie to a member.
    // ⚠️ It survived the carrier untouched precisely because it asserted the absence
    // of a GUESS rather than the absence of carriage; the two are different claims
    // and only one of them was ever this test's.
    const { fills } = fillsOf(`${TWO}fill(p1, p2, color=close > open ? color.green : color.red)\n`)
    expect(fills.length).toBe(1)
    expect(fills[0].color, 'no flat colour is guessed').toBeUndefined()
    expect(fills[0].opacity, 'and no single opacity is invented for two branches').toBeUndefined()
    // …and the pair IS carried, which is what (j) consumes.
    expect(fills[0].colorUp).toBe('#4CAF50')
    expect(fills[0].colorDown).toBe('#FF5252')
  })

  it('⛔⛔ CONTROL — a 3-argument colour carries NO opacity', () => {
    const { fills } = fillsOf(`${TWO}fill(p1, p2, color=color.rgb(0, 255, 0))\n`)
    expect(fills.length).toBe(1)
    expect(fills[0].color).toBe('#00FF00')
    expect(Object.hasOwn(fills[0], 'opacity')).toBe(false)
  })

  it('⛔⛔ CONTROL — a6 did NOT touch plots: a plot presentation is unchanged', () => {
    // The whole risk of a6 is reaching into the colour path and moving plots. Pinned
    // against the exact values a6.0's own acceptance asserts.
    const t = translatePine(`${HEAD}plot(close, "a", color=color.rgb(255, 0, 0, 80))\n`, { strict: true })
    const o = (t.outputs || []).find((x) => x.title === 'a')
    expect(o.presentation.color).toBe('#FF0000')
    expect(o.presentation.opacity).toBeCloseTo(0.2, 5)
  })

  // ── Clouds, and what item (j) actually inherits ─────────────────────────
  it('⭐⭐ CLOUDS — 20 fills, 0 colours, and that is CORRECT, not a gap', () => {
    const { t, fills } = fillsOf(CLOUDS)
    expect(fills.length, 'every fill is carried, with its edges resolved').toBe(20)
    expect(fills.filter((f) => f.color).length,
      'their colour is a conditional over user functions, so there is none to carry')
      .toBe(0)
    // Every fill still names two real, distinct outputs — which is the half (j) needs.
    for (const f of fills) {
      expect(Number.isInteger(f.a) && Number.isInteger(f.b)).toBe(true)
      expect(f.a).not.toBe(f.b)
    }
    // …and the whole script still translates clean on this lane.
    expect((t.refusals || []).length).toBe(0)
  })

  it('⛔ CONTROL — Clouds is clean on BOTH lanes, which is a6\'s definition', () => {
    // H.2's definition of "Clouds verbatim": both lanes, 0 refusals, colours carried
    // where colours exist. The lenient lane is asserted separately so a change that
    // only satisfies strict cannot pass.
    expect((translatePine(CLOUDS, { strict: true }).refusals || []).length).toBe(0)
    expect((translatePine(CLOUDS, {}).refusals || []).length).toBe(0)
  })
})
