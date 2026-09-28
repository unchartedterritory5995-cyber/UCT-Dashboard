// app/src/components/chart/engine/__tests__/pineTernaryNa.test.js
//
// ─── PINE'S `?:` TAKES THE ELSE ARM WHEN ITS CONDITION IS `na` (2026-09-27) ───
//
// Vendor-pinned by `tests/fixtures/vendor/harness/pivot-point-supertrend-rddt-1d-
// 2026-09-27.json`: on bar 9 of RDDT's listing history TradingView draws 38.23456,
// which is `center - 3·atr` only if `lastpp = ph ? ph : pl ? pl : na` took `pl = 44`
// through the ELSE arm of a condition (`ph`) that was `na` on that bar. The shared
// `interpret.js::TERNARY` propagates a NaN test — the engine's cross-language
// `{0,1,NaN}` decision — so the RUNTIME lane says Pine's rule itself, on both of its
// routes: the pure columns its Resolver builds (`pine.js::pineCondition`, under the
// Resolver option `pineNaCondition`) and its own `?:` lowering beside mutable state
// (`pineRuntimeFrontend.js::irCondition`).
//
// ⛔ THE HOST LANE IS DELIBERATELY UNCHANGED. Its trees are persisted, hashed, frozen
// for the Python screener lane and read by the recurrence recognisers; applying the
// same rule there moved 55 test rows when measured (2026-09-27). That is a ruling of
// its own, queued in docs/pine/PARITY-PROGRAMME.md, and the last case below pins that
// the host still propagates, so the gap cannot close or widen unnoticed.
//
// Every expectation below is computed by hand from the bars written next to it.
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { translatePine, pineCondition, pineTruthy } from '../ast/pine'
import { interpret } from '../ast/interpret'
import { runtimeLaneColumns, runtimeLaneHandle, runtimeLaneBuild } from '../pineRuntimeLane'

afterEach(() => { vi.unstubAllEnvs() })

const REPO = path.resolve(process.cwd(), '..')
const LF = String.fromCharCode(10)
const lines = (...xs) => xs.join(LF) + LF
const H5 = lines('//@version=5', 'indicator("t")')
const H4 = lines('//@version=4', 'study("t")')
// closes 99, 101, 98, 105, 97, 102 — above 100 on bars 1, 3, 5.
const CLOSES = [99, 101, 98, 105, 97, 102]
const BARS = CLOSES.map((c, i) => ({ t: 1700000000 + i * 86400, o: c, h: c + 1, l: c - 1, c, v: 1000 }))
const CTX = { tf: 'D', newestBarIsForming: false }
const arr = (x) => Array.from(x, (v) => (Number.isFinite(v) ? v : null))

/** Host lane: the first output's tree, interpreted over BARS. */
function host(src, k = 0) {
  const t = translatePine(src)
  const out = (t.outputs || [])[k]
  expect(out && out.ast, `host lane refused: ${JSON.stringify(t.refusal || (out && out.refusal))}`).toBeTruthy()
  return arr(interpret(out.ast, BARS, {}))
}

/** Runtime lane: every plot's column, in output order, over `bars`. */
function runtime(src, bars = BARS) {
  vi.stubEnv('VITE_PINE_RUNTIME_LANE_ENABLED', '1')
  const b = runtimeLaneBuild(src)
  expect(b.ok, JSON.stringify(b.refusal)).toBe(true)
  const columns = {}
  b.outputs.forEach((o, i) => { columns[`k${i}`] = { output: i, call: o.call, line: o.line } })
  const def = { id: 'u_t', compute: { kind: 'pine', fn: runtimeLaneHandle(src), rev: 1, source: src,
    lane: { plotColours: true, ownsDrawing: false }, columns } }
  const { columns: cols, errors } = runtimeLaneColumns(def, bars, {}, CTX)
  expect(errors).toEqual({})
  return b.outputs.map((_, i) => arr(cols[`k${i}`]))
}

describe('the rule itself', () => {
  it('na and zero are false, anything else is true', () => {
    expect(pineTruthy(NaN)).toBe(false)
    expect(pineTruthy(0)).toBe(false)
    expect(pineTruthy(-0.5)).toBe(true)
    expect(pineTruthy(1)).toBe(true)
  })

  it('⭐ a condition that can never be na is left exactly as written', () => {
    // A comparison (`cmp` answers 0 against NaN), `na(x)`, and not/and/or over those
    // can never be NaN, so wrapping them would move the tree for nothing.
    for (const n of [
      { type: 'op', name: '<=', args: [] },
      { type: 'call', name: 'na', args: [] },
      { type: 'op', name: '!', args: [{ type: 'op', name: '>', args: [] }] },
      { type: 'op', name: '&&', args: [{ type: 'op', name: '>', args: [] }, { type: 'call', name: 'na', args: [] }] },
    ]) expect(pineCondition(n)).toBe(n)
    // …and anything that CAN be na is wrapped as `c != 0`.
    expect(pineCondition({ type: 'series', name: 'close' }).name).toBe('!=')
    expect(pineCondition({ type: 'op', name: '&&', args: [{ type: 'series', name: 'close' },
      { type: 'op', name: '>', args: [] }] }).name).toBe('!=')
  })
})

describe('⭐ pure `?:` in the RUNTIME lane (columns built by the Resolver under `pineNaCondition`)', () => {
  it('a float used as a condition: na → else', () => {
    // x = close when close > 100, else na  →  [na, 101, na, 105, na, 102]
    // plot(x ? 1 : 2)                      →  [2,   1,   2,  1,   2,  1]
    const [col] = runtime(H5 + lines('x = close > 100 ? close : na', 'plot(x ? 1 : 2)'))
    expect(col).toEqual([2, 1, 2, 1, 2, 1])
  })

  it('a chain reaches its second condition when the first is na — the PP SuperTrend shape', () => {
    // a = close on bars where close > 100, b = close on bars where close < 99
    //   a: [na, 101, na, 105, na, 102]   b: [na, na, 98, na, 97, na]
    // a ? a : b ? b : na  →  [na, 101, 98, 105, 97, 102]
    const [col] = runtime(H5 + lines('a = close > 100 ? close : na', 'b = close < 99 ? close : na',
      'plot(a ? a : b ? b : na)'))
    expect(col).toEqual([null, 101, 98, 105, 97, 102])
  })

  it('zero is still false (unchanged)', () => {
    const [col] = runtime(H5 + lines('z = close - close', 'plot(z ? 1 : 2)'))
    expect(col).toEqual([2, 2, 2, 2, 2, 2])
  })

  it('`iff` (v2/v3\'s ternary) reads its condition the same way', () => {
    const [col] = runtime(H4 + lines('x = close > 100 ? close : na', 'plot(iff(x, 1, 2))'))
    expect(col).toEqual([2, 1, 2, 1, 2, 1])
  })
})

describe('⭐ the runtime lane beside mutable state — its own `?:` lowering', () => {
  it('a `var` that is still na takes the else arm', () => {
    // s latches the first close above 100 (bar 1) and holds it.
    //   s: [na, 101, 101, 105, 105, 102]   plot(s ? 1 : 2) → [2, 1, 1, 1, 1, 1]
    const [col] = runtime(H5 + lines('var float s = na', 'if close > 100', '    s := close',
      'plot(s ? 1 : 2)'))
    expect(col).toEqual([2, 1, 1, 1, 1, 1])
  })

  it('a comparison against an `na` history takes the else arm and does not poison the state', () => {
    // The PP SuperTrend recurrence: t := close[1] > t[1] ? max(close, t[1]) : close.
    //   bar 0: close[1] na → else → 99      bar 1: 99 > 99? no → 101
    //   bar 2: 101 > 101? no → 98           bar 3: 98 > 98? no → 105
    //   bar 4: 105 > 105? no → 97           bar 5: 97 > 97? no → 102
    const [col] = runtime(H5 + lines('float t = na',
      't := close[1] > t[1] ? math.max(close, t[1]) : close', 'plot(t)'))
    expect(col).toEqual([99, 101, 98, 105, 97, 102])
  })
})

describe('⛔ the HOST lane is deliberately unchanged', () => {
  it('still propagates an `na` condition — the queued ruling', () => {
    // The first runtime case's script; the host answers na where Pine answers 2.
    const src = H5 + lines('x = close > 100 ? close : na', 'plot(x ? 1 : 2)')
    expect(host(src)).toEqual([null, 1, null, 1, null, 1])
    expect(translatePine(src).outputs[0].ast.args[0].name).not.toBe('!=')
  })
})

describe('⭐ on the vendor capture — PP SuperTrend\'s pivot centre on bar 9', () => {
  it('takes the pivot LOW through the else arm, as TradingView does', () => {
    const cap = JSON.parse(fs.readFileSync(path.join(REPO,
      'tests/fixtures/vendor/harness/pivot-point-supertrend-rddt-1d-2026-09-27.json'), 'utf8'))
    const bars = cap.bars.rows.map((r) => ({ t: r[0], o: r[1], h: r[2], l: r[3], c: r[4], v: r[5] }))
    // bar 5 confirms a pivot HIGH of 74.9 (bar 3's high); bar 9 a pivot LOW of 44 (bar 7's
    // low), on a bar whose `ph` is na. Pine: centre = 74.9, then (74.9·2 + 44)/3 = 64.6.
    expect(bars[3].h).toBe(74.9)
    expect(bars[7].l).toBe(44)
    const [lastpp, center] = runtime(H4 + lines('float ph = pivothigh(2, 2)', 'float pl = pivotlow(2, 2)',
      'var float center = na', 'float lastpp = ph ? ph : pl ? pl : na', 'if lastpp',
      '    if na(center)', '        center := lastpp', '    else',
      '        center := (center * 2 + lastpp) / 3', 'plot(lastpp)', 'plot(center)'), bars)
    expect(lastpp[9]).toBe(44)
    expect(center[8]).toBe(74.9)
    expect(center[9]).toBeCloseTo((74.9 * 2 + 44) / 3, 12)
  })
})
