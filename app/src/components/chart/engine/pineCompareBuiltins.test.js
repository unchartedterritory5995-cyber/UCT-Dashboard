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

describe('the built-ins measured EXACT stay exact for a Pine document (a built-in is not the operator rule)', () => {
  it('ta.crossover / highest / math.max / math.sign have no Pine variant', () => {
    for (const k of ['crossOver', 'crossUnder', 'highest', 'lowest', 'max', 'min', 'sign', 'pivotHigh', 'pivotLow', 'mode']) {
      expect(Object.prototype.hasOwnProperty.call(FN_PINE, k), k).toBe(false)
    }
    expect(Object.keys(FN_PINE).sort()).toEqual(['adx', 'falling', 'minusDI', 'percentrank', 'plusDI', 'rising'])
  })
})
