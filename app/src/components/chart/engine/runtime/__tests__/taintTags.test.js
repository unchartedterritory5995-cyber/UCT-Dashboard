// app/src/components/chart/engine/runtime/__tests__/taintTags.test.js
//
// ─── START-TAINT PART 2: the tag algebra (`../taintTags.js`), every pair of tags ─────────────────────────────────────
// C clean, O offset (`bar_index`: clean up to the number of bars before our first bar), T tainted. The O rules are
// the coordinator's (2026-11-27): O +- C -> O, O - O -> C, O cmp O -> C, every other use of an O is T.
import { describe, it, expect } from 'vitest'

import { TAG, tStrict, tAdd, tSub, tCmp, tVal, tRange, columnTagOf, columnTagsOf, branchTableOf } from '../taintTags.js'
import { OP } from '../program.js'

const { C, O, T } = TAG
const ALL = [C, O, T]
/** the table of `f` over every pair, as `x y -> r` strings */
const table = (f) => ALL.flatMap((x) => ALL.map((y) => `${'COT'[x]}${'COT'[y]}>${'COT'[f(x, y)]}`)).join(' ')

describe('the tag algebra', () => {
  it('+ : C+C C, O+C O, C+O O, O+O T (twice the offset), anything with T is T', () => {
    expect(table(tAdd)).toBe('CC>C CO>O CT>T OC>O OO>T OT>T TC>T TO>T TT>T')
  })
  it('- : O-C O, O-O C (the offsets cancel), C-O T (minus the offset)', () => {
    expect(table(tSub)).toBe('CC>C CO>T CT>T OC>O OO>C OT>T TC>T TO>T TT>T')
  })
  it('cmp : C cmp C and O cmp O are C; O against a C number is T', () => {
    expect(table(tCmp)).toBe('CC>C CO>T CT>T OC>T OO>C OT>T TC>T TO>T TT>T')
  })
  it('any other operator, and an O used as a plain value, is T', () => {
    expect(table(tStrict)).toBe('CC>C CO>T CT>T OC>T OO>T OT>T TC>T TO>T TT>T')
    expect(ALL.map(tVal)).toEqual([C, T, T])
    expect(tRange(Uint8Array.from([0, 0, 0]), 0, 3)).toBe(C)
    expect(tRange(Uint8Array.from([0, 1, 0]), 0, 3)).toBe(T)
    expect(tRange(Uint8Array.from([2, 0, 0]), 1, 3)).toBe(C)
  })
})

describe('a column\'s tag from its folded tree (part 2: one per column)', () => {
  const s = (name) => ({ type: 'series', name })
  const num = (value) => ({ type: 'num', value })
  const op = (name, ...args) => ({ type: 'op', name, args })
  it('bar_index and last_bar_index are O', () => {
    expect(columnTagOf(s('barindex'))).toBe(O)
    expect(columnTagOf(s('lastbarindex'))).toBe(O)
  })
  it('the bar\'s own prices, numbers and pointwise operators over them are C', () => {
    expect(columnTagOf(s('close'))).toBe(C)
    expect(columnTagOf(op('/', num(0), num(0)))).toBe(C)
    expect(columnTagOf(op('>', s('close'), s('open')))).toBe(C)
  })
  it('anything else is T (fail closed): a window, an offset, barstate.isfirst, bar_index in an expression', () => {
    expect(columnTagOf({ type: 'call', name: 'sma', args: [s('close'), num(3)] })).toBe(T)
    expect(columnTagOf({ type: 'offset', value: 3, args: [s('close')] })).toBe(T)
    expect(columnTagOf(s('isfirst'))).toBe(T)
    expect(columnTagOf(op('-', s('barindex'), num(5)))).toBe(T)
    expect(columnTagOf(op('-', s('close'), s('barindex')))).toBe(T)
    expect(columnTagOf(null)).toBe(T)
  })
  it('columnTagsOf keeps column order', () => {
    expect(Array.from(columnTagsOf([s('close'), s('barindex'), s('isfirst')]))).toEqual([C, O, T])
  })
})

describe('the implicit-flow table', () => {
  it('each branch pc holds its join and write set; every other pc is -2', () => {
    // 0 cond; 1 JIF -> 3; 2 store persist 0; 3 HALT
    const p = { code: Int32Array.from([OP.READ_SERIES, 3, 0, OP.JUMP_IF_FALSE, 3, 0, OP.STORE_PERSIST, 0, 0, OP.HALT, 0, 0]),
      functions: [], callSites: [], requests: [] }
    const t = branchTableOf(p)
    expect(Array.from(t.brJoin)).toEqual([-2, 3, -2, -2])
    expect(t.brW[1].persist).toEqual([0])
    expect(branchTableOf(p)).toBe(t)   // once per program
  })
})
