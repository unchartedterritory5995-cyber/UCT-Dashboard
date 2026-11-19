// app/src/components/chart/engine/pineCompare.test.js
//
// The Pine comparison authority against TradingView's own readings (Q-FCMP, Q-FCMP2), and its wiring:
// the host lane's operator table for a Pine document, IEEE for every other document, and the interval form
// the engine's range proofs read.
// ⛔ The vectors are SHARED with the Python twin (`tests/test_pine_compare.py`): one table, two
//   implementations. A vector that fails here and passes there is a lane divergence.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  PINE_CMP, EXACT_CMP, PINE_EQ_EPSILON, PINE_EQ_INCLUSIVE, pineEq, pineCompareAmbiguous, compareRange,
  compareSlack, pineConstCompareExact,
} from './pineCompare.js'
import { interpret, BINARY, BINARY_PINE, binaryFor } from './ast/interpret.js'
import { semanticsOptsFor } from './definitionSemantics.js'
import { foldScalar, NotFoldable } from './ast/bind.js'

const FIXTURE = JSON.parse(readFileSync('../tests/fixtures/ast/pine_compare_vectors.json', 'utf8'))
const NA = (v) => (v === null ? NaN : v)
const codeOf = (t, a, b) => t['=='](a, b) + 2 * t['!='](a, b) + 4 * t['<'](a, b) + 8 * t['<='](a, b)
  + 16 * t['>'](a, b) + 32 * t['>='](a, b)

describe('Q-FCMP / Q-FCMP2: the Pine compare reads what TradingView read', () => {
  it('holds a real table (a fixture that cannot distinguish is not a rail)', () => {
    expect(FIXTURE.vectors.length).toBeGreaterThan(100)
    // the exact compare must FAIL a good share of them, or the table proves nothing about tolerance
    const exactWrong = FIXTURE.vectors.filter((v) => (v.code !== undefined
      ? codeOf(EXACT_CMP, NA(v.a), NA(v.b)) !== v.code
      : EXACT_CMP['=='](NA(v.a), NA(v.b)) !== v.eq))
    expect(exactWrong.length).toBeGreaterThan(30)
    // and the edge rows must separate `<` from `<=` (E11 / E13 / E14 are 1e-10 apart, exactly)
    expect(FIXTURE.vectors.filter((v) => /^E1[134] /.test(v.id)).length).toBe(6)
  })
  for (const v of FIXTURE.vectors) {
    it(v.id, () => {
      const a = NA(v.a)
      const b = NA(v.b)
      if (v.code !== undefined) expect(codeOf(PINE_CMP, a, b)).toBe(v.code)
      else expect(PINE_CMP['=='](a, b)).toBe(v.eq)
    })
  }
})

describe('the authority is one declaration the server can read', () => {
  const src = readFileSync('src/components/chart/engine/pineCompare.js', 'utf8')
  it('declares the epsilon and the edge rule each on one line', () => {
    expect(src.match(/^export const PINE_EQ_EPSILON = ([0-9.e+-]+)$/m)?.[1]).toBe(String(PINE_EQ_EPSILON))
    expect(src.match(/^export const PINE_EQ_INCLUSIVE = (true|false)$/m)?.[1]).toBe(String(PINE_EQ_INCLUSIVE))
  })
  it('equality is exact first: Infinity == Infinity, and `na` falsifies all six', () => {
    expect(pineEq(Infinity, Infinity)).toBe(true)
    expect(pineEq(-Infinity, Infinity)).toBe(false)
    for (const op of ['>', '<', '>=', '<=', '==', '!=']) {
      expect(PINE_CMP[op](NaN, NaN)).toBe(0)
      expect(PINE_CMP[op](NaN, 1)).toBe(0)
      expect(PINE_CMP[op](1, NaN)).toBe(0)
    }
  })
  it('ambiguity is exactly "unequal doubles within the epsilon"', () => {
    expect(pineCompareAmbiguous(1.00000000000003, 1.0)).toBe(true)
    expect(pineCompareAmbiguous(1.0, 1.0)).toBe(false)
    expect(pineCompareAmbiguous(0, 1e-10)).toBe(true)
    expect(pineCompareAmbiguous(0, 1.0000000000000002e-10)).toBe(false)
    expect(pineCompareAmbiguous(NaN, 1)).toBe(false)
    expect(pineCompareAmbiguous('a', 'a ')).toBe(false)
  })
  it('the compile-time exception is v1-v4 (and no pragma), never v5 / v6', () => {
    expect([null, 1, 2, 3, 4, 5, 6].map(pineConstCompareExact)).toEqual([true, true, true, true, true, false, false])
  })
})

const tree = (name, a, b) => ({ type: 'op', name, args: [{ type: 'num', value: a }, { type: 'num', value: b }] })
const bars = [{ t: 1, o: 1, h: 1, l: 1, c: 1, v: 1 }, { t: 2, o: 1, h: 1, l: 1, c: 1, v: 1 }]
const col = (x) => Array.from(x)

describe('the host lane compares a PINE document with the epsilon, every other document exactly', () => {
  it('a Pine translation reads the tie as equal', () => {
    const opts = semanticsOptsFor({ meta: { recurrenceOrigin: 'pine', doorVersion: 9, pineVersion: 6 } })
    expect(opts).toEqual({ pineCompare: true })
    expect(binaryFor(opts)).toBe(BINARY_PINE)
    expect(col(interpret(tree('==', 1.00000000000003, 1.0), bars, {}, undefined, undefined, opts))).toEqual([1, 1])
    expect(col(interpret(tree('>', 1.00000000000003, 1.0), bars, {}, undefined, undefined, opts))).toEqual([0, 0])
    expect(col(interpret(tree('<=', 1e-10, 0), bars, {}, undefined, undefined, opts))).toEqual([1, 1])
  })
  it('a Builder "Apply" import is Pine maths too', () => {
    expect(semanticsOptsFor({ meta: { importedFrom: { dialect: 'pine', via: 'apply' } } })).toEqual({ pineCompare: true })
  })
  it('a native formula keeps IEEE comparison byte for byte', () => {
    expect(semanticsOptsFor({ meta: {} })).toEqual({})
    expect(binaryFor({})).toBe(BINARY)
    expect(col(interpret(tree('==', 1.00000000000003, 1.0), bars, {}, undefined, undefined, {}))).toEqual([0, 0])
    expect(col(interpret(tree('>', 1.00000000000003, 1.0), bars, {}, undefined, undefined, {}))).toEqual([1, 1])
  })
})

describe('the interval form agrees with the point compare on every box it is asked about', () => {
  // a dense grid of doubles around one value, inside and outside the epsilon
  const base = 1.0
  const offs = [-3e-10, -1.0000000000000002e-10, -1e-10, -9e-11, -5e-11, -1e-11, -3e-14, 0,
    3e-14, 1e-11, 5e-11, 9e-11, 1e-10, 1.0000000000000002e-10, 3e-10]
  const pts = offs.map((d) => base + d)
  const boxes = []
  for (let i = 0; i < pts.length; i += 1) for (let j = i; j < pts.length; j += 1) boxes.push({ lo: pts[i], hi: pts[j] })
  for (const table of [PINE_CMP, EXACT_CMP]) {
    for (const op of ['>', '<', '>=', '<=', '==', '!=']) {
      it(`${table === PINE_CMP ? 'Pine' : 'IEEE'} ${op}`, () => {
        let checked = 0
        for (const A of boxes.filter((_, k) => k % 7 === 0)) {
          for (const B of boxes.filter((_, k) => k % 5 === 0)) {
            const xs = pts.filter((p) => p >= A.lo && p <= A.hi)
            const ys = pts.filter((p) => p >= B.lo && p <= B.hi)
            const answers = new Set()
            for (const x of xs) for (const y of ys) answers.add(table[op](x, y))
            const r = compareRange(op, A, B, table)
            // the interval form must never say "cannot" where a point in the box can
            if (answers.has(1)) expect(r.canT).toBe(true)
            if (answers.has(0)) expect(r.canF).toBe(true)
            checked += 1
          }
        }
        expect(checked).toBeGreaterThan(100)
      })
    }
  }
  it('the slack is 0 for IEEE and the epsilon twice over for Pine', () => {
    expect(compareSlack(BINARY)).toBe(0)
    expect(compareSlack(BINARY_PINE)).toBe(2 * PINE_EQ_EPSILON)
  })
})

describe('a bind-time fold declines a pair the two rules answer differently', () => {
  const op = (name, a, b) => ({ type: 'op', name, args: [{ type: 'num', value: a }, { type: 'num', value: b }] })
  it('two numbers equal only within the epsilon are not folded; every other pair folds as before', () => {
    expect(() => foldScalar(op('==', 1.00000000000003, 1), {})).toThrow(NotFoldable)
    expect(() => foldScalar(op('>', 0, 1e-10), {})).toThrow(NotFoldable)
    expect(foldScalar(op('==', 1, 1), {})).toBe(1)
    expect(foldScalar(op('>', 2, 1), {})).toBe(1)
    expect(foldScalar(op('<', 0, 1.0000000000000002e-10), {})).toBe(1)
  })
})
