// app/src/components/chart/engine/runtime/__tests__/wscConstantOffsets.test.js
//
// ⭐⭐ engine NUMBER PENDING — WS-C, THE CONSTANT HALF: TRADINGVIEW NEVER STOPS A CONSTANT OFFSET, AND
// `max_bars_back(x, n)` BOUNDS NOTHING. The captures (run wsc-mbb-2026-11-18, AMEX:SPY 1D from the listing,
// 8,510 bars, packet sha256 6f54e4c81044ba73efe4c1af249f217698793fb20c476a76e338f47c7e457011, committed):
//   M1 `indicator(max_bars_back = 20)`, `plot(close[30])`: real from bar 30 on, `na` before it;
//   M4 `max_bars_back(x, 50)` then `x[60]` and `ta.sma(x, 60)`: both real;
//   M5 `close[6000]` with no declaration: real on the bars past bar 6,000, `na` before it.
// (Q-MBB-1 / -2, runs mbb-2026-11-18 and mbb-late-2026-11-18, are licence-held ledger rows: the DYNAMIC half,
// built separately.)
// The runtime lane refused all three by name (`runtime:directive`). Here it is driven over each committed
// capture's own source and bars, and every row on every bar is TradingView's.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'
import { DEFAULT_BUDGET } from '../../ast/budget.js'

const capture = (id) => JSON.parse(readFileSync(`../tests/fixtures/vendor/harness/${id}.json`, 'utf8'))
const barsOf = (cap) => cap.bars.rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }))
function run(src, bars) {
  const b = buildRuntimeIr(src, { bars, inputs: {} })
  if (!b.ok) throw new Error(`refused ${b.refusal.guard}: ${b.refusal.message}`)
  const program = lowerIrProgram(b.ir)
  const series = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(bars.map((x) => x[k])))
  const r = execute(program, { bars: bars.length, series, columns: program.columns, confirmed: true })
  return { outs: r.outputs.map((o) => Array.from(o)), program }
}

describe('the runtime lane draws M1 / M4 / M5 as TradingView did, every row, every bar', () => {
  for (const m of ['', '-m4', '-m5']) {
    const id = `vw-w4-max-bars-back${m === '' ? '-m1' : m}-spy-1d-2026-11-18`
    it(id, () => {
      const cap = capture(id)
      const bars = barsOf(cap)
      const { outs } = run(cap.source.text, bars)
      expect(outs.length).toBe(cap.study.plots.length)
      const off = []
      cap.study.plots.forEach((pl, k) => {
        const at = cap.plotValues.fields.indexOf(pl.id)
        cap.plotValues.rows.forEach((r, i) => {
          const tv = r[at]
          const ours = outs[k][i]
          const same = tv === null ? ours !== ours : Math.abs(ours - tv) <= 1e-9 * Math.max(1, Math.abs(tv))
          if (!same) off.push(`${pl.title} bar ${i}: ours ${ours}, TradingView ${tv}`)
        })
      })
      expect(off.slice(0, 5), `${off.length} cells off`).toEqual([])
    })
  }
  it('the captures hold what the rule rests on: M1 / M5 real from the offset\'s bar, na before it', () => {
    const tvCol = (cap, title) => {
      const at = cap.plotValues.fields.indexOf(cap.study.plots.find((p) => p.title === title).id)
      return cap.plotValues.rows.map((r) => r[at])
    }
    const m1 = tvCol(capture('vw-w4-max-bars-back-m1-spy-1d-2026-11-18'), 'M1_close_30_declared_20')
    expect(m1.slice(0, 30).every((v) => v === null)).toBe(true)
    expect(m1.slice(30).every((v) => v !== null)).toBe(true)
    const m5 = tvCol(capture('vw-w4-max-bars-back-m5-spy-1d-2026-11-18'), 'M5_close_6000')
    expect(m5.slice(0, 6000).every((v) => v === null)).toBe(true)
    expect(m5.slice(6000).filter((v) => v !== null).length).toBeGreaterThan(2400)
  })
})

describe('the shapes the rule serves, beyond the captures', () => {
  const LONG = Array.from({ length: 6100 }, (_, i) => ({ t: 1600000000 + i * 86400, o: 1, h: 2, l: 0.5, c: 10 + i, v: 1 }))
  it('a VARIABLE\'s constant offset past 5,000 is read from a ring that deep', () => {
    const { outs, program } = run('//@version=5\nindicator("t")\nvar float x = 0.0\nx := x + 1\nplot(x[5500])\n', LONG)
    expect(Math.max(...(program.history || []).map((h) => h.depth))).toBeGreaterThanOrEqual(5500)
    const [y] = outs
    expect(y.slice(0, 5500).every(Number.isNaN)).toBe(true)
    expect(y.slice(5500)).toEqual(Array.from({ length: 600 }, (_, k) => k + 1))
  })
  it('a pure subtree whose constant offset passes the columnar cap is read piecewise, not refused', () => {
    const back = DEFAULT_BUDGET.maxLookback + 40
    const bars = LONG.slice(0, back + 60)
    const { outs } = run(`//@version=5\nindicator("t")\nplot(ta.sma(close, 10)[${back}])\n`, bars)
    const [y] = outs
    const sma = (i) => (i < 9 ? NaN : bars.slice(i - 9, i + 1).reduce((a, x) => a + x.c, 0) / 10)
    for (let i = 0; i < bars.length; i += 1) {
      const want = i - back >= 0 ? sma(i - back) : NaN
      if (Number.isNaN(want)) expect(y[i], `bar ${i}`).toBeNaN()
      else expect(Math.abs(y[i] - want), `bar ${i}`).toBeLessThan(1e-9)
    }
  })
  it('CONTROL: a computed `max_bars_back` bound is still refused by name', () => {
    const b = buildRuntimeIr('//@version=5\nindicator("t")\nx = close\nn = 10\nmax_bars_back(x, n * 2)\nplot(x[1])\n',
      { bars: LONG.slice(0, 40), inputs: {} })
    expect(b.ok).toBe(false)
    expect(b.refusal.guard).toBe('runtime:directive')
  })
})
