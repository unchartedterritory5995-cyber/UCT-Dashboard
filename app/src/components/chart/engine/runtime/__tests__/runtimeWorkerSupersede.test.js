// app/src/components/chart/engine/runtime/__tests__/runtimeWorkerSupersede.test.js
//
// ⭐⭐ (engine 86) — A STALE RUN IN THE RUNTIME WORKER IS STOPPED (`runtimeAsync.js`).
//
// One job is in the worker at a time; the rest wait on the main thread. A chart pane (`ctx.hostPane`) that now
// asks for another picture (document, symbol, timeframe, settings, history fact) stops its own run by
// TERMINATING the worker (a computing worker cannot read a message), and the newer job starts at once on a fresh
// worker. Newer bars of the SAME picture never stop it (a live chart would never draw). Another pane's run, and a
// job no pane owns, are never stopped. A hidden tab stops the run and posts nothing; visible again, the stopped
// run goes first. A cancel is never a failure: it never spends `RUNTIME_WORKER_MAX_STARTS`, never answers, never
// paints, and its memo entry goes (the same bars asked again are a new run).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { workerRunner, resetRuntimeAsync, runtimeWorkerStats, RUNTIME_WORKER_MAX_STARTS, RUNTIME_WORKER_WATCHDOG_MS } from '../runtimeAsync.js'
import { computeRuntimeColumns, runtimeColumnsFor, setRuntimeRunner, onRuntimeColumnsLanded } from '../runtimeColumns.js'

const SOURCE = '//@version=5\nindicator("t")\nvar float s = 0.0\ns := s + close\nplot(s)\n'
const def = (id = 'u_sup') => ({ id, compute: { kind: 'runtime', fn: `runtime:${id}`, source: SOURCE, outputs: { v: 0 } } })
const rows = (n, base = 1e9) => Array.from({ length: n }, (_, i) => ({ t: base + i * 86400, o: 1, h: 2, l: 0.5, c: 1 + i, v: 10 }))
const ctx = (pane, tf = 'D', ticker = 'SPY') => ({ tf, symbol: { ticker, exchange: 'NYSE Arca' }, ...(pane ? { hostPane: pane } : {}) })

/** Workers that hold every message until `flush()`, and record a terminate. */
function manualWorkers() {
  const made = []
  const factory = () => {
    const w = {
      posted: [], queue: [], terminated: false,
      postMessage(msg) { this.posted.push(msg); this.queue.push(msg) },
      flush() {
        const q = this.queue
        this.queue = []
        for (const msg of q) {
          if (!this.onmessage) continue
          const columns = computeRuntimeColumns(msg.def, msg.rows, msg.ctx)
          this.onmessage({ data: { id: msg.id, ok: true, columns } })
        }
      },
      terminate() { this.terminated = true },
    }
    made.push(w)
    return w
  }
  return { factory, made }
}

let visibility = 'visible'
const setVisibility = (v) => {
  visibility = v
  document.dispatchEvent(new Event('visibilitychange'))
}
Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })

afterEach(() => {
  resetRuntimeAsync()
  setRuntimeRunner(null)
  visibility = 'visible'
  vi.useRealTimers()
})

describe('a pane that asks for another picture stops its own run', () => {
  it('⭐ a symbol switch: the running worker is terminated, the old run never answers, the new one runs on a fresh worker', () => {
    const w = manualWorkers()
    const run = workerRunner(w.factory)
    const answered = []
    run(def(), rows(30), ctx('pane-1', 'D', 'SPY'), (err, cols) => answered.push(['SPY', err, cols && cols.v.length]))
    expect(w.made.length).toBe(1)
    run(def(), rows(31), ctx('pane-1', 'D', 'QQQ'), (err, cols) => answered.push(['QQQ', err, cols && cols.v.length]))
    expect(w.made[0].terminated).toBe(true)
    expect(w.made.length).toBe(2)
    expect(w.made[1].posted.length).toBe(1)
    w.made[0].flush() // a late answer from the stopped worker cannot land (its doors are closed)
    w.made[1].flush()
    expect(answered).toEqual([['QQQ', null, 31]])
    expect(runtimeWorkerStats()).toMatchObject({ cancelled: 1, superseded: 1 })
  })

  it('⭐ a timeframe switch, a setting or a history fact is another picture too', () => {
    for (const newer of [ctx('pane-1', '60'), { ...ctx('pane-1'), historyFromListing: true }]) {
      resetRuntimeAsync()
      const w = manualWorkers()
      const run = workerRunner(w.factory)
      run(def(), rows(30), ctx('pane-1'), () => { throw new Error('the stopped run answered') })
      run(def(), rows(30), newer, () => {})
      expect(w.made[0].terminated).toBe(true)
      expect(w.made.length).toBe(2)
    }
    // another document in the same pane slot
    resetRuntimeAsync()
    const w = manualWorkers()
    const run = workerRunner(w.factory)
    run(def('u_a'), rows(30), ctx('pane-1'), () => {})
    run(def('u_b'), rows(30), ctx('pane-1'), () => {})
    expect(w.made[0].terminated).toBe(true)
  })

  it('⛔ newer bars of the SAME picture never stop it: it finishes, then the newest waiting run is posted on the same worker', () => {
    const w = manualWorkers()
    const run = workerRunner(w.factory)
    const answered = []
    for (let k = 0; k < 5; k += 1) run(def(), rows(30 + k), ctx('pane-1'), (err, cols) => answered.push(cols.v.length))
    expect(w.made[0].terminated).toBe(false)
    expect(w.made[0].posted.length).toBe(1)
    w.made[0].flush()
    expect(w.made[0].posted.length).toBe(2)
    w.made[0].flush()
    expect(answered).toEqual([30, 34])
    expect(w.made.length).toBe(1)
    expect(runtimeWorkerStats().cancelled).toBe(0)
  })

  it('⛔ another pane\'s request, or one no pane owns, never stops a running job', () => {
    const w = manualWorkers()
    const run = workerRunner(w.factory)
    const answered = []
    run(def(), rows(30), ctx('pane-1', 'D', 'SPY'), () => answered.push('pane-1 SPY'))
    run(def(), rows(30), ctx('pane-2', 'D', 'QQQ'), () => answered.push('pane-2 QQQ'))
    run(def(), rows(30), ctx(null, 'D', 'IWM'), () => answered.push('no pane IWM'))
    expect(w.made[0].terminated).toBe(false)
    for (let k = 0; k < 3; k += 1) w.made[0].flush()
    expect(answered).toEqual(['pane-1 SPY', 'pane-2 QQQ', 'no pane IWM'])
    expect(w.made.length).toBe(1)
  })

  it('⛔ a pane\'s older WAITING job is replaced by its newer one (never answered), without stopping the running job', () => {
    const w = manualWorkers()
    const run = workerRunner(w.factory)
    const answered = []
    run(def('u_x'), rows(30), ctx('pane-2'), () => answered.push('pane-2'))
    run(def(), rows(30), ctx('pane-1', 'D', 'SPY'), () => answered.push('SPY'))
    run(def(), rows(30), ctx('pane-1', 'D', 'QQQ'), () => answered.push('QQQ'))
    expect(w.made[0].terminated).toBe(false)
    for (let k = 0; k < 3; k += 1) w.made[0].flush()
    expect(answered).toEqual(['pane-2', 'QQQ'])
  })

  it('⛔ a cancel is not a failure: many switches never spend RUNTIME_WORKER_MAX_STARTS', () => {
    const w = manualWorkers()
    const run = workerRunner(w.factory)
    let last = null
    for (let k = 0; k < RUNTIME_WORKER_MAX_STARTS + 4; k += 1) run(def(), rows(30), ctx('pane-1', 'D', `T${k}`), (err, cols) => { last = { err, n: cols && cols.v.length } })
    expect(w.made.length).toBe(RUNTIME_WORKER_MAX_STARTS + 4)
    // a REAL failure now: the worker dies. Had the cancels been counted, the lane would stop starting workers here
    w.made[w.made.length - 1].onerror(new Error('boom'))
    expect(last.err.guard).toBe('runtime:worker-failed')
    run(def(), rows(30), ctx('pane-1', 'D', 'AFTER'), (err, cols) => { last = { err, n: cols && cols.v.length } })
    expect(w.made.length).toBe(RUNTIME_WORKER_MAX_STARTS + 5)
    w.made[w.made.length - 1].flush()
    expect(last).toEqual({ err: null, n: 30 })
  })

  it('⛔ a stopped run\'s watchdog is disarmed: nothing is called unresponsive later', () => {
    vi.useFakeTimers()
    const w = manualWorkers()
    const run = workerRunner(w.factory)
    const answered = []
    run(def(), rows(30), ctx('pane-1', 'D', 'SPY'), (err) => answered.push(['SPY', err && err.guard]))
    run(def(), rows(30), ctx('pane-1', 'D', 'QQQ'), (err) => answered.push(['QQQ', err && err.guard]))
    w.made[1].flush()
    vi.advanceTimersByTime(RUNTIME_WORKER_WATCHDOG_MS * 2)
    expect(answered).toEqual([['QQQ', null]])
  })
})

describe('through the memo: a stopped run leaves no pending answer behind', () => {
  it('⭐ the same bars asked again after their run was stopped start a NEW run (not {} forever)', () => {
    const w = manualWorkers()
    setRuntimeRunner(workerRunner(w.factory))
    const landed = []
    const off = onRuntimeColumnsLanded((k) => landed.push(k))
    const spyRows = rows(30)
    expect(runtimeColumnsFor(def(), spyRows, undefined, ctx('pane-1', 'D', 'SPY'))).toEqual({})
    expect(runtimeColumnsFor(def(), rows(30), undefined, ctx('pane-1', 'D', 'QQQ'))).toEqual({})
    expect(w.made[0].terminated).toBe(true)
    w.made[1].flush()
    // back to SPY with the SAME bars array: a new job (posted), not a pending entry that never lands
    expect(runtimeColumnsFor(def(), spyRows, undefined, ctx('pane-1', 'D', 'SPY'))).toEqual({})
    const fresh = w.made[1]
    expect(w.made.length).toBe(2)
    expect(fresh.posted.map((m) => m.ctx.symbol.ticker)).toEqual(['QQQ', 'SPY'])
    fresh.flush()
    expect(runtimeColumnsFor(def(), spyRows, undefined, ctx('pane-1', 'D', 'SPY')).v.length).toBe(30)
    expect(landed.length).toBe(2)
    off()
  })
})

describe('a hidden tab computes nothing', () => {
  it('⭐ hiding stops the running job (not answered), nothing is posted while hidden, and showing runs it first', () => {
    vi.useFakeTimers()
    const w = manualWorkers()
    const run = workerRunner(w.factory)
    const answered = []
    run(def(), rows(30), ctx('pane-1'), (err, cols) => answered.push(['first', err, cols && cols.v.length]))
    run(def('u_waiting'), rows(32), ctx('pane-3'), (err, cols) => answered.push(['waiting', err, cols && cols.v.length]))
    setVisibility('hidden')
    expect(w.made[0].terminated).toBe(true)
    run(def('u_other'), rows(31), ctx('pane-2'), (err, cols) => answered.push(['second', err, cols && cols.v.length]))
    expect(w.made.length).toBe(1) // no worker started while hidden
    expect(runtimeWorkerStats()).toMatchObject({ hiddenStops: 1, inFlight: false, queued: 3, hidden: true })
    // a hidden tab is not an unresponsive worker: nothing is answered however long it stays hidden
    vi.advanceTimersByTime(RUNTIME_WORKER_WATCHDOG_MS * 3)
    expect(answered).toEqual([])
    setVisibility('visible')
    expect(w.made.length).toBe(2)
    expect(w.made[1].posted[0].def.id).toBe('u_sup') // the stopped run goes first, ahead of what waited
    for (let k = 0; k < 3; k += 1) w.made[1].flush()
    expect(answered).toEqual([['first', null, 30], ['waiting', null, 32], ['second', null, 31]])
  })

  it('⛔ a page that loads hidden posts nothing until it is first shown', () => {
    visibility = 'hidden'
    const w = manualWorkers()
    const run = workerRunner(w.factory)
    let got = null
    run(def(), rows(30), ctx('pane-1'), (err, cols) => { got = cols.v.length })
    expect(w.made.length).toBe(0)
    setVisibility('visible')
    w.made[0].flush()
    expect(got).toBe(30)
  })
})
