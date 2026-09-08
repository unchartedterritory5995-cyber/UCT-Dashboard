// app/src/components/chart/engine/runtime/__tests__/carriedPerf.test.js
//
// ─── ⭐ WHAT CARRIED STATE COSTS (2F-2C, §65–§68) ───────────────────────────
//
// ⭐⭐ THE OPPOSITE SHAPE TO A WINDOW, AND THAT IS THE HEADLINE. A finite window
// reads `span` cells EVERY BAR and holds nothing between them; a recurrence reads
// ONE value per bar and holds three scalars forever. So a recurrence should be
// cheap in time and its cost should not move with the LENGTH at all — `ema(x, 5)`
// and `ema(x, 500)` do identical work. That is measured here rather than asserted,
// because "obviously cheap" is how an O(n) surprise survives to a 5,000-symbol scan.
//
// ⛔ IT MEASURES THE VM, NOT THE FRONT END (`historyPerf.test.js`'s rule).
// Compiling Pine is once per scan; only the bar loop runs per symbol.
//
// ⚠️ WALL TIME ON ONE LAPTOP IS AN ORDER OF MAGNITUDE. What survives is the
// SHAPE and the exact cell arithmetic; ceilings are loose enough to fail for a
// regression and not for a busy machine.
//
//   CARRIED_PERF_OUT   write the JSON report here

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'
import { CARRIED } from '../../ast/interpret.js'

const OUT = process.env.CARRIED_PERF_OUT
  ? path.resolve(process.cwd(), process.env.CARRIED_PERF_OUT) : null
const head = '//@version=5\nindicator("p")\n'

const bars = (n) => Array.from({ length: n }, (_, i) => ({
  t: 1700000000 + i * 86400,
  o: 100 + (i % 17), h: 103 + (i % 19), l: 97 + (i % 13),
  c: 100 + Math.sin(i / 3.1) * 9, v: 1000 + (i % 97),
}))
const columnsOf = (b) => ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(b.map((x) => x[k])))

/** `sites` recurrent calls over distinct runtime state, each of length `len`. */
function sourceFor(sites, len, inUdf) {
  const lines = []
  if (inUdf) lines.push(`f(v) =>`, `    ta.ema(v, ${len})`)
  for (let i = 0; i < sites; i += 1) {
    lines.push(`var s${i} = 0.0`)
    lines.push(`s${i} := close + ${i}`)
  }
  const term = (i) => (inUdf ? `f(s${i})` : `ta.ema(s${i}, ${len})`)
  lines.push(`plot(${Array.from({ length: sites }, (_, i) => term(i)).join(' + ')})`)
  return head + lines.join('\n') + '\n'
}

function timeRun(sites, len, n, { inUdf = false, reps = 3 } = {}) {
  const b = bars(n)
  const built = buildRuntimeIr(sourceFor(sites, len, inUdf), { bars: b, inputs: {} })
  expect(built.ok, built.ok ? '' : JSON.stringify(built.refusal)).toBe(true)
  const program = lowerIrProgram(built.ir)
  const env = { bars: n, series: columnsOf(b), columns: program.columns, confirmed: true }
  execute(program, env)                                    // warm the JIT
  let best = Infinity
  let res = null
  for (let r = 0; r < reps; r += 1) {
    const t0 = performance.now()
    res = execute(program, env)
    best = Math.min(best, performance.now() - t0)
  }
  return {
    ms: best,
    steps: res.budget.counts.CARRIED_STEPS,
    cells: res.budget.counts.CARRIED_CELLS,
    instances: res.budget.counts.CARRIED_INSTANCES,
    rings: program.history.length,
  }
}

const report = { runs: [], length: [], udf: {}, market: {}, state: {} }

describe('⭐ carried state — cost in bars, sites and length', () => {
  it('⭐ the report: sites x bars, with the step count beside the time', () => {
    for (const sites of [1, 10, 100]) {
      for (const n of [300, 5000]) {
        const r = timeRun(sites, 14, n)
        report.runs.push({ sites, len: 14, bars: n, ...r })
        expect(r.steps, `${sites}x${n} took no steps`).toBe(sites * n)
        expect(r.instances).toBe(sites)
        // ⛔ NO RINGS. The whole point of the shape: a recurrence allocates no
        // history for its inputs, however long its length.
        expect(r.rings, 'a recurrence must allocate no history ring').toBe(0)
      }
    }
  })

  it('⭐ LINEAR IN BARS', () => {
    for (const sites of [1, 10, 100]) {
      const small = report.runs.find((r) => r.sites === sites && r.bars === 300)
      const big = report.runs.find((r) => r.sites === sites && r.bars === 5000)
      expect(big.steps / small.steps).toBeCloseTo(5000 / 300, 6)   // exactly linear WORK
      const ratio = big.ms / Math.max(small.ms, 0.02)
      expect(ratio, `${sites} sites: ${ratio.toFixed(1)}x for 16.7x the bars`).toBeLessThan(150)
    }
  })

  it('⭐⭐ FLAT IN LENGTH — the property a window does not have', () => {
    // ⭐ `ema(x, 500)` does exactly as much work as `ema(x, 5)`: one multiply-add
    // and three scalars. Compare with `windowPerf.test.js`, where 40x the span
    // reads 40x the cells (and still costs only 1.3x, because dispatch dominates
    // there too). Here the CELL COUNT itself does not move at all.
    const spans = [5, 50, 500].map((len) => ({ len, ...timeRun(1, len, 5000) }))
    report.length = spans
    for (const s of spans) {
      expect(s.steps).toBe(5000)
      expect(s.cells).toBe(CARRIED.ema.cells)      // three scalars, whatever the length
    }
    const ratio = spans[2].ms / Math.max(spans[0].ms, 0.02)
    expect(ratio, `100x the length cost ${ratio.toFixed(1)}x`).toBeLessThan(6)
  })

  it('⭐ UDF CALL OVERHEAD, separated', () => {
    // The same recurrence reached directly and through a call frame. The delta is
    // the frame, not the step, and naming it stops a future "recurrence is slow"
    // finding that is really a call-overhead finding.
    const direct = timeRun(10, 14, 5000)
    const viaUdf = timeRun(10, 14, 5000, { inUdf: true })
    report.udf = { direct: direct.ms, viaUdf: viaUdf.ms, ratio: viaUdf.ms / Math.max(direct.ms, 0.02) }
    expect(viaUdf.steps).toBe(direct.steps)
    expect(report.udf.ratio, `a call frame cost ${report.udf.ratio.toFixed(2)}x`).toBeLessThan(12)
  })
})

describe('⛔⛔ the 5,000-symbol scan', () => {
  it('⭐ per-symbol state is bounded and exactly predictable', () => {
    // ⭐ EXACT ARITHMETIC, NOT A TIMING. `cells` per instance is a property of
    // the TABLE, so per-symbol memory is a property of the PROGRAM and can be
    // stated before a single bar runs — which is what makes a scan plannable.
    const r = timeRun(100, 14, 300)
    const bytes = r.cells * 8
    report.state = {
      instances: r.instances,
      cellsPerInstance: CARRIED.ema.cells,
      cells: r.cells,
      bytesPerSymbol: bytes,
      bytesFor5000Symbols: bytes * 5000,
    }
    expect(r.cells).toBe(100 * CARRIED.ema.cells)
    // 100 recurrences is already an extreme script; it must stay trivial.
    expect(bytes, `${bytes} bytes/symbol`).toBeLessThan(4096)
  })

  it('⛔ the scan estimate, typical and heavy', () => {
    const typical = timeRun(4, 14, 300)
    const heavy = timeRun(20, 200, 5000)
    const S = 5000
    report.market = {
      typical: { perSymbolMs: typical.ms, scanSeconds: (typical.ms * S) / 1000, steps: typical.steps },
      heavy: { perSymbolMs: heavy.ms, scanSeconds: (heavy.ms * S) / 1000, steps: heavy.steps },
      note: 'CARRIED_STEPS is per execution — it bounds a runaway SYMBOL, never the SCAN.',
    }
    expect(heavy.steps).toBe(20 * 5000)
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
