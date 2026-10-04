// app/src/components/chart/engine/runtime/__tests__/runtimePaneSafety.test.jsx
//
// ─── ⭐⭐ RF — A RUNTIME PANE THAT FAILS LEAVES THE CHART USABLE AND SAYS WHY ────
//
// Readiness audit for switching the runtime pane on (`docs/pine/runtime-pane-
// switch-on-plan.md`). Each way a run can fail is driven here and must end in
// the same two facts: nothing partial is drawn, and the member reads a NAMED
// reason on the chart's disclosure strip. Before RF, measured:
//   * every stop but the script's own `runtime.error` reached the registry as a
//     column error, and NO surface rendered a column error (`columnErrors` is
//     "not UX", C2A.8) — an empty pane with no sentence. The six runtime-only
//     corpus scripts are all fallback documents, so on every intraday chart and
//     every daily chart that does not reach the listing that was the answer;
//   * a VM limit / an unexpected throw arrived as `engine:error` with the text
//     `HISTORY_EXCEEDED — ceiling 20000, reached 20208`;
//   * a worker that never answered left the pane "in flight" forever;
//   * a worker that died had its jobs re-run on the MAIN thread (up to the full
//     1,000 ms budget each, per update on a live chart);
//   * a lane chunk that failed to load was retried on every paint, silently.
// And H14 (CLAUDE.md, the 2026-09-10 navigation freeze): a runtime landing
// re-renders the chart through `useServerColumns`; the commits must stay bounded.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'

import * as registry from '../../nativeRegistry'
import { createBinder } from '../../binder'
import { createFakeChart, makeBars } from '../../__tests__/fakeChart'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'
import { runtimeErrorNotices, resetRuntimeErrorNotices } from '../../runtimeErrorNotice'
import AttachedPineDisclosures from '../../../pane/AttachedPineDisclosures'
import { useServerColumns } from '../../useServerColumns'
import {
  computeRuntimeColumns, runtimeColumnsFor, setRuntimeRunner,
  RUNTIME_HISTORY_GUARD, RUNTIME_LIMIT_GUARD, RUNTIME_FAILED_GUARD, RUNTIME_TIME_BUDGET_GUARD,
} from '../runtimeColumns'
import {
  workerRunner, resetRuntimeAsync, ensureRuntimeLane,
  RUNTIME_WORKER_WATCHDOG_MS, RUNTIME_WORKER_MAX_STARTS,
  RUNTIME_WORKER_UNRESPONSIVE_GUARD, RUNTIME_WORKER_FAILED_GUARD,
} from '../runtimeAsync'

const LF = String.fromCharCode(10)
const REPO = path.resolve(process.cwd(), '..')
const ADX = path.join(REPO, 'tests', 'fixtures', 'vendor', 'harness', 'adx-and-di-for-v4-rddt-1d-2026-09-27.json')
const ADX_SOURCE = JSON.parse(fs.readFileSync(ADX, 'utf8')).source.text

const TINY = ['//@version=5', 'indicator("t")', 'var float s = 0.0', 's := s + close', 'plot(s)', ''].join(LF)
// a collection error on the first bar: Pine stops the script here, this lane names it
// ⚰️ RT7 — this was `array.max` of an empty array, which is MEASURED now (na, as Pine;
// `rt7ArrayNa.test.js`). ⚰️ H7 — then `array.sum` of an empty array, MEASURED too (na,
// CAP4 Q-RT7a). `array.first` of an empty array is a stop Pine itself makes.
const EMPTY_MAX = ['//@version=5', 'indicator("t")', 'a = array.new_float(0)', 'plot(array.first(a))', ''].join(LF)

const rtDef = (source, id = 'u_rf_safety') => ({
  id,
  version: 1,
  compute: { kind: 'runtime', fn: `rf:${id}:${source.length}`, source, outputs: { value: 0 } },
  meta: { name: 'rf' },
  plots: [{ key: 'value' }],
})
const rows = (n, start = 1e9) => Array.from({ length: n }, (_, i) => ({
  t: start + i * 86400, o: 1, h: 2, l: 0.5, c: 1 + (i % 7), v: 10,
}))

afterEach(() => {
  resetRuntimeAsync()
  setRuntimeRunner(null)
  registry.registerRuntimeLane(null)
  registry.registerRuntimeLaneLoader(null)
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

// ─── 1. every stop of the run is NAMED, at the run and at the registry ──────────

describe('RF — a VM throw and a limit stop are refusals by name, never `engine:error`', () => {
  beforeEach(() => { registry.registerRuntimeLane(runtimeColumnsFor) })

  it('⛔ a collection error (Pine stops the script) is `runtime:failed`, its own reason kept, the bar named', () => {
    let err = null
    try { computeRuntimeColumns(rtDef(EMPTY_MAX), rows(30), { tf: 'D' }) } catch (e) { err = e }
    expect(err.guard).toBe(RUNTIME_FAILED_GUARD)
    expect(err.message).toMatch(/stopped on bar 0 of 30/)
    expect(err.message).toMatch(/array\.first: the array is empty/)
    // through the registry: a reason, never a throw on the paint path
    const cols = registry.computeFor(rtDef(EMPTY_MAX, 'u_rf_f2'), rows(30), undefined, { tf: 'D' })
    expect(Object.keys(cols)).toEqual([])
    expect(registry.columnErrors(cols).value.guard).toBe(RUNTIME_FAILED_GUARD)
    // control: the same lane on a script that computes draws it
    expect(computeRuntimeColumns(rtDef(TINY), rows(30), { tf: 'D' }).value.length).toBe(30)
  })

  it('⛔ a VM limit (more bars than `HISTORY` holds) is `runtime:limit`, naming the limit', () => {
    let err = null
    try { computeRuntimeColumns(rtDef(TINY), rows(20001), { tf: 'D' }) } catch (e) { err = e }
    expect(err.guard).toBe(RUNTIME_LIMIT_GUARD)
    expect(err.message).toMatch(/HISTORY: at most 20000, it reached 20001/)
    expect(err.message).not.toMatch(/_EXCEEDED/)
  })

  it('⭐ the script\'s own `runtime.error` is left to C43 (not re-labelled)', () => {
    const src = ['//@version=6', 'indicator("t")', 'if bar_index == 3', '    runtime.error("stop")', 'plot(close)', ''].join(LF)
    let err = null
    try { computeRuntimeColumns(rtDef(src), rows(10), { tf: 'D' }) } catch (e) { err = e }
    expect(err.name).toBe('runtime.error')
    expect(err.guard).not.toBe(RUNTIME_FAILED_GUARD)
    expect(err.message).toBe('stop')
  })
})

describe('RF — `runtimeRunStopOf`: the sentence for a runtime pane that drew nothing', () => {
  beforeEach(() => { registry.registerRuntimeLane(runtimeColumnsFor) })

  it('⭐ a refused run yields its guard and its message; a drawn run, an in-flight run and a non-runtime document yield nothing', () => {
    const def = rtDef(EMPTY_MAX, 'u_rf_s1')
    const stop = registry.runtimeRunStopOf(def, registry.computeFor(def, rows(20), undefined, { tf: 'D' }))
    expect(stop.guard).toBe(RUNTIME_FAILED_GUARD)
    expect(stop.sentence).toMatch(/^not drawn on this chart \(runtime:failed\): this script stopped on bar 0/)
    const ok = rtDef(TINY, 'u_rf_s2')
    expect(registry.runtimeRunStopOf(ok, registry.computeFor(ok, rows(20), undefined, { tf: 'D' }))).toBeNull()
    expect(registry.runtimeRunStopOf(ok, {})).toBeNull() // in flight: no error recorded
    expect(registry.runtimeRunStopOf({ ...ok, compute: { ...ok.compute, kind: 'ast' } }, { __x: 1 })).toBeNull()
  })

  it('⛔ a reached `runtime.error` is C43\'s sentence, never doubled by this one', () => {
    const src = ['//@version=6', 'indicator("t")', 'if bar_index == 3', '    runtime.error("stop")', 'plot(close)', ''].join(LF)
    const def = rtDef(src, 'u_rf_s3')
    const cols = registry.computeFor(def, rows(10), undefined, { tf: 'D' })
    expect(registry.runtimeErrorStopOf(cols)).toBeTruthy()
    expect(registry.runtimeRunStopOf(def, cols)).toBeNull()
  })
})

// ─── 2. the binder publishes it; the strip under the chart renders it ──────────

describe('RF — the member reads WHY on the disclosure strip (real binder, real strip)', () => {
  const DEF_ID = 'u_rf_binder'
  let fake
  let binder
  beforeEach(() => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
    resetRuntimeErrorNotices()
    fake = createFakeChart()
    binder = createBinder({ chart: fake.chart, LWC: fake.LWC })
  })
  afterEach(() => {
    cleanup()
    binder.teardown()
    registry.uninstallUserDefinition(DEF_ID)
    resetRuntimeErrorNotices()
  })
  const install = () => {
    const built = memberPaneDefinition({ source: ADX_SOURCE, id: DEF_ID, name: 'ADX and DI' })
    expect(built.ok, built.reason).toBe(true)
    expect(built.lane).toBe('runtime')
    const { installed, errors } = registry.installUserDefinitions([built.definition])
    expect(installed.length, errors.join(' | ')).toBe(1)
    return installed[0]
  }
  const ctxFor = (extra = {}) => ({
    enabled: true,
    instances: [{ instanceId: 'i1', defId: DEF_ID, inputs: {}, hidden: false }],
    registry,
    bars: makeBars(),
    tf: 'D',
    newestBarIsForming: false,
    adjustTime: (t) => t,
    plan: { fresh: true },
    applyData: (series, data) => { if (series && data) series.setData(data) },
    resolvePlacement: (i) => ({ paneIndex: 0, scaleId: i.defId, scaleOptions: {} }),
    ...extra,
  })
  const settings = { indicatorInstances: [{ instanceId: 'i1', defId: DEF_ID, hidden: false }] }

  it('⭐ a chart that does not start at the listing: the strip names `runtime:history-start` and the chart still binds', () => {
    install()
    binder.sync(ctxFor())
    const notices = runtimeErrorNotices()
    expect(notices.length).toBe(1)
    expect(notices[0][1]).toMatch(new RegExp(`\\(${RUNTIME_HISTORY_GUARD}\\)`))
    render(<AttachedPineDisclosures settings={settings} registry={registry} />)
    const row = screen.getByText(/runtime:history-start/)
    expect(row.textContent).toMatch(/^ADX and DI — not drawn on this chart \(runtime:history-start\): this script is drawn bar by bar/)
    // the chart is not wedged: syncing again is cheap and stays at one notice
    binder.sync(ctxFor())
    expect(runtimeErrorNotices().length).toBe(1)
  })

  it('⛔ CONTROL — the same document on a listing-start series draws, and says nothing', () => {
    install()
    binder.sync(ctxFor({ historyFromListing: true }))
    expect(runtimeErrorNotices()).toEqual([])
    expect(binder.bindings().length).toBeGreaterThan(0)
  })

  it('⭐ the sentence leaves when the run draws again, and when the binder releases', () => {
    install()
    binder.sync(ctxFor())
    expect(runtimeErrorNotices().length).toBe(1)
    binder.sync(ctxFor({ historyFromListing: true }))
    expect(runtimeErrorNotices()).toEqual([])
    binder.sync(ctxFor())
    expect(runtimeErrorNotices().length).toBe(1)
    binder.sync({ ...ctxFor(), enabled: false })
    expect(runtimeErrorNotices()).toEqual([])
  })
})

// ─── 3. the worker: crash, hang, flood ──────────────────────────────────────────

/** A fake worker that runs the worker module's message contract. `mode`:
 *  'ok' answers on a microtask; 'hang' never answers; 'die' errors on post;
 *  'manual' holds every message until `flush()`. */
function fakeWorkers(mode = 'ok') {
  const made = []
  const factory = () => {
    const w = {
      posted: [],
      terminated: false,
      queue: [],
      postMessage(msg) {
        this.posted.push(msg)
        if (mode === 'hang') return
        if (mode === 'die') { queueMicrotask(() => this.onerror && this.onerror(new Error('boom'))); return }
        if (mode === 'manual') { this.queue.push(msg); return }
        queueMicrotask(() => this.answer(msg))
      },
      answer(msg) {
        try {
          const columns = computeRuntimeColumns(msg.def, msg.rows, msg.ctx)
          this.onmessage({ data: { id: msg.id, ok: true, columns } })
        } catch (err) {
          this.onmessage({ data: { id: msg.id, ok: false, error: { name: err.name, message: err.message, guard: err.guard || null } } })
        }
      },
      flush() { const q = this.queue; this.queue = []; for (const m of q) this.answer(m) },
      terminate() { this.terminated = true },
    }
    made.push(w)
    return w
  }
  return { factory, made }
}
const runOnce = (run, def, r, ctx = { tf: 'D' }) => new Promise((resolve) => run(def, r, ctx, (err, cols) => resolve({ err, cols })))

describe('RF — a worker that dies: its jobs are answered by name, nothing runs on this thread', () => {
  it('⛔ the in-flight job carries `runtime:worker-failed`; the next job starts a FRESH worker', async () => {
    const dying = fakeWorkers('die')
    const run = workerRunner(dying.factory)
    const got = await runOnce(run, rtDef(TINY), rows(30))
    expect(got.cols).toBeNull()
    expect(got.err.guard).toBe(RUNTIME_WORKER_FAILED_GUARD)
    expect(got.err.message).toMatch(/The chart is unaffected/)
    expect(dying.made[0].terminated).toBe(true)
    // the next job is posted to a new worker (it may be a stale-chunk load failure)
    const again = await runOnce(run, rtDef(TINY), rows(30))
    expect(again.err.guard).toBe(RUNTIME_WORKER_FAILED_GUARD)
    expect(dying.made.length).toBe(2)
  })

  it('⛔ after `RUNTIME_WORKER_MAX_STARTS` it stops starting workers and answers by name, still never on this thread', async () => {
    const dying = fakeWorkers('die')
    const run = workerRunner(dying.factory)
    for (let k = 0; k < RUNTIME_WORKER_MAX_STARTS + 3; k += 1) {
      const got = await runOnce(run, rtDef(TINY, `u_rf_d${k}`), rows(20))
      expect(got.err.guard).toBe(RUNTIME_WORKER_FAILED_GUARD)
      expect(got.cols).toBeNull()
    }
    expect(dying.made.length).toBe(RUNTIME_WORKER_MAX_STARTS)
  })

  it('⭐ CONTROL — a browser that cannot construct a worker at all runs here, under the same budget', async () => {
    const run = workerRunner(() => { throw new Error('no workers in this browser') })
    const got = await runOnce(run, rtDef(TINY), rows(30))
    expect(got.err).toBeNull()
    expect(got.cols.value.length).toBe(30)
  })
})

describe('RF — a worker that never answers: the watchdog stops it by name', () => {
  it('⛔ past `RUNTIME_WORKER_WATCHDOG_MS` the job carries `runtime:worker-unresponsive` and the worker is terminated', async () => {
    vi.useFakeTimers()
    const hung = fakeWorkers('hang')
    const run = workerRunner(hung.factory)
    let got = null
    run(rtDef(TINY), rows(30), { tf: 'D' }, (err, cols) => { got = { err, cols } })
    vi.advanceTimersByTime(RUNTIME_WORKER_WATCHDOG_MS - 1)
    expect(got).toBeNull() // control: not one millisecond early
    vi.advanceTimersByTime(2)
    expect(got.cols).toBeNull()
    expect(got.err.guard).toBe(RUNTIME_WORKER_UNRESPONSIVE_GUARD)
    expect(hung.made[0].terminated).toBe(true)
  })

  it('⭐ a worker that answers in time is never killed (the timer is disarmed on the answer)', async () => {
    vi.useFakeTimers()
    const slow = fakeWorkers('manual')
    const run = workerRunner(slow.factory)
    let got = null
    run(rtDef(TINY), rows(30), { tf: 'D' }, (err, cols) => { got = { err, cols } })
    vi.advanceTimersByTime(RUNTIME_WORKER_WATCHDOG_MS - 100)
    slow.made[0].flush()
    expect(got.err).toBeNull()
    vi.advanceTimersByTime(RUNTIME_WORKER_WATCHDOG_MS * 3)
    expect(slow.made[0].terminated).toBe(false)
  })
})

describe('RF — a live chart floods the worker: only the newest waiting run of a pane is kept', () => {
  it('⭐ while one run is in the worker, ten new bars arrays post ONE more run — the newest', async () => {
    const slow = fakeWorkers('manual')
    const run = workerRunner(slow.factory)
    const answered = []
    const def = rtDef(TINY)
    const arrays = Array.from({ length: 11 }, (_, k) => rows(30 + k))
    arrays.forEach((r, k) => run(def, r, { tf: 'D' }, (err, cols) => answered.push({ k, err, n: cols && cols.value.length })))
    expect(slow.made[0].posted.length).toBe(1)
    slow.made[0].flush() // the first lands; the newest held one is posted
    expect(slow.made[0].posted.length).toBe(2)
    slow.made[0].flush()
    expect(answered.map((a) => a.k)).toEqual([0, 10])
    expect(answered[1].n).toBe(40)
    // ⛔ superseded runs are never answered (their bars are no longer the chart's)
    expect(answered.length).toBe(2)
  })

  it('⛔ CONTROL — two different panes are not coalesced', () => {
    const slow = fakeWorkers('manual')
    const run = workerRunner(slow.factory)
    run(rtDef(TINY, 'u_rf_a'), rows(30), { tf: 'D' }, () => {})
    run(rtDef(TINY, 'u_rf_b'), rows(30), { tf: 'D' }, () => {})
    run(rtDef(TINY, 'u_rf_a'), rows(30), { tf: '60' }, () => {})
    expect(slow.made[0].posted.length).toBe(3)
  })
})

// ─── 4. the lane chunk does not load ────────────────────────────────────────────

describe('RF — the lane chunk fails to load: named once, not retried on every paint', () => {
  it('⛔ the paint draws nothing while loading, then `runtime:load-failed`; the loader is called once', async () => {
    vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
    registry.registerRuntimeLane(null)
    const loader = vi.fn(() => Promise.reject(new Error('Failed to fetch dynamically imported module')))
    registry.registerRuntimeLaneLoader(loader)
    const def = rtDef(TINY, 'u_rf_load')
    expect(registry.computeFor(def, rows(20), undefined, { tf: 'D' })).toEqual({})
    await vi.waitFor(() => {
      const cols = registry.computeFor(def, rows(20), undefined, { tf: 'D' })
      expect(registry.columnErrors(cols).value.guard).toBe(registry.RUNTIME_LOAD_FAILED_GUARD)
    })
    for (let k = 0; k < 5; k += 1) registry.computeFor(def, rows(20), undefined, { tf: 'D' })
    expect(loader).toHaveBeenCalledTimes(1)
    const stop = registry.runtimeRunStopOf(def, registry.computeFor(def, rows(20), undefined, { tf: 'D' }))
    expect(stop.sentence).toMatch(/could not be loaded in this tab .*reloading the page tries again/)
  })
})

// ─── 5. H14: a landing re-renders the chart; the commits stay bounded ───────────

describe('RF / H14 — a runtime landing cannot drive its host into a render loop', () => {
  it('⭐ a pane that recomputes on every generation renders a BOUNDED number of times, and the worker sees ONE run', async () => {
    const { factory, made } = fakeWorkers('ok')
    ensureRuntimeLane({ factory })
    const def = rtDef(TINY, 'u_rf_h14')
    const bars = rows(60) // the chart's memoised bars: one identity across renders
    let renders = 0
    function Pane() {
      useServerColumns()
      renders += 1
      const cols = registry.computeFor(def, bars, undefined, { tf: 'D' })
      return <div data-testid="pane">{cols.value ? `drawn ${cols.value.length}` : 'waiting'}</div>
    }
    render(<Pane />)
    await screen.findByText('drawn 60')
    await act(async () => { await new Promise((r) => setTimeout(r, 50)) })
    const settled = renders
    expect(settled).toBeLessThanOrEqual(3) // first paint, the landing, at most one StrictMode-free echo
    await act(async () => { await new Promise((r) => setTimeout(r, 100)) })
    expect(renders).toBe(settled) // quiescent: nothing re-renders it after the landing
    expect(made.length).toBe(1)
    expect(made[0].posted.length).toBe(1)
    cleanup()
  })

  it('⛔ a host that hands NEW bars every render (the hazard) is still bounded by the worker: at most one run in flight per pane', async () => {
    const { factory, made } = fakeWorkers('manual')
    ensureRuntimeLane({ factory })
    const def = rtDef(TINY, 'u_rf_h14b')
    let renders = 0
    function Pane() {
      useServerColumns()
      renders += 1
      registry.computeFor(def, rows(60), undefined, { tf: 'D' }) // a fresh array per render
      return <div>{renders}</div>
    }
    render(<Pane />)
    for (let k = 0; k < 5; k += 1) {
      await act(async () => { made[0].flush(); await new Promise((r) => setTimeout(r, 0)) })
    }
    // each landing re-renders once and posts one run; never more than one waiting
    expect(made[0].posted.length).toBeLessThanOrEqual(6)
    expect(made[0].queue.length).toBeLessThanOrEqual(1)
    cleanup()
  })
})

describe('RF — the time budget, through the registry', () => {
  it('⛔ a run past the budget is a named refusal the strip can say', () => {
    registry.registerRuntimeLane((d, b, i, ctx) => {
      let clock = 0
      return computeRuntimeColumns(d, b, ctx, { budgetMs: 100, now: () => { clock += 10; return clock } })
    })
    const def = rtDef(TINY, 'u_rf_budget')
    const cols = registry.computeFor(def, rows(50), undefined, { tf: 'D' })
    const stop = registry.runtimeRunStopOf(def, cols)
    expect(stop.guard).toBe(RUNTIME_TIME_BUDGET_GUARD)
    expect(stop.sentence).toMatch(/took more than 100 ms to draw bar by bar/)
  })
})
