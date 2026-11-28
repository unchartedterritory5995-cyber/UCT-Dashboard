// app/src/components/chart/engine/runtime/__tests__/staticStartFree.test.js
//
// ⭐⭐ E104 (2026-11-28, DEEPVUE) — THE STATIC START-FREE PROOF (`startFreeProof.js`, `runtimeColumns.js::computeStaticStartFree`).
// A runtime program whose value on bar i reads only rows[i-R .. i] is drawn off the listing from bar R on; anything the
// walker cannot prove keeps the refusal it had. These rails hold:
//   * the walker's verdicts over hand-written programs: windowed means and extremes, offsets and their sums are
//     start-free with the reach the tree sums to; `var`, a carried kernel (`ta.ema`), a recursion through history, a
//     read of `bar_index`, a window inside a branch, an `na`-able condition are not;
//   * the release: off the listing, every bar from R on equals a run from the listing, bar for bar, and bars before R
//     are withheld (`withheldBars: R`);
//   * the switch is OFF by default, and off it nothing changes (the CONTROL that the release is what moved).
import { describe, it, expect, afterEach } from 'vitest'
import SRC from '../runtimeColumns.js?raw'
import {
  computeRuntimeColumns, resetRuntimeSessions, setStaticStartFreeEnabled, RUNTIME_HISTORY_GUARD,
} from '../runtimeColumns.js'
import { runtimeWarmupOf } from '../runtimeObjects.js'
import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { startFreeProofOf } from '../startFreeProof.js'

afterEach(() => { setStaticStartFreeEnabled(false); resetRuntimeSessions() })

const FULL = 1500
const bars = Array.from({ length: FULL }, (_, i) => {
  const c = 100 + 5 * Math.sin(i / 11) + i * 0.01
  return { t: 1500000000 + i * 86400, o: c - 0.3, h: c + 1 + (i % 7) * 0.1, l: c - 1, c, v: 1000 + (i % 13) * 10 }
})
const D = { tf: 'D', newestBarIsForming: false }
const doc = (body, outputs = { v: 0 }) => ({ id: 'u_sf', meta: { runtimeHistory: 'listing' },
  compute: { kind: 'runtime', fn: 'runtime:u_sf', outputs, source: `//@version=6\nindicator("sf")\n${body}` } })
const proofOf = (body) => {
  const built = buildRuntimeIr(`//@version=6\nindicator("sf")\n${body}`, { bars })
  expect(built.ok, JSON.stringify(built.refusal)).toBe(true)
  return startFreeProofOf(built.ir)
}
const refusedWith = (fn) => { try { fn(); return null } catch (e) { return e } }

describe('the walker', () => {
  const START_FREE = [
    ['a windowed mean', 'plot(ta.sma(close, 20))', 19],
    ['an extreme of a windowed mean', 'm = ta.sma(close, 10)\nplot(ta.highest(m, 5))', 13],
    ['an offset', 'plot(close[3] - close)', 3],
    ['a ratio of two windows', 'plot(ta.sma(close, 20) / ta.sma(close, 50))', 49],
    ['a history read of a windowed local', 'm = ta.sma(close, 10)\nplot(m - m[2])', 11],
    ['a condition over windows', 'up = close > ta.sma(close, 30)\nplot(up ? 1 : 0)', 29],
  ]
  for (const [what, body, reach] of START_FREE) {
    it(`⭐ start-free: ${what} (reach ${reach})`, () => {
      expect(proofOf(body)).toEqual({ startFree: true, reach })
    })
  }
  const NOT = [
    ['a `var`', 'var float hi = 0.0\nhi := math.max(hi, high)\nplot(hi)', /var/],
    ['a carried kernel (ta.ema)', 'plot(ta.ema(close, 20))', /carried|ema/],
    ['a recursion through history', 'float x = 0.0\nx := nz(x[1]) + close\nplot(x)', /settle|ceiling|history|var/],
    ['a read of bar_index', 'plot(bar_index)', /bar_?index|reads|column|expression/],
    ['a window inside a branch', 'float x = na\nif close > open\n    x := ta.sma(close, 5)\nplot(x)', /branch/],
    ['an na-able condition', 'r = close / (high - high)\nplot(r > 1 and r < 2 ? 1 : 0)', /na/],
  ]
  for (const [what, body, why] of NOT) {
    it(`⛔ not start-free: ${what}`, () => {
      const p = proofOf(body)
      expect(p.startFree).toBe(false)
      expect(p.why).toMatch(why)
    })
  }
})

describe('the release', () => {
  it('the module starts with the release switched off', () => {
    expect(SRC).toMatch(/^let _staticStartFreeOn = false$/m)
  })

  it('CONTROL — off, a start-free program off the listing is refused by name as before', () => {
    const err = refusedWith(() => computeRuntimeColumns(doc('plot(ta.sma(close, 20))'), bars.slice(500),
      { ...D, historyFromListing: false }))
    expect(err && err.guard).toBe(RUNTIME_HISTORY_GUARD)
  })

  it('⭐ on, every bar from the reach on equals the run from the listing; the bars before it are withheld', () => {
    setStaticStartFreeEnabled(true)
    const def = doc('m = ta.sma(close, 20)\nplot(ta.highest(m, 5) - m[3])')
    const truth = computeRuntimeColumns(def, bars, { ...D, historyFromListing: true }).v
    const K = 600
    const got = computeRuntimeColumns(def, bars.slice(K), { ...D, historyFromListing: false })
    const w = runtimeWarmupOf(got)
    expect(w).toMatchObject({ withheldBars: 23, startFree: 'static' })
    for (let i = 0; i < 23; i += 1) expect(Number.isNaN(got.v[i]), `bar ${i} withheld`).toBe(true)
    let compared = 0
    for (let i = 23; i < got.v.length; i += 1) { expect(got.v[i], `bar ${i}`).toBe(truth[K + i]); compared += 1 }
    expect(compared).toBe(FULL - K - 23)
  })

  it('⛔ on, a program it cannot prove keeps the refusal, with the proof\'s reason', () => {
    setStaticStartFreeEnabled(true)
    const err = refusedWith(() => computeRuntimeColumns(doc('plot(ta.ema(close, 20))'), bars.slice(500),
      { ...D, historyFromListing: false }))
    expect(err && err.guard).toBe(RUNTIME_HISTORY_GUARD)
    expect(String(err.message)).toMatch(/not provably start-free/)
  })
})
