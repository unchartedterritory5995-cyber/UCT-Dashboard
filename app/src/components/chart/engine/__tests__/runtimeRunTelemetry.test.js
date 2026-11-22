// app/src/components/chart/engine/__tests__/runtimeRunTelemetry.test.js
//
// ⭐⭐ U4 (2026-11-14) — THE RUN COUNT, the cohort gate's denominator, CLIENT half.
//
// What must hold:
//   • every run the lane ANSWERS is counted once, by outcome (ok / a stop by code / declined),
//     with its round trip in the closed histogram;
//   • a CACHED result is not a run: a repaint over the same bars reaches no runner and no count;
//   • nothing is sent per run: one batch leaves after `RUNS_FLUSH_MS` (or on page hide), and
//     never more than `RUNS_BEACONS_PER_HOUR` in a rolling hour (a batch over budget is KEPT,
//     not lost); a full batch counts what it cannot keep as `dropped`; the chart never waits;
//   • a batch is integers under closed keys: no source, no hash, no sentence.
// The server half is `tests/test_pine_runtime_run_telemetry.py`.
import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from 'vitest'
import {
  noteRuntimeRunStarted, noteRuntimeRunSettled, noteRuntimeLoadFailed, flushRuntimeRuns,
  pendingRuntimeRuns, setRuntimeRunsReporter, resetRuntimeRunTelemetry, runMsBucketOf, runStopCodeOf,
  RUNS_FLUSH_MS, RUNS_BEACONS_PER_HOUR, RUNS_MAX_PER_BATCH, RUNS_MIN_GAP_MS, RUN_MS_BUCKETS,
  RUNTIME_RUNS_BEACON_URL, runtimeRunsTab,
} from '../runtimeRunTelemetry.js'
import { workerRunner, resetRuntimeAsync } from '../runtime/runtimeAsync.js'
import { runtimeColumnsFor, setRuntimeRunner } from '../runtime/runtimeColumns.js'

const HEAD = '//@version=6\nindicator("t")\n'
const DOUBLING = HEAD + 'var string s = "ab"\nfor i = 0 to 29\n    s := s + s\nplot(s == "zz" ? 1 : 0, "v")\n'
const PLAIN = '//@version=5\nindicator("t")\nvar float s = 0.0\ns := s + close\nplot(s)\n'
const docOf = (source, id = 'd') => ({ id, compute: { kind: 'runtime', fn: `runtime:${id}`, source, outputs: { v: 0 } } })
const bars = (n = 40) => Array.from({ length: n }, (_, i) => ({ t: 1e9 + i * 86400, o: 1, h: 2, l: 0.5, c: 1 + i, v: 10 }))

let workerSelf = null
beforeAll(async () => {
  workerSelf = { onmessage: null, postMessage: null }
  vi.stubGlobal('self', workerSelf)
  await import('../runtime/runtimeWorker.js')
})
afterAll(() => vi.unstubAllGlobals())

function realWorkerFactory({ dies = false } = {}) {
  return () => {
    const w = {
      postMessage(msg) {
        queueMicrotask(() => {
          if (dies) { w.onerror && w.onerror(new Error('boom')); return }
          workerSelf.postMessage = (data) => w.onmessage({ data })
          workerSelf.onmessage({ data: msg })
        })
      },
      terminate() {},
    }
    return w
  }
}
const runOnce = (run, def, rows) => new Promise((resolve) => run(def, rows, { tf: 'D' }, (err, cols) => resolve({ err, cols })))

afterEach(() => {
  vi.useRealTimers()
  resetRuntimeAsync()
  resetRuntimeRunTelemetry()
  setRuntimeRunsReporter(null)
  setRuntimeRunner(null)
})

describe('U4 — what a run counts as', () => {
  it('⭐ real runs through the real worker: an ok run and a MEMORY stop, by code, each timed', async () => {
    const run = workerRunner(realWorkerFactory())
    const a = await runOnce(run, docOf(PLAIN, 'a'), bars())
    const b = await runOnce(run, docOf(DOUBLING, 'b'), bars())
    expect(a.err).toBeNull()
    expect(b.err && b.err.guard).toBe('runtime:limit')
    const p = pendingRuntimeRuns()
    expect(p.started).toBe(2)
    expect(p.ok).toBe(1)
    expect(p.declined).toBe(0)
    expect(p.stops).toEqual({ [`runtime:limit:${b.err.limit}`]: 1 })
    expect(Object.values(p.ms).reduce((x, y) => x + y, 0)).toBe(2)
  })

  it('a worker that dies is a worker-failed STOP for every job it held', async () => {
    const run = workerRunner(realWorkerFactory({ dies: true }))
    const r = await runOnce(run, docOf(PLAIN), bars())
    expect(r.err.guard).toBe('runtime:worker-failed')
    expect(pendingRuntimeRuns().stops).toEqual({ 'runtime:worker-failed': 1 })
  })

  it('⛔ a CACHED result is not a run: the same bars repainted reach no runner and no count', async () => {
    const run = workerRunner(realWorkerFactory())
    let landed = null
    const wrapped = (def, rows, ctx, done) => run(def, rows, ctx, (e, c) => { done(e, c); landed && landed() })
    setRuntimeRunner(wrapped)
    const def = docOf(PLAIN, 'memo')
    const rows = bars()
    await new Promise((resolve) => { landed = resolve; runtimeColumnsFor(def, rows, {}, { tf: 'D' }) })
    for (let i = 0; i < 5; i += 1) runtimeColumnsFor(def, rows, {}, { tf: 'D' })
    const p = pendingRuntimeRuns()
    expect(p.started).toBe(1)
    expect(p.ok).toBe(1)
  })

  it('a refusal that is not a stop counts as declined; the load failure counts once per tab', () => {
    noteRuntimeRunSettled({ guard: 'runtime:conditional-history' }, 3)
    noteRuntimeRunSettled(Object.assign(new Error('x'), { guard: 'runtime:limit', limit: 'not a name' }), 4)
    noteRuntimeLoadFailed()
    noteRuntimeLoadFailed()
    const p = pendingRuntimeRuns()
    expect(p.declined).toBe(1)
    expect(p.stops).toEqual({ 'runtime:limit': 1, 'runtime:load-failed': 1 })
  })

  it('the histogram keys are the declared edges and `inf`', () => {
    expect(runMsBucketOf(0)).toBe('1')
    expect(runMsBucketOf(1.2)).toBe('2')
    expect(runMsBucketOf(999)).toBe('1000')
    expect(runMsBucketOf(RUN_MS_BUCKETS[RUN_MS_BUCKETS.length - 1] + 1)).toBe('inf')
    expect(runMsBucketOf(NaN)).toBe('1')
    expect(runStopCodeOf({ guard: 'runtime:killed' })).toBeNull()
    expect(runStopCodeOf({ guard: 'runtime:limit', limit: 'MEMORY' })).toBe('runtime:limit:MEMORY')
  })
})

describe('U4 — instant always: batched, rate-limited, fire-and-forget', () => {
  it('⛔ nothing leaves per run; ONE batch leaves after the flush window, then the count restarts', () => {
    vi.useFakeTimers()
    const sent = []
    setRuntimeRunsReporter((b) => sent.push(b))
    for (let i = 0; i < 50; i += 1) { noteRuntimeRunStarted(); noteRuntimeRunSettled(null, 12) }
    expect(sent).toEqual([])
    vi.advanceTimersByTime(RUNS_FLUSH_MS - 1)
    expect(sent).toEqual([])
    vi.advanceTimersByTime(1)
    expect(sent).toEqual([{ tab: runtimeRunsTab(), started: 50, ok: 50, declined: 0, stops: {}, ms: { 15: 50 } }])
    expect(pendingRuntimeRuns().ok).toBe(0)
    vi.advanceTimersByTime(RUNS_FLUSH_MS * 3)
    expect(sent.length).toBe(1)          // an empty batch is never sent
  })

  it('a batch carries no source, no hash and no sentence', () => {
    const sent = []
    setRuntimeRunsReporter((b) => sent.push(b))
    noteRuntimeRunSettled(Object.assign(new Error(`the script ${PLAIN} stopped`), { guard: 'runtime:time-budget' }), 900)
    flushRuntimeRuns()
    const text = JSON.stringify(sent)
    expect(Object.keys(sent[0]).sort()).toEqual(['declined', 'ms', 'ok', 'started', 'stops', 'tab'])
    expect(sent[0].tab).toMatch(/^[0-9a-f]{16}$/)
    const { tab: _t, ...rest } = sent[0]
    expect(JSON.stringify(rest)).not.toMatch(/indicator|stopped|version|[0-9a-f]{12}/)
    expect(text).not.toMatch(/indicator|stopped|version/)
  })

  it('⭐ a ROLLING budget: over it the batch is KEPT and leaves when the hour frees a slot', () => {
    vi.useFakeTimers()
    const sent = []
    setRuntimeRunsReporter((b) => sent.push(b))
    for (let i = 0; i < RUNS_BEACONS_PER_HOUR; i += 1) { noteRuntimeRunSettled(null, 1); expect(flushRuntimeRuns()).toBe(true) }
    noteRuntimeRunSettled(null, 1)
    noteRuntimeRunSettled(null, 1)
    expect(flushRuntimeRuns()).toBe(false)            // over budget: nothing sent...
    expect(pendingRuntimeRuns().ok).toBe(2)           // ...and nothing lost
    vi.advanceTimersByTime(3600000 + 1)
    expect(sent.length).toBe(RUNS_BEACONS_PER_HOUR + 1)
    expect(sent[sent.length - 1].ok).toBe(2)          // a tab open all day keeps reporting
  })

  it('a FULL batch counts what it cannot keep as dropped and leaves early (not sooner than the gap)', () => {
    vi.useFakeTimers()
    const sent = []
    setRuntimeRunsReporter((b) => sent.push(b))
    noteRuntimeRunSettled(null, 1)
    flushRuntimeRuns()                                // a send just happened
    for (let i = 0; i < RUNS_MAX_PER_BATCH + 7; i += 1) noteRuntimeRunSettled(null, 1)
    expect(pendingRuntimeRuns().ok).toBe(RUNS_MAX_PER_BATCH)
    expect(pendingRuntimeRuns().dropped).toBe(7)
    vi.advanceTimersByTime(RUNS_MIN_GAP_MS - 5)
    expect(sent.length).toBe(1)
    vi.advanceTimersByTime(10)
    expect(sent.length).toBe(2)
    expect(sent[1].ok + sent[1].declined).toBe(RUNS_MAX_PER_BATCH)
    expect(sent[1].dropped).toBe(7)
  })

  it('the tab nonce is random per page load, 16 hex, and needs no secure context', () => {
    const a = runtimeRunsTab()
    expect(a).toMatch(/^[0-9a-f]{16}$/)
    resetRuntimeRunTelemetry()
    expect(runtimeRunsTab()).not.toBe(a)
  })

  it('the default transport is a keepalive POST nobody awaits, and a throwing fetch costs nothing', () => {
    const calls = []
    vi.stubGlobal('fetch', vi.fn((url, init) => { calls.push({ url, init }); return Promise.reject(new Error('offline')) }))
    noteRuntimeRunSettled(null, 5)
    expect(flushRuntimeRuns()).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(RUNTIME_RUNS_BEACON_URL)
    expect(calls[0].init.keepalive).toBe(true)
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('refused') }))
    noteRuntimeRunSettled(null, 5)
    expect(() => flushRuntimeRuns()).not.toThrow()
    vi.stubGlobal('self', workerSelf)
  })

  it('a page hide sends what has been collected at once', () => {
    const sent = []
    setRuntimeRunsReporter((b) => sent.push(b))
    noteRuntimeRunSettled(null, 5)
    window.dispatchEvent(new Event('pagehide'))
    expect(sent).toHaveLength(1)
  })
})
