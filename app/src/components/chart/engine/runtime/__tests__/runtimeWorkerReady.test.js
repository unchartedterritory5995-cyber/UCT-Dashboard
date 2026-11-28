// app/src/components/chart/engine/runtime/__tests__/runtimeWorkerReady.test.js
//
// ⭐⭐ (Fred RS run half, 2026-11-26) — THE RUNTIME WORKER IS POSTED TO ONLY WHEN IT SAYS IT IS READY, AND IT IS WARMED.
//
// ⚰️ Measured (production-flag bundle, smoke@ AGL 1D, n=20 reloads, 2026-11-26): in 9 of 20 cold reloads the chart's first
// run was posted to a worker still loading its 1.7 MB chunk, superseded 40-260 ms later (the listing date landed: another
// picture), and the worker TERMINATED and loaded again, its start-up paid twice before the RS label could be computed;
// and every first run took 520-650 ms from its post (390-440 ms in a worker that had already loaded).
// So: (1) a worker from a factory that announces (`announcesReady`, the browser's own) is posted nothing until it says
// READY; a job superseded meanwhile is dropped on the page and the loading worker is KEPT; (2) a worker that never says
// it is stopped by the watchdog, by name; (3) `warmRuntimeLane({warm})` runs the chart's own documents once over stand-in
// bars as soon as the worker is ready and idle (a chart job always first, a warm job never answered, counted or painted);
// (4) the worker itself says READY when its module has evaluated, and answers a WARM job with nothing but that it is done.
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import {
  workerRunner, resetRuntimeAsync, runtimeWorkerStats, warmRuntimeLane, RUNTIME_WORKER_WATCHDOG_MS, RUNTIME_WORKER_UNRESPONSIVE_GUARD,
} from '../runtimeAsync.js'
import { computeRuntimeColumns, setRuntimeRunner, onRuntimeColumnsLanded } from '../runtimeColumns.js'
import { RUNTIME_WORKER_READY, RUNTIME_WORKER_READY_ASK, RUNTIME_WORKER_WARM } from '../workerReady.js'
import * as registry from '../../nativeRegistry'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'

const SOURCE = '//@version=5\nindicator("t")\nvar float s = 0.0\ns := s + close\nplot(s)\n'
const def = (id = 'u_rdy') => ({ id, compute: { kind: 'runtime', fn: `runtime:${id}`, source: SOURCE, outputs: { v: 0 } } })
const rows = (n, base = 1e9) => Array.from({ length: n }, (_, i) => ({ t: base + i * 86400, o: 1, h: 2, l: 0.5, c: 1 + i, v: 10 }))
const ctx = (pane, ticker = 'SPY') => ({ tf: 'D', symbol: { ticker, exchange: 'NYSE Arca' }, ...(pane ? { hostPane: pane } : {}) })

/** Workers that hold every message until `flush()`; `ready()` posts the READY word. */
function announcingWorkers({ announces = true } = {}) {
  const made = []
  const factory = () => {
    const w = {
      posted: [], queue: [], terminated: false, asked: 0,
      postMessage(msg) {
        if (msg && msg.kind === RUNTIME_WORKER_READY_ASK) { this.asked += 1; return }
        this.posted.push(msg); this.queue.push(msg)
      },
      ready() { this.onmessage && this.onmessage({ data: { kind: RUNTIME_WORKER_READY } }) },
      flush() {
        const q = this.queue
        this.queue = []
        for (const msg of q) {
          if (!this.onmessage) continue
          if (msg.kind === RUNTIME_WORKER_WARM) { this.onmessage({ data: { id: msg.id, warm: true } }); continue }
          const columns = computeRuntimeColumns(msg.def, msg.rows, msg.ctx)
          this.onmessage({ data: { id: msg.id, ok: true, columns } })
        }
      },
      terminate() { this.terminated = true },
    }
    made.push(w)
    return w
  }
  if (announces) factory.announcesReady = true
  return { factory, made }
}

afterEach(() => {
  resetRuntimeAsync()
  setRuntimeRunner(null)
  vi.useRealTimers()
})

describe('a job is posted only to a worker that has said it is ready', () => {
  it('⭐ a job superseded while the worker loads is dropped on the page; the loading worker is KEPT, not loaded again', () => {
    const w = announcingWorkers()
    const run = workerRunner(w.factory)
    const answered = []
    run(def(), rows(30), ctx('pane-1', 'SPY'), (err, cols) => answered.push(['SPY', err, cols && cols.v.length]))
    expect(w.made.length, 'the worker is started for the job').toBe(1)
    expect(w.made[0].posted.length, 'nothing is posted to a worker still loading').toBe(0)
    expect(w.made[0].asked, 'the page asks the worker to say READY, once').toBe(1)
    run(def(), rows(31), ctx('pane-1', 'QQQ'), (err, cols) => answered.push(['QQQ', err, cols && cols.v.length]))
    // ⛔ THE RAIL: no terminate, no second worker
    expect(w.made[0].terminated, 'the loading worker is kept').toBe(false)
    expect(w.made.length, 'it is not loaded again').toBe(1)
    w.made[0].ready()
    expect(w.made[0].posted.length, 'only the newest picture is posted, once ready').toBe(1)
    expect(w.made[0].posted[0].rows.length).toBe(31)
    w.made[0].flush()
    expect(answered).toEqual([['QQQ', null, 31]])
    expect(runtimeWorkerStats()).toMatchObject({ cancelled: 0, superseded: 0, posted: 1 })
  })

  it('⭐ a worker that never says READY is stopped by the watchdog, and its waiting job is answered by name', () => {
    vi.useFakeTimers()
    const w = announcingWorkers()
    const run = workerRunner(w.factory)
    const answered = []
    run(def(), rows(10), ctx('pane-1'), (err) => answered.push(err && err.guard))
    vi.advanceTimersByTime(RUNTIME_WORKER_WATCHDOG_MS - 1)
    expect(answered).toEqual([])
    vi.advanceTimersByTime(2)
    expect(answered).toEqual([RUNTIME_WORKER_UNRESPONSIVE_GUARD])
    expect(w.made[0].terminated).toBe(true)
  })

  it('⛔ CONTROL: a factory that does not announce (every stand-in) is posted to at once, as before', () => {
    const w = announcingWorkers({ announces: false })
    const run = workerRunner(w.factory)
    run(def(), rows(10), ctx('pane-1'), () => {})
    expect(w.made[0].posted.length).toBe(1)
    expect(w.made[0].asked, 'a factory that does not announce is not asked').toBe(0)
  })

  it('⛔ CONTROL: once ready, a job is posted at once (the gate is only the start-up)', () => {
    const w = announcingWorkers()
    const run = workerRunner(w.factory)
    run(def('u_a'), rows(10), ctx('pane-1'), () => {})
    w.made[0].ready()
    w.made[0].flush()
    run(def('u_b'), rows(10), ctx('pane-2'), () => {})
    expect(w.made[0].posted.length).toBe(2)
  })
})

describe('the worker is warmed with the chart\'s own documents', () => {
  const warmDoc = () => ({ def: def('u_warm'), rows: rows(50), ctx: { tf: 'D' } })

  it('⭐ the warm job goes out as soon as the worker is ready, and a chart job waits for it, then runs; the warm job is never answered', () => {
    const w = announcingWorkers()
    const landed = []
    const off = onRuntimeColumnsLanded((k) => landed.push(k))
    warmRuntimeLane({ factory: w.factory, warm: [warmDoc()] })
    expect(w.made.length, 'the worker is spawned by the warm').toBe(1)
    expect(w.made[0].posted.length, 'nothing before READY').toBe(0)
    w.made[0].ready()
    expect(w.made[0].posted.map((m) => m.kind), 'the warm job is posted once ready').toEqual([RUNTIME_WORKER_WARM])
    expect(w.made[0].posted[0].def.id).toBe('u_warm')
    const answered = []
    const run = workerRunner(w.factory)
    run(def(), rows(30), ctx('pane-1'), (err, cols) => answered.push(cols && cols.v.length))
    expect(w.made[0].posted.length, 'the chart job waits for the warm job').toBe(1)
    w.made[0].flush()   // the warm job's answer: the chart job is posted
    expect(w.made[0].posted.length).toBe(2)
    expect(w.made[0].posted[1].kind).toBeUndefined()
    w.made[0].flush()
    expect(answered).toEqual([30])
    expect(runtimeWorkerStats()).toMatchObject({ warmed: 1, posted: 1 })
    expect(landed.length, 'only the chart job lands').toBe(0)   // (no registry listener here: the runner's own done answered)
    off()
  })

  it('⭐ a chart job already waiting goes FIRST; a page warms once', () => {
    const w = announcingWorkers()
    const run = workerRunner(w.factory)
    run(def(), rows(30), ctx('pane-1'), () => {})
    warmRuntimeLane({ factory: w.factory, warm: [warmDoc()] })
    w.made[0].ready()
    expect(w.made[0].posted.map((m) => m.kind || 'job')).toEqual(['job'])
    w.made[0].flush()
    expect(w.made[0].posted.map((m) => m.kind || 'job')).toEqual(['job', RUNTIME_WORKER_WARM])
    w.made[0].flush()
    warmRuntimeLane({ factory: w.factory, warm: [warmDoc()] })
    expect(w.made[0].posted.length, 'a second warm is not run').toBe(2)
  })

  it('⛔ a warm job in the worker is never stopped by a pane\'s newer picture (it has no pane)', () => {
    const w = announcingWorkers()
    warmRuntimeLane({ factory: w.factory, warm: [warmDoc()] })
    w.made[0].ready()
    const run = workerRunner(w.factory)
    run(def(), rows(30), ctx('pane-1', 'SPY'), () => {})
    run(def(), rows(31), ctx('pane-1', 'QQQ'), () => {})
    expect(w.made[0].terminated).toBe(false)
    expect(w.made.length).toBe(1)
  })
})

describe('the worker itself', () => {
  it('⭐ says READY when asked (once its module has evaluated), never unasked, and answers a WARM job with nothing but that it is done', async () => {
    const posted = []
    const prev = globalThis.self
    globalThis.self = { postMessage: (m) => posted.push(m) }
    try {
      vi.resetModules()
      await import('../runtimeWorker.js')
      expect(posted, 'nothing is volunteered (a harness reads the first message as its own answer)').toEqual([])
      globalThis.self.onmessage({ data: { kind: RUNTIME_WORKER_READY_ASK } })
      expect(posted, 'READY, when asked').toEqual([{ kind: RUNTIME_WORKER_READY }])
      globalThis.self.onmessage({ data: { kind: RUNTIME_WORKER_WARM, id: 7, def: def('u_w'), rows: rows(20), ctx: { tf: 'D' } } })
      expect(posted[1]).toEqual({ id: 7, warm: true })
      // and the page's own factory is the one that waits for that word (the browser's worker is not exported)
      const page = fs.readFileSync(path.resolve(process.cwd(), 'src/components/chart/engine/runtime/runtimeAsync.js'), 'utf8')
      expect(page).toMatch(/\r?\ndefaultFactory\.announcesReady = true\r?\n/)
    } finally {
      globalThis.self = prev
    }
  })

  it('⭐ the chart warms the lane at boot with the member\'s documents, not after the first paint', () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), 'src/components/StockChart.jsx'), 'utf8')
    const call = src.slice(src.indexOf('    armRuntimeLaneWarm({'), src.indexOf('    armRuntimeLaneWarm({') + 400)
    expect(call).toMatch(/afterPaint: startNow,/)
    expect(call).not.toMatch(/afterFirstChartPaint/)
    expect(src).toMatch(/warmRuntimeLane\(\{ warm: engineRegistry\.runtimeWarmDocuments\(\) \}\)/)
  })

  it('⭐ the documents warmed are the member\'s, in the form the worker runs them (Fred RS: its run half)', () => {
    const RS = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'src/components/chart/house/housePineIndicators.json'), 'utf8'))
      .indicators.find((e) => e.slug === 'fred-rs').pine
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
    const stored = JSON.parse(JSON.stringify(memberPaneDefinition({ source: RS, name: 'Fred RS', id: 'u_warm-fred' }).definition))
    const { installed, errors } = registry.installUserDefinitions([stored])
    expect(installed.length, errors.join(' | ')).toBe(1)
    try {
      const docs = registry.runtimeWarmDocuments()
      const fred = docs.find((d) => String(d.def.id).includes('u_warm-fred'))
      expect(fred, 'Fred RS is warmed').toBeTruthy()
      expect(fred.def.id.endsWith('~run'), 'as its run half').toBe(true)
      expect(fred.def.compute.source).toBe(stored.compute.runtimeObjects.source)
      expect(fred.rows.length).toBeGreaterThan(100)
      expect(docs.length).toBeLessThanOrEqual(2)
    } finally {
      registry.uninstallUserDefinition(installed[0].id)
      vi.unstubAllEnvs()
    }
  })
})
