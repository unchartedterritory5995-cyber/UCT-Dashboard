// app/src/components/chart/engine/ast/objectHandleHistory.test.js
//
// ⭐⭐ `line.delete(sup[1])` — A DRAWING VARIABLE'S HISTORY.
//
// The corpus idiom is one fresh object per bar and yesterday's deleted. Before
// this, the delete's target (`sup[1]`, an `offset` node) was unaddressable, the
// delete was DROPPED and counted — 291 drops across the committed corpus — and
// under the object-only door a script drawing that way either refused or kept
// every day's object where the author kept one.
//
// Three layers carry it and each is railed on its own: the TRANSLATOR emits
// `{r:'reg', id, back}`, the VALIDATOR bounds `back`, the RUNTIME answers it from
// a ring of end-of-bar register snapshots.
import { describe, it, expect } from 'vitest'
import { translatePine } from './pine'
import { evaluateObjects } from '../objectRuntime'
import { assertObjectProgram, MAX_HANDLE_BACK } from './objectProgram'

const LF = String.fromCharCode(10)
const host = (lines) => translatePine(['//@version=5', 'indicator("t", overlay=true)', ...lines].join(LF),
  { strict: true })

/** Drive a program whose trees are all bar-index / literal arithmetic. */
function run(t, bars = 30) {
  const trees = t.objects.trees
  const ev = (n, bar) => {
    if (!n) return NaN
    if (n.type === 'num') return n.value
    if (n.type === 'series') return n.name === 'barindex' ? bar : 100 + bar
    if (n.type === 'op') {
      const a = (n.args || []).map((x) => ev(x, bar))
      if (n.name === '+') return a[0] + a[1]
      if (n.name === '-') return a[0] - a[1]
    }
    return NaN
  }
  return evaluateObjects(t.objects, {
    barCount: bars, readNode: (i, bar) => ev(trees[i], bar), readTime: (i) => i,
  })
}

describe('⭐⭐ the translator addresses `x[n]` on a drawing variable', () => {
  const t = host(['sup = line.new(bar_index - 5, low, bar_index, low)', 'line.delete(sup[1])'])

  it('emits a delete whose target reads the register ONE bar back', () => {
    const del = t.objects.ops.find((o) => o.k === 'delete')
    expect(del, JSON.stringify(t.objectDiagnostics)).toBeTruthy()
    expect(del.target).toMatchObject({ r: 'reg', back: 1 })
    expect(t.objectDiagnostics.droppedOps).toBe(0)
  })

  it('⭐ and the RUNTIME keeps exactly one line — yesterday\'s is deleted every bar', () => {
    const r = run(t)
    expect(r.status).toBe('ok')
    expect(r.live.filter((o) => o.family === 'line').length).toBe(1)
    expect(r.stats.created).toBe(30)
    expect(r.stats.deleted).toBe(29)
  })

  it('⭐ `x[2]` keeps two', () => {
    const t2 = host(['sup = line.new(bar_index - 5, low, bar_index, low)', 'line.delete(sup[2])'])
    expect(run(t2).live.filter((o) => o.family === 'line').length).toBe(2)
  })

  it('⛔ an offset that is not a whole number the translation can state is still DROPPED', () => {
    const t3 = host(['n = close > open ? 1 : 2', 'sup = line.new(bar_index - 5, low, bar_index, low)',
      'line.delete(sup[n])'])
    expect(t3.objectDiagnostics.dropReasons['delete:target']).toBe(1)
  })
})

describe('⛔ the validator bounds the ring', () => {
  const base = {
    programVersion: 1,
    regs: [{ id: 'r0', family: 'line' }],
    colls: [],
    trees: [],
    ops: [
      { k: 'create', family: 'line', site: 's1', into: 'r0', when: null,
        props: { x1: { v: 'bar' }, y1: { v: 'const', value: 1 }, x2: { v: 'bar' }, y2: { v: 'const', value: 1 } } },
      { k: 'delete', when: null, target: { r: 'reg', id: 'r0', back: 1 } },
    ],
  }
  it('accepts 0..MAX_HANDLE_BACK', () => {
    expect(() => assertObjectProgram(base)).not.toThrow()
  })
  it('refuses a fraction, a negative and one past the ceiling', () => {
    for (const back of [0.5, -1, MAX_HANDLE_BACK + 1]) {
      const p = { ...base, ops: [base.ops[0], { ...base.ops[1], target: { r: 'reg', id: 'r0', back } }] }
      expect(() => assertObjectProgram(p), String(back)).toThrow(/history/)
    }
  })
})
