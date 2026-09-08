// app/src/components/chart/engine/__tests__/computeStress.test.js
//
// ─── ⭐⭐ C2A.7: CONTAINMENT MUST NOT BECOME AN UNBOUNDED DOOR ───────────────
//
// C2A stopped one failing column from erasing its siblings. The obvious way to get
// that wrong is to turn a guard into a shrug: catch everything, keep going, and let
// a document do as much work as it likes as long as each individual piece refuses
// politely.
//
// ⛔ SO THE PROTECTION IS ASSERTED, NOT ASSUMED. Every fixture here is a legal
// document a member could actually save, built to be expensive in a different way,
// and each asserts that the engine still refuses — or completes in a bounded time
// — rather than hanging.
//
// ⛔ AND EVERY ONE IS DETERMINISTIC. No randomness, no wall-clock thresholds that
// pass on a fast machine and flake on a loaded one, except the two that MEASURE
// (which are generous by an order of magnitude and exist to catch a hang, not a
// slowdown).
import { describe, it, expect } from 'vitest'
import { computeFor, columnErrors } from '../nativeRegistry'
import { interpret } from '../ast/interpret'
import { DEFAULT_BUDGET } from '../ast/budget'

const bars = (n) => Array.from({ length: n }, (_, i) => ({
  t: 1500000000 + i * 86400, o: 100, h: 101, l: 99, c: 100 + Math.sin(i / 7) * 5, v: 1000,
}))
const B = bars(5000)

const S = (n) => ({ type: 'series', name: n })
const N = (v) => ({ type: 'num', value: v })
const call = (name, ...args) => ({ type: 'call', name, args })
const op = (name, ...args) => ({ type: 'op', name, args })

const doc = (trees) => ({
  id: 'u_stress',
  schemaVersion: 2,
  label: 'Stress',
  inputs: [],
  plots: Object.keys(trees).map((k) => ({ key: k, label: k, style: 'line', legend: { decimals: 2 } })),
  compute: { kind: 'ast', fn: 'sha256:stress', trees, budget: DEFAULT_BUDGET },
})

/** Nested arithmetic `depth` levels deep. */
const deep = (depth) => {
  let n = S('close')
  for (let i = 0; i < depth; i += 1) n = op('+', n, N(1))
  return n
}

/** `k` moving averages summed — the "many repeated MAs" shape. */
const manyMas = (k) => {
  let n = call('sma', S('close'), N(10))
  for (let i = 1; i < k; i += 1) n = op('+', n, call('ema', S('close'), N(10 + i)))
  return n
}

const timed = (fn) => {
  const t0 = Date.now()
  let threw = null
  try { fn() } catch (e) { threw = e.guard || e.name }
  return { ms: Date.now() - t0, threw }
}

describe('C2A.7 — the guard still guards', () => {
  it('⛔ MANY INDEPENDENT OUTPUTS: a wide document is bounded, not unbounded', () => {
    // 24 cheap columns. Containment must not turn "many columns" into "no limit":
    // each is still budgeted, and the whole thing must finish quickly.
    const trees = {}
    for (let i = 0; i < 24; i += 1) trees[`k${i}`] = call('sma', S('close'), N(10 + i))
    const r = timed(() => {
      const cols = computeFor(doc(trees), B, {}, {})
      expect(Object.keys(cols)).toHaveLength(24)
    })
    expect(r.threw).toBeNull()
    expect(r.ms, `24 cheap columns took ${r.ms}ms`).toBeLessThan(8000)
  })

  it('⛔ DEEPLY NESTED ARITHMETIC is refused by the NODE budget, per column', () => {
    // `maxNodes` is 128 and this is ~600. It must refuse — and, with containment,
    // refuse only itself.
    const cols = computeFor(doc({ ok: S('close'), deep: deep(300) }), B, {}, {})
    expect(Object.keys(cols)).toEqual(['ok'])
    expect(columnErrors(cols).deep.guard).toBe('budget:nodes')
  })

  it('⛔ A LARGE WINDOW is refused by the LOOKBACK budget', () => {
    const cols = computeFor(doc({ ok: S('close'), wide: call('sma', S('close'), N(50000)) }), B, {}, {})
    expect(Object.keys(cols)).toEqual(['ok'])
    expect(columnErrors(cols).wide.guard).toMatch(/budget:lookback|resolve:window/)
  })

  it('⛔ AN EXPENSIVE RECURRENCE is refused by the STEP ceiling', () => {
    const acc = call('accum', N(0), op('+', S('self'), S('close')), N(250))
    const cols = computeFor(doc({ ok: S('close'), heavy: acc }), B, {}, {})
    expect(Object.keys(cols)).toEqual(['ok'])
    expect(columnErrors(cols).heavy.guard).toBe('interpret:steps')
  })

  it('⛔⛔ MANY EXPENSIVE COLUMNS DO NOT MULTIPLY INTO A HANG', () => {
    // The failure containment must not become "run twelve 400ms recurrences".
    // Each refuses from a multiplication before doing any work, so a document of
    // twelve of them costs nothing at all — which is the property that makes
    // containment safe to ship.
    const trees = {}
    for (let i = 0; i < 12; i += 1) {
      trees[`h${i}`] = call('accum', N(0), op('+', S('self'), S('close')), N(250))
    }
    const r = timed(() => {
      const cols = computeFor(doc(trees), B, {}, {})
      expect(Object.keys(cols)).toEqual([])
      expect(Object.keys(columnErrors(cols))).toHaveLength(12)
    })
    expect(r.threw).toBeNull()
    expect(r.ms, `twelve refused recurrences took ${r.ms}ms`).toBeLessThan(3000)
  })

  it('⛔ REPEATED IDENTICAL SUBEXPRESSIONS are bounded by the same node budget', () => {
    // The corpus repeats subtrees heavily (77-84% of counted nodes). Repetition
    // is not itself refused — the NODE COUNT is, and that is the right axis.
    // ⚠️ THE THRESHOLD WAS MEASURED, NOT GUESSED. The first draft asserted that
    // twelve moving averages would refuse; twelve is 36 nodes and computes
    // happily. `maxNodes` is 128, one MA in this shape is 3 nodes, and the wall
    // is at ~43 of them: manyMas(40) = 120 nodes passes, manyMas(50) = 150 does
    // not. A stress fixture whose "too big" is not actually too big measures
    // nothing.
    const cols = computeFor(doc({ many: manyMas(50) }), B, {}, {})
    expect(Object.keys(cols)).toEqual([])
    expect(columnErrors(cols).many.guard).toBe('budget:nodes')
  })

  it('⭐ …and 40 of them, at 120 nodes, still compute — the boundary from below', () => {
    // Both sides of one wall. Without this the case above is satisfied by a
    // budget set to zero.
    const cols = computeFor(doc({ many: manyMas(40) }), B, {}, {})
    expect(Object.keys(cols)).toEqual(['many'])
    expect(columnErrors(cols)).toEqual({})
  })

  it('⭐ AN EXPENSIVE BUT LEGAL COLUMN STILL COMPUTES — the non-vacuity control', () => {
    // Without this every case above is satisfied by "refuse everything", and the
    // suite would be green with the engine bricked.
    const legal = manyMas(6)
    const cols = computeFor(doc({ legal }), B, {}, {})
    expect(Object.keys(cols)).toEqual(['legal'])
    expect(columnErrors(cols)).toEqual({})
  })

  it('⛔ A MALFORMED TREE fails as itself, and takes nothing with it', () => {
    const cols = computeFor(doc({ ok: S('close'), junk: { type: 'nonsense' } }), B, {}, {})
    expect(Object.keys(cols)).toEqual(['ok'])
    expect(Object.keys(columnErrors(cols))).toEqual(['junk'])
  })

  it('⛔ the STEP ceiling is still enforced when a column is asked directly', () => {
    // Containment lives in `computeFor`. `interpret` itself must go on refusing,
    // or every other caller (the scan lane, the alert evaluator) loses the guard.
    expect(() => interpret(
      call('accum', N(0), op('+', S('self'), S('close')), N(250)), B, {}, DEFAULT_BUDGET,
    )).toThrow(/steps/)
  })
})
