// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.f7HostWmaWarmup.test.js
//
// ─── ⭐⭐ F7 (step 93) — the HOST lane's FFILL warm-up is the RUNTIME lane's ──────
//
// RT8 taught the runtime VM `ta.wma`'s witnessed warm-up: a hole in the lookback is
// the last finite input at its own weight, the answer is `na` on an `na` bar, and
// the FIRST answer is on the n-th FINITE input. The host lane's `rolling` FFILL
// answered once its filled window was full (from bar 89 on trend-targets' shape).
// Now both lanes run one rule (`interpret.js::rolling`, `ast_interpret.py::_rolling`).
//
// Evidence, stated per block:
//   · trend-targets-algoalpha NYSE:RDDT 1D FROM THE LISTING (`history.startsAtBar0`):
//     the wma's INPUT is taken from the runtime lane's own run of the script's
//     supertrend on the capture's bars (finite on bar 0 = 0, `na` to 88, finite
//     from 89 — the shape RT8 solved from TradingView's numbers); the HOST lane's
//     `FN.wma` / `FN.ema` over it are graded against TradingView's `Baseline`.
//   · host vs VM on synthetic gappy warm-ups: equal on every bar (one rule).
//   · JS vs Python: `tests/fixtures/ast/ffill_warmup_parity.json` (this file
//     asserts the JS lane writes it; `tests/test_ast_ffill_warmup_parity.py` the
//     Python lane).
//
// ⚠️ Q-RT8a is NOT separated here: "n-th finite input" (rule A) and "the window
// holds n - 1 finite inputs" (rule B) both put trend-targets' first wma on bar 127.
// Rule A is kept because it is the VM's; the separating capture is queued (RT8).
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { loadCapture, HARNESS_DIR, REPO, withDoorState } from './harness'
import { toProductBars } from './ourSide'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'
import { computeRuntimeColumns } from '../../runtime/runtimeColumns'
import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../../runtime/lowerIr.js'
import { execute } from '../../runtime/vm.js'
import { FN, FINITE_WINDOW } from '../../ast/interpret.js'

const T = 600000
const cap = (id) => {
  const c = loadCapture(path.join(HARNESS_DIR, `${id}.json`)).capture
  expect(c, id).toBeTruthy()
  return c
}

// trend-targets-algoalpha's own lines (st_factor 12, st_atr_period 90, wma 40, ema 14
// at the defaults), with the wma's input plotted so the run hands it over.
const TREND_TARGETS_INPUT = `//@version=6
indicator("f7 trend-targets wma input", overlay = true)
pine_supertrend(factor, atrPeriod) =>
    src = hl2
    atr = ta.atr(atrPeriod)
    upperBand = src + factor * atr
    lowerBand = src - factor * atr
    prevLowerBand = nz(lowerBand[1])
    prevUpperBand = nz(upperBand[1])

    lowerBand := lowerBand > prevLowerBand or close[1] < prevLowerBand ? lowerBand : prevLowerBand
    upperBand := upperBand < prevUpperBand or close[1] > prevUpperBand ? upperBand : prevUpperBand

    [lowerBand, upperBand]

[lwr, upr] = pine_supertrend(12, 90)
plot(math.avg(lwr, upr), "avg")
plot(ta.ema(ta.wma(math.avg(lwr, upr), 40), 14), "Baseline")
`

/** The runtime lane's run of a source on a capture's bars: the member door's
 *  runtime FALLBACK, handed its own host translation marked refused (RT8's
 *  `forcedRuntime`) — the door and the VM are the member's. */
function runtimeColumnsOf(source, capture) {
  const d = withDoorState('runtime', () => {
    const host = memberPaneDefinition({ source, id: 'u_f7hostwma0001' })
    const refused = { ...host.translation, ok: false, refusals: [{ guard: 'f7:forced', message: 'forced to the runtime lane for grading' }] }
    return memberPaneDefinition({ source, id: 'u_f7hostwma0001', translation: refused })
  })
  expect(d.lane).toBe('runtime')
  const cols = computeRuntimeColumns(d.definition, toProductBars(capture),
    { tf: 'D', newestBarIsForming: false, historyFromListing: true, symbol: { ticker: 'RDDT', exchange: 'NYSE' } })
  return Object.values(cols).map((c) => Array.from(c))
}

const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-12)

describe('F7 — trend-targets-algoalpha RDDT from the listing: the host lane\'s wma warm-up is TradingView\'s', () => {
  const c = cap('trend-targets-algoalpha-rddt-1d-2026-10-02')
  const roles = c.study.plots.map((p, i) => ({ p, column: i + 1 }))
  const baseCol = roles.find((x) => x.p.title === 'Baseline').column
  const tv = c.plotValues.rows.map((r) => (r[baseCol] == null ? NaN : r[baseCol]))

  it('the input is the shape RT8 solved, and TradingView\'s Baseline first answers on bar 140', () => {
    expect(c.history.startsAtBar0).toBe(true)
    const [avg] = runtimeColumnsOf(TREND_TARGETS_INPUT, c)
    expect(avg[0]).toBe(0)
    expect(avg.slice(1, 89).every((v) => Number.isNaN(v))).toBe(true)
    expect(avg.slice(89).every(Number.isFinite)).toBe(true)
    expect(tv.findIndex(Number.isFinite)).toBe(140)
  }, T)

  it('⭐⭐ HOST `ta.ema(ta.wma(x, 40), 14)` over that input: TradingView\'s Baseline on every bar, and the VM\'s exactly', () => {
    const [avg, vmBase] = runtimeColumnsOf(TREND_TARGETS_INPUT, c)
    const wma = Array.from(FN.wma(Float64Array.from(avg), 40))
    expect(wma.findIndex(Number.isFinite), 'the wma first answers on its 40th finite input').toBe(127)
    const host = Array.from(FN.ema(Float64Array.from(wma), 14))
    let compared = 0
    for (let i = 0; i < tv.length; i += 1) {
      expect(Number.isFinite(host[i]), `bar ${i}: host answers exactly where TradingView does`).toBe(Number.isFinite(tv[i]))
      if (!Number.isFinite(tv[i])) continue
      compared += 1
      expect(rel(host[i], tv[i]), `bar ${i}`).toBeLessThan(1e-9)
      expect(rel(host[i], vmBase[i]), `bar ${i}: one rule, two lanes`).toBeLessThan(1e-12)
    }
    expect(compared).toBeGreaterThan(400)
  }, T)

  it('⛔ CONTROL — the pre-F7 host rule (a full filled window) answers from bar 89 and misses TradingView', () => {
    const [avg] = runtimeColumnsOf(TREND_TARGETS_INPUT, c)
    // the old rule, written out: answer where the filled window is full and this bar finite
    let carry = NaN
    const filled = avg.map((v) => (Number.isFinite(v) ? (carry = v) : carry))
    const w = 40
    const old = avg.map((v, i) => {
      if (i < w - 1 || !Number.isFinite(v)) return NaN
      const win = filled.slice(i - w + 1, i + 1)
      if (!win.every(Number.isFinite)) return NaN
      return win.reduce((a, x, k) => a + x * (k + 1), 0) / (w * (w + 1) / 2)
    })
    expect(old.findIndex(Number.isFinite)).toBe(89)
    const oldBase = Array.from(FN.ema(Float64Array.from(old), 14))
    expect(oldBase.findIndex(Number.isFinite)).not.toBe(140)
  }, T)
})

// ── host vs VM on synthetic gappy warm-ups ────────────────────────────────────
const N = 60
const BARS = Array.from({ length: N }, (_, i) => {
  const c = 100 + Math.sin(i / 3) * 7 + i * 0.25
  return { t: 1700000000 + i * 86400, o: c - 0.5, h: c + 1, l: c - 1, c, v: 1000 + i }
})
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const head = '//@version=5\nindicator("f7")\n'
function vmOut(src) {
  const built = buildRuntimeIr(src, { bars: BARS, inputs: {} })
  if (!built.ok) throw new Error(`refused ${built.refusal.guard}: ${built.refusal.message}`)
  const program = lowerIrProgram(built.ir)
  const r = execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true })
  return Array.from(r.outputs[0])
}

/** Each shape: a Pine expression for x (the VM side) and the same series in JS. */
const SHAPES = [
  ['finite on bar 0, gap to 9', 'bar_index == 0 ? 7.0 : bar_index < 10 ? na : close', (i) => (i === 0 ? 7 : i < 10 ? NaN : BARS[i].c)],
  ['leading na to 5, then clean', 'bar_index < 6 ? na : close', (i) => (i < 6 ? NaN : BARS[i].c)],
  ['holes inside the warm-up', 'bar_index % 3 == 1 ? na : close', (i) => (i % 3 === 1 ? NaN : BARS[i].c)],
  ['two finite, long gap, then clean', 'bar_index < 2 ? close : bar_index < 20 ? na : close', (i) => (i < 2 || i >= 20 ? BARS[i].c : NaN)],
  ['clean', 'close', (i) => BARS[i].c],
  ['holes after the warm-up', 'bar_index > 15 and bar_index % 7 == 0 ? na : close', (i) => (i > 15 && i % 7 === 0 ? NaN : BARS[i].c)],
]
const LENGTHS = [1, 4, 9]

describe('F7 — host `FN.wma` and the VM\'s `ta.wma` are one rule on every bar', () => {
  it('wma is the only FFILL member (so this is the whole blast radius)', () => {
    expect(Object.keys(FINITE_WINDOW).filter((k) => FINITE_WINDOW[k].na === 'ffill')).toEqual(['wma'])
  })
  for (const [name, pine, js] of SHAPES) {
    for (const n of LENGTHS) {
      it(`${name}, length ${n}`, () => {
        // `var x` + `:=` keeps the series a run value, so the VM's own OP.WINDOW
        // answers (a pure expression can be compiled to the host's column)
        const vm = vmOut(`${head}var x = 0.0\nx := ${pine}\nplot(ta.wma(x, ${n}))\n`)
        const host = Array.from(FN.wma(Float64Array.from({ length: N }, (_, i) => js(i)), n))
        let answered = 0
        for (let i = 0; i < N; i += 1) {
          expect(Number.isFinite(host[i]), `bar ${i}`).toBe(Number.isFinite(vm[i]))
          if (Number.isFinite(vm[i])) { answered += 1; expect(rel(host[i], vm[i]), `bar ${i}`).toBeLessThan(1e-12) }
        }
        expect(answered).toBeGreaterThan(0)
      })
    }
  }
  it('⛔ NON-VACUITY — the first shape separates the rules: first answer on the n-th finite input, not the full window', () => {
    const x = Float64Array.from({ length: N }, (_, i) => SHAPES[0][2](i))
    // 1 finite on bar 0 then finite from 10: the 4th finite input is bar 12 (old rule: bar 10)
    expect(Array.from(FN.wma(x, 4)).findIndex(Number.isFinite)).toBe(12)
  })
})

// ── JS vs Python ──────────────────────────────────────────────────────────────
const FIXTURE = path.join(REPO, 'tests', 'fixtures', 'ast', 'ffill_warmup_parity.json')
const enc = (a) => Array.from(a).map((v) => (Number.isFinite(v) ? v : null))
function fixtureNow() {
  return {
    _about: 'F7 (step 93): ta.wma FFILL warm-up, JS lane outputs (interpret.js FN.wma). Asserted equal to the JS lane by vendorHarness.f7HostWmaWarmup.test.js and to the Python lane by tests/test_ast_ffill_warmup_parity.py. null = na.',
    cases: SHAPES.flatMap(([name, , js]) => LENGTHS.map((n) => {
      const x = Float64Array.from({ length: N }, (_, i) => js(i))
      return { name, n, x: enc(x), wma: enc(FN.wma(x, n)) }
    })),
  }
}
describe('F7 — the JS lane writes the parity fixture the Python lane is held to', () => {
  it('the committed fixture is the JS lane\'s output', () => {
    const now = fixtureNow()
    if (process.env.F7_WRITE_FIXTURE === '1') fs.writeFileSync(FIXTURE, `${JSON.stringify(now)}\n`)
    expect(JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))).toEqual(now)
  })
})
