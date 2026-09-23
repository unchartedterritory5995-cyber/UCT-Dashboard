// app/src/components/chart/engine/ast/legacyBareNamespace.test.js
//
// ─── ⛔⛔ A BARE NAME IN A PASTED PINE SCRIPT IS PINE'S, NOT OURS ───────────
//
// Pine v1–v4 spelled its technical-analysis builtins WITHOUT the `ta.`
// namespace: `pivothigh(high, 15, 15)` in a v4 script is exactly what a v5
// script writes as `ta.pivothigh(high, 15, 15)`. v5 moved them and left the
// bare spelling behind.
//
// This engine ALSO has a function table of its own, whose names a member types
// in the formula box, and several of those names collide with Pine's — with
// DIFFERENT semantics. `pine.js` states the rule for the collision:
//
//     "the bare `pivothigh(...)` still resolves to this table's own function,
//      unshifted, because a member typing the bare name in OUR box means OUR
//      vocabulary"
//
// ⭐ THAT RULE IS RIGHT FOR THE FORMULA BOX AND WRONG FOR A PASTED SCRIPT.
// One name table serves two languages. In the box the member is speaking our
// vocabulary; in a `//@version=4` script they are speaking Pine's, and the
// same six characters mean different things.
//
// ⚰️⚰️ WHAT IT COST, MEASURED AGAINST TRADINGVIEW ON 2026-09-23. The
// `trendlines` indicator draws five lines. Every one of ours sat ONE PIVOT SPAN
// EARLY — our right anchor was exactly the vendor's left anchor — because
// `pivothigh` resolved to the house column, which emits ON THE PIVOT BAR, while
// Pine emits at the CONFIRMATION BAR `right` bars later.
//
// ⛔⛔ AND THAT IS LOOK-AHEAD, NOT AN OFFSET. `pine.js` says so itself about the
// `[R]` shift: *"it CANCELS the look-ahead … the translated column is
// non-repainting where the bare call is preview-repaints."* An engine that
// marks a pivot `right` bars before the vendor could know it is an engine whose
// backtests see the future. That is the worst class of error a trading
// indicator can have, and it was reachable by pasting an ordinary v4 script.
//
// ⛔ THE SIGN CASE IS WORSE STILL, BECAUSE IT IS SILENT. Pine's
// `ta.highestbars` returns a NON-POSITIVE offset; the house column returns a
// positive one. `CLAUDE.md` already records `ta.highestbars` shipping green
// with the sign inverted once. Bare `highestbars` in a v4 script walked
// straight back into it.
//
// ⛔ THE GAP WAS DOCUMENTED AND UNBOUNDED, which is this repo's own lesson.
// `pine.js` at the namespaced-transform site says, in as many words: *"a Pine
// v4 script may spell a `ta.` builtin bare, and that spelling is then genuinely
// ambiguous … nothing here guesses."* Writing the hazard down is not handling
// it — and the corpus carries 71 v4 scripts.
import { describe, it, expect } from 'vitest'

import { translatePine, PINE_NAMESPACED_TREE } from './pine.js'

const LF = String.fromCharCode(10)
const Q = String.fromCharCode(34)
const head = (v) => `//@version=${v}${LF}${v >= 5 ? 'indicator' : 'study'}(${Q}t${Q})${LF}`

/** The selected output's formula, or the refusal that stopped it. */
function formula(src) {
  const out = translatePine(src, { strict: true })
  if (!out.ok) return `REFUSED ${(out.refusal || {}).guard}: ${(out.refusal || {}).message}`
  return out.outputs[out.selected].formula
}

/** The same call, written the way each Pine version spells it. */
const bareV4 = (call) => formula(head(4) + `plot(${call})${LF}`)
const taV5 = (call) => formula(head(5) + `plot(ta.${call})${LF}`)

describe('⛔⛔ a bare builtin in a v1–v4 script means PINE, not the house table', () => {
  it('⛔ CONTROL — the namespaced spelling still works, and is a TRANSFORM', () => {
    // ⭐ NON-VACUITY. Every equivalence below is against the `ta.` answer, so if
    // that path were broken the comparisons would pass by matching two
    // failures. And the transform must really transform: if `ta.pivothigh`
    // produced the bare column unchanged there would be nothing to test.
    const ta = taV5('pivothigh(high, 2, 2)')
    expect(ta.startsWith('REFUSED'), ta).toBe(false)
    expect(ta, 'the `ta.` spelling is not applying its shift').toContain('[2]')
    expect(Object.keys(PINE_NAMESPACED_TREE)).toEqual(
      expect.arrayContaining(['ta.pivothigh', 'ta.pivotlow', 'ta.highestbars', 'ta.lowestbars']),
    )
  })

  it('⭐⭐ `pivothigh` in v4 === `ta.pivothigh` in v5 — the look-ahead is cancelled', () => {
    // ⚰️ THE TRENDLINES DEFECT, reduced to one line. Before the fix the v4 form
    // produced the unshifted house column and every line landed a pivot span
    // early against TradingView.
    expect(bareV4('pivothigh(high, 2, 2)')).toBe(taV5('pivothigh(high, 2, 2)'))
    expect(bareV4('pivotlow(low, 3, 3)')).toBe(taV5('pivotlow(low, 3, 3)'))
  })

  it('⭐⭐ `highestbars` / `lowestbars` in v4 carry PINE\'S SIGN', () => {
    // ⛔ Pine returns a NON-POSITIVE offset. A sign flip is invisible in a
    // render and wrong in every piece of arithmetic downstream of it.
    expect(bareV4('highestbars(high, 5)')).toBe(taV5('highestbars(high, 5)'))
    expect(bareV4('lowestbars(low, 5)')).toBe(taV5('lowestbars(low, 5)'))
  })

  it('⛔⛔ THE WHOLE ROSTER, DERIVED — no transformed name may be left behind', () => {
    // ⭐ THE ANTI-ROT HALF, and the reason this is not four hand-written cases.
    // A transform added to `PINE_NAMESPACED_TREE` tomorrow is covered the day it
    // lands; a hand-typed list would silently stop covering the newest entry,
    // which is exactly how `pivothigh` came to be wrong in the first place.
    const ARGS = {
      'ta.pivothigh': 'high, 2, 2', 'ta.pivotlow': 'low, 2, 2',
      'ta.highestbars': 'high, 5', 'ta.lowestbars': 'low, 5',
    }
    for (const full of Object.keys(PINE_NAMESPACED_TREE)) {
      const bare = full.slice(3)
      const args = ARGS[full]
      expect(args, `${full} has no probe arguments — add one rather than skipping it`).toBeTruthy()
      const v4 = bareV4(`${bare}(${args})`)
      const v5 = taV5(`${bare}(${args})`)
      expect(v4.startsWith('REFUSED'), `${bare} refused in v4: ${v4}`).toBe(false)
      expect(v4, `bare \`${bare}\` in a v4 script does not mean \`${full}\``).toBe(v5)
    }
  })

  it('⛔⛔ AND v5 IS UNCHANGED — the bare spelling is NOT Pine there', () => {
    // ⭐ THE BOUND ON THE FIX. v5 removed the bare spelling, so a v5 script
    // writing `pivothigh(...)` is not writing Pine and must keep resolving to
    // the house column. Widening the rule to every version would silently
    // change what an existing v5 translation means.
    const v5bare = formula(head(5) + `plot(pivothigh(high, 2, 2))${LF}`)
    const v5ta = taV5('pivothigh(high, 2, 2)')
    expect(v5bare.startsWith('REFUSED'), v5bare).toBe(false)
    expect(v5bare, 'the v5 bare spelling was captured by the legacy rule').not.toBe(v5ta)
  })

  it('⛔ a name with NO transform is untouched in both versions', () => {
    // ⭐ CONTROL: the fix must move only the names whose semantics differ.
    // `sma` means the same thing in both vocabularies and must not be re-routed.
    const a = bareV4('sma(close, 5)');
    const b = taV5('sma(close, 5)')
    expect(a.startsWith('REFUSED'), a).toBe(false)
    expect(a).toBe(b)
  })
})
