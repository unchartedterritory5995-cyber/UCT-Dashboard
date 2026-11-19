// ─── ⭐⭐ (Fred RS filled chart, coordinator ruling 2026-11-19, engine 84; option A2, engine 86) — THE WORKER'S BUDGET ──
//
// `runtimeColumns.js::runtimePaneBudgetFor`: a run in the worker is held to min(12,000, 1,000 + 1.0 ms × the bars it
// covers past 5,000) (engine 84 shipped 0.35 and 4,000), and in the worker the VM's `WALL_TIME` follows that budget
// (`runLimitsOf`); every main-thread door keeps 1,000 ms, and every caller but the worker keeps `WALL_TIME` 5,000.
// These rails hold, on a STEPPING clock (each read of the host clock advances a fixed step, as
// `runtimeDoorBudget.rail.test.js` does), so no verdict depends on how busy the machine is:
//   1. up to 5,000 bars the budget is exactly 1,000 ms, and the stop names the pane's budget;
//   2. Fred RS's run half over 11,520 5m extended-hours bars, on a device where it costs 70% of its scaled budget, is
//      drawn by the worker, and the same device under the fixed 1,000 ms is refused;
//   2b. Fred RS over 15,360 bars on a device where it costs 95% of its budget, its first run alone past 5,000 ms, is
//      drawn: the worker's `WALL_TIME` follows the budget (with 5,000 it would stop there);
//   3. a runaway past the ceiling is refused `runtime:time-budget`, naming 12,000 ms;
//   4. the synchronous door (the main thread) keeps 1,000 ms where the worker scales, and the worker draws a run of
//      8,000 ms that the VM's 5,000 would have stopped;
//   5. the bars a run COVERS: a chart of 20,000 bars cut at its depth to fewer than 5,000 keeps 1,000 ms, and the
//      curtain's first run is held to the scaled number;
//   6. only the worker hands the VM its budget as `WALL_TIME`: every other caller keeps 5,000, each by name.
import { describe, it, expect, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import {
  computeRuntimeColumns, resetRuntimeSessions, resetRuntimeLedgers, runtimeColumnsFor, setRuntimeRunner,
  runtimePaneBudgetFor, runLimitsOf, RUNTIME_PANE_TIME_BUDGET_MS, RUNTIME_TIME_BUDGET_GUARD,
} from '../runtimeColumns.js'
import { DEFAULT_LIMITS } from '../limits.js'
import { resetRuntimeAsync } from '../runtimeAsync.js'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition.js'
import { OWN_DAILY_KEY } from '../../otherSymbols.js'

const REPO = path.resolve(process.cwd(), '..')
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); resetRuntimeAsync(); setRuntimeRunner(null); resetRuntimeSessions(); resetRuntimeLedgers() })

/** The host clock every run reads by default, stubbed: each read advances `step` ms. Returns the read count. */
function steppingClock(step) {
  const s = { t: 0, reads: 0 }
  vi.spyOn(globalThis.performance, 'now').mockImplementation(() => { s.reads += 1; s.t += step; return s.t })
  return s
}
const LF = String.fromCharCode(10)
const TINY = ['//@version=6', 'indicator("pb")', 'var float s = 0.0', 's := s + close', 'plot(s)', ''].join(LF)
const tiny = (meta = {}) => ({ id: 'u_pb', compute: { kind: 'runtime', fn: 'runtime:u_pb', rev: 1, source: TINY, outputs: { value: 0 } }, inputs: [], meta })
const daily = (n) => Array.from({ length: n }, (_, i) => ({ t: 1e9 + i * 86400, o: 1, h: 2, l: 0.5, c: 1 + (i % 7), v: 10 }))
const DCTX = { tf: 'D', newestBarIsForming: false, historyFromListing: true, symbol: { ticker: 'SPY', exchange: 'AMEX' } }
const refusedWith = (fn) => { try { fn(); return null } catch (e) { return e } }

/** Fred RS's run half (the member door's) over `count` regular trading sessions of 5m extended-hours bars (192 a
 *  session, 04:00-19:55 ET), with SPX, its daily rows, the chart's own daily rows and the rating seed supplied. */
function fredRs(count) {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1'); vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
  const RS = fs.readFileSync(path.join(REPO, 'docs/pine/rs-rating/rs-rating-fred6724__pziQwiT2.pine'), 'utf8')
  const ro = memberPaneDefinition({ source: RS, name: 'Fred RS', id: 'u_pb' }).definition.compute.runtimeObjects
  const half = { id: 'u_pb_half', compute: { kind: 'runtime', fn: 'runtime:u_pb_half', source: ro.source, objects: true, outputs: ro.outputs },
    meta: { runtimeHistory: 'listing' } }
  // 60 regular trading sessions (no NYSE holiday among them), 04:00-19:55 ET, SPX's regular session on each
  const ET = (day, hh, mm) => { const [y, m, d] = day.split('-').map(Number); return Date.UTC(y, m - 1, d, hh + (day < '2026-11-01' ? 4 : 5), mm) / 1000 }
  const isoPlus = (iso, d) => new Date(Date.parse(`${iso}T00:00:00Z`) + d * 86400000).toISOString().slice(0, 10)
  const sessions = []
  for (let d = '2026-11-13'; sessions.length < count; d = isoPlus(d, -1)) {
    if (![0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay()) && d !== '2026-09-07') sessions.unshift(d)
  }
  const chart = sessions.flatMap((d, k) => Array.from({ length: 192 }, (_, j) => {
    const c = 90 + k * 0.05 + Math.sin((k * 192 + j) / 9) + Math.cos(j / 23)
    return { t: ET(d, 4, 0) + j * 300, o: c - 0.1, h: c + 0.3, l: c - 0.3, c, v: 1000 + j }
  }))
  const spx = sessions.flatMap((d, k) => Array.from({ length: 78 }, (_, j) => {
    const c = 7300 + k * 5 + Math.cos(j / 7) * 3
    return { t: ET(d, 9, 30) + j * 300, o: c, h: c + 1, l: c - 1, c, v: 1 }
  }))
  const prev = isoPlus(sessions[0], -3)
  const spxd = [prev, ...sessions].map((d, k) => ({ t: Date.parse(`${d}T00:00:00Z`) / 1000, o: 1, h: 1, l: 1, c: 7290 + k * 5, v: 1 }))
  const ownd = [prev, ...sessions].map((d, k) => ({ t: d, o: 1, h: 1, l: 1, c: 89 + k * 0.1, v: 1 }))
  const seed = []
  for (let d = isoPlus(sessions[0], -20), k = 0; d <= '2026-11-16'; d = isoPlus(d, 1), k += 1) seed.push({ t: d, o: 0, h: 1000, l: 0, c: [190.9, 123.49, 75, 39.88, 12.98, 5, 2][Math.floor(k / 5) % 7], v: 0 })
  const ctx = { tf: '5', newestBarIsForming: false, historyFromListing: false,
    symbol: { ticker: 'RDDT', exchange: 'NYSE', industry: 'Internet Content & Information', sector: 'Communication Services', securityType: 'stock' },
    secondary: new Map([['SPX', { bars: spx, status: 'available' }], ['SPX@D', { bars: spxd, status: 'available' }],
      [OWN_DAILY_KEY, { bars: ownd, status: 'available' }], ['SEED_FRED6725_RS_RATING:RSRATING@D', { bars: seed, status: 'available' }]]),
    exchangeOf: (t) => (t === 'SPX' ? 'SP' : null) }
  return { half, chart, ctx }
}

describe('the budget of a run in the worker scales with the bars it covers', () => {
  it('1. the numbers, and up to 5,000 bars a stop at exactly 1,000 ms', () => {
    for (const n of [0, 100, 4000, 5000]) expect(runtimePaneBudgetFor(n)).toBe(1000)
    // ⭐ (engine 86, A2; the coordinator's final slope ruling: 1.0, the formula's floor) 1.0 ms a bar past 5,000
    // (was 0.35: 2,050 at 8,000, 3,282 at 11,520; A2 proposed 1.2: 4,600, 8,824)
    expect(runtimePaneBudgetFor(8000)).toBeCloseTo(4000, 6)
    expect(runtimePaneBudgetFor(11520)).toBeCloseTo(7520, 6)
    expect(runtimePaneBudgetFor(13440)).toBeCloseTo(9440, 6)
    // the ceiling: 12,000 from 16,000 bars (was 4,000 from 13,571)
    expect(runtimePaneBudgetFor(15999)).toBeLessThan(12000)
    expect(runtimePaneBudgetFor(16000)).toBe(12000)
    expect(runtimePaneBudgetFor(32768)).toBe(12000)
    steppingClock(1)    // a run of 4,000 bars reads the clock thousands of times: well past 1,000 ms
    const err = refusedWith(() => computeRuntimeColumns(tiny(), daily(4000), DCTX, { budgetMs: RUNTIME_PANE_TIME_BUDGET_MS, budgetScales: true }))
    expect(err && err.guard).toBe(RUNTIME_TIME_BUDGET_GUARD)
    expect(err.message).toMatch(/took more than 1000 ms/)
    expect(err.message, 'below 5,000 ms the pane stops it, never the VM').toMatch(/this pane's budget/)
  })

  it("2. Fred RS's run half over 11,520 5m bars: drawn on a device where it costs 70% of its scaled budget; refused there under the fixed 1,000", () => {
    const { half, chart, ctx } = fredRs(60)
    expect(chart.length).toBe(11520)
    // the array-operation ceiling is its own unit (#2002); lifted here so the time budget is what decides
    const limits = { ARRAY_OPERATIONS: 1e9 }
    const run = (step, budgetScales) => {
      vi.restoreAllMocks()
      const clock = steppingClock(step)
      resetRuntimeSessions(); resetRuntimeLedgers()
      const err = refusedWith(() => computeRuntimeColumns(half, chart, ctx, { budgetMs: RUNTIME_PANE_TIME_BUDGET_MS, budgetScales, limits }))
      return { err, reads: clock.reads }
    }
    // calibrate: how often this run reads the clock (a crawl: no budget can fire)
    const { err: none, reads } = run(1e-7, true)
    expect(none).toBe(null)
    const budget = runtimePaneBudgetFor(11520)
    const step = (0.7 * budget) / reads      // every read of the run: at most 70% of the budget is counted against it
    expect(run(step, true).err, 'the worker draws it').toBe(null)
    const fixed = run(step, false).err
    expect(fixed && fixed.guard, 'the fixed 1,000 ms refuses it').toBe(RUNTIME_TIME_BUDGET_GUARD)
  })

  it("2b. Fred RS over 15,360 bars, its first run alone past 5,000 ms, where the whole costs 95% of its budget: drawn (the worker's WALL_TIME follows the budget)", () => {
    // (engine 86 train, the final slope 1.0) 80 sessions: at 1.0 the 70 sessions this case used (13,440 bars, 9,440 ms)
    // put the first run alone at ~4,530 ms, short of the VM's 5,000, and the precondition below said so
    const { half, chart, ctx } = fredRs(80)
    expect(chart.length).toBe(15360)
    const limits = { ARRAY_OPERATIONS: 1e9 }
    const run = (step, c = ctx) => {
      vi.restoreAllMocks()
      const clock = steppingClock(step)
      resetRuntimeSessions(); resetRuntimeLedgers()
      const err = refusedWith(() => computeRuntimeColumns(half, chart, c, { budgetMs: RUNTIME_PANE_TIME_BUDGET_MS, budgetScales: true, limits }))
      return { err, reads: clock.reads }
    }
    // calibrate: the whole curtain's clock reads, and its first run's (the same program over every bar, one run)
    const whole = run(1e-7)
    expect(whole.err).toBe(null)
    const first = run(1e-7, { ...ctx, historyFromListing: true })
    expect(first.err).toBe(null)
    const budget = runtimePaneBudgetFor(15360)
    const step = (0.95 * budget) / whole.reads
    // the preconditions, so the case cannot pass by not reaching what it is about
    expect(step * whole.reads, 'the whole run is inside its budget').toBeLessThan(budget)
    expect(step * first.reads, "its first run alone is past the VM's 5,000 ms").toBeGreaterThan(DEFAULT_LIMITS.WALL_TIME)
    const { err } = run(step)
    expect(err && err.message, 'the worker draws it').toBe(null)
  }, 180000)

  it('3. a runaway past the ceiling is refused by name, naming 12,000 ms', () => {
    steppingClock(1)
    // 30,000 bars (under the 32,768-bar HISTORY ceiling) read the clock about 60,000 times: ~60,000 ms
    const err = refusedWith(() => computeRuntimeColumns(tiny(), daily(30000), DCTX, { budgetMs: RUNTIME_PANE_TIME_BUDGET_MS, budgetScales: true }))
    expect(err && err.guard).toBe(RUNTIME_TIME_BUDGET_GUARD)
    expect(err.message).toMatch(/took more than 12000 ms/)
  })

  it('4. the main thread keeps 1,000 ms (the synchronous door), the worker scales, and draws a run of 8,000 ms', async () => {
    // calibrate: how often a run of 20,000 bars reads the clock (a crawl: no budget can fire)
    const crawl = steppingClock(1e-7)
    expect(refusedWith(() => computeRuntimeColumns(tiny(), daily(20000), DCTX, { budgetMs: RUNTIME_PANE_TIME_BUDGET_MS, budgetScales: true }))).toBe(null)
    const reads = crawl.reads
    vi.restoreAllMocks(); resetRuntimeSessions(); resetRuntimeLedgers()
    steppingClock(24000 / reads)    // the run costs ~24,000 ms: past the worker's 12,000
    const door = refusedWith(() => runtimeColumnsFor(tiny(), daily(20000), {}, DCTX))
    expect(door && door.guard).toBe(RUNTIME_TIME_BUDGET_GUARD)
    expect(door.message).toMatch(/took more than 1000 ms/)
    // the worker's own entry, with the same clock
    const posted = []
    vi.stubGlobal('self', { postMessage: (m) => posted.push(m) })
    await import('../runtimeWorker.js')
    globalThis.self.onmessage({ data: { id: 3, def: tiny(), rows: daily(20000), ctx: DCTX } })
    expect(posted[0] && posted[0].ok).toBe(false)
    expect(JSON.stringify(posted[0].error)).toMatch(/took more than 12000 ms/)
    // ⭐ (engine 86, A2) a run of ~8,000 ms in one execute: past the VM's 5,000, inside the worker's 12,000 — drawn
    vi.restoreAllMocks(); resetRuntimeSessions(); resetRuntimeLedgers()
    vi.stubGlobal('self', globalThis.self)
    steppingClock(8000 / reads)
    globalThis.self.onmessage({ data: { id: 4, def: tiny(), rows: daily(20000), ctx: DCTX } })
    expect(posted[1] && posted[1].error, 'the worker draws it').toBe(undefined)
    expect(posted[1].ok).toBe(true)
  })

  it('5. the bars a run COVERS: cut at its depth to fewer than 5,000, a 20,000-bar chart keeps 1,000 ms', () => {
    // a 5m chart of 20,000 regular-session bars whose SP:SPX bars our store holds only for the last 50 sessions
    // (trading sessions only: a session on an NYSE holiday reads as a HOLE, not a depth; each day's own DST offset)
    const HOLIDAYS = new Set(['2025-01-01', '2025-01-09', '2025-01-20', '2025-02-17', '2025-04-18', '2025-05-26', '2025-06-19',
      '2025-07-04', '2025-09-01', '2025-11-27', '2025-12-25', '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25',
      '2026-06-19', '2026-07-03', '2026-09-07'])
    const dst = (d) => (d >= '2025-03-09' && d < '2025-11-02') || (d >= '2026-03-08' && d < '2026-11-01')
    const ET = (day, hh, mm) => { const [y, m, d] = day.split('-').map(Number); return Date.UTC(y, m - 1, d, hh + (dst(day) ? 4 : 5), mm) / 1000 }
    const days = []
    for (let t = Date.UTC(2026, 10, 13) / 1000; days.length < 257; t -= 86400) {
      const d = new Date(t * 1000).toISOString().slice(0, 10)
      if (![0, 6].includes(new Date(t * 1000).getUTCDay()) && !HOLIDAYS.has(d)) days.unshift(d)
    }
    const rth = (list, base) => list.flatMap((d, k) => Array.from({ length: 78 }, (_, j) => ({ t: ET(d, 9, 30) + j * 300, o: base + k, h: base + k + 1, l: base + k - 1, c: base + k + Math.sin(j / 9), v: 1 })))
    const chart = rth(days, 90).slice(-20000)
    const spx = rth(days.slice(-50), 7300)
    const def = { id: 'u_pb_req', compute: { kind: 'runtime', fn: 'runtime:u_pb_req', rev: 1,
      source: ['//@version=6', 'indicator("pbr")', 'x = request.security("SP:SPX", timeframe.period, close)', 'plot(x)', ''].join(LF), outputs: { value: 0 } },
    inputs: [], meta: { runtimeHistory: 'listing' } }
    const dailyOf = (list, base, key) => list.map((d, k) => ({ t: key(d), o: 1, h: 1, l: 1, c: base + k, v: 1 }))
    const ctx = { tf: '5', newestBarIsForming: false, historyFromListing: false,
      symbol: { ticker: 'RDDT', exchange: 'NYSE', industry: 'Internet Content & Information', sector: 'Communication Services', securityType: 'stock' },
      secondary: new Map([['SPX', { bars: spx, status: 'available' }],
        ['SPX@D', { bars: dailyOf(days, 7290, (d) => Date.parse(`${d}T00:00:00Z`) / 1000), status: 'available' }],
        [OWN_DAILY_KEY, { bars: dailyOf(days, 89, (d) => d), status: 'available' }]]),
      exchangeOf: (t) => (t === 'SPX' ? 'SP' : null) }
    expect(chart.length).toBe(20000)
    steppingClock(1)
    const err = refusedWith(() => computeRuntimeColumns(def, chart, ctx, { budgetMs: RUNTIME_PANE_TIME_BUDGET_MS, budgetScales: true }))
    expect(err && err.guard, err && err.message).toBe(RUNTIME_TIME_BUDGET_GUARD)
    expect(err.message, '50 x 78 = 3,900 bars covered: the 1,000 ms floor').toMatch(/took more than 1000 ms/)
    // and over the whole chart (no request: no cut) the curtain's first run is held to the scaled number
    vi.restoreAllMocks()
    steppingClock(1)
    const whole = refusedWith(() => computeRuntimeColumns(tiny({ runtimeHistory: 'listing' }), chart, { ...ctx, secondary: new Map() },
      { budgetMs: RUNTIME_PANE_TIME_BUDGET_MS, budgetScales: true }))
    expect(whole && whole.guard).toBe(RUNTIME_TIME_BUDGET_GUARD)
    expect(whole.message).toMatch(/took more than 12000 ms/)
  })

  it('6. only the worker hands the VM its budget as WALL_TIME: every other caller keeps 5,000, each by name', () => {
    expect(DEFAULT_LIMITS.WALL_TIME).toBe(5000)
    const BIG = runtimePaneBudgetFor(13440)    // 9,440 ms
    // the worker (`runtimeWorker.js`), and the curtain's two runs of its job (`wallFollowsBudget`)
    expect(runLimitsOf({ budgetMs: RUNTIME_PANE_TIME_BUDGET_MS, budgetScales: true }, BIG)).toEqual({ WALL_TIME: BIG })
    expect(runLimitsOf({ budgetMs: BIG, budgetScales: false, wallFollowsBudget: true }, BIG)).toEqual({ WALL_TIME: BIG })
    // a limit a measurement names beside it is kept; a WALL_TIME it names wins
    expect(runLimitsOf({ budgetScales: true, limits: { ARRAY_OPERATIONS: 1e9 } }, BIG)).toEqual({ ARRAY_OPERATIONS: 1e9, WALL_TIME: BIG })
    const named = { WALL_TIME: 777 }
    expect(runLimitsOf({ budgetScales: true, limits: named }, BIG)).toBe(named)
    // at or below 5,000 ms nothing changes, even in the worker: the pane's own budget stops it first, as before
    expect(runLimitsOf({ budgetMs: RUNTIME_PANE_TIME_BUDGET_MS, budgetScales: true }, 5000)).toBe(undefined)
    expect(runLimitsOf({ budgetMs: RUNTIME_PANE_TIME_BUDGET_MS, budgetScales: true }, 3000)).toBe(undefined)
    // EVERY OTHER CALLER, by name, with the options it passes: the VM keeps DEFAULT_LIMITS (WALL_TIME 5,000)
    const others = {
      'runtimeColumns.js::runtimeColumnsFor (the synchronous door, the main thread)': { budgetMs: RUNTIME_PANE_TIME_BUDGET_MS, now: () => 0 },
      'runtimeAsync.js::runHere (a browser with no Worker, the main thread)': { budgetMs: RUNTIME_PANE_TIME_BUDGET_MS },
      'headlessCompute.js (the screener and alert lane)': { incremental: false, now: () => 0, onBudget: () => {} },
      'services/pine_runtime/job.mjs (the service)': { budgetMs: RUNTIME_PANE_TIME_BUDGET_MS, incremental: false },
      'tools/pine_runtime_host_parity.mjs (the parity host)': { incremental: false },
      'a caller that passes a long budget but does not scale it': { budgetMs: BIG },
    }
    for (const [who, opts] of Object.entries(others)) expect(runLimitsOf(opts, BIG), who).toBe(undefined)
    const census = { WALL_TIME: 600000, TOTAL_INSTRUCTIONS: 1e12 }
    expect(runLimitsOf({ limits: census, budgetMs: 600000 }, 600000), 'the limits census (vendorHarness/runtimeLimitsBudget)').toBe(census)
    // ...and that IS the options each passes: the source of every product call, read here, so a caller that starts
    // passing `budgetScales` (or the curtain's marker) shows up by name
    const ROOT = path.resolve(process.cwd(), '..')
    const callers = {
      'app/src/components/chart/engine/runtime/runtimeWorker.js': true,
      'app/src/components/chart/engine/runtime/runtimeAsync.js': false,
      'app/src/components/chart/engine/headlessCompute.js': false,
      'services/pine_runtime/job.mjs': false,
      'tools/pine_runtime_host_parity.mjs': false,
    }
    for (const [file, scales] of Object.entries(callers)) {
      const text = fs.readFileSync(path.join(ROOT, file), 'utf8')
      const calls = [...text.matchAll(/computeRuntimeColumns\(([^\n]*(?:\n(?!\s*\}\s*catch)[^\n]*){0,4})/g)].map((m) => m[1])
      expect(calls.length, `${file} calls the run`).toBeGreaterThan(0)
      expect(calls.some((c) => /budgetScales: true/.test(c)), `${file} scales the budget`).toBe(scales)
      expect(text.includes('wallFollowsBudget'), `${file} never names the curtain's marker`).toBe(false)
    }
    // the service declares the worker's scaling browser-only (its adapter rail, HP-7, holds the two call shapes)
    expect(fs.readFileSync(path.join(ROOT, 'services/pine_runtime/job.mjs'), 'utf8')).toMatch(/optsBrowserOnly: Object\.freeze\(\['budgetScales'\]\)/)
    // behaviour, for the caller that does not scale: a run of ~8,000 ms in one execute is stopped by the VM at 5,000
    const crawl = steppingClock(1e-7)
    expect(refusedWith(() => computeRuntimeColumns(tiny(), daily(20000), DCTX, { budgetMs: BIG }))).toBe(null)
    const reads = crawl.reads
    vi.restoreAllMocks(); resetRuntimeSessions(); resetRuntimeLedgers()
    steppingClock(8000 / reads)
    const stopped = refusedWith(() => computeRuntimeColumns(tiny(), daily(20000), DCTX, { budgetMs: BIG }))
    expect(stopped && stopped.guard).toBe(RUNTIME_TIME_BUDGET_GUARD)
    expect(stopped.message).toMatch(/took more than 5000 ms .*the most time one run of a script may take/)
  })
})
