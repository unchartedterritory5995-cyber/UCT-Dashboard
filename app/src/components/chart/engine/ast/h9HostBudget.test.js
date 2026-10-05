// app/src/components/chart/engine/ast/h9HostBudget.test.js
//
// ─── ⭐⭐ H9 — TWO HOST-LANE REFUSALS THAT WERE MIS-COUNTS, NOT COSTS ──────────
//
// 1. `ta.highestbars` / `ta.lowestbars` (and v4's bare spelling) are built by
//    `negatedBars` from RESOLVED arguments, so the `int`-slot fold that
//    `resolveTableCall` gives every other Pine length never ran:
//    `highestbars(lb + rb + 1)` with both inputs at 5 reached the install door as
//    `(5 + 5) + 1` and refused `resolve:window` (`pivot-high-low-points`).
//    `pine.js::foldBarsLength`. The registration rule did not move.
// 2. `seriesRefs` counted clock columns (`time`, `dayofweek`, `periodseconds`, ...)
//    and `accum`'s `self` as BASE series, so a script reading four data columns
//    refused `budget:series` "10 > 8" (`mtf-key-levels-support-and-resistance`,
//    `vwap-fibo-dev-extensions-strategy`). `budget.js::NOT_A_BASE_SERIES`, mirrored
//    by `ast_budget.py::_NOT_A_BASE_SERIES` over the SAME fixture
//    (`tests/fixtures/ast_budget/h9_series_refs.json`, read by
//    `tests/test_ast_budget_h9.py` too).
//
// ⛔ WHAT STAYS REFUSED, because it is a real cost: a window that reads a bar
// (`close > open ? 5 : 6`) still meets `resolve:window` by name, and a
// lookback over the cap (`rsi(vwapOf(close), 16)` = 976 > 960) is unchanged.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { translatePine } from './pine.js'
import { checkBudget, seriesRefs, DEFAULT_BUDGET } from './budget.js'
import { interpret, maxLookback } from './interpret.js'

const REPO = path.resolve(process.cwd(), '..')
const FIXTURE = JSON.parse(fs.readFileSync(
  path.join(REPO, 'tests', 'fixtures', 'ast_budget', 'h9_series_refs.json'), 'utf8'))

const v5 = (body) => `//@version=5\nindicator("h9", overlay = true)\n${body}\n`
const v4 = (body) => `//@version=4\nstudy("h9", overlay = true)\n${body}\n`

function treeOf(src) {
  const out = translatePine(src)
  expect(out.ok, JSON.stringify(out.refusal)).toBe(true)
  return out.outputs[out.selected].ast
}

function findCall(tree, name) {
  const stack = [tree]
  while (stack.length) {
    const n = stack.pop()
    if (!n || typeof n !== 'object') continue
    if (n.type === 'call' && n.name === name) return n
    for (const a of n.args || []) stack.push(a)
  }
  return null
}

const N = 30
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1700000000 + i * 86400,
  o: 100 + Math.sin(i), h: 103 + Math.sin(i * 1.7) * 3, l: 97 - Math.cos(i * 1.3) * 2,
  c: 100 + Math.cos(i), v: 1000 + i,
}))

describe('⭐ H9.1 — a constant highestbars/lowestbars length is folded by the translator', () => {
  it('v4 bare `highestbars(mb)` with mb = lb + rb + 1 reaches the engine as the literal 11', () => {
    const tree = treeOf(v4('lb = input(5)\nrb = input(5)\nmb = lb + rb + 1\nplot(highestbars(mb))'))
    const call = findCall(tree, 'highestbars')
    expect(call.args[0]).toEqual({ type: 'series', name: 'high' })
    expect(call.args[1]).toEqual({ type: 'num', value: 11 })
    expect(maxLookback(tree)).toBe(11)
    expect(checkBudget(tree).ok).toBe(true)
  })

  it('v5 `ta.lowestbars(low, lb + rb + 1)` folds the same way', () => {
    const tree = treeOf(v5('lb = input.int(5)\nrb = input.int(5)\nplot(ta.lowestbars(low, lb + rb + 1))'))
    expect(findCall(tree, 'lowestbars').args[1]).toEqual({ type: 'num', value: 11 })
    expect(checkBudget(tree).ok).toBe(true)
  })

  it('the folded tree IS the literal tree, so it computes what the literal form computes', () => {
    const folded = treeOf(v5('lb = input.int(3)\nplot(ta.highestbars(high, lb * 2 + 1))'))
    const literal = treeOf(v5('plot(ta.highestbars(high, 7))'))
    expect(JSON.stringify(folded)).toBe(JSON.stringify(literal))
    expect(Array.from(interpret(folded, BARS, {})).filter(Number.isFinite).length).toBeGreaterThan(0)
  })

  it('⛔ the registration reader is UNCHANGED: an unfolded `(5 + 5) + 1` window still refuses `resolve:window`', () => {
    // The shape `pivot-high-low-points` reached the install door with before H9. The fix
    // is the translator's; the registration rule (and the repaint linter's
    // `must_repaint.json::computed_window`) did not move.
    const n = (value) => ({ type: 'num', value })
    const old = { type: 'call', name: 'highestbars', args: [{ type: 'series', name: 'high' },
      { type: 'op', name: '+', args: [{ type: 'op', name: '+', args: [n(5), n(5)] }, n(1)] }] }
    let thrown = null
    try { checkBudget(old) } catch (e) { thrown = e }
    expect(thrown && thrown.guard).toBe('resolve:window')
  })

  it('⛔ a length that reads a bar is NOT folded and still refuses by name at registration', () => {
    const tree = treeOf(v5('plot(ta.highestbars(high, close > open ? 5 : 6))'))
    expect(findCall(tree, 'highestbars').args[1].type).toBe('op')
    let thrown = null
    try { checkBudget(tree) } catch (e) { thrown = e }
    expect(thrown && thrown.guard).toBe('resolve:window')
  })

  it('⛔ a literal length is byte-identical to before (no fold needed)', () => {
    const tree = treeOf(v5('plot(ta.highestbars(high, 11))'))
    expect(findCall(tree, 'highestbars').args[1]).toEqual({ type: 'num', value: 11 })
  })
})

describe('⭐ H9.2 — `seriesRefs` counts base series, not clock columns or `self`', () => {
  it('every shared fixture case answers its expected count (the Python lane reads the same file)', () => {
    expect(FIXTURE.cases.length).toBeGreaterThan(5)
    for (const c of FIXTURE.cases) expect(seriesRefs(c.tree), c.name).toBe(c.expected)
  })

  it('the fixture records a MOVED count, so it can tell the two measurements apart', () => {
    expect(FIXTURE.cases.some((c) => c.before !== c.expected)).toBe(true)
  })

  it('the mtf-key-levels shape is inside the series cap now (it was 10 > 8)', () => {
    const c = FIXTURE.cases.find((x) => x.name.startsWith('mtf-key-levels'))
    expect(c.before).toBeGreaterThan(DEFAULT_BUDGET.maxSeriesRefs)
    const r = checkBudget(c.tree)
    expect(r.measured.maxSeriesRefs).toBe(4)
    expect(r.ok).toBe(true)
  })

  it('⛔ an undeclared name is still counted (no `resolve:name` case moves)', () => {
    expect(seriesRefs({ type: 'series', name: 'globalThis' })).toBe(1)
  })

  it('⛔ nine distinct DATA-or-undeclared names still refuse `budget:series`', () => {
    const names = ['open', 'high', 'low', 'close', 'volume', 'k1', 'k2', 'k3', 'k4']
    const tree = names.slice(1).reduce((acc, n) => ({ type: 'op', name: '+', args: [acc, { type: 'series', name: n }] }),
      { type: 'series', name: names[0] })
    const r = checkBudget(tree)
    expect(r.ok).toBe(false)
    expect(r.guard).toBe('budget:series')
  })
})
