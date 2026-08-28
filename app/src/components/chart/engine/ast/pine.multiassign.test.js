import { describe, it, expect } from 'vitest'

import { translatePine } from './pine.js'

/**
 * `fastLength = input(12), slowLength = input(26)` — two bindings, one line.
 *
 * ⭐ A v2/v3 IDIOM, and the whole of what held `19-cm-macd-ult-mtf` once its
 * timeframe cleared. The refusal read "this Pine line is not a shape the
 * translator reads (reached through `fastLength`)" — accurate, and pointing at
 * the SECOND name on the line rather than at the comma that actually stopped it.
 *
 * ⛔ THE SPLIT IS DELIBERATELY NARROW, because a comma means several things in
 * Pine and only one of them is this. It applies ONLY to a line with no indented
 * block beneath it, and ONLY when EVERY top-level segment carries its own
 * top-level `=`. A comma inside a call is at bracket depth and was never a
 * candidate; a line where one segment is not an assignment refuses exactly as
 * before, because a partial split would bind half a statement and drop the rest
 * silently — which is worse than the refusal it replaced.
 */
describe('several bindings on one line', () => {
  const src = (body) => `//@version=4\nstudy("t")\n${body}\n`

  const treeOf = (out) => {
    expect(out.refusal, out.refusal && out.refusal.message).toBe(null)
    const first = out.outputs.find((o) => o.refusal === null)
    expect(first, 'no output translated').toBeTruthy()
    return first.ast
  }

  it('⭐ both names bind, and both are readable afterwards', () => {
    const ast = treeOf(translatePine(src(
      `fastLength = input(12, minval=1), slowLength = input(26, minval=1)
plot(sma(close, fastLength) - sma(close, slowLength))`)))
    expect(ast).toEqual({
      type: 'op', name: '-',
      args: [
        { type: 'call', name: 'sma', args: [{ type: 'series', name: 'close' }, { type: 'num', value: 12 }] },
        { type: 'call', name: 'sma', args: [{ type: 'series', name: 'close' }, { type: 'num', value: 26 }] },
      ],
    })
  })

  it('⭐ …and the SECOND binding is really bound, not defaulted by luck', () => {
    // The control on the line above: if the split dropped segment two, `slowLength`
    // would be undefined and refuse — but if it dropped segment ONE while leaving a
    // stale binding around, the tree would still shape-match with the wrong number.
    // Reading the second name ALONE is what distinguishes those.
    const ast = treeOf(translatePine(src(
      `a = input(7), b = input(99)
plot(sma(close, b))`)))
    expect(ast).toEqual({
      type: 'call', name: 'sma',
      args: [{ type: 'series', name: 'close' }, { type: 'num', value: 99 }],
    })
  })

  it('⭐ three on a line, because two is not a special case', () => {
    const ast = treeOf(translatePine(src(
      `a = input(2), b = input(3), c = input(4)
plot(sma(close, a) + sma(close, b) + sma(close, c))`)))
    const lengths = JSON.stringify(ast).match(/"value":(\d+)}/g)
    expect(lengths).toEqual(['"value":2}', '"value":3}', '"value":4}'])
  })

  // ─── what must NOT split ──────────────────────────────────────────────────

  it('⛔ a comma INSIDE a call is not a statement separator', () => {
    // It never was — it sits at bracket depth — but a split written without the
    // depth rule would cut `sma(close, 20)` in half and hand a fragment to the
    // parser. Asserted so the depth rule cannot be quietly dropped.
    const ast = treeOf(translatePine(src('plot(sma(close, 20))')))
    expect(ast).toEqual({
      type: 'call', name: 'sma',
      args: [{ type: 'series', name: 'close' }, { type: 'num', value: 20 }],
    })
  })

  it('⛔ a named argument keeps its own `=`', () => {
    // `input(12, minval=1)` has an `=` at bracket depth. If the segment scan used
    // a naive search it would find that one and mis-locate the binding.
    const ast = treeOf(translatePine(src(
      `len = input(12, minval=1), other = input(5, minval=1)
plot(sma(close, len))`)))
    expect(ast.args[1]).toEqual({ type: 'num', value: 12 })
  })

  it('⛔ a segment that is NOT an assignment blocks the split entirely', () => {
    // ⛔⛔ ALL OR NOTHING, AND THIS IS THE ASSERTION THAT MATTERS. Splitting here
    // would bind `a` and silently drop a `plot` the member wrote — a script that
    // translates while missing an output it declared. It refuses instead.
    const out = translatePine(src('a = 1, plot(close)'))
    expect(out.ok).toBe(false)
    expect(out.refusal).toBeTruthy()
  })

  it('⚰️ …though the SENTENCE it refuses with is still the wrong one', () => {
    // Pinned as a known defect rather than left to be rediscovered. The line binds
    // whole, the `plot` is never collected, and the member is told the script
    // "offers no plot" while a plot sits on the line they are reading.
    //
    // ⛔ THE OBVIOUS FIX WAS WRITTEN AND REVERTED: refusing every top-level comma
    // that cannot be split also refuses `screener(a), screener(b), …`, which the
    // OWNER corpus uses and which translated fine — it cost that script its ten
    // working outputs. Caught only because that snapshot pins OUTPUT COUNT beside
    // the guard; a gate on the guard alone would have called the regression green.
    // Fixing the sentence needs a reader that knows which segments are outputs,
    // which is a different job from splitting bindings.
    const out = translatePine(src('a = 1, plot(close)'))
    expect(out.refusal.guard).toBe('pine:no-output')
  })

  it('⛔ and a line with an indented block beneath it never splits', () => {
    // The body belongs to the line as a whole, and there is no honest answer to
    // "which segment owns the block". Out of scope by construction, not by luck.
    //
    // ⚰️⚰️ THIS ASSERTION USED TO PROVE NOTHING, AND IT STILL DOES NOT PROVE THE
    // GUARD — which is worth saying out loud rather than dressing up.
    // It originally ran `a = 1, b = 2` over a block and asserted only that
    // SOMETHING refused, on a script with no plot in it: that refuses at
    // `pine:no-output` whether the split happened or not. It now reads `b`, so at
    // least it observes a real difference between the two SHAPES below.
    //
    // ⛔ BUT MEASURED: deleting `body.length === 0` from the split condition is an
    // EQUIVALENT MUTANT — all eight cases here stay green with the guard removed.
    // I could not construct a source where its presence changes an observable
    // answer, so it is defensive rather than load-bearing today, and this file
    // does not claim otherwise. (`pine.js` records another measured equivalent
    // mutant the same way; a guard nobody can see fire is worth marking as such
    // rather than leaving a green test to imply it was checked.)
    // ⭐ WHAT THE PAIR BELOW DOES PROVE is the SPLIT itself: with a block the line
    // does not split and `b` is unbound; without one it splits and `b` is 2.
    const withBlock = translatePine(src(
      `a = 1, b = 2
    c = 3
plot(close > b ? 1 : 0)`))
    expect(withBlock.refusal).toBeTruthy()
    expect(withBlock.refusal.guard).toBe('pine:statement')

    const withoutBlock = translatePine(src(
      `a = 1, b = 2
plot(close > b ? 1 : 0)`))
    expect(withoutBlock.refusal).toBe(null)
    expect(withoutBlock.outputs.find((o) => o.refusal === null).formula)
      .toBe('close > 2 ? 1 : 0')
  })
})
