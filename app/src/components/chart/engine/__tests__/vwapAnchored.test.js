// app/src/components/chart/engine/__tests__/vwapAnchored.test.js
//
// ─── ⭐⭐ e95 UNIT 2 — PINE'S ANCHORED `ta.vwap(source, anchor[, stdev_mult])`, BOTH LANES ─────────────────────
//
// TradingView's built-in VWAP reads `[_vwap, _stdevUpper, _] = ta.vwap(src, isNewPeriod, 1)` inside an `if` block;
// both lanes refused it (the host `pine:tuple` -> `pine:reassign`, the runtime `runtime:call-windowed-state`), and
// neither lane had an anchored VWAP at all. Now one accumulator (`interpret.js::vwapAnchorAccumulate`, TradingView's
// published `computeVWAP`: sums from each reset, `na` before the first), one builder (`PINE_TUPLE_BUILTINS.vwap`),
// both lanes and the Python twin (`ast_interpret._vwap_anchor_col`, `tests/test_vwap_anchor_parity.py`).
import { describe, it, expect, vi, afterEach } from 'vitest'

import { buildRuntimeIr } from '../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../runtime/lowerIr.js'
import { execute } from '../runtime/vm.js'
import { translatePine } from '../ast/pine.js'
import { parseFormula } from '../ast/parse.js'
import { interpret, FN } from '../ast/interpret.js'

const N = 80
const T0 = Date.UTC(2024, 0, 2) / 1000
const BARS = Array.from({ length: N }, (_, i) => ({
  t: T0 + i * 86400,
  o: 100 + Math.sin(i * 0.4) * 5,
  h: 106 + Math.sin(i * 0.4) * 5 + (i % 3),
  l: 95 + Math.sin(i * 0.4) * 5 - (i % 2),
  c: 100 + Math.cos(i * 0.3) * 6,
  v: 1000 + ((i * 7919) % 613),
}))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const HEAD = '//@version=6\nindicator("t", overlay = true)\n'

afterEach(() => { vi.unstubAllEnvs() })

/** the published `computeVWAP` body by hand: sums from each reset, `na` before the first */
function byHand(anchorAt, mult = 1) {
  let spv = NaN; let sv = NaN; let sppv = NaN
  return BARS.map((b, i) => {
    const p = (b.h + b.l + b.c) / 3
    if (anchorAt(i)) { spv = p * b.v; sv = b.v; sppv = b.v * (p * p) } else { spv = p * b.v + spv; sv = b.v + sv; sppv = b.v * (p * p) + sppv }
    const vwap = sv > 0 ? spv / sv : NaN
    const variance = sppv / sv - vwap * vwap
    const sd = Math.sqrt(variance < 0 ? 0 : variance)
    return { vwap, upper: vwap + sd * mult, lower: vwap - sd * mult }
  })
}
/** the host lane: every plot's column through the columnar interpreter */
function hostColumns(body) {
  const t = translatePine(`${HEAD}${body}`, { strict: true })
  expect(t.ok, JSON.stringify(t.refusal || {})).toBe(true)
  return t.outputs.map((o) => {
    expect(o.refusal, o.refusal && o.refusal.message).toBeFalsy()
    const parsed = parseFormula(o.formula)
    expect(parsed.ok, o.formula).toBe(true)
    const col = interpret(parsed.ast, BARS, {})
    return Array.from({ length: N }, (_, i) => (typeof col === 'number' ? col : col[i]))
  })
}
/** the runtime lane: the run's outputs */
function runtimeColumns(body) {
  const built = buildRuntimeIr(`${HEAD}${body}`, { bars: BARS, inputs: {} })
  expect(built.ok, built.ok ? '' : `${built.refusal.guard}: ${built.refusal.message}`).toBe(true)
  const program = lowerIrProgram(built.ir)
  const r = execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true, barTimes: BARS.map((b) => b.t) })
  return r.outputs.map((o) => Array.from(o))
}
function same(got, want, label) {
  expect(got.length).toBe(want.length)
  let finite = 0
  for (let i = 0; i < want.length; i += 1) {
    if (Number.isNaN(want[i])) expect(Number.isNaN(got[i]), `${label} bar ${i}: ours ${got[i]}, want na`).toBe(true)
    else { expect(got[i], `${label} bar ${i}`).toBe(want[i]); finite += 1 }
  }
  return finite
}

const EVERY7 = (i) => i % 7 === 3
// a per-bar anchor the run computes (a `var` it writes), so the runtime lane's own kernel answers it
const RUN_ANCHOR = 'var bool a = false\na := bar_index % 7 == 3\n'

describe('the anchored VWAP: ta.vwap(source, anchor)', () => {
  it('host lane: the published computeVWAP sums from each reset, na before the first anchor, bit for bit', () => {
    const [v] = hostColumns('plot(ta.vwap(hlc3, bar_index % 7 == 3))\n')
    const want = byHand(EVERY7).map((r) => r.vwap)
    expect(same(v, want, 'host vwap')).toBe(N - 3)
    expect(Number.isNaN(v[2]) && Number.isFinite(v[3])).toBe(true)
  })
  it('runtime lane: the same numbers from its own kernel (an anchor the run computes)', () => {
    const [v] = runtimeColumns(`${RUN_ANCHOR}plot(ta.vwap(hlc3, a))\n`)
    expect(same(v, byHand(EVERY7).map((r) => r.vwap), 'runtime vwap')).toBe(N - 3)
  })
  it('the three-value form: [vwap, upper, lower] with the bands at the multiplier, both lanes', () => {
    const body = (anchor) => `[m, u, l] = ta.vwap(hlc3, ${anchor}, 2)\nplot(m)\nplot(u)\nplot(l)\n`
    const want = byHand(EVERY7, 2)
    const h = hostColumns(body('bar_index % 7 == 3'))
    same(h[0], want.map((r) => r.vwap), 'host mid'); same(h[1], want.map((r) => r.upper), 'host upper'); same(h[2], want.map((r) => r.lower), 'host lower')
    const r = runtimeColumns(`${RUN_ANCHOR}${body('a')}`)
    same(r[0], want.map((x) => x.vwap), 'rt mid'); same(r[1], want.map((x) => x.upper), 'rt upper'); same(r[2], want.map((x) => x.lower), 'rt lower')
  })
  it('⛔ the sums run from the RESET, never from the series start (a long series stays exact)', () => {
    const col = FN.vwapAnchor(SERIES[3], Float64Array.from(BARS.map((_, i) => (i === 40 ? 1 : 0))), SERIES[4])
    expect(col[41]).toBe((BARS[40].c * BARS[40].v + BARS[41].c * BARS[41].v) / (BARS[40].v + BARS[41].v))
    expect(Number.isNaN(col[39])).toBe(true)
  })
  it('⛔ a computed source is refused by name on the host lane (what the vendor sums do with an na term is not measured)', () => {
    const t = translatePine(`${HEAD}plot(ta.vwap(ta.sma(close, 3), bar_index % 7 == 3))\n`, { strict: true })
    const out = t.outputs && t.outputs[0]
    expect((t.refusal && t.refusal.guard) || (out && out.refusal && out.refusal.guard)).toBe('pine:arity')
  })
  it('the one-argument session VWAP is untouched (a control)', () => {
    const t = translatePine(`${HEAD}plot(ta.vwap(close))\n`, { strict: true })
    expect(t.outputs[0].formula).toMatch(/vwapOf\(/)
  })
})
