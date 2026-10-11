// app/src/components/chart/engine/__tests__/vendorHarness/runtimeLimitsBudget.measure.test.js
//
// ─── ⭐⭐ UIE PHASE 2 — WHAT `HISTORY` AND `LOOP_ITERATIONS` ACTUALLY COST ─────────
//
// The Phase B census (`runtimePaneReadiness.measure.test.js`) found two ceilings that
// stop scripts a member could reasonably run: `HISTORY` (20,000 bars) refuses every
// 5-minute chart that loads its full 20,208-32,000 bars, and `LOOP_ITERATIONS`
// (100,000 over a WHOLE run) refuses loop-heavy scripts part-way through an ordinary
// daily chart. Before either moves, this measures, for every runtime-only corpus script
// at every chart length, with both ceilings LIFTED (`opts.limits`, a measurement door no
// product caller passes):
//
//   * what the run really uses — loop iterations, instructions, the per-bar peak, the
//     MEMORY estimate — and the time and heap it takes;
//   * whether it fits the pane's own 1,000 ms budget (`RUNTIME_PANE_TIME_BUDGET_MS`);
//
// and, for a set of ADVERSARIAL programs on the longest chart (32,000 bars), which limit
// stops each one and how long the stop takes, under the old limits and the shipped ones.
//
// ⛔ OPT-IN, AND IT ASSERTS NO TIMING (a wall clock is the machine's). It asserts that
// every adversarial program is stopped BY NAME, under every limit set.
//   cd app && UIE_LIMITS_CENSUS=1 UIE_LIMITS_OUT=<file.json> node node_modules/vitest/vitest.mjs run \
//     --maxWorkers=1 src/components/chart/engine/__tests__/vendorHarness/runtimeLimitsBudget.measure.test.js
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import * as registry from '../../nativeRegistry'
import { computeRuntimeColumns, RUNTIME_PANE_TIME_BUDGET_MS } from '../../runtime/runtimeColumns'
import { DEFAULT_LIMITS } from '../../runtime/limits'
import { enterMemberDoor, HARNESS_DEF_ID } from './ourSide'

const RUN = process.env.UIE_LIMITS_CENSUS === '1'
const OUT = process.env.UIE_LIMITS_OUT
const REPO = path.resolve(process.cwd(), '..')
const CORPUS = path.join(REPO, 'corpus', 'committed')
const FIX = path.join(REPO, 'tests', 'fixtures', 'vendor', 'harness')
const DAILY = path.join(FIX, 'vw-deadband-ticks-aapl-1d-2026-09-28.json')
const FIVE = path.join(FIX, 'vw-bar-origin-rddt-5-2026-10-02.json')
const RUNS = 3
const LIFTED = { HISTORY: 1e9, LOOP_ITERATIONS: 1e12 }
/** The limits as they stood before this phase, for the adversarial comparison. */
const OLD = { HISTORY: 20000, LOOP_ITERATIONS: 100000 }

afterEach(() => { vi.unstubAllEnvs() })

const rowsOf = (file) => JSON.parse(fs.readFileSync(file, 'utf8')).bars.rows
const toBars = (rows) => rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }))
function longIntraday(rows, n) {
  const span = rows[rows.length - 1][0] - rows[0][0] + 300
  const head = rows.slice(0, n - rows.length).map(([t, ...rest]) => [t - span, ...rest])
  return [...head, ...rows]
}

function measure(def, rows, ctx, limits, budgetMs) {
  const times = []
  let peak = 0
  let err = null
  let counts = null
  for (let k = 0; k < RUNS; k += 1) {
    const bars = toBars(rows)
    const base = process.memoryUsage().heapUsed
    let calls = 0
    const now = () => {
      calls += 1
      if (calls % 512 === 0) {
        const h = process.memoryUsage().heapUsed - base
        if (h > peak) peak = h
      }
      return performance.now()
    }
    const t0 = performance.now()
    err = null
    try {
      computeRuntimeColumns(def, bars, ctx, {
        limits, now, ...(budgetMs ? { budgetMs } : { budgetMs: 600000 }),
        onBudget: (b) => { counts = { ...b.counts } },
      })
    } catch (e) { err = e }
    times.push(performance.now() - t0)
  }
  times.sort((a, b) => a - b)
  const stop = err ? (String(err.message).match(/\((\w+): at most/) || [])[1] || err.guard || err.name : null
  return {
    bars: rows.length,
    medianMs: Number(times[Math.floor(times.length / 2)].toFixed(1)),
    peakHeapMB: Number((peak / 1048576).toFixed(1)),
    stop,
    ...(counts ? {
      loopIterations: counts.LOOP_ITERATIONS,
      loopPerBar: Number((counts.LOOP_ITERATIONS / rows.length).toFixed(1)),
      totalInstructions: counts.TOTAL_INSTRUCTIONS,
      peakInstructionsPerBar: counts.INSTRUCTIONS_PER_BAR,
      memoryEstimateMB: Number((counts.MEMORY / 1048576).toFixed(1)),
      liveObjectsPeak: counts.LIVE_OBJECTS,
    } : {}),
  }
}

const synthetic = (body) => ({ id: 'adv', compute: { kind: 'runtime', fn: 'runtime:adv', outputs: { v: 0 },
  source: `//@version=6\nindicator("adv")\n${body}` } })

/** Programs written to exhaust a resource, each with the limit that should stop it. */
const ADVERSARIAL = {
  'per-bar runaway for': 'float s = 0.0\nfor i = 0 to 1000000000\n    s += i\nplot(s)\n',
  'heavy honest-looking for (30k/bar)': 'float s = 0.0\nfor i = 0 to 30000\n    s += i\nplot(s)\n',
  'moderate for (5k/bar)': 'float s = 0.0\nfor i = 0 to 5000\n    s += i\nplot(s)\n',
  'nested 200x200 for': 'float s = 0.0\nfor i = 0 to 199\n    for j = 0 to 199\n        s += j\nplot(s)\n',
  'while runaway': 'int k = 0\nwhile k >= 0\n    k += 1\nplot(k)\n',
  'array that grows every bar': 'var a = array.new_float(0)\nfor i = 0 to 9\n    array.push(a, close)\nplot(array.size(a))\n',
  'window over 5000 bars': 'plot(ta.sma(close, 5000))\n',
}

/** Loop-heavy programs an honest indicator writes, which the old whole-run count refused. */
const HONEST = {
  // name: [source, loop iterations a bar]
  '50-bar lookback loop': ['float s = 0.0\nfor i = 0 to 49\n    s += i * close\nplot(s)\n', 50],
  '150-bar lookback loop': ['float s = 0.0\nfor i = 0 to 149\n    s += close[i]\nplot(s)\n', 150],
  '300-bar lookback loop': ['float s = 0.0\nfor i = 0 to 299\n    s += i\nplot(s)\n', 300],
  'nested 20x10 loop': ['float s = 0.0\nfor i = 0 to 19\n    for j = 0 to 9\n        s += j\nplot(s)\n', 220],
}

describe.skipIf(!RUN)('UIE Phase 2 — HISTORY and LOOP_ITERATIONS, measured (opt-in)', () => {
  it('measures every runtime-only script lifted, and every adversarial program under each limit set', () => {
    expect(OUT, 'UIE_LIMITS_OUT must name the output file').toBeTruthy()
    const daily = rowsOf(DAILY)
    const five = rowsOf(FIVE)
    const lengths = [
      { name: 'D 5000', rows: daily.slice(-5000), tf: 'D' },
      { name: `D ${daily.length}`, rows: daily, tf: 'D' },
      { name: `5m ${five.length}`, rows: five, tf: '5' },
      { name: '5m 32000', rows: longIntraday(five, 32000), tf: '5' },
    ]
    const files = fs.readdirSync(CORPUS).filter((f) => f.endsWith('.pine')).sort()
    const scripts = []
    for (const f of files) {
      const source = fs.readFileSync(path.join(CORPUS, f), 'utf8')
      vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
      vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '')
      let offDoor
      try { offDoor = enterMemberDoor(source) } catch { offDoor = { def: null } }
      registry.uninstallUserDefinition(HARNESS_DEF_ID)
      if (offDoor.def) continue
      vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
      let door
      try { door = enterMemberDoor(source) } catch { registry.uninstallUserDefinition(HARNESS_DEF_ID); continue }
      registry.uninstallUserDefinition(HARNESS_DEF_ID)
      if (!door.def || !door.built || door.built.lane !== 'runtime') continue
      const slug = f.replace(/\.pine$/, '').split('__')[0]
      const ctx = (L) => ({ tf: L.tf, newestBarIsForming: false, historyFromListing: true })
      scripts.push({
        slug,
        runtimeHistory: (door.def.meta && door.def.meta.runtimeHistory) || null,
        lifted: lengths.map((L) => ({ length: L.name, ...measure(door.def, L.rows, ctx(L), LIFTED) })),
        shipped: lengths.map((L) => ({ length: L.name,
          ...measure(door.def, L.rows, ctx(L), undefined, RUNTIME_PANE_TIME_BUDGET_MS) })),
      })
    }
    expect(scripts.length).toBeGreaterThanOrEqual(10)

    // ⭐ The adversarial and honest programs run on the longest daily chart AND on the
    // longest chart any member loads (32,000 bars). On the latter `HISTORY` is lifted to
    // the bar count in every set, so what is measured is the LOOP and instruction
    // ceilings, not the bar-count refusal at bar 0.
    const adversarial = []
    const honest = []
    for (const L of [lengths[1], lengths[3]]) {
      const H = { HISTORY: Math.max(DEFAULT_LIMITS.HISTORY, L.rows.length) }
      const sets = [['old', { ...OLD, ...H }, null], ['shipped', H, null],
        ['shipped+pane', H, RUNTIME_PANE_TIME_BUDGET_MS]]
      const ctx = { tf: L.tf, newestBarIsForming: false }
      for (const [name, body] of Object.entries(ADVERSARIAL)) {
        const row = { name, length: L.name }
        for (const [label, limits, budgetMs] of sets) {
          const m = measure(synthetic(body), L.rows, ctx, limits, budgetMs)
          row[label] = { stop: m.stop, medianMs: m.medianMs, peakHeapMB: m.peakHeapMB }
          // ⛔ EVERY ONE IS STOPPED, BY NAME — never run to the end, never a freeze
          expect(m.stop, `${name} on ${L.name} under ${label}`).toBeTruthy()
        }
        adversarial.push(row)
      }
      for (const [name, [body, perBar]] of Object.entries(HONEST)) {
        const row = { name, length: L.name, needs: perBar * L.rows.length }
        for (const [label, limits, budgetMs] of sets) {
          const m = measure(synthetic(body), L.rows, ctx, limits, budgetMs)
          row[label] = { stop: m.stop, medianMs: m.medianMs, peakHeapMB: m.peakHeapMB,
            loopIterations: m.loopIterations ?? null }
        }
        // ⭐ the point of the change: a loop-heavy program whose whole run fits the
        // ceiling runs to its end; one that does not is stopped BY NAME, never cut short
        if (row.needs < DEFAULT_LIMITS.LOOP_ITERATIONS) expect(row.shipped.stop, `${name} on ${L.name}`).toBeNull()
        else expect(row.shipped.stop, `${name} on ${L.name}`).toMatch(/LOOP_ITERATIONS|TOTAL_INSTRUCTIONS/)
        honest.push(row)
      }
    }
    fs.writeFileSync(OUT, JSON.stringify({
      generatedBy: 'app/src/components/chart/engine/__tests__/vendorHarness/runtimeLimitsBudget.measure.test.js',
      shippedLimits: { HISTORY: DEFAULT_LIMITS.HISTORY, LOOP_ITERATIONS: DEFAULT_LIMITS.LOOP_ITERATIONS,
        INSTRUCTIONS_PER_BAR: DEFAULT_LIMITS.INSTRUCTIONS_PER_BAR, TOTAL_INSTRUCTIONS: DEFAULT_LIMITS.TOTAL_INSTRUCTIONS,
        WALL_TIME: DEFAULT_LIMITS.WALL_TIME, paneBudgetMs: RUNTIME_PANE_TIME_BUDGET_MS },
      oldLimits: OLD,
      scripts,
      adversarial,
      honest,
    }, null, 1))
  }, 3600000)
})
