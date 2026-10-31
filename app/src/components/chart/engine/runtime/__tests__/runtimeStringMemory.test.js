// app/src/components/chart/engine/runtime/__tests__/runtimeStringMemory.test.js
//
// ⭐⭐ PHASE 3 WS-H, ARMING ITEM S2 (2026-10-31) — A STRING IS HELD STATE, AND THE
// `MEMORY` ESTIMATE COUNTS IT.
//
// Before: `CONCAT` was a raw `x + y`, and the estimate (`vm.js`, `limits.js` MEMORY)
// counted columns, rings, collections and drawings but no text. A doubling loop
// fits 30 doublings inside one bar's instruction budget, so the run reached the
// engine's own string ceiling (`RangeError: Invalid string length`, named only
// `runtime:failed`) or the worker's heap before any NAMED limit. After: the result's
// size is peaked before the concatenation, and the same scripts stop by name,
// `MEMORY`, on the pane's `runtime:limit` guard.
//
// Real front end, lowering and VM; no mocks of the engine.
import { describe, it, expect } from 'vitest'
import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'
import { DEFAULT_LIMITS, RuntimeLimitError } from '../limits.js'
import { computeRuntimeColumns, RUNTIME_LIMIT_GUARD } from '../runtimeColumns.js'

const N = 300
const BARS = Array.from({ length: N }, (_, i) => {
  const c = 100 + 10 * Math.sin(i / 7) + i * 0.05
  return { t: 1700000000 + i * 86400, o: c - 0.5, h: c + 1, l: c - 1, c, v: 1000 + (i % 13) * 10 }
})
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const HEAD = '//@version=6\nindicator("t")\n'

function run(src) {
  const built = buildRuntimeIr(HEAD + src, { bars: BARS, inputs: {}, objectsInRun: true, tf: 'D', basePeriod: 'D' })
  if (!built.ok) throw new Error(`refused: ${built.refusal.guard} — ${built.refusal.message}`)
  const program = lowerIrProgram(built.ir)
  return execute(program, {
    bars: N, series: SERIES, columns: program.columns, confirmed: true, barTimes: BARS.map((b) => b.t),
  })
}
const stopOf = (fn) => { try { fn(); return null } catch (e) { return e } }

// 30 doublings inside ONE bar — within that bar's instruction budget.
const IN_BAR = 'var string s = "ab"\nfor i = 0 to 29\n    s := s + s\nplot(s == "zz" ? 1 : 0, "v")\n'
// one doubling per bar, carried by `var` — the slow version of the same thing.
const ACROSS_BARS = 'var string s = "ab"\ns := s + s\nplot(s == "zz" ? 1 : 0, "v")\n'
// a string that grows by ten characters a bar: legitimate, and small.
const GROWING = 'var string s = ""\ns := s + "0123456789"\nplot(s == "zz" ? 1 : 0, "v")\n'
const HELD = 'var string s = ""\nplot(s == "zz" ? 1 : 0, "v")\n'

describe('S2 — strings in the MEMORY estimate', () => {
  it('⭐ a doubling loop inside one bar stops by NAME (MEMORY), never as an engine RangeError', () => {
    const err = stopOf(() => run(IN_BAR))
    expect(err).toBeInstanceOf(RuntimeLimitError)
    expect(err.limit).toBe('MEMORY')
    expect(err.ceiling).toBe(DEFAULT_LIMITS.MEMORY)
  })

  it('⭐ a string doubled once a bar (carried by var) stops by NAME (MEMORY) too', () => {
    const err = stopOf(() => run(ACROSS_BARS))
    expect(err).toBeInstanceOf(RuntimeLimitError)
    expect(err.limit).toBe('MEMORY')
  })

  it('⭐ the pane names the stop: runtime:limit, MEMORY, and nothing is drawn', () => {
    const doc = { id: 's2', compute: { kind: 'runtime', fn: 'runtime:s2', source: HEAD + IN_BAR, outputs: { v: 0 } } }
    const err = stopOf(() => computeRuntimeColumns(doc, BARS.map((b) => ({ ...b })), { tf: 'D' }))
    expect(err).not.toBeNull()
    expect(err.guard).toBe(RUNTIME_LIMIT_GUARD)
    expect(err.message).toMatch(/MEMORY/)
  })

  it('the estimate grows with a held string: at least 2 B per character of the largest one', () => {
    const grown = run(GROWING).budget.counts.MEMORY
    const control = run(HELD).budget.counts.MEMORY
    expect(grown - control).toBeGreaterThanOrEqual(2 * 10 * N)
  })

  it('a legitimate growing string stays far below the ceiling and draws', () => {
    const r = run(GROWING)
    expect(r.budget.counts.MEMORY).toBeLessThan(DEFAULT_LIMITS.MEMORY / 100)
  })
})
