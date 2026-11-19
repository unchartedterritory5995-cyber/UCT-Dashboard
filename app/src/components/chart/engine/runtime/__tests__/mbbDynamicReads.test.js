// ─── ⭐⭐ (2026-11-18) A DYNAMIC HISTORY READ PAST A DECLARED max_bars_back IS THE REAL HISTORY ─────────────────────
//
// Captured on TradingView 2026-11-18 (the runs are local, licence-held; the readings are quoted here):
//   * WS-C Q1 M2 (`vw-w4-max-bars-back-m2.pine`, AMEX:SPY 1D, 8,510 bars, run `wsc-mbb-2026-11-18`): declared 20,
//     `n = bar_index > 100 ? 25 : 1`, `close[n]` → the real close 25 back on 8,508 bars; never a stop;
//   * M3 (no declaration, `n = bar_index > 300 ? 250 : 1`) → real;
//   * Q-MBB-1 (`mbb-2026-11-18`, RDDT 669 / SPY 8,510 bars): declared 50, `k = bar_index % 120`, `close[k]`,
//     `ta.ema(close, 5)[k]` → real on every bar past 50 (363 / 4,889);
//   * Q-MBB-2 (`mbb-late-2026-11-18`): the same with offsets past 50 only from bar 300 → real (369 / 8,210);
//   * Fred RS's seed loop (`curveRsPerf[delta .. delta + 34]`, declared 253) on NYSE:RDDT 5m: delta 423, labels drawn.
// So the VM's only stop is Pine's 5,000 (`vm.js`), a declared ring with no proved top is 5,000 deep
// (`pineRuntimeFrontend.js::boundedSlotOffset`), and an offset that does not fold is read bar by bar whether or not
// the script declares a buffer (the engine agent's trap B: with none, a chart of 5,000 bars or fewer refused "a bar
// offset counts backwards in whole bars").
import { describe, it, expect } from 'vitest'
import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const mkBars = (n) => Array.from({ length: n }, (_, i) => ({
  t: 1700000000 + i * 86400, o: 100 + (i % 9), h: 104 + (i % 7), l: 96 - (i % 5), c: 100 + ((i * 37) % 23) + i * 0.01, v: 1000 + i,
}))
const seriesOf = (bars) => ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(bars.map((b) => b[k])))
const build = (src, bars) => buildRuntimeIr(src, { bars, inputs: {} })
function run(src, bars) {
  const b = build(src, bars)
  if (!b.ok) throw new Error(`refused ${b.refusal.guard}: ${b.refusal.message}`)
  const program = lowerIrProgram(b.ir)
  return execute(program, { bars: bars.length, series: seriesOf(bars), columns: program.columns, confirmed: true,
    barTimes: bars.map((x) => x.t) }).outputs.map((o) => Array.from(o))
}
const v5 = (decl, ...lines) => ['//@version=5', `indicator("t"${decl})`, ...lines].join('\n')
const emaOf = (bars, len) => {
  const a = 2 / (len + 1)
  const out = []
  let e = NaN
  bars.forEach((b, i) => {
    if (i < len - 1) { out.push(NaN); return }
    e = i === len - 1 ? bars.slice(0, len).reduce((s, x) => s + x.c, 0) / len : a * b.c + (1 - a) * e
    out.push(e)
  })
  return out
}

describe('Q-MBB-1 / Q-MBB-2 / M3 shapes, served and read as the real history', () => {
  const RDDT = mkBars(669)
  for (const [label, decl] of [['declared 50', ', max_bars_back = 50'], ['⛔ TRAP B: no declaration', '']]) {
    it(`${label}: k = bar_index % 120 from bar 0, close[k] and ta.ema(close, 5)[k]`, () => {
      const [k, c, e] = run(v5(decl, 'k = bar_index % 120', 'e = ta.ema(close, 5)', 'plot(k)', 'plot(close[k])', 'plot(e[k])'), RDDT)
      const ema = emaOf(RDDT, 5)
      let past = 0
      for (let i = 0; i < RDDT.length; i += 1) {
        expect(k[i]).toBe(i % 120)
        expect(c[i], `close[${k[i]}] at ${i}`).toBe(RDDT[i - k[i]].c)
        const want = ema[i - k[i]]
        if (Number.isNaN(want)) expect(e[i]).toBeNaN()
        else expect(Math.abs(e[i] - want) <= 1e-9 * Math.abs(want), `ema[${k[i]}] at ${i}`).toBe(true)
        if (k[i] > 50) past += 1
      }
      expect(past).toBeGreaterThan(300)                           // most reads are past the declared 50
    })
    it(`${label}: offsets past 50 only from bar 300 (a buffer sized from the first bars never saw them)`, () => {
      const [c] = run(v5(decl, 'k = bar_index >= 300 ? 60 + bar_index % 60 : 0', 'plot(close[k])'), RDDT)
      for (let i = 300; i < RDDT.length; i += 1) expect(c[i]).toBe(RDDT[i - (60 + (i % 60))].c)
    })
  }
  for (const [label, decl] of [['declared 50', ', max_bars_back = 50'], ['no declaration', '']]) {
    it(`⛔ TRAP B (${label}): a non-folding offset lowered BAR BY BAR (inside a block) is the real history, never "counts backwards"`, () => {
      // the arm a top-level expression never reaches (it goes to the columnar lane): with no declaration this refused
      // "a bar offset counts backwards in whole bars" (the engine agent's trap B; Fred RS's own door hit it)
      const src = v5(decl, 'k = bar_index % 120', 's = 0.0', 'if close > 0', '    s := close[k]', 'plot(s)')
      const b = build(src, RDDT)
      expect(b.ok, b.ok ? '' : b.refusal.message).toBe(true)
      const [s] = run(src, RDDT)
      for (let i = 0; i < RDDT.length; i += 1) expect(s[i], `close[${i % 120}] at ${i}`).toBe(RDDT[i - (i % 120)].c)
    })
  }
  it('⛔ TRAP B AT THE MEMBER DOOR (no bars): Fred RS\'s own shape, `closeDa[n63]` with `n63 = bar_index < 63 ? bar_index : 63`, builds, declared and not', () => {
    // the shape the door declined ("a bar offset counts backwards in whole bars", runtime:statement) once a declaration
    // stopped routing it: at the door the daily request folds to the chart's own close, and `n63` folds to no number
    for (const decl of [', max_bars_back = 253', '']) {
      const src = v5(decl, 'n63 = bar_index < 63 ? bar_index : 63', 'closeDa = request.security(syminfo.tickerid, "D", close)',
        'plot(closeDa / closeDa[n63])')
      const door = buildRuntimeIr(src, { bars: [], inputs: {} })
      expect(door.ok, `${decl || 'no declaration'}: ${door.ok ? '' : door.refusal.message}`).toBe(true)
      const [p] = run(src, RDDT)
      for (const i of [0, 10, 62, 63, 64, 300, 668]) expect(p[i], `bar ${i}`).toBe(RDDT[i].c / RDDT[i - Math.min(i, 63)].c)
    }
  })
  it('M3 (no declaration): a 250-bar offset after bar 300 is the real close', () => {
    const [c] = run(v5('', 'n = bar_index > 300 ? 250 : 1', 'plot(close[n])'), RDDT)
    expect(c[400]).toBe(RDDT[150].c)
    expect(c[200]).toBe(RDDT[199].c)
  })
  it('CONTROL: an offset that FOLDS to no whole number keeps its refusal', () => {
    const b = build(v5('', 'n = -3', 'plot(close[n])'), RDDT)
    expect(b.ok).toBe(false)
  })
})
