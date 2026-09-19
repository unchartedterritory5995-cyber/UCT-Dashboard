// app/src/components/chart/engine/runtime/__tests__/historyPerf.test.js
//
// ─── ⭐ WHAT RUNTIME HISTORY COSTS (§56/§57) ────────────────────────────────
//
// History is the first thing this runtime allocates PER SYMBOL that is not
// bounded by the program text alone, so it is the first thing that could make a
// whole-market scan infeasible. Measured, not assumed.
//
// ⛔ IT MEASURES THE VM, NOT THE FRONT END. Building the IR from Pine source is a
// once-per-scan cost with a different fix (compile once, run per symbol); mixing
// them would report a compile as a per-bar expense — the same error Phase 1's
// reused-buffer control existed to catch, which inverted that wave's conclusion.
//
// ⚠️ WALL TIME ON ONE LAPTOP IS AN ORDER OF MAGNITUDE, NOT A NUMBER. What is
// meant to survive is the SHAPE — how cost moves with slots and with bars — and
// the memory arithmetic, which is exact. The only assertions are non-vacuity and
// a ceiling loose enough that it can fail for a regression and not for a busy
// machine (`lesson_an_acceptance_number_is_a_forecast_until_derived`).
//
//   HISTORY_PERF_OUT   write the JSON report here

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import {
  makeIrProgram, SLOT, num, read, binary, series, declare, assign, emit,
} from '../ir.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const OUT = process.env.HISTORY_PERF_OUT
  ? path.resolve(process.cwd(), process.env.HISTORY_PERF_OUT) : null

/** A program with `n` history-bearing state slots, each READ at `depth` back.
 *  ⭐ Read as well as written: a write-only ring would understate the cost of the
 *  thing scripts actually do, which is `s := close + s[1]`. */
function programWith(n, depth) {
  const slots = []; const history = []; const statements = []
  for (let i = 0; i < n; i += 1) {
    slots.push({ name: `s${i}`, kind: SLOT.PERSIST })
    history.push({ name: `s${i}`, varSlot: i, depth })
    statements.push(declare(i, num(0)))
  }
  for (let i = 0; i < n; i += 1) {
    statements.push(assign(i, binary('+', series('close'),
      { kind: 'hist', of: read(i), slot: i, back: depth })))
  }
  statements.push(emit(0, read(0)))
  return lowerIrProgram(makeIrProgram({ slots, history, statements, outputs: ['out'] }))
}

/** The same program shape with NO history at all — the baseline that turns a
 *  wall-clock number into an attributable one. Without it, "history costs 2ms"
 *  is a statement about the bar loop, not about history. */
function programWithout(n) {
  const slots = []; const statements = []
  for (let i = 0; i < n; i += 1) {
    slots.push({ name: `s${i}`, kind: SLOT.PERSIST })
    statements.push(declare(i, num(0)))
  }
  for (let i = 0; i < n; i += 1) {
    statements.push(assign(i, binary('+', series('close'), read(i))))
  }
  statements.push(emit(0, read(0)))
  return lowerIrProgram(makeIrProgram({ slots, statements, outputs: ['out'] }))
}

const NAMES = ['open', 'high', 'low', 'close', 'volume']
function ctxFor(bars) {
  const s = NAMES.map(() => new Float64Array(bars))
  for (let i = 0; i < bars; i += 1) {
    for (let k = 0; k < 5; k += 1) s[k][i] = 100 + Math.sin(i / 7) * 5 + k
  }
  return { bars, series: s, columns: [], confirmed: true }
}
const timeIt = (fn, reps) => {
  fn(); fn()
  const t0 = performance.now()
  for (let r = 0; r < reps; r += 1) fn()
  return (performance.now() - t0) / reps
}
const mb = (b) => Math.round((b / 1048576) * 100) / 100

const DEPTH = 1
const rows = []
for (const bars of [300, 5000]) {
  const ctx = ctxFor(bars)
  for (const n of [1, 10, 100]) {
    const withH = programWith(n, DEPTH)
    const without = programWithout(n)
    const reps = bars > 1000 ? 20 : 200
    const msH = timeIt(() => execute(withH, ctx), reps)
    const msN = timeIt(() => execute(without, ctx), reps)
    rows.push({
      bars,
      slots: n,
      cells: withH.history.reduce((s, h) => s + h.depth, 0),
      msWithHistory: Math.round(msH * 1000) / 1000,
      msNoHistory: Math.round(msN * 1000) / 1000,
      overheadPct: Math.round(((msH - msN) / msN) * 1000) / 10,
      nsPerBar: Math.round((msH * 1e6) / bars),
      ringBytes: withH.history.reduce((s, h) => s + h.depth, 0) * 8,
    })
  }
}

// ── the whole-market question (§57) ──
// ⭐ THE RING IS PER SYMBOL; THE PROGRAM IS NOT. A compiled program is shared
// across a scan, so what multiplies by 5,000 is the ring, never the bytecode.
const UNIVERSE = 5000
const at = (bars, slots) => rows.find((r) => r.bars === bars && r.slots === slots)
const market = {
  universe: UNIVERSE,
  shared: 'the compiled program — bytecode, consts, columns — is scanned once and reused',
  perSymbol: 'the history rings only',
  corpusTypical: {
    note: 'the 2F-2 census: 29 of 35 scripts want exactly one bar back; 3 slots is a busy one',
    slots: 3, depth: 1, bytesPerSymbol: 24, totalMB: mb(UNIVERSE * 24),
  },
  tenSlots: { bytesPerSymbol: 10 * DEPTH * 8, totalMB: mb(UNIVERSE * 10 * DEPTH * 8),
    vmSecondsAt5000Bars: Math.round(UNIVERSE * at(5000, 10).msWithHistory) / 1000 },
  hundredSlots: { bytesPerSymbol: 100 * DEPTH * 8, totalMB: mb(UNIVERSE * 100 * DEPTH * 8),
    vmSecondsAt5000Bars: Math.round(UNIVERSE * at(5000, 100).msWithHistory) / 1000 },
}
if (OUT) fs.writeFileSync(OUT, JSON.stringify({ rows, market, depth: DEPTH }, null, 2))

describe('⭐ what runtime history costs', () => {
  it('reports the shape, against a no-history baseline', () => {
    /* eslint-disable no-console */
    const p = (v, w) => String(v).padStart(w)
    console.log('\n   bars  slots  cells   ms(hist)  ms(none)  overhead   ns/bar   ring B')
    console.log('   ' + '-'.repeat(64))
    for (const r of rows) {
      console.log(`   ${p(r.bars, 4)}  ${p(r.slots, 5)}  ${p(r.cells, 5)}  `
        + `${p(r.msWithHistory, 8)}  ${p(r.msNoHistory, 8)}  ${p(r.overheadPct + '%', 8)}  `
        + `${p(r.nsPerBar, 6)}  ${p(r.ringBytes, 6)}`)
    }
    console.log(`\n   whole market (${UNIVERSE} symbols, rings only — the program is shared):`)
    console.log(`     census-typical  3 slots x 1 bar = ${market.corpusTypical.bytesPerSymbol} B/symbol -> ${market.corpusTypical.totalMB} MB`)
    console.log(`     10 slots        -> ${market.tenSlots.totalMB} MB, ${market.tenSlots.vmSecondsAt5000Bars} s VM time at 5,000 bars`)
    console.log(`     100 slots       -> ${market.hundredSlots.totalMB} MB, ${market.hundredSlots.vmSecondsAt5000Bars} s VM time at 5,000 bars`)
    /* eslint-enable no-console */
    expect(rows).toHaveLength(6)
  })

  it('⛔ memory is EXACTLY slots x depth x 8 bytes — arithmetic, not a measurement', () => {
    // The one number here that is not laptop-dependent, and the one the
    // whole-market model rests on. A ring is a Float64 per bar per slot; nothing
    // else is allocated per symbol.
    for (const r of rows) expect(r.ringBytes).toBe(r.slots * DEPTH * 8)
    expect(market.corpusTypical.totalMB).toBeLessThan(1)
  })

  it('⛔ cost is LINEAR in bars, not quadratic — the ring never grows', () => {
    // A history implementation that appended to a host array would show 5000/300
    // bars costing far more than 16.7x. The ring is why it does not.
    for (const slots of [1, 10, 100]) {
      const small = at(300, slots)
      const big = at(5000, slots)
      const ratio = big.msWithHistory / small.msWithHistory
      // ⚠️ GENEROUS ON PURPOSE. This is wall-clock on a shared machine, and the
      // suite runs 200+ files in parallel — a tight ratio here fails for LOAD, not
      // for a regression, and a rail that goes red when the laptop is busy gets
      // muted (`lesson_an_intermittent_red_can_be_a_population_not_a_test`).
      // Measured quiet: ~5.3x. Quadratic growth would be ~280x, so 120 separates
      // the two failure modes without being noise-sensitive.
      expect(ratio, `${slots} slots: ${ratio.toFixed(1)}x for 16.7x the bars`).toBeLessThan(120)
    }
  })
})
