// app/src/components/chart/engine/ast/refusalLocationSeam.test.js
//
// ─── ⭐⭐ THE SEAM WHERE A REFUSAL'S OWN POSITION WAS THROWN AWAY ────────────
//
// `buildRuntimeIr`'s catch has a fallback: a refusal that knows no location
// inherits the enclosing STATEMENT's, marked `locationIsStatement` so nobody
// reads it as the offending sub-expression's own position. That fallback is
// right, and it was firing on refusals that DID know where they were.
//
// ⛔⛔ THE TWO REFUSAL CLASSES CARRY THEIR POSITION DIFFERENTLY, AND THE CATCH
// ASKED ONLY ONE OF THEM. `RuntimeRefusal` FLATTENS `at` into `line`/`column`/
// `token` in its constructor; `PineRefusal` keeps the same object NESTED at
// `.at` and never sets `.line` at all. The catch asked `e.line == null`, which
// is TRUE FOR EVERY `PineRefusal` WHETHER OR NOT IT KNOWS ITS POSITION — so
// every `pine:` guard reaching this lane had its real line overwritten with the
// statement's and was stamped approximate.
//
// ⭐⭐ MEASURED BEFORE THE FIX, by attaching `e.at` to the surfaced refusal and
// driving one fixture per guard family through `buildObjectLane`:
//
//     guard            e.constructor   e.line   e.at                  surfaced
//     runtime:colour   RuntimeRefusal  4        null                  L4 exact
//     pine:function    PineRefusal     null     L4 c6 notarealfunction L4 APPROX
//     pine:undefined   PineRefusal     null     L4 c6 nosuchname       L4 APPROX
//     pine:builtin     PineRefusal     null     L4 c6 syminfo.mintick  L4 APPROX
//     pine:builtin     PineRefusal     null     L6 c8 syminfo.mintick  L4 APPROX
//
// The LAST row is the one that settles it: a `plot(...)` spanning lines 4-6 with
// the offending builtin on line 6 arrived carrying `at.line = 6` and surfaced as
// line 4. Not merely a lost column — THE WRONG LINE, stamped approximate, on a
// refusal that had the right one in hand the whole time.
//
// ⭐ AND `fail()` ALREADY KNEW. Its `position(e)` helper reads `e.line` and
// falls back to `e.at`, under a comment naming this exact two-class hazard. The
// fix was applied there and NOT in the catch — and the catch runs FIRST, writes
// `e.line`, and so `position` never gets to consult `.at`
// (`lesson_a_guard_repeated_is_a_guard_unproved`: two readers of one fact, one
// of them corrected).
//
// ⛔ TWO EARLIER FIXES AIMED AT THE RAISE SITES WERE MEASURED AS NO-OPS on the
// corpus count and reverted — see `approximateRefusals.measure.test.js`'s
// header. They changed nothing because the raise sites were never the problem:
// the position was raised correctly and discarded afterwards.
import { describe, it, expect } from 'vitest'

import { buildObjectLane } from '../runtime/objectLane.js'

const LF = String.fromCharCode(10)
const Q = String.fromCharCode(34)
const N = 60
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1700000000 + i * 86400,
  o: 100 + (i % 7), h: 104 + (i % 5), l: 96 - (i % 3), c: 100 + (i % 11), v: 1000000 + i,
}))
// ⛔ THE TABLE IS NOT DECORATION. `buildObjectLane` refuses a source that draws
// no object at all (`objects:no-objects-in-source`) before the runtime lane is
// ever asked, so a fixture without one measures the object pass instead.
// Header + table is three lines, so the first body line is line 4.
const HEAD = `//@version=6${LF}indicator(${Q}t${Q}, overlay = true)${LF}`
  + `var t = table.new(position.top_right, 1, 1)${LF}`

const build = (body) => {
  try { return buildObjectLane(HEAD + body, { tf: 'D', newestBarIsForming: false, bars: BARS }) }
  catch { return null }
}

/**
 * ⭐ THE FIXTURES SPAN THREE LINES ON PURPOSE. A one-line statement puts the
 * statement's position and the sub-expression's position on the SAME LINE, so a
 * clobbered location is invisible in the line number — which is why this
 * survived a census that read `locationIsStatement` beside single-line fixtures.
 * The offending token sits two lines below the statement that encloses it, so
 * the two answers cannot be confused.
 */
const SPANNING = [
  // guard, body, the offending TOKEN the refusal should point at
  ['pine:undefined', `plot(close${LF}     + high${LF}     + nosuchname)${LF}`, 'nosuchname'],
  ['pine:builtin', `plot(close${LF}     + high${LF}     + syminfo.mintick)${LF}`, 'syminfo.mintick'],
  ['pine:function', `plot(close${LF}     + high${LF}     + ta.notarealfunction(close, 5))${LF}`,
    'ta.notarealfunction'],
]

/** Where a token really sits in a source, 1-based, both axes.
 *
 *  ⛔ DERIVED, NEVER TYPED. The first draft of this file hand-typed the column
 *  and was off by one — which a reader would have "fixed" by editing the
 *  expectation, i.e. by moving the rail to wherever the product happened to be.
 *  A number computed from the fixture cannot be edited into agreement.
 *  (`lesson_probe_names_must_be_derived_not_typed`.) */
function whereIs(src, token) {
  const i = src.indexOf(token)
  if (i < 0) return null
  const before = src.slice(0, i)
  const nl = before.lastIndexOf(LF)
  return { line: before.split(LF).length, column: i - nl }
}

// The line the enclosing STATEMENT starts on — what the fallback would hand
// back. Header + table is three lines, so `plot(` opens on line 4.
const STMT_LINE = 4

describe('⭐⭐ a refusal that knows where it is keeps its own location', () => {
  it('⛔ CONTROL — every spanning fixture actually refuses, with the guard named', () => {
    // ⛔ NON-VACUITY. Every assertion below is over a refusal; a fixture that
    // quietly COMPILED would satisfy `not.toBe(true)` by carrying no refusal at
    // all, and the whole file would pass having measured nothing.
    for (const [guard, body] of SPANNING) {
      const r = build(body)
      expect(r && r.ok, `${guard}: the fixture did not refuse`).toBe(false)
      expect((r.refusal || {}).guard, `${guard}: a different guard fired`).toBe(guard)
    }
  })

  it('⛔⛔ CONTROL — every fixture puts its offender on a DIFFERENT line from its statement', () => {
    // ⛔ WITHOUT THIS THE FILE PROVES NOTHING. A one-line fixture makes the
    // statement's position and the offender's position the same, so a clobbered
    // location is invisible in the line number — which is exactly how this
    // survived a census that already read `locationIsStatement`.
    for (const [guard, body, token] of SPANNING) {
      const at = whereIs(HEAD + body, token)
      expect(at, `${guard}: \`${token}\` is not in its own fixture`).toBeTruthy()
      expect(at.line, `${guard}: the offender shares the statement's line`)
        .not.toBe(STMT_LINE)
    }
  })

  it('⭐⭐ a `pine:` refusal reports the OFFENDING position, not the statement it is inside', () => {
    for (const [guard, body, token] of SPANNING) {
      const at = whereIs(HEAD + body, token)
      const ref = (build(body) || {}).refusal || {}
      expect(ref.line, `${guard}: reported the statement's line, not the offender's`)
        .toBe(at.line)
      // ⛔ THE LINE ALONE IS NOT THE PROPERTY. Column and token come from the
      // same source or the member is pointed at the right line and the wrong
      // thing on it — before the fix these read the statement's start and the
      // word `plot`.
      expect(ref.column, `${guard}: reported the statement's column`).toBe(at.column)
      expect(ref.token, `${guard}: reported the statement's keyword`).toBe(token)
      expect(ref.locationIsStatement, `${guard}: an exact location is stamped approximate`)
        .not.toBe(true)
    }
  })

  it('⛔⛔ CONTROL — the statement fallback STILL FIRES for a refusal with no position', () => {
    // ⛔⛔ THE FALLBACK IS NOT BEING DELETED, IT IS BEING ASKED THE RIGHT
    // QUESTION. A refusal that genuinely knows nothing about where it is must
    // still inherit the enclosing statement's position and must still be
    // stamped approximate, or `line: null` reaches a member. Without this
    // control, "make every refusal exact by never pinning anything" passes the
    // whole file.
    //
    // ⭐ THE FIXTURE IS NOT INVENTED — it is the shape of one of the two corpus
    // scripts still reported approximate after the fix
    // (`volume-spikes-growing-volume-signals-with-alerts-scanner`, L44).
    // `runtime/colours.js` throws a bare `ColourError` for an eight-digit hex,
    // which is an ordinary `Error`: no `line`, no `at`, nothing to recover. So
    // the fallback fires, correctly, and says so.
    //
    // ⭐ AND IT DEMONSTRATES WHY THE FLAG EXISTS: the unreadable colour is
    // written on line 5 and the refusal reports line 6, because line 6 is the
    // statement being lowered when the colour was read. That is an honest
    // approximation, and it is marked as one.
    const src = `${HEAD}table.cell(t, 0, 0, ${Q}x${Q})${LF}`
      + `myCol = #00e67610${LF}`     // ← the unreadable colour really lives here
      + `bgcolor(myCol)${LF}`        // ← and this is the statement it is reported on
    const r = buildObjectLane(src, { tf: 'D', newestBarIsForming: false, bars: BARS })
    expect(r && r.ok, 'the colourless fixture did not refuse').toBe(false)
    expect((r.refusal || {}).message, 'a different refusal fired')
      .toContain('not a colour this engine can read')
    expect((r.refusal || {}).line, 'the fallback stopped pinning a location').toBe(6)
    expect((r.refusal || {}).token, 'the fallback stopped naming the statement').toBe('bgcolor')
    expect((r.refusal || {}).locationIsStatement,
      'an approximated location is no longer stamped as one').toBe(true)
  })

  it('⛔ CONTROL — a `runtime:` guard is unchanged: it always kept its position', () => {
    // The lane raises this one itself, as a `RuntimeRefusal`, which flattens its
    // position into `.line`. It was never approximate and must not become so —
    // a "fix" that made every refusal exact by never pinning anything would pass
    // the tests above and fail this one.
    const r = build(`bgcolor(close)${LF}`)
    expect(r && r.ok, 'the runtime fixture did not refuse').toBe(false)
    expect((r.refusal || {}).guard).toBe('runtime:colour')
    expect((r.refusal || {}).line, 'the runtime fixture lost its line').toBe(STMT_LINE)
    expect((r.refusal || {}).locationIsStatement).not.toBe(true)
  })
})
