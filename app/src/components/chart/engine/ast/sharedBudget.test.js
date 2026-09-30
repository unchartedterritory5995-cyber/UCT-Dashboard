// app/src/components/chart/engine/ast/sharedBudget.test.js
//
// ─── ⭐⭐ C19 — THE NODE BUDGET COUNTS WHAT THE EVALUATOR COMPUTES ────────────
//
// Integrator ruling (2026-09-30): `budget:nodes` (the 128-node cap, NOT raised)
// may count a SHARED subtree ONCE, but only where the evaluator genuinely
// evaluates it once; a subtree textually repeated but evaluated separately still
// counts every time. So the count is built from the keys the evaluator's own
// memos use (`interpret.js::evaluationUnits`), and each rail below pairs the
// COUNT with a measurement of the WORK (`opts.stepSink` records every recurrence
// that actually runs), so the two cannot drift apart:
//   1. a shape the evaluator shares is one unit AND runs once — within a tree,
//      and across a pass (`crossMemo`, the object lane's interned pass);
//   2. a shape it does NOT share counts every time AND runs every time — under
//      another `tf` scope, and an operator reading `self` under two recurrences;
//   3. the step memo shares by SHAPE, not by object, so a document whose
//      objects were never shared (a V1 save read back from JSON) pays for the
//      one unit it is charged, not for every path to it.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { interpret, nodeCount, structuralMaps, TableRefusal } from './interpret'
import { checkBudget, DEFAULT_BUDGET } from './budget'

const bars = Array.from({ length: 60 }, (_, i) => {
  const d = new Date(Date.UTC(2024, 0, 1) + i * 86400000).toISOString().slice(0, 10)
  return { t: d, o: 100 + i, h: 101 + i, l: 99 + i, c: 100 + i + (i % 3), v: 1 + (i % 5) }
})
const num = (value) => ({ type: 'num', value })
const series = (name) => ({ type: 'series', name })
const op = (name, ...args) => ({ type: 'op', name, args })
const accum = (seed, body, w) => ({ type: 'call', name: 'accum', args: [seed, body, num(w)] })
const weekly = (x) => ({ type: 'tf', value: 'W', args: [x] })
const clone = (x) => JSON.parse(JSON.stringify(x))
const distinct = (t) => structuralMaps(t).distinct

/** A left-leaning sum of `n` different terms `close * k` — `3n` units, none shared (`close`, n literals, n products, n − 1 sums). */
function wide(n, k0 = 1) {
  let t = op('*', series('close'), num(k0))
  for (let k = k0 + 1; k < k0 + n; k += 1) t = op('+', t, op('*', series('close'), num(k)))
  return t
}

describe('C19 — a shape the evaluator shares counts once AND runs once', () => {
  it('⭐ within one tree: two copies of one accumulator are one set of units and ONE run', () => {
    const acc = () => accum(num(0), op('+', series('self'), series('close')), 20)
    const tree = op('+', acc(), op('*', acc(), num(2)))
    // counted once: the accumulator's 6 units once, plus `+`, `*` and `2`
    expect(nodeCount(tree)).toBe(nodeCount(acc()) + 3)
    expect(nodeCount(tree)).toBe(distinct(tree))
    const sink = []
    interpret(tree, bars, {}, undefined, undefined, { tf: 'D', stepSink: sink })
    expect(sink).toHaveLength(1)
  })

  // the object lane interns its trees, so a subtree two trees share is ONE object;
  // `shared` is 120 units, `first` 121 (under the cap), `second` 144 standalone
  const sharedPair = () => {
    const shared = op('+', wide(38), accum(num(0), op('+', series('self'), series('volume')), 10))
    return { shared, first: op('>', shared, num(0)), second: op('<', shared, wide(8, 200)) }
  }

  it('⭐ across a pass: a column the pass already holds costs ONE read, and does not run again', () => {
    const { first, second } = sharedPair()
    const memo = new Map()
    const sink = []
    interpret(first, bars, {}, undefined, undefined, { tf: 'D', crossMemo: memo, stepSink: sink })
    expect(sink).toHaveLength(1)
    expect(nodeCount(second)).toBeGreaterThan(DEFAULT_BUDGET.maxNodes)
    // `<`, ONE read of the held `shared`, and `wide(8, 200)`'s 24 — nothing below the held node
    expect(nodeCount(second, memo)).toBe(26)
    expect(checkBudget(second, null, memo).ok).toBe(true)
    // …and the work agrees: the held accumulator does not run a second time
    const col = interpret(second, bars, {}, undefined, undefined, { tf: 'D', crossMemo: memo, stepSink: sink })
    expect(sink).toHaveLength(1)
    expect(col[59]).toBe(1) // 741·close + a small sum is below 1628·close
  })

  it('⛔ …and without the pass it is refused at `budget:nodes`, the cap unmoved', () => {
    const { second } = sharedPair()
    let err = null
    try { interpret(second, bars, {}, undefined, undefined, { tf: 'D' }) } catch (e) { err = e }
    expect(err).toBeInstanceOf(TableRefusal)
    expect(err.guard).toBe('budget:nodes')
    expect(err.message).toMatch(/measures 144 and the cap is 128/)
  })

  it('⛔ a tree whose OWN new work is over the cap is still refused, whatever the pass holds', () => {
    const memo = new Map()
    const held = wide(10)
    interpret(held, bars, {}, undefined, undefined, { tf: 'D', crossMemo: memo })
    const tree = op('+', held, wide(45, 100)) // 135 new units beside one held read
    expect(nodeCount(tree, memo)).toBeGreaterThan(DEFAULT_BUDGET.maxNodes)
    expect(() => interpret(tree, bars, {}, undefined, undefined, { tf: 'D', crossMemo: memo }))
      .toThrow(/exceeds the node budget/)
  })

  it('⛔ a held shape is free only when EVERY object of it is held: an un-held twin computes', () => {
    const memo = new Map()
    const a = wide(10)
    interpret(a, bars, {}, undefined, undefined, { tf: 'D', crossMemo: memo })
    // the same shape as a SECOND object, not in the memo: the evaluator may reach it first
    const tree = op('+', a, clone(a))
    expect(nodeCount(tree, memo)).toBe(nodeCount(tree))
  })
})

describe('C19 — a shape the evaluator does NOT share counts every time AND runs every time', () => {
  it('⛔ under another `tf` scope: the same accumulator on the chart and on weekly bars is two', () => {
    const acc = () => accum(num(0), op('+', series('self'), series('close')), 3)
    const tree = op('-', acc(), weekly(acc()))
    // the weekly child is a fresh `interpret` on other bars, with a memo of its own
    expect(nodeCount(tree)).toBe(2 * nodeCount(acc()) + 2)
    expect(nodeCount(tree)).toBeGreaterThan(distinct(tree))
    const sink = []
    interpret(tree, bars, {}, undefined, undefined, { tf: 'D', stepSink: sink })
    expect(sink).toHaveLength(2)
    expect(new Set(sink.map((r) => r.bars))).toEqual(new Set([60, sink.find((r) => r.bars !== 60).bars]))
    expect(sink.some((r) => r.bars < 60)).toBe(true) // one run on the weekly bars
  })

  it('⛔ …and a pass memo does not reach into it: a held chart column is not held on weekly bars', () => {
    const memo = new Map()
    const x = wide(5)
    interpret(x, bars, {}, undefined, undefined, { tf: 'D', crossMemo: memo })
    expect(memo.has(x)).toBe(true)
    const tree = weekly(x)
    expect(nodeCount(tree, memo)).toBe(nodeCount(tree))
  })

  it('⛔ reading a recurrence bind: `self + 1` under two recurrences is two computations', () => {
    const count = (cond) => accum(num(0), op('?:', cond, op('+', series('self'), num(1)), num(0)), 20)
    const up = count(op('>', series('close'), series('open')))
    const down = count(op('<', series('close'), series('open')))
    const tree = op('-', up, down)
    // `self + 1` is one SHAPE, but a computation per recurrence: +1 over distinct.
    // The bind read `self` computes nothing (a slot of the step's history), so
    // like a literal it is one unit per shape.
    expect(nodeCount(tree)).toBe(distinct(tree) + 1)
    // the reads `0`, `close`, `open`, `1`, `20` and `self` are shared; `-` is new
    expect(nodeCount(tree)).toBe(nodeCount(up) + nodeCount(down) - 6 + 1)
    const sink = []
    interpret(tree, bars, {}, undefined, undefined, { tf: 'D', stepSink: sink })
    expect(sink).toHaveLength(2)
  })
})

describe('C19 — the step memo shares by SHAPE, so an unshared document pays what it is charged', () => {
  it('⭐ a 14-deep DAG spine read back from JSON (no shared objects) still steps in linear time', () => {
    // C12r's rail builds this DAG from SHARED objects. A V1 document saved and
    // read back has none: every path is its own object, 2^15 nodes. Charged 44
    // units, it must cost 44 per step — keyed on the object, a step walked every
    // path (over 400M visits here, far past the timeout).
    let s = series('self')
    for (let k = 0; k < 14; k += 1) s = op('/', op('+', s, s), num(2))
    const tree = clone(accum(num(1), s, 250))
    expect(nodeCount(tree)).toBe(distinct(tree))
    expect(nodeCount(tree)).toBeLessThan(DEFAULT_BUDGET.maxNodes)
    const long = Array.from({ length: 300 }, (_, i) => bars[i % bars.length])
    const col = interpret(tree, long, {}, undefined, undefined, { tf: 'D' })
    expect(col[299]).toBe(1)
    expect(col[250]).toBe(1)
  }, 20000)
})

describe('C19 — ONE fixture, both lanes: the same trees, the same units', () => {
  // `tests/test_ast_c19_shared_budget.py` asserts the SAME numbers off the SAME
  // file, so a unit the JS lane counts and the Python lane does not (or the
  // reverse) is a red rail rather than a formula the builder accepts and the
  // backend refuses — the drift `node_count`'s own docstring records once.
  const FIXTURE = path.resolve(process.cwd(), '..', 'tests/fixtures/ast/c19_units.json')
  const doc = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))
  it('non-vacuity: the fixture holds cases, and at least one where units and distinct differ', () => {
    expect(doc.cases.length).toBeGreaterThanOrEqual(4)
    expect(doc.cases.some((c) => c.units !== c.distinct)).toBe(true)
  })
  for (const c of doc.cases) {
    it(c.name, () => {
      expect(nodeCount(c.tree)).toBe(c.units)
      expect(distinct(c.tree)).toBe(c.distinct)
    })
  }
})
