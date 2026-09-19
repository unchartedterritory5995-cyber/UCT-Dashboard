// app/src/components/chart/engine/runtime/__tests__/windowPerf.test.js
//
// ─── ⭐ WHAT A FINITE WINDOW COSTS (2F-2B, §57) ─────────────────────────────
//
// ⛔⛔ THIS IS THE FIRST PER-BAR COST IN THIS RUNTIME THAT SCALES WITH A NUMBER
// THE MEMBER TYPES. History was bounded by the program text — 35 real scripts
// asked for `[1]` and one for `[2]`, so the ring is tiny whatever the script. A
// window is not: `sma(x, 200)` reads TWO HUNDRED cells on every bar, and there
// is nothing stopping a member writing 500. Across a 5,000-symbol scan that is
// the difference between a scan and an outage, so it is measured rather than
// assumed — and `WINDOW_CELLS` exists because of what this file reports.
//
// ⭐ THE SHAPE IS WHAT SURVIVES, NOT THE MILLISECONDS. Cost must be LINEAR in
// bars and LINEAR in span; anything superlinear means the window is being
// rebuilt from something it should be reading. Wall time on one laptop under a
// parallel suite is an order of magnitude — the ceilings below are loose enough
// to fail for a regression and not for a busy machine
// (`lesson_an_acceptance_number_is_a_forecast_until_derived`).
//
// ⚠️ AND IT MEASURES THE VM, NOT THE FRONT END — `historyPerf.test.js`'s rule.
// Compiling Pine is once per scan; only the bar loop is per symbol.
//
//   WINDOW_PERF_OUT   write the JSON report here

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const OUT = process.env.WINDOW_PERF_OUT
  ? path.resolve(process.cwd(), process.env.WINDOW_PERF_OUT) : null

const head = '//@version=5\nindicator("p")\n'

function bars(n) {
  return Array.from({ length: n }, (_, i) => ({
    t: 1700000000 + i * 86400,
    o: 100 + (i % 17), h: 103 + (i % 19), l: 97 + (i % 13),
    c: 100 + Math.sin(i / 3.1) * 9, v: 1000 + (i % 97),
  }))
}
const columnsOf = (b) => ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(b.map((x) => x[k])))

/** `sites` distinct window calls over distinct runtime state, each of `span`. */
function sourceFor(sites, span) {
  const lines = []
  for (let i = 0; i < sites; i += 1) {
    lines.push(`var s${i} = 0.0`)
    lines.push(`s${i} := close + ${i}`)
  }
  const terms = Array.from({ length: sites }, (_, i) => `ta.sma(s${i}, ${span})`).join(' + ')
  lines.push(`plot(${terms})`)
  return head + lines.join('\n') + '\n'
}

/** ⭐ COMPILE ONCE, RUN MANY — the scan's real shape, and the only honest way to
 *  read a per-symbol number off a per-scan cost. */
function timeRun(sites, span, n, reps = 3) {
  const b = bars(n)
  const built = buildRuntimeIr(sourceFor(sites, span), { bars: b, inputs: {} })
  expect(built.ok, built.ok ? '' : JSON.stringify(built.refusal)).toBe(true)
  const program = lowerIrProgram(built.ir)
  const env = { bars: n, series: columnsOf(b), columns: program.columns, confirmed: true }
  execute(program, env)                                   // warm the JIT
  let best = Infinity
  let cells = 0
  for (let r = 0; r < reps; r += 1) {
    const t0 = performance.now()
    const res = execute(program, env)
    best = Math.min(best, performance.now() - t0)
    cells = res.budget.counts.WINDOW_CELLS
  }
  return { ms: best, cells, windows: program.windows.length }
}

const report = { runs: [], market: {} }

describe('⭐ finite windows — cost in bars, sites and span', () => {
  it('⭐ the report: sites × bars, with the cell count beside the time', () => {
    for (const sites of [1, 10, 40]) {
      for (const n of [300, 5000]) {
        const r = timeRun(sites, 20, n)
        report.runs.push({ sites, span: 20, bars: n, ...r })
        // ⭐ NON-VACUITY: a run that reduced nothing would report a fast zero.
        expect(r.cells, `${sites}×${n} charged no cells`).toBeGreaterThan(0)
        expect(r.windows).toBe(sites)
      }
    }
    // ⚰️ EXACT ARITHMETIC, AND IT MOVED WITH THE NA POLICIES. This read
    // `20 * (5000 - 19)` — cells charged only past the warm-up. `sma` is a SKIP
    // member now and feeds its observation ring on EVERY bar, so it charges from
    // bar 0. The count follows the work, which is the point of a cost counter.
    const one = report.runs.find((r) => r.sites === 1 && r.bars === 5000)
    expect(one.cells).toBe(20 * 5000)
  })

  it('⭐ LINEAR IN BARS — 16.7× the bars must not cost 100× the time', () => {
    for (const sites of [1, 10, 40]) {
      const small = report.runs.find((r) => r.sites === sites && r.bars === 300)
      const big = report.runs.find((r) => r.sites === sites && r.bars === 5000)
      expect(big.cells / small.cells).toBeGreaterThan(15)   // the WORK is linear, exactly
      const ratio = big.ms / Math.max(small.ms, 0.02)
      expect(ratio, `${sites} sites: ${ratio.toFixed(1)}× for 16.7× the bars`).toBeLessThan(150)
    }
  })

  it('⭐ LINEAR IN SPAN — the window is read, never rebuilt', () => {
    const spans = [5, 20, 100, 200].map((span) => ({ span, ...timeRun(1, span, 2000) }))
    report.runs.push(...spans.map((s) => ({ sites: 1, bars: 2000, ...s })))
    for (const s of spans) expect(s.cells).toBe(s.span * 2000)
    const ratio = spans[3].ms / Math.max(spans[0].ms, 0.02)
    expect(ratio, `40× the span cost ${ratio.toFixed(1)}×`).toBeLessThan(200)
  })

  it('⛔⛔ THE 5,000-SYMBOL SCAN — the number that decides feasibility', () => {
    // ⭐ ONE SYMBOL MEASURED, THE MARKET EXTRAPOLATED. A screener compiles once
    // and runs the bar loop per symbol, so per-symbol wall time × the universe
    // IS the scan — and it is the only number that says whether a member can put
    // `ta.sma(x, 200)` in a screen at all.
    const typical = timeRun(4, 20, 300)      // a real screener: a few windows, a year of bars
    const heavy = timeRun(8, 200, 5000)      // a deliberately expensive one
    const SYMBOLS = 5000
    report.market = {
      typical: { perSymbolMs: typical.ms, scanSeconds: (typical.ms * SYMBOLS) / 1000, cells: typical.cells },
      heavy: { perSymbolMs: heavy.ms, scanSeconds: (heavy.ms * SYMBOLS) / 1000, cells: heavy.cells },
      windowCellsCeiling: 100000000,
      heavyCellsPerSymbol: heavy.cells,
    }
    // ⛔ THE HEAVY CASE IS THE ONE THAT MATTERS, and it is a WARNING not a pass:
    // 8 sites × 200 span × 5,000 bars is ~8M cells for ONE symbol. `WINDOW_CELLS`
    // is per-execution, so the ceiling bounds a runaway symbol, NOT the scan —
    // budgeting the SCAN is 2G's problem and this is the evidence for it.
    expect(heavy.cells).toBeGreaterThan(1000000)
    expect(heavy.cells).toBeLessThan(100000000)
    // a single symbol must stay well under a second even in the heavy shape
    expect(heavy.ms, `heavy symbol took ${heavy.ms.toFixed(1)}ms`).toBeLessThan(3000)
  })

  it('writes the report', () => {
    if (OUT) {
      fs.mkdirSync(path.dirname(OUT), { recursive: true })
      fs.writeFileSync(OUT, JSON.stringify(report, null, 2))
    }
    expect(report.runs.length).toBeGreaterThan(5)
  })
})
