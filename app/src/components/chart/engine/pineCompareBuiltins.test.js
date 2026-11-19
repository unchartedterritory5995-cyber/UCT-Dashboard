// app/src/components/chart/engine/pineCompareBuiltins.test.js
//
// ⭐⭐ engine 78 (#1858) (Q-FCMP2) — the BUILT-INS that compare inside with Pine's epsilon, and the ones that
// do not, as vw-fcmp-builtins-v2 measured them; each kernel for a Pine document and, unchanged, for a native one.
// TradingView's ta.dmi readings are READ OFF the committed capture (vw-fcmp-builtins-spy-1d-2026-11-18 and
// -rddt-1d, B32-B34, every bar), with that capture's own bars (AMEX:SPY 1D from the listing, NYSE:RDDT 1D).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { computeADX } from '../indicators.js'
import { pineGt } from './pineCompare.js'
import { interpret, FN, FN_PINE, CARRIED, CARRIED_PINE } from './ast/interpret.js'
import { ARRAY_FNS } from './runtime/collections.js'

const capture = (sym) => JSON.parse(readFileSync(`../tests/fixtures/vendor/harness/vw-fcmp-builtins-${sym}-1d-2026-11-18.json`, 'utf8'))
const barsOf = (cap) => cap.bars.rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }))
const colOf = (cap, title) => {
  const at = cap.plotValues.fields.indexOf(cap.study.plots.find((p) => p.title === title).id)
  return cap.plotValues.rows.map((r) => r[at])
}
const SPY = capture('spy')
const BARS = barsOf(SPY)
/** TradingView's built-in ta.dmi(14, 14) as [DI+, DI-, ADX] per bar, read off the capture (B32-B34). */
const dmiOf = (cap) => {
  const [p, m, a] = ['B32_dmi_diplus', 'B33_dmi_diminus', 'B34_dmi_adx'].map((t) => colOf(cap, t))
  return p.map((v, i) => [v, m[i], a[i]])
}

/** Cells (bar, leg) where `r` (computeADX's shape) is not TradingView's; `null` cells (na) are not compared. */
function offCells(r, tv) {
  const off = []
  tv.forEach((row, i) => row.forEach((v, k) => {
    if (v === null) return
    const o = [r.plusDI, r.minusDI, r.adx][k][i]
    const ours = o ? o.value : NaN
    if (!(Math.abs(ours - v) <= 1e-9 * Math.max(1, Math.abs(v)))) off.push([i, k])
  }))
  return off
}

describe('ta.dmi compares +DM / -DM within the epsilon (TradingView DI+ on SPY bar 5,333 is the tie)', () => {
  const TV = dmiOf(SPY)
  const close = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b))
  it('the Pine comparison reads TradingView on EVERY bar of both committed captures (SPY 8,509, RDDT 668)', () => {
    expect(TV.filter((row) => row.every((v) => v !== null)).length).toBeGreaterThan(8400)
    expect(offCells(computeADX(BARS, 14, { gt: pineGt }), TV)).toEqual([])
    const rddt = capture('rddt')
    expect(offCells(computeADX(barsOf(rddt), 14, { gt: pineGt }), dmiOf(rddt))).toEqual([])
  })
  it('the control: IEEE is off TradingView on SPY (759 cells, from bar 5,333)', () => {
    const off = offCells(computeADX(BARS, 14), TV)
    expect(off.length).toBe(759)
    expect(Math.min(...off.map(([i]) => i))).toBe(5333)
  })
  it('the bars hold the tie: up and down moves 2.84e-14 apart on bars 5,333 and 5,453', () => {
    for (const i of [5333, 5453]) {
      const up = BARS[i].h - BARS[i - 1].h
      const down = BARS[i - 1].l - BARS[i].l
      expect(up).not.toBe(down)
      expect(Math.abs(up - down)).toBeLessThan(1e-13)
    }
  })
  it('the rail value: TradingView DI+ at SPY bar 5,333 is 27.576070967939575, and the Pine comparison reads it', () => {
    expect(TV[5333][0]).toBe(27.576070967939575)
    expect(close(computeADX(BARS, 14, { gt: pineGt }).plusDI[5333].value, TV[5333][0])).toBe(true)
  })
  it('the native ADX keeps IEEE (and so differs from bar 5,333: the control)', () => {
    const r = computeADX(BARS, 14)
    expect(close(r.plusDI[5332].value, TV[5332][0])).toBe(true)
    expect(close(r.plusDI[5333].value, TV[5333][0])).toBe(false)
  })
  it('a Pine document reaches it through FN_PINE; a native one through FN', () => {
    const h = BARS.map((b) => b.h), l = BARS.map((b) => b.l), c = BARS.map((b) => b.c)
    expect(close(FN_PINE.plusDI(h, l, c, 14)[5333], TV[5333][0])).toBe(true)
    expect(close(FN.plusDI(h, l, c, 14)[5333], TV[5333][0])).toBe(false)
  })
})

describe('ta.rising / ta.falling / ta.percentrank compare within the epsilon (B24 B25 B30, Z09 Z10 Z14)', () => {
  for (const e of [2.9976021664879227e-14, 9.000000744663339e-11]) {
    // 1, 1 + e, 1 repeating (the probe's `hs`)
    const hs = Array.from({ length: 12 }, (_, i) => (i % 3 === 1 ? 1 + e : 1))
    it(`rising(1) never fires on a ${e} step; IEEE fires on every 1 + e bar`, () => {
      expect(Array.from(FN_PINE.rising(hs, 1))).toEqual(hs.map(() => 0))
      expect(Array.from(FN.rising(hs, 1)).filter((v, i) => i % 3 === 1 && i > 0).every((v) => v === 1)).toBe(true)
      expect(Array.from(FN_PINE.falling(hs, 1))).toEqual(hs.map(() => 0))
    })
    it(`percentrank(1) on the bar after 1 + e is 100 (IEEE: 0), e = ${e}`, () => {
      const pr = FN_PINE.percentrank(hs, 1)
      const ie = FN.percentrank(hs, 1)
      for (let i = 2; i < hs.length; i += 3) {
        expect(pr[i]).toBe(100)
        expect(ie[i]).toBe(0)
      }
    })
  }
  it('the runtime lane carries the Pine kernel for rising / falling, and the host the IEEE one', () => {
    expect(CARRIED_PINE.rising.step).not.toBe(CARRIED.rising.step)
    expect(CARRIED_PINE.falling.step).not.toBe(CARRIED.falling.step)
    for (const k of Object.keys(CARRIED)) if (k !== 'rising' && k !== 'falling') expect(CARRIED_PINE[k]).toBe(CARRIED[k])
  })
  it('a Pine evaluation of the tree uses them; a native one does not', () => {
    const bars = [1, 1 + 3e-14, 1, 1 + 3e-14].map((c, t) => ({ t, o: c, h: c, l: c, c, v: 1 }))
    const tree = { type: 'call', name: 'rising', args: [{ type: 'series', name: 'close' }, { type: 'num', value: 1 }] }
    expect(Array.from(interpret(tree, bars, {}, undefined, undefined, { pineCompare: true }))).toEqual([0, 0, 0, 0])
    expect(Array.from(interpret(tree, bars, {}, undefined, undefined, {}))).toEqual([0, 1, 0, 1])
  })
})

describe('array.indexof / array.includes find a number within the epsilon (B27 B28 Z12); text stays strict', () => {
  const budget = { charge() {} }
  for (const e of [3e-14, 9e-11]) {
    it(`1 + ${e} is found at 0 in [1.0, 2.0]`, () => {
      expect(ARRAY_FNS['array.indexof'].fn([[1.0, 2.0], 1 + e], budget)).toBe(0)
      expect(ARRAY_FNS['array.includes'].fn([[1.0, 2.0], 1 + e], budget)).toBe(1)
    })
  }
  it('outside the epsilon, `na`, and text are as before', () => {
    expect(ARRAY_FNS['array.indexof'].fn([[1.0, 2.0], 1 + 3e-10], budget)).toBe(-1)
    expect(ARRAY_FNS['array.indexof'].fn([[NaN, 1.0], NaN], budget)).toBe(-1)
    expect(ARRAY_FNS['array.indexof'].fn([['a', 'b'], 'b'], budget)).toBe(1)
    expect(ARRAY_FNS['array.includes'].fn([['a'], 'a '], budget)).toBe(0)
  })
})

// ⭐ engine 81 (Q-FCMP3, vw-fcmp-arrays, run fcmp3b-2026-11-18, packet b400024aa71d: AMEX:SPY and
// NYSE:RDDT 1D from the listing, the same reading on every bar of both). TradingView's readings, row by row: the
// first describe holds the kernels' answers to the committed captures' own rows.
const ARR = (sym) => JSON.parse(readFileSync(`../tests/fixtures/vendor/harness/vw-fcmp-arrays-${sym}-1d-2026-11-18.json`, 'utf8'))
describe('the Q-FCMP3 kernels answer every row as the committed captures read it (A01-A16)', () => {
  const budget = { charge() {} }
  const e = 3e-14, z = 9e-11, far = 3e-10, s3 = [1.0, 2.0, 3.0]
  const f = (name, arr, v) => ARRAY_FNS[`array.${name}`].fn([arr, v], budget)
  const ours = [
    f('lastindexof', [1.0, 2.0, 1.0], 1.0), f('lastindexof', [1.0, 2.0, 1.0 + e], 1.0), f('lastindexof', [1.0, 2.0], 1.0 + e),
    f('lastindexof', [1.0, 2.0], 1.0 + z), f('lastindexof', [1.0, 2.0], 1.0 + far),
    f('binary_search', s3, 2.0), f('binary_search', s3, 2.0 + e), f('binary_search', s3, 2.0 - e), f('binary_search', s3, 2.0 + z),
    f('binary_search', s3, 2.0 + far), f('binary_search_leftmost', s3, 2.0 - e), f('binary_search_leftmost', s3, 2.0 - z),
    f('binary_search_rightmost', s3, 2.0 + e), f('binary_search_rightmost', s3, 2.0 + z), f('binary_search_leftmost', s3, 2.0 - far),
    f('binary_search_rightmost', s3, 2.0 + far),
  ]
  for (const sym of ['spy', 'rddt']) {
    it(`vw-fcmp-arrays-${sym}: every row, on every bar, is the kernels' answer`, () => {
      const cap = ARR(sym)
      cap.study.plots.slice(1).forEach((pl, k) => {
        const at = cap.plotValues.fields.indexOf(pl.id)
        expect(new Set(cap.plotValues.rows.map((r) => r[at])), pl.title).toEqual(new Set([ours[k]]))
      })
    })
  }
})
describe('array.lastindexof finds a number within the epsilon, from the end (A01-A05); text stays strict', () => {
  const budget = { charge() {} }
  const last = (arr, v) => ARRAY_FNS['array.lastindexof'].fn([arr, v], budget)
  it('A01 the exact control: 2', () => expect(last([1.0, 2.0, 1.0], 1.0)).toBe(2))
  it('A02 the last element is 1 + 3e-14: 2 (exact would be 0)', () => expect(last([1.0, 2.0, 1.0 + 3e-14], 1.0)).toBe(2))
  it('A03 / A04 the target is 1 + 3e-14 / 1 + 9e-11: 0 (exact would be -1)', () => {
    expect(last([1.0, 2.0], 1.0 + 3e-14)).toBe(0)
    expect(last([1.0, 2.0], 1.0 + 9e-11)).toBe(0)
  })
  it('A05 outside the epsilon: -1; an `na` element matches nothing; text is strict', () => {
    expect(last([1.0, 2.0], 1.0 + 3e-10)).toBe(-1)
    expect(last([1.0, NaN, 2.0], 2.0)).toBe(2)
    expect(last([NaN, 1.0, NaN], 1.0)).toBe(1)
    expect(last(['a', 'b', 'a'], 'a')).toBe(2)
    expect(last(['a'], 'a ')).toBe(-1)
  })
})

describe('the three binary searches stay EXACT, as measured (A06-A16): a built-in is not the operator rule', () => {
  const budget = { charge() {} }
  const s3 = [1.0, 2.0, 3.0]
  const bs = (name, v) => ARRAY_FNS[`array.${name}`].fn([s3, v], budget)
  it('binary_search: 2 is at 1 (A06); 2 + 3e-14, 2 - 3e-14 and 2 + 9e-11 are not found (A07-A09: -1, tolerant would be 1)', () => {
    expect(bs('binary_search', 2.0)).toBe(1)
    expect([2.0 + 3e-14, 2.0 - 3e-14, 2.0 + 9e-11].map((v) => bs('binary_search', v))).toEqual([-1, -1, -1])
    expect(bs('binary_search', 2.0 + 3e-10)).toBe(-1)                                             // A10
  })
  it('binary_search_leftmost of 2 - 3e-14 / 2 - 9e-11 is 0 (A11 / A12, tolerant would be 1); 2 - 3e-10: 0 (A15)', () => {
    expect([2.0 - 3e-14, 2.0 - 9e-11, 2.0 - 3e-10].map((v) => bs('binary_search_leftmost', v))).toEqual([0, 0, 0])
  })
  it('binary_search_rightmost of 2 + 3e-14 / 2 + 9e-11 is 2 (A13 / A14, tolerant would be 1); 2 + 3e-10: 2 (A16)', () => {
    expect([2.0 + 3e-14, 2.0 + 9e-11, 2.0 + 3e-10].map((v) => bs('binary_search_rightmost', v))).toEqual([2, 2, 2])
  })
})

describe('the built-ins measured EXACT stay exact for a Pine document (a built-in is not the operator rule)', () => {
  it('ta.crossover / highest / math.max / math.sign have no Pine variant', () => {
    for (const k of ['crossOver', 'crossUnder', 'highest', 'lowest', 'max', 'min', 'sign', 'pivotHigh', 'pivotLow', 'mode']) {
      expect(Object.prototype.hasOwnProperty.call(FN_PINE, k), k).toBe(false)
    }
    expect(Object.keys(FN_PINE).sort()).toEqual(['adx', 'falling', 'minusDI', 'percentrank', 'plusDI', 'rising'])
  })
})
