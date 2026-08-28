import { describe, it, expect } from 'vitest'

import { parseFormula, TABLE } from './parse.js'
import { sentenceFor } from './sentence.js'

/**
 * THE GUARDS NOTHING IN THIS REPO HAD EVER FIRED — and what measuring them found.
 *
 * ⛔ A GUARD NOBODY HAS SEEN FIRE IS NOT A GUARD. `canonicalise:node` and
 * `sentence:operator` were the last two on the canonical path with no test
 * anywhere, and each is a final `default:` — precisely where a silent wrong
 * answer surfaces if a walk stops covering its input.
 *
 * ⭐⭐ MEASURING THEM ANSWERED A QUESTION THE CODE ONLY HALF-STATED. `parse.js`
 * has TWO `canonicalise:node` sites. One is reachable and one is not:
 *
 *   the LITERAL arm      reachable — a STRING literal has no canonical form,
 *                        because the manifest's only literal is a number.
 *   the final `default:` UNREACHABLE, measured. Every jsep shape that gets that
 *                        far already has its OWN named guard first —
 *                        `canonicalise:member` (`a.b`), `canonicalise:this`,
 *                        `canonicalise:compound` (`close, open`),
 *                        `canonicalise:array` — and everything else is rejected
 *                        by jsep itself under `parser`.
 *
 * ⚠️ SO THAT LAST `default:` IS A BACKSTOP WITH NO REACHABLE INPUT TODAY, and this
 * file says so rather than implying a test covers it. That is not an argument for
 * deleting it: it is the arm that catches a jsep upgrade introducing a node type
 * nobody mapped, which is exactly when you want a refusal instead of `undefined`.
 * It is an argument for not counting it as tested.
 */
describe('the last fallthroughs on the canonical path', () => {
  // ─── parse.js — the reachable `canonicalise:node` ─────────────────────────

  it('⭐ a STRING literal refuses at `canonicalise:node`', () => {
    // ⛔ THE IMPORTANT HALF IS THAT IT REFUSES RATHER THAN COERCING. `'20'`
    // quietly becoming the number 20 would let a quoted length through as a
    // window and read as a working formula.
    const out = parseFormula("sma(close, '20')")
    expect(out.ok).toBe(false)
    expect(out.guard).toBe('canonicalise:node')
  })

  it('⭐ …and `true` / `false` are NOT refused — they are 1 and 0', () => {
    // ⛔ THE CONTROL. That branch sits directly beneath the boolean arms, so a
    // fix that widened it would take booleans with it — and the manifest declares
    // `!`, `&&`, `||` and `?:` over a table whose only literal is a number, which
    // is why `true` has to survive as `1`.
    expect(parseFormula('true')).toEqual({ ok: true, ast: { type: 'num', value: 1 } })
    expect(parseFormula('false')).toEqual({ ok: true, ast: { type: 'num', value: 0 } })
  })

  it('⭐⭐ every OTHER unsupported shape is refused by its OWN name, not the fallthrough', () => {
    // This is what makes the final `default:` unreachable, and it is the better
    // design: a member who writes `a.b` is told about property access, not handed
    // a generic "no canonical form". Asserted as a table so a guard that
    // regresses INTO the fallthrough is visible — that would be a real loss of
    // sentence quality with no test failure anywhere else.
    const cases = [
      ['a.b', 'canonicalise:member'],
      ['this', 'canonicalise:this'],
      ['close, open', 'canonicalise:compound'],
      ['[close, open]', 'canonicalise:array'],
    ]
    const got = cases.map(([src]) => [src, parseFormula(src).guard])
    expect(got).toEqual(cases)
  })

  // ─── sentence.js — an op naming an operator the table does not declare ────

  it('⭐⭐ a tree naming an UNDECLARED operator refuses, and lists what exists', () => {
    // ⚠️ REACHED ONLY WITH A HAND-BUILT TREE, and that is exactly why it needs a
    // test. The parser cannot produce this, so nothing entering by the front door
    // exercises it — but `sentenceFor` also renders trees loaded from the STORE,
    // and a row written under an older or newer manifest is this shape.
    let refusal = null
    try {
      sentenceFor({ type: 'op', name: '<=>', args: [
        { type: 'series', name: 'close' }, { type: 'series', name: 'open' },
      ] }, {})
    } catch (e) { refusal = e }
    expect(refusal, 'an undeclared operator rendered a sentence').toBeTruthy()

    // ⭐ IT NAMES WHAT THE TABLE DOES DECLARE. A refusal that says only "no" sends
    // the reader hunting; this one hands them the vocabulary.
    const declared = Object.keys(TABLE.operators || {}).sort()
    expect(declared.length).toBeGreaterThan(5)
    expect(String(refusal.message)).toContain(declared[0])
  })

  // ─── a concern that turned out to be unreachable, measured ──────────────

  it('⚠️ the parser never emits a `num` node holding NEGATIVE ZERO', () => {
    // ⭐ THIS PINS A NON-DEFECT, ON PURPOSE. `interpret.js`'s structural memo
    // interns nodes by shape, and `String(-0)` is "0" — so a tree holding both
    // `num -0` and `num 0` would give them ONE id and reuse one column for the
    // other. That was raised as a possible cross-lane divergence.
    //
    // ⛔ IT CANNOT ARISE FROM THE FRONT DOOR. Every `-0` in source canonicalises
    // to `u-(num 0)`, never to a `num` holding -0, so the two shapes are never
    // both present as literals. Measured across both lanes as well: `1 / -0` and
    // `1 / 0` are NaN in each, and `sign(-0)` is 0 in each.
    //
    // ⚠️ WHAT REMAINS TRUE is the same caveat as `sentence:operator` above — a
    // row loaded from the STORE is not parser output, so a hand-written or
    // foreign-produced tree could still hold one. This case exists so that if the
    // parser ever starts emitting it, the change is visible HERE rather than as a
    // memo collision nobody can reproduce.
    expect(parseFormula('-0')).toEqual({ ok: true, ast: {
      type: 'op', name: 'u-', args: [{ type: 'num', value: 0 }],
    } })
    expect(parseFormula('0')).toEqual({ ok: true, ast: { type: 'num', value: 0 } })
  })

  it('⭐ …and a DECLARED operator still renders — not a blanket refusal', () => {
    const text = sentenceFor({ type: 'op', name: '>', args: [
      { type: 'series', name: 'close' }, { type: 'series', name: 'open' },
    ] }, {})
    expect(JSON.stringify(text)).toMatch(/close/)
  })
})
