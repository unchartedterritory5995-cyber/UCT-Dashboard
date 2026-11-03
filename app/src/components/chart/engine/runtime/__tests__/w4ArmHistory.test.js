// app/src/components/chart/engine/runtime/__tests__/w4ArmHistory.test.js
//
// ─── ⭐⭐⭐ W4 T4 — A `?:` ARM RUNS ONLY WHEN IT IS CHOSEN (per-call-site state) ───
//
// Pine evaluates only the operand a `?:` picks, so a `ta.*` call written in an arm
// keeps the history of the bars that arm ran on (Pine's execution model; the
// Operators page: the ternary returns the chosen operand). WITNESSED for Pine v6 by
// `vw-arm-history-rddt/spy-1d-2026-10-02` (T03 / T04 / T05 / K02 / K03 / N02, graded
// through this lane in `vendorHarness.w4ArmHistory.test.js`). Until W4 T4 this lane
// evaluated both arms on every bar (`SELECT`) and so refused every such arm by name
// (`runtime:conditional-history`, WS-C).
//
// ⭐ WHAT IS PINNED:
//   1. SERVED: a Pine v6 `?:` at the root whose arms hold `ta.sma` / `ta.ema` /
//      `ta.rma` / one-argument `ta.change` is lowered as a JUMP (`lazy`): only the
//      picked arm runs, so those calls step per call site. Column route, slot route,
//      through a binding read twice, inside arithmetic, in both arms, and the
//      McGinley shape (`mg := na(mg[1]) ? ta.ema(…) : …`, TradingView's built-in);
//   2. the test is read as a CONDITION with the version's `na` rule: from the
//      listing a v6 test that is `na` (a crossing in warm-up) takes the else arm and
//      nothing is counted; below v4 an `na` test is still counted (`runtime:na-test`);
//   3. ⛔ REFUSED BY NAME, every shape no capture settles: other `ta.*` in an arm
//      (H1 `ta.stdev` / `ta.sum`, H5 `ta.highest`), `ta.change(x, n)`, `ta.change` in
//      an `if` block (H2), a nested `?:` with history, a function that keeps history
//      (U01), Pine v5 (Q-PT1), v4 (Q-PT3) and v4 `iff` (H10), and a `?:` that is not
//      lowered at the root (function body, loop, varying block, a call's argument,
//      an offset, the drawing build, the object door).
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram, naTestsOf } from '../lowerIr.js'
import { execute } from '../vm.js'
import { probeRuntimeProgram } from '../runtimeColumns.js'
import { EXPR } from '../ir.js'

const DIR = path.resolve(process.cwd(), '..', 'tests/fixtures/vendor/harness')
const CAP = JSON.parse(fs.readFileSync(path.join(DIR, 'vw-arm-history-rddt-1d-2026-10-02.json'), 'utf8'))
const BARS = CAP.bars.rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v: v == null ? 0 : v }))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const UP = BARS.map((b) => b.c > b.o)
const R4 = 'runtime:conditional-history'

const NL = String.fromCharCode(10)
const v6 = (...lines) => ['//@version=6', 'indicator("t")', ...lines].join(NL)
const v5 = (...lines) => ['//@version=5', 'indicator("t")', ...lines].join(NL)
const v4 = (...lines) => ['//@version=4', 'study("t")', ...lines].join(NL)
const v3 = (...lines) => ['//@version=3', 'study("t")', ...lines].join(NL)

const build = (src, extra = {}) => buildRuntimeIr(src, { bars: BARS, inputs: {}, pane: true, ...extra })
const refusalOf = (src, extra) => { const b = build(src, extra); return b.ok ? null : b.refusal }
function run(src, { listing = true } = {}) {
  const b = build(src)
  if (!b.ok) throw new Error(`refused ${b.refusal.guard}: ${b.refusal.message}`)
  const program = lowerIrProgram(b.ir, { historyFromListing: listing })
  const r = execute(program, { bars: BARS.length, series: SERIES, columns: program.columns, confirmed: true })
  return { out: r.outputs.map((o) => Array.from(o)), program, ir: b.ir }
}
const same = (a, b) => (Number.isNaN(a) && Number.isNaN(b))
  || (!Number.isNaN(a) && !Number.isNaN(b) && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b)))
const expectRows = (a, b, what) => a.forEach((x, i) => expect(same(x, b[i]), `${what} bar ${i}: ${x} vs ${b[i]}`).toBe(true))

/** Every `ternary` IR node of a build, wherever it sits. */
const ternariesOf = (ir) => {
  const found = []
  const walk = (n, d = 0) => {
    if (!n || typeof n !== 'object' || d > 200) return
    if (Array.isArray(n)) { n.forEach((x) => walk(x, d + 1)); return }
    if (n.kind === EXPR.TERNARY) found.push(n)
    for (const v of Object.values(n)) if (v && typeof v === 'object') walk(v, d + 1)
  }
  walk(ir)
  return found
}

// ── hand replays of the per-run rules (the C48 / vw-arm-history readings) ──────
/** `ta.sma(src, n)` over the RUNS: the mean of the last n finite runs (`na` skipped). */
const smaRuns = (src, ran, n) => {
  const obs = []
  return src.map((x, i) => {
    if (!ran[i]) return undefined
    if (Number.isFinite(x)) { obs.push(x); if (obs.length > n) obs.shift() }
    return obs.length < n ? NaN : obs.reduce((a, b) => a + b, 0) / n
  })
}
/** `ta.ema` / `ta.rma` over the RUNS: seeded by the mean of the first n runs. */
const smoothRuns = (src, ran, n, alpha) => {
  let seen = 0
  let sum = 0
  let prev = NaN
  return src.map((x, i) => {
    if (!ran[i]) return undefined
    if (!Number.isFinite(x)) return NaN
    if (seen < n) { seen += 1; sum += x; if (seen === n) prev = sum / n; return seen === n ? prev : NaN }
    prev = alpha * x + (1 - alpha) * prev
    return prev
  })
}
/** `ta.change(src)` over the RUNS: `src - src one run back` (`na` carried through). */
const changeRuns = (src, ran) => {
  let last
  return src.map((x, i) => {
    if (!ran[i]) return undefined
    const v = last === undefined ? NaN : x - last
    last = x
    return v
  })
}
const CLOSE = BARS.map((b) => b.c)
const pick = (perRun, other) => perRun.map((v, i) => (v === undefined ? other[i] : v))

describe('1 — SERVED: a v6 `?:` arm with witnessed history runs only when it is chosen', () => {
  it('the column route: `up ? ta.sma / ta.ema / ta.rma / ta.change : …` equal the per-run replays', () => {
    const { out, ir } = run(v6('up = close > open',
      'plot(up ? ta.sma(close, 5) : close)',
      'plot(up ? ta.ema(close, 5) : close)',
      'plot(up ? ta.rma(close, 4) : close)',
      'plot(up ? ta.change(close) : 0.0)'))
    expectRows(out[0], pick(smaRuns(CLOSE, UP, 5), CLOSE), 'sma')
    expectRows(out[1], pick(smoothRuns(CLOSE, UP, 5, 2 / 6), CLOSE), 'ema')
    expectRows(out[2], pick(smoothRuns(CLOSE, UP, 4, 1 / 4), CLOSE), 'rma')
    expectRows(out[3], pick(changeRuns(CLOSE, UP), CLOSE.map(() => 0)), 'change')
    const lazy = ternariesOf(ir).filter((t) => t.lazy === true)
    expect(lazy.length).toBe(4)
  })

  it('the false arm, both arms, and inside arithmetic', () => {
    const DOWN = UP.map((u) => !u)
    const { out } = run(v6('up = close > open',
      'plot(up ? close : ta.sma(close, 3))',
      'plot(up ? ta.sma(close, 3) : ta.ema(close, 3))',
      'plot(close - (up ? ta.sma(close, 3) : close) * 2)'))
    expectRows(out[0], pick(smaRuns(CLOSE, DOWN, 3), CLOSE), 'false arm')
    expectRows(out[1], pick(smaRuns(CLOSE, UP, 3), smoothRuns(CLOSE, DOWN, 3, 0.5)), 'both arms')
    const inner = pick(smaRuns(CLOSE, UP, 3), CLOSE)
    expectRows(out[2], CLOSE.map((c, i) => c - inner[i] * 2), 'arithmetic')
  })

  it('through a binding read twice: one rule, the same numbers at each read', () => {
    const { out } = run(v6('up = close > open', 't = up ? ta.sma(close, 5) : close', 'plot(t)', 'plot(t * 2)'))
    const want = pick(smaRuns(CLOSE, UP, 5), CLOSE)
    expectRows(out[0], want, 'first read')
    expectRows(out[1], want.map((x) => x * 2), 'second read')
  })

  it('the slot route: a test that reads a slot, and an arm that reads one', () => {
    const { out } = run(v6('var float s = 0.0', 's := s + 1',
      'plot(s > 3 ? ta.sma(close, 5) : close)',
      'var float e = 0.0', 'e := close > open ? ta.ema(close, 5) : e', 'plot(e)'))
    const ranS = BARS.map((_, i) => i + 1 > 3)
    expectRows(out[0], pick(smaRuns(CLOSE, ranS, 5), CLOSE), 'test reads a slot')
    const em = smoothRuns(CLOSE, UP, 5, 2 / 6)
    let held = 0
    expectRows(out[1], em.map((v) => { if (v !== undefined) held = v; return held }), 'arm reads a slot')
  })

  it('⭐ the McGinley shape (TradingView\'s built-in): `mg := na(mg[1]) ? ta.ema(source, length) : …`', () => {
    const { out, program } = run(v6('length = input.int(14, minval=1)', 'source = close', 'mg = 0.0',
      'mg := na(mg[1]) ? ta.ema(source, length) : mg[1] + (source - mg[1]) / (length * math.pow(source/mg[1], 4))',
      'plot(mg)'))
    // hand replay: the ema arm runs while the previous mg is na, the recurrence after
    const want = []
    let seen = 0
    let sum = 0
    let em = NaN
    CLOSE.forEach((c, i) => {
      const prev = i === 0 ? NaN : want[i - 1]
      if (Number.isNaN(prev)) {
        if (seen < 14) { seen += 1; sum += c; if (seen === 14) em = sum / 14 } else em = (2 / 15) * c + (13 / 15) * em
        want.push(seen < 14 ? NaN : em)
      } else want.push(prev + (c - prev) / (14 * Math.pow(c / prev, 4)))
    })
    expectRows(out[0], want, 'mcginley')
    expect(Number.isFinite(out[0][13]) && Number.isNaN(out[0][12])).toBe(true)
    expect(naTestsOf(program)).toBe(0)
  })

  it('`ta.change` over a source that is `na` on some runs carries the `na` (its `x - x[1]`, counted in runs)', () => {
    const even = BARS.map((_, i) => i % 2 === 0)
    const srcNa = CLOSE.map((c, i) => (even[i] ? c : NaN))
    const { out } = run(v6('up = close > open', 'src_na = bar_index % 2 == 0 ? close : na', 'plot(up ? ta.change(src_na) : 0.0)'))
    expectRows(out[0], pick(changeRuns(srcNa, UP), CLOSE.map(() => 0)), 'change of na')
  })
})

describe('2 — the test is read as a condition, by the version\'s `na` rule', () => {
  // `ta.cross(close, w)` with `w` in warm-up is `na` on bars 0..19 here; TradingView
  // takes the ELSE arm on such a test (F1, `rt1-na-test-v6` A02)
  const SRC = v6('w = ta.sma(close, 20)', 'plot(ta.cross(close, w) ? ta.sma(close, 3) : close)')
  it('from the listing: nothing counted, and the else arm (with no step of the true arm) on the na bars', () => {
    const { out, program, ir } = run(SRC)
    expect(naTestsOf(program)).toBe(0)
    const lazy = ternariesOf(ir).filter((t) => t.lazy === true)
    expect(lazy.length).toBe(1)
    for (let i = 0; i < 20; i += 1) expect(out[0][i], `bar ${i}`).toBe(CLOSE[i])
    expect(probeRuntimeProgram(SRC).naTests).toBe(0)
  })
  it('off the listing the `na` reading is not claimed: counted, as `SELECT`\'s test is', () => {
    expect(naTestsOf(run(SRC, { listing: false }).program)).toBe(1)
  })
  it('below v4 nothing is claimed: a v3 `?:` whose test can be na is still counted (`runtime:na-test`), and an arm with history is refused', () => {
    const p = probeRuntimeProgram(v3('x = 0.0', 'x := close[1]', 'plot(x ? 1 : 2)'))
    expect(p.ok, p.refusal && p.refusal.message).toBe(true)
    expect(p.naTests).toBe(1)
    expect(refusalOf(v3('x = 0.0', 'x := close[1]', 'plot(x ? sma(close, 3) : 2)')).guard).toBe(R4)
  })
})

describe('3 — ⛔ refused by name: every arm shape no capture settles', () => {
  const ARM = (call) => v6('up = close > open', `plot(up ? ${call} : close)`)
  it.each([
    ['ta.stdev(close, 5)', 'H1'], ['ta.sum(close, 5)', 'H1'], ['ta.median(close, 5)', 'H1'],
    ['ta.highest(close, 5)', 'H5'], ['ta.lowest(close, 5)', 'H5'], ['ta.atr(5)', 'H3'], ['ta.rsi(close, 5)', 'H3'],
    ['ta.mom(close, 2)', 'H2'], ['ta.change(close, 2)', 'W4-A1'],
    ['ta.sma(close[1] + close, 3)[1]', 'H9'], ['(close + open)[1]', 'H9'],
    ['ta.sma(ta.ema(close, 3), 3)', 'a source with its own history'],
    ['ta.wma(close, 5)', 'not witnessed'], ['fixnan(close)', 'not witnessed'],
  ])('`%s` in an arm (%s)', (call) => {
    const r = refusalOf(ARM(call))
    expect(r && r.guard, call).toBe(R4)
  })
  it('a nested `?:` with history, and a function that keeps history (U01)', () => {
    expect(refusalOf(v6('up = close > open', 'plot(up ? (close > close[1] ? ta.sma(close, 3) : 0.0) : close)')).guard).toBe(R4)
    expect(refusalOf(v6('f(x) => x - x[1]', 'up = close > open', 'plot(up ? f(close) : 0.0)')).guard).toBe(R4)
  })
  it('a `?:` sent past the column route (a Pine twin in an arm, a colour) is asked the same rule', () => {
    // ⚰️ these were lowered with `SELECT`, their arm's state stepping on every bar
    for (const body of [
      'plot(close > open ? ta.valuewhen(close > close[1], close, 0) : close)',
      'plot(close > open ? ta.barssince(close > close[1]) : 0)',
      'plot(close > open ? fixnan(close) : close)',
    ]) expect(refusalOf(v6(body)) && refusalOf(v6(body)).guard, body).toBe(R4)
    // a plot's colour is fail-soft (RT6): that colour alone is refused, by the same rule
    const colourOf = (body) => probeRuntimeProgram(v6(body)).outputs.find((o) => o.colour).colour
    expect(colourOf('plot(close, color = close > open ? (ta.sma(close, 3) > close ? color.red : color.blue) : color.gray)').refused)
      .toMatch(/conditional-history/)
    // CONTROL: a twin on every bar, and a colour `?:` with no history in its arms, stay served
    expect(refusalOf(v6('plot(ta.valuewhen(close > close[1], close, 0))'))).toBeNull()
    expect(colourOf('plot(close, color = close > open ? color.red : color.blue)').refused).toBeUndefined()
  })
  it('`ta.change` (H2) and `ta.stdev` (H1) in an `if` block stay refused', () => {
    expect(refusalOf(v6('float y = na', 'if close > open', '    y := ta.change(close)', 'plot(y)')).guard).toBe(R4)
    expect(refusalOf(v6('float y = na', 'if close > open', '    y := ta.stdev(close, 5)', 'plot(y)')).guard).toBe(R4)
  })
  it('Pine v5 (Q-PT1), v4 (Q-PT3) and v4 `iff` (H10) keep the refusal', () => {
    expect(refusalOf(v5('up = close > open', 'plot(up ? ta.sma(close, 5) : close)')).guard).toBe(R4)
    expect(refusalOf(v4('up = close > open', 'plot(up ? sma(close, 5) : close)')).guard).toBe(R4)
    expect(refusalOf(v4('up = close > open', 'plot(iff(up, sma(close, 3), 0))')).guard).toBe(R4)
  })
  it('a `?:` not lowered at the root: function body, loop, varying block, call argument, offset', () => {
    const shapes = [
      v6('f(s) => s > open ? ta.sma(s, 5) : s', 'plot(f(close))'),
      v6('float acc = 0.0', 'for i = 0 to 1', '    acc += close > open ? ta.sma(close, 3) : close', 'plot(acc)'),
      v6('float y = na', 'if close > close[1]', '    y := close > open ? ta.sma(close, 3) : close', 'plot(y)'),
      v6('up = close > open', 't = up ? ta.sma(close, 5) : close', 'float y = na', 'if close > close[1]', '    y := t', 'plot(y)'),
      // the same binding read at the root FIRST, then where its `?:` cannot be split
      v6('up = close > open', 't = up ? ta.sma(close, 5) : close', 'plot(t)', 'float y = na', 'if close > close[1]', '    y := t', 'plot(y)'),
      v6('up = close > open', 't = up ? ta.sma(close, 3) : close', 'plot(t)', 'plot(ta.sma(t, 5))'),
      v6('up = close > open', 'plot(ta.sma(up ? ta.sma(close, 3) : close, 5))'),
      v6('up = close > open', 'plot((up ? ta.sma(close, 3) : close)[1])'),
      v6('up = close > open', 'plot(math.abs(up ? ta.sma(close, 3) : close))'),
      // a `?:` whose test reads a slot is lowered off the column route (no block check
      // there): inside a varying block and inside a loop it is still not the root
      v6('var float s = 0.0', 's := s + 1', 'float y = na', 'if close > close[1]', '    y := s > 3 ? ta.sma(close, 3) : close', 'plot(y)'),
      v6('var float s = 0.0', 's := s + 1', 'float acc = 0.0', 'for i = 0 to 1', '    acc += s > 3 ? ta.sma(close, 3) : close', 'plot(acc)'),
    ]
    for (const s of shapes) expect(refusalOf(s) && refusalOf(s).guard, s).toBe(R4)
  })
  it('the drawing build (`objectsInRun`) and the object door keep master\'s refusal', () => {
    const src = v6('up = close > open', 'plot(up ? ta.sma(close, 5) : close)')
    expect(refusalOf(src)).toBeNull()
    expect(refusalOf(src, { objectsInRun: true }).guard).toBe(R4)
    expect(refusalOf(src, { objectDoor: true }).guard).toBe(R4)
  })
  it('CONTROL: a test fixed before bar 0 still takes one arm on every bar (no jump, no per-run state)', () => {
    const { out, ir } = run(v6('m = input.bool(true, "m")', 'plot(m ? ta.sma(close, 5) : close)'))
    expect(ternariesOf(ir).some((t) => t.lazy === true)).toBe(false)
    const every = run(v6('plot(ta.sma(close, 5))')).out[0]
    expectRows(out[0], every, 'fixed test')
  })
})

describe('4 — the lowering: a `lazy` ternary is a jump, whatever its test', () => {
  it('the unpicked arm never runs: its state does not step', () => {
    // the arm with `ta.sma` is never taken (a test that reads a slot, always false):
    // its window never fills, so taking it on the last bar alone answers na
    const { out } = run(v6('var int n = 0', 'n := n + 1',
      `plot(n == ${BARS.length} ? ta.sma(close, 2) : close)`))
    expect(Number.isNaN(out[0][BARS.length - 1])).toBe(true)
    expectRows(out[0].slice(0, -1), CLOSE.slice(0, -1), 'untaken')
  })
})
