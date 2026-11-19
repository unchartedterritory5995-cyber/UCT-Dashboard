// app/src/components/chart/engine/hostLaneCost.test.js
//
// ⭐⭐ ROUTE BY COST (Engine 73 (#1711)) — the host lane's recurrence estimate and its budget
// (`hostLaneCost.js`, `ast/interpret.js::recurrenceStepsPerBar`), railed. Evidence:
// docs/pine/evidence/2026-11-17-host-lane-cost/EVIDENCE.md.
import { describe, it, expect } from 'vitest'
import { recurrenceStepsPerBar, evaluationUnits } from './ast/interpret'
import {
  hostLaneCostOf, HOST_RECURRENCE_STEP_BUDGET, HOST_COST_REFERENCE_BARS, LONG_TASK_MS, CHEAPEST_MEASURED_STEP_NS,
} from './hostLaneCost'

const num = (value) => ({ type: 'num', value })
const series = (name) => ({ type: 'series', name })
const op = (name, ...args) => ({ type: 'op', name, args })
const call = (name, ...args) => ({ type: 'call', name, args })
const accum = (seed, body, w) => call('accum', seed, body, num(w))
const astDoc = (trees) => ({ id: 'u_cost', compute: { kind: 'ast', trees } })

describe('recurrenceStepsPerBar — the bounded window, in the evaluator\'s own units', () => {
  it('one `var`: its warm-up times what one step computes', () => {
    // `self + close`: the `+` is computed each step; `self` and `close` are reads (no unit of work)
    expect(recurrenceStepsPerBar(accum(num(0), op('+', series('self'), series('close')), 250))).toBe(250)
    // a body of three computed nodes, `max(self, close) + (close - open)`: `max`, `+`, and `close - open`?
    // `close - open` reads no bind: a self-free column, memoised once, NOT a step's work
    const body = op('+', call('max', series('self'), series('close')), op('-', series('close'), series('open')))
    expect(recurrenceStepsPerBar(accum(num(0), body, 250))).toBe(2 * 250)
  })

  it('a tree with no recurrence costs no recurrence steps (window work is not counted here)', () => {
    expect(recurrenceStepsPerBar(call('sma', series('close'), num(20)))).toBe(0)
    expect(recurrenceStepsPerBar(op('+', series('close'), num(1)))).toBe(0)
  })

  it('the SAME recurrence read twice counts once, as the evaluator memoises it', () => {
    const mk = () => accum(num(0), op('+', series('self'), series('close')), 250)
    expect(recurrenceStepsPerBar(op('+', mk(), op('*', mk(), num(2))))).toBe(250)
    // control: two DIFFERENT recurrences count twice
    const other = accum(num(0), op('+', series('self'), series('high')), 250)
    expect(recurrenceStepsPerBar(op('+', mk(), other))).toBe(500)
  })

  it('a recurrence fed by another counts both, each at its own warm-up', () => {
    const inner = accum(num(0), op('+', series('self'), series('close')), 100)
    const outer = accum(num(0), op('+', series('self'), inner), 300)
    expect(recurrenceStepsPerBar(outer)).toBe(100 + 300)
  })

  it('the tally changes no unit count (`budget:nodes` reads the same number)', () => {
    const t = op('+', accum(num(0), op('+', series('self'), series('close')), 250), call('sma', series('close'), num(5)))
    const plain = evaluationUnits(t).count
    const tallied = evaluationUnits(t, undefined, new Map()).count
    expect(tallied).toBe(plain)
    expect(plain).toBeGreaterThan(0)
  })
})

describe('the budget — a long task at the cheapest measured step, derived, never typed', () => {
  it('is LONG_TASK_MS / CHEAPEST_MEASURED_STEP_NS, over 5,000 bars', () => {
    expect(LONG_TASK_MS).toBe(50)
    expect(CHEAPEST_MEASURED_STEP_NS).toBe(18.5)
    expect(HOST_COST_REFERENCE_BARS).toBe(5000)
    expect(HOST_RECURRENCE_STEP_BUDGET).toBe(Math.floor((LONG_TASK_MS * 1e6) / CHEAPEST_MEASURED_STEP_NS))
    expect(HOST_RECURRENCE_STEP_BUDGET).toBe(2702702)
  })

  it('a document is over only past the budget: 540 steps a bar stays, 541 moves', () => {
    const at = (w) => astDoc({ p: accum(num(0), op('+', series('self'), series('close')), w) })
    const under = hostLaneCostOf(at(540))
    expect(under).toMatchObject({ stepsPerBar: 540, steps: 540 * 5000, over: false })
    const over = hostLaneCostOf(at(541))
    expect(over).toMatchObject({ stepsPerBar: 541, steps: 541 * 5000, over: true })
  })

  it('the document\'s trees are one pass: a recurrence two plots share counts once', () => {
    const mk = () => accum(num(0), op('+', series('self'), series('close')), 400)
    const shared = hostLaneCostOf(astDoc({ a: mk(), b: op('*', mk(), num(2)) }))
    expect(shared.stepsPerBar).toBe(400)
    expect(shared.over).toBe(false)
    const two = hostLaneCostOf(astDoc({ a: mk(), b: accum(num(0), op('+', series('self'), series('low')), 400) }))
    expect(two.stepsPerBar).toBe(800)
    expect(two.over).toBe(true)
  })

  it('anything that is not a host document is never over', () => {
    expect(hostLaneCostOf({ compute: { kind: 'runtime', source: 'x' } }).over).toBe(false)
    expect(hostLaneCostOf(null).over).toBe(false)
    expect(hostLaneCostOf(astDoc({})).over).toBe(false)
  })

  it('a tree the estimate cannot read stays on the host lane, said', () => {
    const bad = astDoc({ p: call('accum', num(0), op('+', series('self'), series('close')), series('close')) })
    const r = hostLaneCostOf(bad)
    expect(r.over).toBe(false)
    expect(r.unreadable).toBe(true)
  })
})
