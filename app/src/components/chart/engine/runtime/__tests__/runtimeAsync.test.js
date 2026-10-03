// app/src/components/chart/engine/runtime/__tests__/runtimeAsync.test.js
//
// ⭐⭐ RT1 — the runtime pane's run, off the main thread (`runtimeAsync.js`), and
// the registry loading the lane for a SAVED runtime document.
//
// jsdom has no `Worker`, so the worker is a fake that runs the worker module's
// own message handler contract: `{id, def, rows, ctx}` in, `{id, ok, columns}` or
// `{id, ok: false, error}` out.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { workerRunner, resetRuntimeAsync, ensureRuntimeLane } from '../runtimeAsync.js'
import { computeRuntimeColumns, runtimeColumnsFor, setRuntimeRunner } from '../runtimeColumns.js'
import * as registry from '../../nativeRegistry.js'
import { subscribe } from '../../serverCompute.js'

const SOURCE = '//@version=5\nindicator("t")\nvar float s = 0.0\ns := s + close\nplot(s)\n'
const DEF = { id: 'x', compute: { fn: 'x', source: SOURCE, outputs: { v: 0 } } }
const bars = () => Array.from({ length: 30 }, (_, i) => ({ t: 1e9 + i * 86400, o: 1, h: 2, l: 0.5, c: 1 + i, v: 10 }))

/** A fake worker: answers each message with what the real worker computes. */
function fakeWorkerFactory({ dies = false } = {}) {
  const made = []
  const factory = () => {
    const w = {
      posted: [],
      postMessage(msg) {
        this.posted.push(msg)
        queueMicrotask(() => {
          if (dies) { this.onerror && this.onerror(new Error('boom')); return }
          try {
            const columns = computeRuntimeColumns(msg.def, msg.rows, msg.ctx)
            this.onmessage({ data: { id: msg.id, ok: true, columns } })
          } catch (err) {
            this.onmessage({ data: { id: msg.id, ok: false, error: { name: err.name, message: err.message, guard: err.guard || null } } })
          }
        })
      },
      terminate() {},
    }
    made.push(w)
    return w
  }
  return { factory, made }
}

afterEach(() => {
  resetRuntimeAsync()
  setRuntimeRunner(null)
  vi.unstubAllEnvs()
})

describe('RT1 — the worker runner', () => {
  it('⭐ sends only plain fields, and lands the same columns the main thread would compute', async () => {
    const { factory, made } = fakeWorkerFactory()
    const run = workerRunner(factory)
    const rows = bars()
    const got = await new Promise((resolve) => run(DEF, rows, { tf: 'D' }, (err, cols) => resolve({ err, cols })))
    expect(got.err).toBeNull()
    expect(got.cols).toEqual(computeRuntimeColumns(DEF, rows, { tf: 'D' }))
    const msg = made[0].posted[0]
    expect(Object.keys(msg.def).sort()).toEqual(['compute', 'id', 'meta'])
    expect(msg.rows[0]).toEqual({ t: rows[0].t, o: 1, h: 2, l: 0.5, c: 1, v: 10 })
  })

  it('⭐ a refusal comes back as a refusal, guard intact', async () => {
    const { factory } = fakeWorkerFactory()
    const run = workerRunner(factory)
    const def = { ...DEF, meta: { runtimeHistory: 'listing' } }
    const got = await new Promise((resolve) => run(def, bars(), { tf: 'D' }, (err, cols) => resolve({ err, cols })))
    expect(got.cols).toBeNull()
    expect(got.err.guard).toBe('runtime:history-start')
  })

  // ⚰️ RT1 re-ran a dead worker's jobs on THIS thread. RF (2026-10-02) answers them
  // by name instead: a run there is up to a full budget of frames, and on a live
  // chart that is a freeze per update. The new rule and its rails are
  // `runtimePaneSafety.test.js`; this case keeps the RT1 name so its history reads.
  it('⛔ a worker that dies takes no run with it: the job is answered BY NAME, not re-run here', async () => {
    const { factory } = fakeWorkerFactory({ dies: true })
    const run = workerRunner(factory)
    const rows = bars()
    const got = await new Promise((resolve) => run(DEF, rows, { tf: 'D' }, (err, cols) => resolve({ err, cols })))
    expect(got.cols).toBeNull()
    expect(got.err.guard).toBe('runtime:worker-failed')
  })

  it('⭐ through runtimeColumnsFor: the chart is told to repaint, and the repaint reads the columns', async () => {
    const { factory } = fakeWorkerFactory()
    ensureRuntimeLane({ factory })
    const told = []
    const unsub = subscribe((k) => told.push(k))
    try {
      const rows = bars()
      expect(runtimeColumnsFor(DEF, rows, undefined, { tf: 'D' })).toEqual({})
      await new Promise((r) => setTimeout(r, 0))
      expect(told.length).toBe(1)
      expect(runtimeColumnsFor(DEF, rows, undefined, { tf: 'D' }).v.length).toBe(30)
    } finally { unsub() }
  })
})

describe('RT1 — a SAVED runtime document loads the lane on demand', () => {
  it('⭐ unregistered and flag ON: draws nothing this paint, loads the lane, repaints, then draws', async () => {
    vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
    registry.registerRuntimeLane(null)
    // the loader `StockChart.jsx` registers, verbatim in shape
    registry.registerRuntimeLaneLoader(() => import('../runtimeAsync.js').then((m) => m.ensureRuntimeLane()))
    const def = {
      id: 'u_member-pane-lazy', compute: { kind: 'runtime', fn: 'runtime:u_member-pane-lazy', source: SOURCE, outputs: { value: 0 } },
    }
    const told = []
    const unsub = subscribe((k) => told.push(k))
    try {
      const rows = bars()
      expect(registry.computeFor(def, rows, undefined, { tf: 'D' })).toEqual({})
      await vi.waitFor(() => expect(told).toContain('runtime:lane'))
      const cols = registry.computeFor(def, rows, undefined, { tf: 'D' })
      expect(registry.columnErrors(cols)).toEqual({})
      expect(cols.value.length).toBe(30)
    } finally { unsub() }
  })

  it('⛔ flag ON but no loader registered: the old refusal, never a silent blank', () => {
    vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
    registry.registerRuntimeLane(null)
    registry.registerRuntimeLaneLoader(null)
    const def = {
      id: 'u_member-pane-lazy3', compute: { kind: 'runtime', fn: 'runtime:u_member-pane-lazy3', source: SOURCE, outputs: { value: 0 } },
    }
    const cols = registry.computeFor(def, bars(), undefined, { tf: 'D' })
    expect(registry.columnErrors(cols).value.guard).toBe('runtime:unregistered')
  })

  it('⛔ unregistered and flag OFF: the old refusal, nothing loaded', () => {
    vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '')
    registry.registerRuntimeLane(null)
    const def = {
      id: 'u_member-pane-lazy2', compute: { kind: 'runtime', fn: 'runtime:u_member-pane-lazy2', source: SOURCE, outputs: { value: 0 } },
    }
    const cols = registry.computeFor(def, bars(), undefined, { tf: 'D' })
    expect(registry.columnErrors(cols).value.guard).toBe('runtime:unregistered')
  })
})
