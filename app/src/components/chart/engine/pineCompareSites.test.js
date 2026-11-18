// app/src/components/chart/engine/pineCompareSites.test.js
//
// ⭐⭐ engine 78 (#1858) — the comparison sites that have no TradingView capture of their own, each railed
// directly (coordinator, 2026-11-18): the object runtime's guards, the state narrowing the range proofs read,
// and the translator's static decision.
import { describe, it, expect } from 'vitest'
import { PINE_CMP, EXACT_CMP, PINE_EQ_EPSILON, compareNarrow } from './pineCompare.js'
import { BINARY, BINARY_PINE } from './ast/interpret.js'
import { evaluateObjects } from './objectRuntime'
import { __staticBinaryForTests as staticBinary } from './ast/pine.js'

describe('the object runtime compares a guard within the epsilon (an object program is always Pine)', () => {
  const P = (ops) => ({ programVersion: 1, regs: [{ id: 'r0', family: 'label' }], colls: [], ops })
  const GET = (prop) => ({ v: 'get', target: { r: 'reg', id: 'r0' }, prop })
  // bar 0: a label into r0 at y = node 0's value; then a second label only where `r0.y > 1`
  const prog = () => P([
    { k: 'create', family: 'label', site: 's0', into: 'r0', when: { v: 'const', value: 1 }, props: { x: { v: 'bar' }, y: { v: 'graph', node: 0 } } },
    { k: 'create', family: 'label', site: 's1', into: null, when: { v: 'cmp', op: '>', args: [GET('y'), { v: 'const', value: 1 }] }, props: { x: { v: 'bar' }, y: { v: 'const', value: 2 } } },
  ])
  const drawn = (y) => evaluateObjects(prog(), { barCount: 1, readNode: () => y, readTime: (b) => b })
    .live.map((o) => o.site).sort()
  it('a label 3e-14 above 1 is not above 1: the guarded label is not made', () => {
    expect(drawn(1.00000000000003)).toEqual(['s0'])
  })
  it('the control: clearly above, it is made', () => {
    expect(drawn(1.1)).toEqual(['s0', 's1'])
  })
})

describe('the state narrowing never drops a state the run can be in (soundness grid, both tables)', () => {
  const c = 1.0
  const offs = [-3e-10, -2.0000000000000004e-10, -1.0000000000000002e-10, -1e-10, -5e-11, -3e-14, 0,
    3e-14, 5e-11, 1e-10, 1.0000000000000002e-10, 2.0000000000000004e-10, 3e-10]
  const states = offs.map((d) => c + d)
  for (const [name, table] of [['Pine', BINARY_PINE], ['IEEE', BINARY]]) {
    for (const op of ['<', '<=', '>', '>=']) {
      for (const branch of [true, false]) {
        it(`${name} ${op} ${branch}`, () => {
          const { lo, hi } = compareNarrow(op, branch, states[0], states[states.length - 1], c, table)
          for (const s of states) {
            if ((table[op](s, c) === 1) === branch) expect(s >= lo && s <= hi, `s = ${s} dropped`).toBe(true)
          }
        })
      }
    }
  }
  it('the IEEE narrowing is today\'s, byte for byte (no slack)', () => {
    expect(compareNarrow('>', false, 0, 2, 1, BINARY)).toEqual({ lo: 0, hi: 1 })
    expect(compareNarrow('>', false, 0, 2, 1, BINARY_PINE)).toEqual({ lo: 0, hi: 1 + 2 * PINE_EQ_EPSILON })
    expect(PINE_CMP['>'](1 + 5e-11, 1)).toBe(0)
    expect(EXACT_CMP['>'](1 + 5e-11, 1)).toBe(1)
  })
})

describe('a translate-time static decision declines a pair the two rules answer differently', () => {
  it('two numbers within the epsilon are not static; every other pair is', () => {
    expect(staticBinary('>', { n: 1.00000000000003 }, { n: 1 })).toBe(null)
    expect(staticBinary('<=', { n: 0 }, { n: 1e-10 })).toBe(null)
    expect(staticBinary('>', { n: 2 }, { n: 1 })).toEqual({ b: true })
    expect(staticBinary('<', { n: 0 }, { n: 1.0000000000000002e-10 })).toEqual({ b: true })
    expect(staticBinary('>', { n: 1 }, { n: 1 })).toEqual({ b: false })
  })
})
