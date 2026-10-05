// app/src/components/chart/engine/ast/f9WmaRuleA.test.js
//
// ─── F9 — `ta.wma` FIRST ANSWERS ON ITS n-TH FINITE INPUT (rule A), host lane ──
//
// CAP4 `vw-rt8-runtime-followups-rddt-1d-2026-10-04` (Q-RT8a): over a source finite
// on bars 0-2, `na` on 3-19 and finite from 20, TradingView's `ta.wma(src, 10)`
// first answers on bar 26 (W01); finite on bar 0 only then from 50, on bar 58 (W03).
// `interpret.js::rolling` (`finiteSeen`) and its Python twin
// `ast_interpret.py::_rolling` (`tests/test_f9_wma_rule_a.py`, the same trees and
// bars) — the runtime lane's `vm.js` OP.WINDOW `ffill` already answered so.
import { describe, it, expect } from 'vitest'
import { interpret } from './interpret'

const N = 80
const BARS = Array.from({ length: N }, (_, i) => {
  const c = 50 + (i % 7) * 1.5 + i * 0.1
  const d = new Date(Date.UTC(2025, 0, 6))
  d.setUTCDate(d.getUTCDate() + i)
  return { t: d.toISOString().slice(0, 10), o: c - 0.5, h: c + 1, l: c - 1, c, v: 1000 }
})
const num = (value) => ({ type: 'num', value })
const NA = { type: 'op', name: '/', args: [num(0), num(0)] }
const bi = { type: 'series', name: 'barindex' }
const close = { type: 'series', name: 'close' }
const lt = (k) => ({ type: 'op', name: '<', args: [bi, num(k)] })
const eq = (k) => ({ type: 'op', name: '==', args: [bi, num(k)] })
const tern = (c, a, b) => ({ type: 'op', name: '?:', args: [c, a, b] })
const wma = (x, n) => ({ type: 'call', name: 'wma', args: [x, num(n)] })
const W01 = wma(tern(lt(3), close, tern(lt(20), NA, close)), 10)
const W03 = wma(tern(eq(0), num(0), tern(lt(50), NA, close)), 10)
const firstFinite = (col) => Array.from(col).findIndex((v) => Number.isFinite(v))

describe('F9 — wma rule A on the host lane', () => {
  it('⭐ W01: finite 0-2, na 3-19, finite from 20 → first answer on bar 26 (the 10th finite input)', () => {
    expect(firstFinite(interpret(W01, BARS))).toBe(26)
  })
  it('⭐ W03: finite on bar 0, na to 49, finite from 50 → first answer on bar 58', () => {
    expect(firstFinite(interpret(W03, BARS))).toBe(58)
  })
  it('the hole is still the last finite value at its own weight once answering (the measured fill)', () => {
    const col = interpret(W01, BARS)
    const src = BARS.map((b, i) => (i < 3 || i >= 20 ? b.c : NaN))
    const filled = []
    let carry = NaN
    for (const v of src) { if (Number.isFinite(v)) carry = v; filled.push(carry) }
    const at = 26
    let num_ = 0
    let den = 0
    for (let k = 0; k < 10; k += 1) { num_ += filled[at - 9 + k] * (k + 1); den += k + 1 }
    expect(col[at]).toBeCloseTo(num_ / den, 10)
  })
  it('control: a source finite from bar 0 answers on bar n - 1, as before', () => {
    expect(firstFinite(interpret(wma(close, 10), BARS))).toBe(9)
  })
})
