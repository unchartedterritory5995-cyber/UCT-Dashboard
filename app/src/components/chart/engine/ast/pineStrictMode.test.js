// app/src/components/chart/engine/ast/pineStrictMode.test.js
//
// ─── ⭐⭐⭐ HOSTING AN INDICATOR IS A DIFFERENT QUESTION FROM SCREENING ONE ───
//
// ⛔⛔ `translatePine` USED TO ANSWER `ok: true` FOR A SCRIPT IT HAD MOSTLY
// FAILED TO READ, and this file is the rail that stops it happening again.
//
// The screener asks "which columns can you serve me?" — two of twenty-three is a
// useful answer there. A chart pane asks "can you draw this?" and two of
// twenty-three is a NO. Same translation, two contracts; `opts.strict` picks one.
//
// ⭐ THE SPECIMEN IS A REAL SCRIPT, NOT A CONSTRUCTED ONE. `Uncharted Clouds` is
// a member-authored v6 indicator whose entire visual is a 21-layer gradient
// built from `array.get` — a construct this engine refuses. It is the exact
// shape the lenient contract reads as success, which is why it is the fixture.

import { describe, it, expect } from 'vitest'
import { translatePine } from './pine.js'

/** The Clouds shape in miniature: two plots that translate, N that cannot.
 *  ⛔ Written out rather than read from the member's file so this rail owns its
 *  own input — a fixture that can be edited elsewhere is not a rail. */
const cloudsShape = (layers) => {
  const head = '//@version=6\nindicator("cloud", overlay=true)\n'
    + 'fastMA = ta.ema(close, 9)\n'
    + 'slowMA = ta.ema(close, 20)\n'
    + 'plot(fastMA, "Fast MA")\n'
    + 'plot(slowMA, "Slow MA")\n'
    + `var layerArray = array.new<float>(${layers})\n`
  let body = ''
  for (let i = 0; i < layers; i += 1) {
    body += `p${i + 1} = plot(array.get(layerArray, ${i}), display=display.none, editable=false)\n`
  }
  return head + body
}

const CLOUDS = cloudsShape(21)

describe('⛔⛔ strict mode refuses a PARTIAL translation', () => {
  it('⭐⭐ the real Clouds shape: lenient says yes, strict says no', () => {
    const lenient = translatePine(CLOUDS)
    const strict = translatePine(CLOUDS, { strict: true })

    // ⚰️ THE DEFECT, PRESERVED AS THE CONTROL. Lenient still answers `true` —
    // deliberately, because for a column picker that is the right answer. If
    // this line ever goes false the screener contract has silently changed.
    expect(lenient.ok, 'lenient mode still offers what it can').toBe(true)
    expect(strict.ok, 'strict mode refuses a script it only half-read').toBe(false)

    // ⛔ AND THE TWO AGREE ABOUT THE FACTS. Only the verdict differs — the same
    // translation, read against two contracts.
    expect(strict.outputs.length).toBe(lenient.outputs.length)
    expect(strict.refusals.length).toBe(lenient.refusals.length)
  })

  it('⭐⭐⭐ it surfaces ONE NAMED REASON PER FAILED OUTPUT — twenty-one of them', () => {
    const r = translatePine(CLOUDS, { strict: true })
    const failed = r.outputs.filter((o) => o.formula == null)
    expect(failed.length, 'twenty-one plots read an array').toBe(21)
    expect(r.refusals.length, 'and twenty-one reasons are reported').toBe(21)

    // Every one names its guard AND its position — a count with no line number
    // is not something a member can act on.
    for (const ref of r.refusals) {
      expect(ref.guard, 'every refusal names a guard').toBeTruthy()
      expect(typeof ref.line, 'every refusal names a line').toBe('number')
      expect(typeof ref.column, 'every refusal names a column').toBe('number')
    }
    expect([...new Set(r.refusals.map((x) => x.guard))]).toEqual(['pine:collection'])
    // ⭐ The lines are DISTINCT — twenty-one different plots, not one reason
    // repeated twenty-one times by a loop that lost track of where it was.
    expect(new Set(r.refusals.map((x) => x.line)).size).toBe(21)
  })

  it('⭐ the top-level refusal carries a caret, exactly like a lexer refusal', () => {
    const r = translatePine(CLOUDS, { strict: true })
    // ⛔ NEVER `null` ON A STRICT FAILURE. Declining in silence is the shape this
    // door has been caught doing twice; a host caller must always get a reason.
    expect(r.refusal, 'strict mode never declines silently').toBeTruthy()
    expect(r.refusal.guard).toBe('pine:collection')
    expect(r.refusal.excerpt, 'the caret excerpt a member reads').toContain('^')
    expect(r.refusal.line).toBeGreaterThan(0)
  })

  it('⭐ the result says which contract answered it', () => {
    expect(translatePine(CLOUDS).mode).toBe('screener')
    expect(translatePine(CLOUDS, { strict: true }).mode).toBe('host')
  })
})

describe('⭐ strict mode does NOT punish a script for being correct', () => {
  const clean = '//@version=6\nindicator("t")\nplot(ta.ema(close, 9), "EMA")\nplot(ta.sma(close, 20), "SMA")\n'

  it('⭐ a fully-translating script passes BOTH contracts', () => {
    expect(translatePine(clean).ok).toBe(true)
    expect(translatePine(clean, { strict: true }).ok).toBe(true)
    expect(translatePine(clean, { strict: true }).refusal).toBe(null)
  })

  it('⭐⭐ a HIDDEN output is an author\'s choice, not a failure', () => {
    // ⛔ THE CASE A NAIVE STRICT RULE GETS WRONG. `display = display.none` is
    // ordinary Pine — Clouds' own layer plots are hidden on purpose, because
    // they exist only as `fill` anchors. Testing "is every output USABLE" would
    // refuse this script; the real test is "did anything fail to TRANSLATE".
    const src = '//@version=6\nindicator("t")\nplot(close, "visible")\nplot(ta.ema(close,9), "hidden", display=display.none)\n'
    const r = translatePine(src, { strict: true })
    expect(r.ok, 'a deliberately hidden plot is not a failure').toBe(true)
    expect(r.refusals.length).toBe(0)
  })

  it('⛔ NON-VACUITY — strict mode can still say no for the ordinary reasons', () => {
    // If strict only ever differed on partial translations it would be untested
    // against the failures every mode shares.
    //
    // ⚰️ THE SPECIMEN WAS `ta.cum` UNTIL 2026-09-09, and the swap is the point
    // rather than housekeeping. Owner Ruling D made `cum` the ONE name host mode
    // serves that the screener refuses — so the moment it landed, this case was
    // asserting the opposite of the truth while reading as a general claim about
    // strictness. A non-vacuity probe pointed at the single EXCEPTION is worse
    // than none: it goes green again the day somebody breaks the exception.
    // ⭐ `ta.barssince` is the right shape: Pine's is UNBOUNDED, this table's
    // `barssince(condition, n)` is a different, bounded function, and no lane
    // serves the Pine meaning — so BOTH contracts refuse it, which is what
    // "the failures every mode shares" actually means.
    const script = '//@version=6\nindicator(\"t\")\nplot(ta.barssince(close > open) ? 1 : 0)\n'
    const r = translatePine(script, { strict: true })
    expect(r.ok).toBe(false)
    expect(r.refusal.guard).toBeTruthy()
    // ⛔ AND THE LENIENT CONTRACT REFUSES IT TOO — that is what makes this an
    // ORDINARY refusal rather than a strictness one, and it is the half that stops
    // the specimen silently becoming another `cum`.
    expect(translatePine(script).ok, 'the specimen is mode-specific, not ordinary')
      .toBe(false)
  })
})

describe('⛔⛔ `barstate.*` folds on closed bars and is REFUSED for a pane', () => {
  // ⭐⭐ THE SECOND PLACE THE TWO CONTRACTS DIVERGE, and the reason is the same
  // one: the screener evaluates CLOSED bars, so folding `barstate.isconfirmed`
  // to true there is EXACT. A chart pane draws the forming bar, where it is
  // false exactly once — on the one bar the member is watching. Realtime has
  // never been tested in this engine, so host mode declines rather than
  // shipping a confident wrong value on that bar.
  const each = (member) => `//@version=6\nindicator("t")\nplot(barstate.${member} ? close : open)\n`

  for (const [member, folded] of [['isconfirmed', 'close'], ['ishistory', 'close'],
    ['isnew', 'close'], ['isrealtime', 'open']]) {
    it(`⭐ barstate.${member} — folds to \`${folded}\` for the screener, refuses for a pane`, () => {
      const l = translatePine(each(member))
      expect(l.ok, 'the screener contract is unchanged').toBe(true)
      expect(l.outputs[0].formula, 'and it still folds to its closed-bar value').toBe(folded)

      const h = translatePine(each(member), { strict: true })
      expect(h.ok).toBe(false)
      expect(h.refusal.guard).toBe('pine:live-bar-state')
    })
  }

  it('⛔ the refusal says the name is KNOWN, not missing', () => {
    // ⚰️ `pine:builtin` would be the wrong sentence here and this file's
    // neighbour already argued that for `barstate.islast`: "this engine has no
    // home for that name" is false when the engine holds it and folds it.
    const h = translatePine(each('isconfirmed'), { strict: true })
    expect(h.refusal.message).toMatch(/forming bar/)
    expect(h.refusal.message).not.toMatch(/does not hold/)
  })

  it('⭐ `barstate.islast` is refused by BOTH — it was never a fold', () => {
    // A request-dependent name, refused for a different and older reason. It
    // must not quietly become a live-bar refusal.
    expect(translatePine(each('islast')).refusal.guard).toBe('pine:builtin')
    expect(translatePine(each('islast'), { strict: true }).refusal.guard).toBe('pine:builtin')
  })
})

describe('⛔ the two contracts differ ONLY where they are meant to', () => {
  it('⭐⭐ a script with no partials and no barstate reads IDENTICALLY in both', () => {
    // ⛔ THE RAIL AGAINST SCOPE CREEP. `strict` is allowed to change exactly two
    // things — a partial translation's verdict, and the closed-bar folds. If it
    // ever starts changing FORMULAS, the two lanes have forked and the whole
    // "one reading, two contracts" claim is gone.
    const src = '//@version=6\nindicator("t")\n'
      + 'len = input.int(14, "len")\n'
      + 'plot(ta.rsi(close, len), "RSI")\n'
      + 'plot(ta.atr(len), "ATR")\n'
      + 'plot(ta.highest(high, len) - ta.lowest(low, len), "Range")\n'
    const l = translatePine(src)
    const h = translatePine(src, { strict: true })
    expect(l.ok).toBe(true)
    expect(h.ok).toBe(true)
    expect(h.outputs.map((o) => o.formula)).toEqual(l.outputs.map((o) => o.formula))
    expect(h.selected).toBe(l.selected)
    expect(h.inputParams).toEqual(l.inputParams)
  })
})
