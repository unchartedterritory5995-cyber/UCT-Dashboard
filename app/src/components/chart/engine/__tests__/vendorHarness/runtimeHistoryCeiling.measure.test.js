// app/src/components/chart/engine/__tests__/vendorHarness/runtimeHistoryCeiling.measure.test.js
//
// ⭐⭐ UIE PHASE 3 (M2) — THE `HISTORY` CEILING AT 20,000, 30,000, 32,000 AND 32,768 BARS,
// through the PRODUCT path a member's pane takes: `computeRuntimeColumns` under the
// pane's own 1,000 ms budget (`RUNTIME_PANE_TIME_BUDGET_MS`), the warm-up curtain for a
// listing document (a 5-minute chart never reaches the listing), the shipped limits
// with only `HISTORY` set to the bar count under test.
//
// For every runtime-only corpus script, at every length: the outcome (drawn / the named
// refusal), the time (best of RUNS), the run's MEMORY estimate and the heap growth, and
// that two runs draw bit-identical values (determinism). For every adversarial program
// (the limits census's), at every length: that it is stopped BY NAME, and how long the
// stop takes — a larger window must not let a runaway run longer than the budget allows.
//
// ⛔ OPT-IN (UIE_HISTORY_CEILING=1, UIE_HISTORY_OUT=<file.json>). Asserts the safety
// properties (named stops, bounded stop time, determinism, MEMORY under its ceiling); the
// wall-clock numbers are the machine's and are reported, not asserted.
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import * as registry from '../../nativeRegistry'
import { computeRuntimeColumns, RUNTIME_PANE_TIME_BUDGET_MS } from '../../runtime/runtimeColumns'
import { runtimeWarmupOf } from '../../runtime/runtimeObjects'
import { DEFAULT_LIMITS } from '../../runtime/limits'
import { enterMemberDoor, HARNESS_DEF_ID } from './ourSide'

const RUN = process.env.UIE_HISTORY_CEILING === '1'
const OUT = process.env.UIE_HISTORY_OUT
const REPO = path.resolve(process.cwd(), '..')
const CORPUS = path.join(REPO, 'corpus', 'committed')
const FIVE = path.join(REPO, 'tests', 'fixtures', 'vendor', 'harness', 'vw-bar-origin-rddt-5-2026-10-02.json')
const LENGTHS = [20000, 30000, 32000, 32768]
const RUNS = 3
const SYM = { ticker: 'RDDT', exchange: 'NYSE' }
// what a stop may take past the pane budget: the bar it is checked at the end of, and
// the curtain's bookkeeping. Measured well under this; a runaway would be seconds.
const STOP_SLACK_MS = 400

afterEach(() => { vi.unstubAllEnvs() })

const toBars = (rows) => rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }))
function longIntraday(rows, n) {
  // the real 5-minute capture, with its own earlier copy stitched on in front (shifted
  // back in time) until it is n bars long — real bar shapes, strictly increasing times
  let out = rows.slice()
  while (out.length < n) {
    const span = out[out.length - 1][0] - out[0][0] + 300
    out = [...rows.map(([t, ...rest]) => [t - span, ...rest]).slice(-(n - out.length)), ...out]
  }
  return out.slice(-n)
}

const ADVERSARIAL = {
  'per-bar runaway for': 'float s = 0.0\nfor i = 0 to 1000000000\n    s += i\nplot(s)\n',
  'heavy for (30k/bar)': 'float s = 0.0\nfor i = 0 to 30000\n    s += i\nplot(s)\n',
  'moderate for (5k/bar)': 'float s = 0.0\nfor i = 0 to 5000\n    s += i\nplot(s)\n',
  'nested 200x200 for': 'float s = 0.0\nfor i = 0 to 199\n    for j = 0 to 199\n        s += j\nplot(s)\n',
  'while runaway': 'int k = 0\nwhile k >= 0\n    k += 1\nplot(k)\n',
  'array that grows every bar': 'var a = array.new_float(0)\nfor i = 0 to 9\n    array.push(a, close)\nplot(array.size(a))\n',
  'window over 5000 bars': 'plot(ta.sma(close, 5000))\n',
  'listing doc, never converges': 'var int k = 0\nk += 1\nplot(k)\n',
}
const synthetic = (body, listing) => ({ id: 'adv', ...(listing ? { meta: { runtimeHistory: 'listing' } } : {}),
  compute: { kind: 'runtime', fn: 'runtime:adv', outputs: { v: 0 }, source: `//@version=6\nindicator("adv")\n${body}` } })

function runOnce(def, bars, limits) {
  const base = process.memoryUsage().heapUsed
  let peak = 0
  let calls = 0
  const now = () => {
    calls += 1
    if (calls % 256 === 0) { const h = process.memoryUsage().heapUsed - base; if (h > peak) peak = h }
    return performance.now()
  }
  let memory = 0
  const t0 = performance.now()
  try {
    const cols = computeRuntimeColumns(def, bars, { tf: '5', newestBarIsForming: false, symbol: SYM },
      { limits, now, budgetMs: RUNTIME_PANE_TIME_BUDGET_MS, onBudget: (b) => { memory = Math.max(memory, b.counts.MEMORY || 0) } })
    return { ms: performance.now() - t0, cols, peakHeapMB: peak / 1048576, memoryMB: memory / 1048576 }
  } catch (e) {
    const stop = (String(e.message).match(/\((\w+): at most/) || [])[1] || e.guard || e.name
    return { ms: performance.now() - t0, stop, peakHeapMB: peak / 1048576, memoryMB: memory / 1048576 }
  }
}

const identical = (a, b) => {
  const ka = Object.keys(a)
  if (ka.length !== Object.keys(b).length) return false
  for (const k of ka) {
    if (!b[k] || a[k].length !== b[k].length) return false
    for (let i = 0; i < a[k].length; i += 1) if (!Object.is(a[k][i], b[k][i])) return false
  }
  return true
}

describe.skipIf(!RUN)('UIE Phase 3 M2 — HISTORY at 20,000 / 30,000 / 32,000 / 32,768 (opt-in)', () => {
  it('measures every runtime-only script and every adversarial program at every length', () => {
    expect(OUT, 'UIE_HISTORY_OUT must name the output file').toBeTruthy()
    const five = JSON.parse(fs.readFileSync(FIVE, 'utf8')).bars.rows
    const charts = LENGTHS.map((n) => ({ n, bars: toBars(longIntraday(five, n)) }))
    const scripts = []
    for (const f of fs.readdirSync(CORPUS).filter((x) => x.endsWith('.pine')).sort()) {
      const source = fs.readFileSync(path.join(CORPUS, f), 'utf8')
      vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
      vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '')
      let off
      try { off = enterMemberDoor(source) } catch { off = { def: null } }
      registry.uninstallUserDefinition(HARNESS_DEF_ID)
      if (off.def) continue
      vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
      let door
      try { door = enterMemberDoor(source) } catch { registry.uninstallUserDefinition(HARNESS_DEF_ID); continue }
      registry.uninstallUserDefinition(HARNESS_DEF_ID)
      if (!door.def || !door.built || door.built.lane !== 'runtime') continue
      const row = { slug: f.replace(/\.pine$/, '').split('__')[0], at: {} }
      for (const c of charts) {
        const limits = { HISTORY: c.n }
        const runs = Array.from({ length: RUNS }, () => runOnce(door.def, c.bars, limits))
        const first = runs[0]
        // ⛔ deterministic: every run of the same chart ends the same way, bit for bit
        for (const r of runs.slice(1)) {
          expect(r.stop, `${row.slug} ${c.n}`).toBe(first.stop)
          if (!first.stop) expect(identical(first.cols, r.cols), `${row.slug} ${c.n} identical`).toBe(true)
        }
        // ⛔ bounded: drawn or stopped, it never runs far past the pane budget
        expect(Math.min(...runs.map((r) => r.ms)), `${row.slug} ${c.n}`).toBeLessThan(RUNTIME_PANE_TIME_BUDGET_MS + STOP_SLACK_MS)
        expect(first.memoryMB).toBeLessThan(DEFAULT_LIMITS.MEMORY / 1048576)
        const w = first.cols ? runtimeWarmupOf(first.cols) : null
        row.at[c.n] = {
          outcome: first.stop || 'drawn',
          bestMs: Math.round(Math.min(...runs.map((r) => r.ms))),
          memoryMB: Number(first.memoryMB.toFixed(1)),
          peakHeapMB: Number(Math.max(...runs.map((r) => r.peakHeapMB)).toFixed(1)),
          ...(w ? { warmupBars: w.withheldBars, secondRunStoppedAt: w.secondRunStoppedAt ?? null } : {}),
        }
      }
      scripts.push(row)
    }
    expect(scripts.length).toBeGreaterThanOrEqual(10)

    const adversarial = []
    for (const [name, body] of Object.entries(ADVERSARIAL)) {
      const row = { name, at: {} }
      for (const c of charts) {
        const r = runOnce(synthetic(body, name.startsWith('listing')), c.bars, { HISTORY: c.n })
        // ⛔ every one stopped BY NAME, and within the budget's reach
        expect(r.stop, `${name} ${c.n}`).toBeTruthy()
        expect(r.ms, `${name} ${c.n}`).toBeLessThan(RUNTIME_PANE_TIME_BUDGET_MS + STOP_SLACK_MS)
        row.at[c.n] = { stop: r.stop, ms: Math.round(r.ms), peakHeapMB: Number(r.peakHeapMB.toFixed(1)) }
      }
      adversarial.push(row)
    }

    // ⛔ and one bar past the ceiling under test is still refused at bar 0, by name
    const over = runOnce(synthetic('plot(close)\n'), toBars(longIntraday(five, 32769)), { HISTORY: 32768 })
    expect(over.stop).toBe('HISTORY')

    fs.writeFileSync(OUT, JSON.stringify({
      generatedBy: 'app/src/components/chart/engine/__tests__/vendorHarness/runtimeHistoryCeiling.measure.test.js',
      paneBudgetMs: RUNTIME_PANE_TIME_BUDGET_MS, memoryCeilingMB: DEFAULT_LIMITS.MEMORY / 1048576,
      lengths: LENGTHS, scripts, adversarial, over: over.stop,
    }, null, 1))
  }, 3600000)
})
