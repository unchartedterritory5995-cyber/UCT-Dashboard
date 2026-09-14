// app/src/components/chart/engine/ast/alphaCarriage.test.js
//
// ─── ⭐⭐ a6.0 / H.1 — A LITERAL ALPHA IS CARRIED ───────────────────────────
//
// A band the author drew 80% transparent was rendering fully opaque. `staticColourOf`
// parses `color.rgb`'s fourth argument, validates it, and then returns a 3-channel
// `#RRGGBB` with nowhere to put it. 56 of 328 corpus scripts feed a colour helper into
// a `plot()` (`tools/pine_colour_census.py`).
//
// ⭐⭐ THE CARRIER ALREADY EXISTS, AND MEASURING THE CONSUMERS IS WHAT FOUND THAT.
// `presentation.opacity` (0…1, = 1 − transp/100) is already validated by `defSchema`
// and already read by the renderer — it was added after Volume v2's "Scale Padding"
// plot drew as a solid white line across the sub-pane because its `opacity = 0` was
// dropped (`memberPaneDefinition.js:139`). So **no consumer changes at all**, and H.1
// is one branch rather than a new field. Measured before choosing:
//
//     color.new(color.red, 50)      -> {color:"#FF5252", opacity:0.5}   already carried
//     transp=40                     -> {color:"#FF5252", opacity:0.6}   already carried
//     color.new(color.red, close)   -> {colorDynamic:true}              correctly refused
//     color.rgb(255, 0, 0)          -> {color:"#FF0000"}                correct, no alpha
//     color.rgb(255, 0, 0, 80)      -> {color:"#FF0000"}                ⛔ THE GAP
//
// ⛔ A DYNAMIC ALPHA STILL RETURNS NULL and that is not an oversight: a transparency
// that moves bar by bar makes the whole colour dynamic, and reading only the base
// hands the member one flat colour and silently loses the effect.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { translatePine } from './pine.js'

const CORPUS = path.resolve(__dirname, '../../../../../../corpus/committed')
const HEAD = '//@version=6\nindicator("t", overlay=true)\n'

/** ⛔ MARKER — deleted by the commit that carries the alpha. */
const run = it.fails

const presOf = (src, title) => {
  const t = translatePine(src, { strict: true })
  const o = (t.outputs || []).find((x) => x.title === title)
  return o && o.presentation
}

describe('a6.0 — `color.rgb`\'s literal alpha reaches presentation', () => {
  it('⭐⭐ a 4-argument `color.rgb` carries its alpha as `opacity`', () => {
    // 80% transparent is 0.2 opaque — the same 1 − t/100 the `color.new` path and the
    // legacy `transp=` path already use, so one carrier means one arithmetic.
    const p = presOf(`${HEAD}plot(close, "a", color=color.rgb(255, 0, 0, 80))\n`, 'a')
    expect(p).toBeTruthy()
    expect(p.color).toBe('#FF0000')
    expect(p.opacity).toBeCloseTo(0.2, 5)
  })

  it('⭐ CORPUS · atr-bands:120 — the white take-profit band is not opaque white', () => {
    // ⚰️ THE SCRIPT THE DEFECT WAS FOUND ON. `color.rgb(255, 255, 255, 80)` on a band
    // whose whole job is to sit behind the price: drawn opaque it is the loudest thing
    // on the chart, which is the opposite of what the author asked for.
    const src = fs.readFileSync(path.join(CORPUS, 'atr-bands__ad60b125e6.pine'), 'utf8')
    const t = translatePine(src, { strict: true })
    const o = (t.outputs || []).find((x) => x.title === 'Upper Take-Profit Band')
    expect(o, 'the band still translates').toBeTruthy()
    expect(o.presentation.color).toBe('#FFFFFF')
    expect(o.presentation.opacity, '80% transparent is 0.2 opaque').toBeCloseTo(0.2, 5)
  })

  it('⭐ CORPUS · atr-bands:121 — the second band, a different colour, same alpha', () => {
    // ⚰️ THIS CASE FIRST NAMED `Upper ATR Band` (:116, `color.rgb(0, 255, 0, 50)`) AND
    // THAT LINE CANNOT CARRY IT — measured, not assumed. Both :116 and :117 refuse
    // `pine:statement`, traced to line 83, so they arrive with `title: null` and no
    // `presentation` at all. Their alpha is not dropped; the whole plot is refused for
    // a reason that has nothing to do with colour.
    // ⭐ So the second assertion moves to a line that exists, on a DIFFERENT colour, to
    // keep the pair discriminating: if the alpha were hard-coded rather than read, one
    // of these two would still be right and the other would not.
    const src = fs.readFileSync(path.join(CORPUS, 'atr-bands__ad60b125e6.pine'), 'utf8')
    const t = translatePine(src, { strict: true })
    const o = (t.outputs || []).find((x) => x.title === 'Lower Take-Profit Band')
    expect(o, 'the band still translates').toBeTruthy()
    expect(o.presentation.color).toBe('#FFFF00')
    expect(o.presentation.opacity).toBeCloseTo(0.2, 5)
  })

  // ── controls, permanent ──────────────────────────────────────────────────
  it('⛔⛔ CONTROL — a DYNAMIC alpha still refuses to fold, and says the colour is dynamic', () => {
    // Without this, "carry the alpha" could be implemented by reading the base and
    // ignoring whether the transparency is a series — which loses a bar-by-bar fade
    // and reports a flat colour with total confidence.
    const p = presOf(`${HEAD}plot(close, "a", color=color.new(color.red, close))\n`, 'a')
    expect(p.color, 'no flat colour is invented').toBeUndefined()
    expect(p.colorDynamic).toBe(true)
  })

  it('⛔⛔ CONTROL — a 3-argument `color.rgb` is UNCHANGED and carries no opacity', () => {
    // The commonest shape by far. If carrying alpha gave every colour an opacity, every
    // snapshot in the repo would move for no reason and the real change would be
    // unreviewable inside the noise.
    const p = presOf(`${HEAD}plot(close, "a", color=color.rgb(255, 0, 0))\n`, 'a')
    expect(p.color).toBe('#FF0000')
    expect(Object.hasOwn(p, 'opacity'), 'no opacity field is invented').toBe(false)
  })

  it('⛔ CONTROL — the paths that already worked still do', () => {
    // `color.new` and the legacy `transp=` were carrying alpha before H.1. A change to
    // `staticColourOf` must not disturb them, and asserting it here means a regression
    // shows up beside the thing that caused it.
    const a = presOf(`${HEAD}plot(close, "a", color=color.new(color.red, 50))\n`, 'a')
    expect(a.opacity).toBeCloseTo(0.5, 5)
    const b = presOf(`${HEAD}plot(close, "a", color=color.red, transp=40)\n`, 'a')
    expect(b.opacity).toBeCloseTo(0.6, 5)
  })

  // ── H.2's obligation on a6 PROPER, not on a6.0 ──────────────────────────
  run('⛔ H.2 · OPEN — a `fill()` note carries the colour argument it was given', () => {
    // ⚠️ THIS IS a6's DEBT TO ITEM (j), NOT a6.0's. H.2 ruled Clouds' 20 fill() calls
    // to be item (j)'s rendering problem, and made a6 owe (j) notes that PRESERVE their
    // colour arguments so (j) need not re-parse the source. Today the note is a
    // sentence and nothing else. Marked open here so the obligation is a committed
    // assertion rather than a line in a ruling; it is not satisfied by the
    // `staticColourOf` change and is not meant to be.
    const src = fs.readFileSync(path.resolve(
      __dirname, '../../../../../../tests/fixtures/member/uncharted-clouds.pine'), 'utf8')
    const t = translatePine(src, { strict: true })
    const fill = (t.notes || []).find((n) => n.code === 'pine:chart-only' && n.line === 118)
    expect(fill, 'the fill at 118 is noted').toBeTruthy()
    expect(fill.colour ?? fill.color, 'and the note carries what it was told to paint')
      .toBeTruthy()
  })
})
