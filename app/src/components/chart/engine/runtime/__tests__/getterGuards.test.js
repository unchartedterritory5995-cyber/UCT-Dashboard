// app/src/components/chart/engine/runtime/__tests__/getterGuards.test.js
//
// ─── ⭐⭐ A GUARD THAT READS OBJECT STATE — `ta.crossunder(high, box1.get_bottom())` ───
//
// ⚰️ MEASURED AGAINST TRADINGVIEW, 2026-09-27. Zero-Lag MA Trend Levels draws
// its 8 trend-break labels from `switch` arms guarded by a crossing of price
// with the current trend box's edge. A getter is object state the pure V2 graph
// cannot hold, so both arms were refused and TradingView's 8 labels were 0.
// The runtime holds the register, so the getter is LIFTED out of the tree and
// read by the runtime — at the op's own position in the op order, once per bar.
//
// The expectations below are Pine's rules written out bar by bar, not our
// runtime's output:
//   · the getter reads the register AS IT STANDS WHEN THE STATEMENT RUNS on
//     that bar (a statement above the create sees yesterday's box);
//   · `ta.crossover(a, b)` is `a > b and a[1] <= b[1]` over the values seen on
//     each bar, and an `na` operand makes it FALSE (so `not` of it is TRUE);
//   · an empty register reads `na`.
import { describe, it, expect } from 'vitest'

import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'
import { objectReaderFor } from '../../objectColumns'
import { evaluateObjects } from '../../objectRuntime'
import { translatePine } from '../../ast/pine'

const N = 60
const BARS = Array.from({ length: N }, (_, i) => ({
  t: new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10),
  o: 100 + (i % 7), h: 110 + (i % 5), l: 90 - (i % 3), c: 100 + (i % 11), v: 1000000 + i,
}))
const H = '//@version=5\nindicator("t", overlay=true, max_labels_count=500, max_boxes_count=500)\nplot(close)\n'
const Q = String.fromCharCode(34)
const MID = (b) => (b.h + b.l) / 2
const MAKE = 'if close > open\n    b := box.new(bar_index, (high + low) / 2, bar_index, low)\n'
const LABEL = `label.new(bar_index, high, ${Q}x${Q})`

/** Through the MEMBER DOOR and the object runtime it feeds. → label bars. */
function labelBars(body) {
  const d = memberPaneDefinition({ source: H + body, id: 'u_gg', name: 'gg' })
  expect(d.ok, d.reason).toBe(true)
  const reader = objectReaderFor(d.definition, BARS, { inputs: undefined, tf: 'D', symbol: 'TEST' })
  expect(reader, 'objectReaderFor returned null').toBeTruthy()
  const run = evaluateObjects(reader.program, {
    barCount: BARS.length, readNode: reader.readNode, readTime: (i) => BARS[i].t,
  })
  return run.live.filter((o) => o.family === 'label').map((o) => o.props.x)
}
const diag = (body) => translatePine(H + body, { strict: true }).objectDiagnostics || {}

/** Pine, bar by bar: a crossing of `close` over the held box's TOP, with the
 *  label statement placed `before` or `after` the statement that makes boxes. */
function modelCrossOverTop({ order, negate = false }) {
  let top = null
  let prev = [NaN, NaN]
  const fired = []
  const statement = (i) => {
    const b = BARS[i]
    const g = top === null ? NaN : top
    const [pc, pg] = prev
    const cross = [b.c, g, pc, pg].every((x) => !Number.isNaN(x)) && b.c > g && pc <= pg
    prev = [b.c, g]
    if (negate ? !cross : cross) fired.push(i)
  }
  for (let i = 0; i < N; i += 1) {
    if (order === 'before') statement(i)
    if (BARS[i].c > BARS[i].o) top = MID(BARS[i])
    if (order === 'after') statement(i)
  }
  return fired
}

describe('⭐⭐ a getter in a guard is read at the statement, once per bar', () => {
  it('⛔ CONTROL — the fixture crosses, and not on every bar; placement changes the answer', () => {
    const after = modelCrossOverTop({ order: 'after' })
    expect(after.length).toBeGreaterThan(0)
    expect(after.length).toBeLessThan(N)
    expect(modelCrossOverTop({ order: 'before' })).not.toEqual(after)
  })

  it('⭐ `ta.crossover(close, b.get_top())` BELOW the create reads today\'s box', () => {
    expect(labelBars(`var b = box(na)\n${MAKE}if ta.crossover(close, b.get_top())\n    ${LABEL}\n`))
      .toEqual(modelCrossOverTop({ order: 'after' }))
  })

  it('⭐ the same statement ABOVE the create reads the box as it stood before this bar\'s create', () => {
    expect(labelBars(`var b = box(na)\nif ta.crossover(close, b.get_top())\n    ${LABEL}\n${MAKE}`))
      .toEqual(modelCrossOverTop({ order: 'before' }))
  })

  it('⭐ the function spelling `box.get_top(b)` is the same read', () => {
    expect(labelBars(`var b = box(na)\n${MAKE}if ta.crossover(close, box.get_top(b))\n    ${LABEL}\n`))
      .toEqual(modelCrossOverTop({ order: 'after' }))
  })

  it('⭐ an `na` operand makes the crossing FALSE, so `not` of it is TRUE — on every bar before the first box', () => {
    const got = labelBars(`var b = box(na)\n${MAKE}if not ta.crossover(close, b.get_top())\n    ${LABEL}\n`)
    expect(got).toEqual(modelCrossOverTop({ order: 'after', negate: true }))
    expect(got[0], 'bar 0 has no box: the crossing is false, `not` is true').toBe(0)
  })

  it('⭐ a comparison with a getter, AND a getter-free condition, combine as Pine does', () => {
    const got = labelBars(`var b = box(na)\n${MAKE}if close > b.get_bottom() and close > open\n    ${LABEL}\n`)
    const expected = []
    let bottom = null
    for (let i = 0; i < N; i += 1) {
      const b = BARS[i]
      if (b.c > b.o) bottom = b.l
      if (bottom !== null && b.c > bottom && b.c > b.o) expected.push(i)
    }
    expect(expected.length).toBeGreaterThan(0)
    expect(got).toEqual(expected)
  })

  it('⭐ inside `switch` arms, the second arm runs only when the first — which also reads the box — did not', () => {
    const body = `var b = box(na)\n${MAKE}switch\n`
      + `    ta.crossover(close, b.get_top()) => label.new(bar_index, high, ${Q}U${Q})\n`
      + `    close < b.get_bottom() => label.new(bar_index, low, ${Q}D${Q})\n`
    const expected = []
    let box = null
    let prev = [NaN, NaN]
    for (let i = 0; i < N; i += 1) {
      const b = BARS[i]
      if (b.c > b.o) box = { top: MID(b), bottom: b.l }
      const g = box ? box.top : NaN
      const cross = [b.c, g, ...prev].every((x) => !Number.isNaN(x)) && b.c > g && prev[0] <= prev[1]
      prev = [b.c, g]
      if (cross || (box && b.c < box.bottom)) expected.push(i)
    }
    expect(labelBars(body)).toEqual(expected)
  })
})

describe('⛔ a getter this lane cannot lift keeps the guard unreadable — dropped and counted', () => {
  it('a getter inside arithmetic', () => {
    const dg = diag(`var b = box(na)\n${MAKE}if close > b.get_top() + 1\n    ${LABEL}\n`)
    expect(dg.dropReasons['guard:create']).toBe(1)
  })

  // ⭐ C14 (2026-09-29): a WHOLE-coordinate getter is read at its op by the
  // runtime now (`objectGetterState.test.js`); inside arithmetic it is refused.
  it('a getter INSIDE a coordinate’s arithmetic is still refused', () => {
    const dg = diag(`var b = box(na)\n${MAKE}label.new(bar_index, b.get_top() + 1, ${Q}x${Q})\n`)
    expect(dg.dropReasons['create:label']).toBe(1)
  })

  it('a WHOLE-coordinate getter is served (C14)', () => {
    const dg = diag(`var b = box(na)\n${MAKE}label.new(bar_index, b.get_top(), ${Q}x${Q})\n`)
    expect(dg.dropReasons['create:label']).toBeUndefined()
  })

  // ⚰️ C16 (2026-09-29) — this was "a getter guard inside a counted loop body is
  // refused". Only a CROSSING has no single answer there (observed once per bar);
  // a comparison is read per iteration, so it is served now — and the crossing
  // case below keeps the refusal.
  it('⭐ C16 — a getter COMPARISON inside a counted loop body is read per iteration, as Pine runs it', () => {
    const body = `var b = box(na)\n${MAKE}for i = 0 to 2\n    if close > b.get_top()\n        ${LABEL}\n`
      + `label.new(bar_index, low, ${Q}y${Q})\n`
    const dg = diag(body)
    expect(dg.dropReasons && dg.dropReasons['guard:create']).toBeUndefined()
    // Pine, bar by bar: the box is (re)made first; then three iterations each
    // label the bar when close is above the held box's top; then one `y` label.
    let top = null
    const want = []
    BARS.forEach((b, i) => {
      if (b.c > b.o) top = MID(b)
      for (let k = 0; k <= 2; k += 1) if (top !== null && b.c > top) want.push(i)
      want.push(i)
    })
    expect(labelBars(body)).toEqual(want)
  })

  it('⛔ a getter CROSSING inside a counted loop body — refused as that op\'s guard, the rest of the drawing kept', () => {
    const dg = diag(`var b = box(na)\n${MAKE}for i = 0 to 2\n    if ta.crossover(close, b.get_top())\n        ${LABEL}\n`
      + `label.new(bar_index, low, ${Q}y${Q})\n`)
    expect(dg.dropReasons['guard:create']).toBe(1)
    expect(dg.failed, 'the whole program was lost instead of one op').toBeUndefined()
  })

  it('a getter on a name that is not a declared drawing handle', () => {
    const dg = diag(`var b = box(na)\n${MAKE}if ta.crossover(close, zz.get_top())\n    ${LABEL}\n`)
    expect(dg.dropReasons['guard:create']).toBe(1)
  })
})
