// app/src/components/chart/engine/__tests__/computeContainment.test.js
//
// ─── ⭐⭐ C2A: ONE COLUMN'S FAILURE IS ONE COLUMN'S FAILURE ──────────────────
//
// ⚰️ MEASURED ON A REAL SCRIPT, and it cost seven columns to lose four.
// `mid_engagement__14-master-line-lite` declares 7. Three — Consensus and the two
// bands — compute cleanly at the 5,000 bars a chart loads: 4,945 finite values
// each, 6-20 ms. The other four are `accum` recurrences whose `bars × warmup`
// exceeds `MAX_RECURRENCE_STEPS`, and they refuse.
//
// `astColumnsFor`'s loop had no `try`. The fourth tree threw, the loop unwound,
// `computeFor` threw, the binder's `attempt(...)` caught it and `continue`d past
// the WHOLE INSTANCE — and all seven plots drew nothing. Measured through
// `computeFor` itself: OK at 1, 2 and 3 columns, throwing from the 4th on.
//
// ⛔ THE BUDGET WAS NEVER SHARED, and the distinction is the finding. Each
// `interpret` call is capped on its own tree and nothing accumulates across
// siblings. A shared budget would mean the DOCUMENT is too big; it is not — one
// column of it is. Fixing the wrong one would have meant raising a limit that was
// never the problem.
import { describe, it, expect } from 'vitest'
import { computeFor, columnErrors } from '../nativeRegistry'
import { DEFAULT_BUDGET } from '../ast/budget'

const bars = (n) => Array.from({ length: n }, (_, i) => ({
  t: 1500000000 + i * 86400, o: 100, h: 101, l: 99, c: 100 + (i % 7), v: 1000,
}))

const SERIES = (name) => ({ type: 'series', name })
const NUM = (v) => ({ type: 'num', value: v })

/** A cheap column: just the close. */
const CHEAP = SERIES('close')

/** An `accum` whose `bars × warmup` blows `MAX_RECURRENCE_STEPS` at 5,000 bars.
 *  250 × 5,000 = 1,250,000 > 1,000,000 — the exact shape master-line-lite uses. */
const EXPENSIVE = {
  type: 'call',
  name: 'accum',
  args: [NUM(0), { type: 'op', name: '+', args: [SERIES('self'), SERIES('close')] }, NUM(250)],
}

const doc = (trees) => ({
  id: 'u_contain',
  schemaVersion: 2,
  label: 'Contain',
  inputs: [],
  plots: Object.keys(trees).map((k) => ({ key: k, label: k, style: 'line', legend: { decimals: 2 } })),
  compute: { kind: 'ast', fn: 'sha256:contain', trees, budget: DEFAULT_BUDGET },
})

const finite = (col) => (col || []).filter(Number.isFinite).length

describe('a failing column does not erase its siblings', () => {
  const B = bars(5000)

  it('⭐⭐ the good columns still compute when a sibling refuses', () => {
    const cols = computeFor(doc({ a: CHEAP, bad: EXPENSIVE, b: CHEAP }), B, {}, {})
    expect(Object.keys(cols).sort()).toEqual(['a', 'b'])
    expect(finite(cols.a)).toBe(5000)
    expect(finite(cols.b)).toBe(5000)
  })

  it('⛔ THE ORDER DOES NOT MATTER — a failure FIRST must not eat what follows', () => {
    // The original defect was order-dependent by construction: everything after
    // the throw was lost. A test that only put the bad column last would pass
    // with the bug still in place for every script that plots its expensive
    // column first.
    const cols = computeFor(doc({ bad: EXPENSIVE, a: CHEAP, b: CHEAP }), B, {}, {})
    expect(Object.keys(cols).sort()).toEqual(['a', 'b'])
  })

  it('⭐⭐ and the REASON is preserved, per column', () => {
    const cols = computeFor(doc({ a: CHEAP, bad: EXPENSIVE }), B, {}, {})
    const errs = columnErrors(cols)
    expect(Object.keys(errs)).toEqual(['bad'])
    expect(errs.bad.guard).toBe('interpret:steps')
    expect(errs.bad.message).toMatch(/steps/)
    // ⛔ A COLUMN THAT COMPUTED HAS NO ENTRY. "Which of my outputs failed" must be
    // answerable, not merely "something failed".
    expect(errs.a).toBeUndefined()
  })

  it('⛔ the error channel is INVISIBLE to a key walk', () => {
    // Every consumer of a column map walks it with `Object.keys` — the binder's
    // `for (const plotKey of Object.keys(cols))` is the one that matters. A
    // visible extra key would become a phantom plot on every chart.
    const cols = computeFor(doc({ a: CHEAP, bad: EXPENSIVE }), B, {}, {})
    expect(Object.keys(cols)).toEqual(['a'])
    expect(JSON.parse(JSON.stringify(cols)).__columnErrors).toBeUndefined()
  })

  it('⛔ NON-VACUITY: with no failure there is no error state at all', () => {
    const cols = computeFor(doc({ a: CHEAP, b: CHEAP }), B, {}, {})
    expect(Object.keys(cols).sort()).toEqual(['a', 'b'])
    expect(columnErrors(cols)).toEqual({})
  })

  it('⛔ EVERY column failing yields no columns — and every reason', () => {
    // `spma-trend`'s real shape: all five of its columns exceed the budget on
    // their own. That is NOT a containment failure and must not be dressed as a
    // partial success — the honest answer is no columns, with five reasons.
    const cols = computeFor(doc({ x: EXPENSIVE, y: EXPENSIVE }), B, {}, {})
    expect(Object.keys(cols)).toEqual([])
    expect(Object.keys(columnErrors(cols)).sort()).toEqual(['x', 'y'])
  })

  it('⛔ A DOCUMENT DEFECT STILL THROWS — containment is for COMPUTE, not for shape', () => {
    // A plot with no tree is a malformed document, not an expensive one. Swallowing
    // it here would turn a defect the schema already refuses into a silently
    // missing plot.
    const d = doc({ a: CHEAP })
    d.plots.push({ key: 'ghost', label: 'ghost', style: 'line', legend: { decimals: 2 } })
    expect(() => computeFor(d, B, {}, {})).toThrow(/no tree in/)
  })

  it('⭐ at a bar count the expensive column CAN take, nothing is contained', () => {
    // 250 × 900 = 225,000, well inside the ceiling. The same document computes
    // every column — which is what proves the refusal is about cost and not about
    // the shape of the tree.
    const cols = computeFor(doc({ a: CHEAP, bad: EXPENSIVE }), bars(900), {}, {})
    expect(Object.keys(cols).sort()).toEqual(['a', 'bad'])
    expect(columnErrors(cols)).toEqual({})
  })
})
