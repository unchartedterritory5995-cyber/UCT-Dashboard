// app/src/components/chart/engine/ast/fillConditionalCarriage.test.js
//
// ─── ⭐⭐ (j) j.3b — A FILL CARRIES A *CONDITIONAL* COLOUR ────────────────────
//
// j.3a built the renderer: `createFillPrimitive` takes per-point colours and draws
// one polygon per run (R30). Nothing can reach it. A `plot()` is given
// `outputPresentation(args, {env, resolver, kind})` and can emit
// `colorUp`/`colorDown`/`colorCondition`; a `fill()` is given `{env}` with **no
// resolver** (`pine.js:11287`), so `colourConditional` never runs, and both
// `fills.push` (`:11288`) and `resolveFillHandles` (`:12504`) hold only `color` and
// `opacity`. ⇒ **j.3a is built, tested, green and unreachable** — a named defect
// class in this repo, and the reason this block exists.
//
// ⛔⛔ THE FOLD IS NOT THE BLOCKER, THE CARRIER IS. The j.3b census measured every
// colour position in 325 files: of 254 fill colour positions, the number that would
// carry a colour under ANY fold — narrow, narrow-plus-numeric, or a corpus-wide
// constant folder — is **ZERO**, because a fold resolves colours into a slot that
// does not exist. Carrying a fold's answer is this file's subject; the fold itself
// is H.9 and is NOT built here.
//
// ─── ⚰️ THE RULE THAT IS NOT IN THE PLAN, AND WHY IT IS HERE FIRST ───────────
//
// ⛔⛔ A CONDITIONAL WHOSE TWO BRANCHES FOLD TO THE **SAME COLOUR** IS DECLINED.
//
// `keltner-center-of-gravity-channel` (`:91`, `:95`) reads
//
//     nzz ? color.new(color.blue, 70) : color.new(color.blue, 90)
//
// — one hex, two TRANSPARENCIES. The schema holds ONE `opacity` for a fill, so a
// carrier that took this would emit `colorUp === colorDown` and drop the alpha,
// drawing a FLAT blue band where the author drew a fading one, and drawing it where
// today nothing is drawn at all. That is exactly the failure `staticColourOf`'s own
// `color.new` branch already refuses in its comment — *"reading only the BASE and
// calling it static hands the member one flat red and loses the entire effect —
// silently"* — arriving through a different door.
//
// ⭐ IT IS RAILED BEFORE THE MUTATION THAT WOULD JUSTIFY IT. The census predicted
// this shape (2 of the 7 gaining fills) before any code was written, so the rail is
// written first rather than after a proof caught it. A naive carrier passes every
// other case in this file and fails only this one.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { translatePine } from './pine.js'

const REPO = path.resolve(__dirname, '../../../../../..')
const HEAD = '//@version=6\nindicator("t", overlay=true)\n'
const TWO = `${HEAD}p1 = plot(close, "a")\np2 = plot(open, "b")\n`
const CLOUDS = fs.readFileSync(path.join(REPO, 'tests/fixtures/member/uncharted-clouds.pine'), 'utf8')
const corpus = (name) => fs.readFileSync(path.join(REPO, 'corpus/committed', name), 'utf8')

const translated = (src) => {
  const t = translatePine(src, { strict: true })
  return { t, fills: (t.presentation && t.presentation.fills) || [], outputs: t.outputs || [] }
}
const fillsOf = (src) => translated(src).fills

/** The colour expression both a plot and a fill are given, so the two paths can be
 *  compared directly — the plot's answer is the fold's answer, and the fill should
 *  carry the SAME thing rather than a second opinion. */
const COND = 'close > open ? color.green : color.red'

describe('(j) j.3b — the conditional-fill carrier', () => {
  it('⛔⛔ NON-VACUITY — the specimen\'s branches DO fold today, on the plot path', () => {
    // Without this, "the fill carries colorUp/colorDown" could fail for a reason
    // that has nothing to do with the carrier: branches the folder cannot read.
    // The PLOT path already passes a resolver, so it answers the fold question
    // alone, and it answers it for the very expression the fill below uses.
    const { outputs } = translated(`${HEAD}plot(close, "DYN", color = ${COND})\n`)
    const p = (outputs[0] || {}).presentation || {}
    expect(p.colorUp, 'the branches do not fold, so this fixture tests nothing').toBe('#4CAF50')
    expect(p.colorDown).toBe('#FF5252')
    expect(p.colorCondition && p.colorCondition.formula).toBe('close > open')
  })

  it('⛔ CONTROL — a STATIC fill is unchanged: one colour, its alpha, nothing else', () => {
    // The shipped single-colour band cannot move. Pinned to MEASURED values.
    const fills = fillsOf(`${TWO}fill(p1, p2, color=color.new(color.green, 40))\n`)
    expect(fills.length).toBe(1)
    expect(fills[0].color).toBe('#4CAF50')
    expect(fills[0].opacity).toBe(0.6)
    expect(Object.hasOwn(fills[0], 'colorUp'), 'a static fill must not grow branch colours').toBe(false)
    expect(Object.hasOwn(fills[0], 'colorCondition')).toBe(false)
  })

  it('⛔⛔ AN ALPHA-ONLY CONDITIONAL IS DECLINED — same colour, two transparencies', () => {
    // ⭐ THE RAIL WRITTEN BEFORE THE MUTATION. Keltner's real shape. A carrier that
    // takes this draws a flat band and silently loses the fade; today it draws
    // nothing, which is the honest answer until the schema can hold two alphas.
    const fills = fillsOf(
      `${TWO}fill(p1, p2, color=close > open ? color.new(color.blue, 70) : color.new(color.blue, 90))\n`)
    expect(fills.length).toBe(1)
    expect(Object.hasOwn(fills[0], 'colorUp'),
      'an alpha-only conditional was carried as a flat colour — the fade is lost').toBe(false)
    expect(fills[0].color, 'and no flat colour is guessed either').toBeUndefined()
  })

  it('⛔⛔ …AND THE DECLINE IS DECLARED, because silence is a defect', () => {
    // ⭐ SPLIT FROM THE CONTROL ABOVE ON PURPOSE. "Not carried as a flat colour" is
    // true BEFORE and AFTER the carrier, which is what makes it a control. "The
    // member is TOLD" is only true after, so it is a separate, failing assertion —
    // folding the two together would have made a control that cannot hold its own
    // meaning, half of it changing under the build it is supposed to constrain.
    //
    // ⛔ `outputPresentation` ALREADY sets `colorDynamic` today; `fills.push`
    // (`pine.js:11288`) drops it, so a fill declines in silence while a plot says so.
    const fills = fillsOf(
      `${TWO}fill(p1, p2, color=close > open ? color.new(color.blue, 70) : color.new(color.blue, 90))\n`)
    expect(fills[0].colorDynamic, 'the loss must be DECLARED, not silent').toBe(true)
  })

  it('⛔ CONTROL — the carrier touches FILLS only; a plot presentation is byte-identical', () => {
    const { outputs } = translated(`${HEAD}plot(close, "DYN", color = ${COND})\n`)
    const p = (outputs[0] || {}).presentation || {}
    expect(Object.keys(p).sort()).toEqual(['colorCondition', 'colorDown', 'colorUp'])
  })

  it('⭐⭐ CLOUDS NOW CARRIES ALL 20 — the carrier was waiting for the fold', () => {
    // ⚰️ THIS CONTROL USED TO ASSERT THE OPPOSITE, and it was right when written:
    // "CLOUDS still carries NO fill colour, and that is still correct — its
    // branches are `getBullFillColor(k)` / `getBearFillColor(k)`, which
    // `staticColourOf` folds neither way. The CARRIER cannot help a fold that did
    // not happen."
    //
    // ⭐ R35c + R35d made the fold happen, so the premise moved by RULING rather
    // than by drift — which is exactly when a control is rewritten instead of
    // deleted. It now pins the other side of the same fact, and the pair is the
    // whole story of (j): j.3b(a) built a carrier with nothing to carry, and this
    // file is where "nothing to carry" turned into twenty.
    const { fills } = translated(CLOUDS)
    expect(fills.length).toBe(20)
    expect(fills.filter((f) => f.color).length,
      'a conditional fill must not collapse to ONE flat colour').toBe(0)
    expect(fills.filter((f) => f.colorUp && f.colorDown).length,
      'the fold landed but the carrier did not carry it').toBe(20)
  })

  it('⛔⛔ A CONDITIONAL FILL CARRIES ITS TWO COLOURS AND ITS CONDITION', () => {
    // TODAY: `presentation.fills[0]` is `{a, b}` and nothing else — measured, and
    // recorded here so the before-state is not something a reader has to trust.
    const fills = fillsOf(`${TWO}fill(p1, p2, color=${COND})\n`)
    expect(fills.length).toBe(1)
    expect(fills[0].colorUp).toBe('#4CAF50')
    expect(fills[0].colorDown).toBe('#FF5252')
    expect(fills[0].colorCondition && fills[0].colorCondition.formula).toBe('close > open')
    // ⛔ AND NO FLAT COLOUR IS INVENTED ALONGSIDE — a consumer reading `.color`
    // first would paint one band where the author drew two.
    expect(fills[0].color, 'a flat colour was guessed beside the pair').toBeUndefined()
  })

  it('⛔⛔ RE-BASELINE — MEASURED, and the census over-predicted it fivefold', () => {
    // ⭐⭐ PREDICTED 5 SCRIPTS / 7 FILLS. MEASURED 1 SCRIPT / 1 FILL. The gap is a
    // finding about the INSTRUMENT, and it is the reason a prediction is checked
    // against the product rather than published as a result.
    //
    // `tools/pine_colour_fn_census.py` counts colour POSITIONS IN SOURCE TEXT. A
    // fill only reaches `presentation.fills` if BOTH its handles also resolve to
    // surviving outputs — `resolveFillHandles` drops the rest, because "a band with
    // one edge is not a band". Three of the five named scripts therefore carry NO
    // fills at all, whatever their colour expressions say:
    //
    //   atr-trailing-stop-by-ceyhun        0 fills carried
    //   cumulative-volume-delta            0 fills carried
    //   order-block-finder                 0 fills carried
    //   keltner-center-of-gravity-channel  10 fills, all STATIC (the alpha-only
    //                                      conditionals are not among the carried)
    //   72s-strategy-adaptive-hull         1 fill, and it GAINS its two colours
    //
    // ⛔ THE PREDICTION IS KEPT IN THE TEST RATHER THAN CORRECTED AWAY. Editing the
    // census to match this would hide the lesson: a source-text census bounds what
    // COULD carry, never what DOES, and only the product can close that bound.
    const measured = {}
    for (const name of [
      'atr-trailing-stop-by-ceyhun__UMldb6tGLd.pine',
      'cumulative-volume-delta__c772250751.pine',
      '72s-strategy-adaptive-hull-moving-average-pt1__58ujcjLFIt.pine',
      'keltner-center-of-gravity-channel__e4a81d76f6.pine',
      'order-block-finder__fVSb3j0I87.pine',
    ]) {
      const fills = fillsOf(corpus(name))
      measured[name] = {
        fills: fills.length,
        carried: fills.filter((f) => f.colorUp && f.colorDown).length,
      }
    }
    expect(measured['72s-strategy-adaptive-hull-moving-average-pt1__58ujcjLFIt.pine'])
      .toEqual({ fills: 1, carried: 1 })
    expect(measured['atr-trailing-stop-by-ceyhun__UMldb6tGLd.pine']).toEqual({ fills: 0, carried: 0 })
    expect(measured['cumulative-volume-delta__c772250751.pine']).toEqual({ fills: 0, carried: 0 })
    expect(measured['order-block-finder__fVSb3j0I87.pine']).toEqual({ fills: 0, carried: 0 })
    // keltner's fills are STATIC and must stay static — the alpha-only decline and
    // the "a static fill is unchanged" control meeting on a real script.
    //
    // ⚰️ THE HEAD-COUNT MOVED 7 -> 10 ON 2026-09-22 AND THE CLAIM DID NOT. This
    // script opens `tf = timeframe.period` and dispatches on `tf` eight arms deep;
    // until the `timeframe.*` family landed, `timeframe.period` refused, so three
    // of its fills never reached `presentation.fills` at all. Nothing about the
    // CARRIER changed — `carried` is still 0, and 0 is what this case is about.
    // ⛔ THE COUNT IS KEPT AS A COUNT rather than relaxed to a floor: a fill that
    // silently stopped resolving is exactly what this number is here to catch, and
    // `toBeGreaterThan` would have accepted 7 forever.
    expect(measured['keltner-center-of-gravity-channel__e4a81d76f6.pine'])
      .toEqual({ fills: 10, carried: 0 })

    // …and the whole corpus delta is ONE fill. Stated as a number so a later change
    // that quietly widens the carrier has something to fail against.
    const total = Object.values(measured).reduce((n, m) => n + m.carried, 0)
    expect(total, 'the measured corpus re-baseline for j.3b is exactly one fill').toBe(1)
  })
})
