// app/src/components/chart/engine/ast/routingSentencesRespectD2.test.js
//
// ─── ⭐⭐ R20 — A ROUTING SENTENCE MAY NOT PROMISE WHAT D2 BLOCKS ────────────
//
// Owner ruling, 2026-09-15. Two refusal sentences route work to **item (c)** and the
// **IR lane**:
//
//   • a `for` bound that depends on a series (R1, 56 uses) —
//     *"a loop whose bound depends on a series is the IR lane's, item (c)"*
//   • an `input.time` whose default is an expression (R16, 5 uses) —
//     *"the 5 that are expressions are item (c)'s"*
//
// ⛔⛔ BOTH ARE TRUE AND BOTH ARE INCOMPLETE, AND THE MISSING HALF IS THE ONE A MEMBER
// ACTS ON. Ruling **D2** is that a pane draws the **HOST lane's saved definition**
// (`paneGate.js::PANE_LANE = 'host'`) and that **the IR lane's output does not reach
// the pane path**. So a sentence that says "the IR lane will carry this" promises a
// member a result that, while D2 stands, **cannot reach the surface they are looking
// at**. The work is permitted off-pane; the delivery is not.
//
// ⭐ THE FIX IS THE QUALIFICATION, NOT THE ROUTING. The routing is correct — these
// really are the IR lane's. What each sentence gains is the fact that the IR lane does
// not reach a pane while D2 stands, so nobody reads "item (c) will handle it" as "this
// will draw."
//
// ⛔ R16's **10 bare-`input`** sentences are NOT touched: measured, those uses are
// `request.security`-consumed and **item (c) already delivers them** today. A
// qualification there would be false.
import { describe, it, expect } from 'vitest'
import { translatePine } from './pine.js'

/** ⭐ ONE SPECIMEN PER SENTENCE, inline and minimal, so the assertion is about the
 *  sentence rather than about a corpus script's other problems. */
// ⚰️ v1 of these two specimens produced NO routing sentence at all, and the
// non-vacuity control below caught it on the first run rather than review — the
// series-bound one guarded its read with `array.size(a) > 0`, which settles to 0 and
// relocates the refusal to an out-of-range read before the loop's bound is ever
// reported. Probed through the door and replaced with the forms that actually emit.
const SERIES_BOUND = [
  'indicator("x")',
  'n = int(ta.sma(close, 14))',
  'a = array.new<float>(0)',
  'for i = 0 to n',
  '    array.push(a, close)',
  'plot(array.get(a, 0))',
].join('\n')

const TIME_EXPR_DEFAULT = [
  'indicator("x")',
  't = input.time(timestamp("2024-01-01"), "Start")',
  'plot(t > 0 ? close : 0)',
].join('\n')

/** Every sentence a translation puts in front of a member, notes AND refusals. */
function sentences(src) {
  const t = translatePine(src, {})
  const out = []
  for (const n of (t.notes || [])) out.push(String(n.message || ''))
  for (const r of (t.refusals || [])) out.push(String(r.message || ''))
  return out
}

const routing = (src, needle) => sentences(src).filter((m) => m.includes(needle))

describe('R20 — a routing sentence carries D2\'s limit', () => {
  it('⛔⛔ NON-VACUITY CONTROL — each specimen really produces its routing sentence', () => {
    // Without this, "the sentence contains X" passes over an empty list and the
    // `it.fails` guarding it reports the defect already fixed — the R13 shape, and
    // the reason this control is now named in every red acceptance.
    const a = routing(SERIES_BOUND, 'item (c)')
    expect(a.length, 'the series-bound specimen produced NO item (c) routing sentence, '
      + 'so every assertion about its wording is vacuous').toBeGreaterThan(0)
    expect(a.join(' '), 'the series-bound sentence should name the IR lane')
      .toContain('IR lane')

    const b = routing(TIME_EXPR_DEFAULT, 'item (c)')
    expect(b.length, 'the input.time specimen produced NO item (c) routing sentence')
      .toBeGreaterThan(0)
  })

  it('⭐⭐ the SERIES-BOUND sentence says the IR lane does not reach a pane', () => {
    const m = routing(SERIES_BOUND, 'item (c)').join(' ')
    expect(m, 'a member is told item (c) carries this, but not that D2 keeps the IR '
      + 'lane off the pane — so they are promised a result they cannot be shown')
      .toMatch(/ruling D2|does not reach a pane|not on the pane path/)
  })

  it('⭐⭐ the input.time EXPRESSION-DEFAULT sentence says the same', () => {
    const m = routing(TIME_EXPR_DEFAULT, 'item (c)').join(' ')
    expect(m, 'same promise, same missing limit')
      .toMatch(/ruling D2|does not reach a pane|not on the pane path/)
  })

  it('⛔ CONTROL — R16\'s bare-`input` routing is NOT given the qualification', () => {
    // ⭐ Those uses ARE delivered today — they are `request.security`-consumed and fold
    // to `sym`. Adding "D2 blocks this" there would be false, and a rail that demanded
    // the qualification everywhere would force exactly that lie.
    const t = translatePine(
      'indicator("x")\ntf = input("D", "TF")\nplot(request.security("AAPL", tf, close))\n',
      {})
    const all = [...(t.notes || []), ...(t.refusals || [])]
      .map((x) => String(x.message || '')).join(' ')
    expect(all).not.toMatch(/ruling D2/)
    expect((t.outputs || []).length, 'the bare-input timeframe path stopped working')
      .toBeGreaterThan(0)
  })
})
