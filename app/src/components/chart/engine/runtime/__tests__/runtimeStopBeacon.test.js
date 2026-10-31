// app/src/components/chart/engine/runtime/__tests__/runtimeStopBeacon.test.js
//
// ⭐⭐ PHASE 3 WS-H, ARMING ITEM S8 (2026-10-31) — a runtime run that STOPS is
// counted for the operator, with no source and no member id.
//
// The worker here is the REAL `runtimeWorker.js` message handler, loaded against a
// stand-in `self`, so the run time it reports is the module's own, not a fake's.
// The server half (closed sets, storage, the admin read) is
// `tests/test_pine_runtime_stop_telemetry.py`.
import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from 'vitest'
import {
  workerRunner, resetRuntimeAsync, setRuntimeStopReporter, runtimeStopBeaconOf,
  RUNTIME_STOP_BEACON_GUARDS, RUNTIME_STOP_BEACONS_PER_TAB, RUNTIME_STOP_BEACON_URL,
} from '../runtimeAsync.js'
import { computeRuntimeColumns, setRuntimeRunner, RUNTIME_LIMIT_GUARD } from '../runtimeColumns.js'
import { runtimeSourceHash } from '../../runtimeKill.js'

const HEAD = '//@version=6\nindicator("t")\n'
// 30 doublings in one bar: stops by NAME on MEMORY (S2)
const DOUBLING = HEAD + 'var string s = "ab"\nfor i = 0 to 29\n    s := s + s\nplot(s == "zz" ? 1 : 0, "v")\n'
const PLAIN = '//@version=5\nindicator("t")\nvar float s = 0.0\ns := s + close\nplot(s)\n'
const docOf = (source, id = 'd') => ({ id, compute: { kind: 'runtime', fn: `runtime:${id}`, source, outputs: { v: 0 } } })
const bars = (n = 40) => Array.from({ length: n }, (_, i) => ({ t: 1e9 + i * 86400, o: 1, h: 2, l: 0.5, c: 1 + i, v: 10 }))

let workerSelf = null
beforeAll(async () => {
  workerSelf = { onmessage: null, postMessage: null }
  vi.stubGlobal('self', workerSelf)
  await import('../runtimeWorker.js')
})
// the module reads `self` when it ANSWERS, so the stand-in stays for the file
afterAll(() => vi.unstubAllGlobals())

/** A worker whose body is the real module's handler. */
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
  resetRuntimeAsync()
  setRuntimeRunner(null)
})

describe('S8 — the stop beacon', () => {
  it('⭐ a real MEMORY stop through the real worker beacons exactly { guard, limit, hash, bars, ms, lane }', async () => {
    const sent = []
    setRuntimeStopReporter((b) => sent.push(b))
    const run = workerRunner(realWorkerFactory())
    const rows = bars()
    const got = await runOnce(run, docOf(DOUBLING), rows)
    expect(got.err.guard).toBe(RUNTIME_LIMIT_GUARD)
    expect(sent).toHaveLength(1)
    const b = sent[0]
    expect(Object.keys(b).sort()).toEqual(['bars', 'guard', 'hash', 'lane', 'limit', 'ms'])
    expect(b).toMatchObject({ guard: 'runtime:limit', limit: 'MEMORY', bars: rows.length, lane: 'worker' })
    expect(b.hash).toBe(runtimeSourceHash(DOUBLING).slice(0, 12))
    expect(b.hash).toMatch(/^[0-9a-f]{12}$/)
    expect(Number.isInteger(b.ms) && b.ms >= 0).toBe(true)
    // ⛔ no source, no sentence
    const wire = JSON.stringify(b)
    expect(wire).not.toContain('s := s + s')
    expect(wire).not.toContain('indicator')
    expect(wire).not.toContain(got.err.message.slice(0, 30))
  })

  it("⭐ the figure sent is the WORKER's own run time, not the main thread's wait", async () => {
    const sent = []
    setRuntimeStopReporter((b) => sent.push(b))
    // a frozen clock that jumps 7 s while the job waits for the worker (queue,
    // bundle load): the run itself takes 0 ms by this clock, the wait 7,000
    let t = 1000
    const spy = vi.spyOn(performance, 'now').mockImplementation(() => t)
    const slow = () => {
      const w = realWorkerFactory()()
      const post = w.postMessage
      w.postMessage = (msg) => { t += 7000; post(msg) }
      return w
    }
    try {
      await runOnce(workerRunner(slow), docOf(DOUBLING), bars())
    } finally { spy.mockRestore() }
    expect(sent).toHaveLength(1)
    expect(sent[0].ms).toBe(0)
  })

  it('a run that does not stop sends nothing; nor does a refusal that is not a stop', async () => {
    const sent = []
    setRuntimeStopReporter((b) => sent.push(b))
    const run = workerRunner(realWorkerFactory())
    expect((await runOnce(run, docOf(PLAIN, 'p'), bars())).err).toBeNull()
    const refused = { ...docOf(PLAIN, 'q'), meta: { runtimeHistory: 'listing' } }
    expect((await runOnce(run, refused, bars())).err.guard).toBe('runtime:warmup-never-converges')
    expect(sent).toEqual([])
  })

  it('a worker that dies beacons runtime:worker-failed, with no limit', async () => {
    const sent = []
    setRuntimeStopReporter((b) => sent.push(b))
    const got = await runOnce(workerRunner(realWorkerFactory({ dies: true })), docOf(PLAIN, 'w'), bars())
    expect(got.err.guard).toBe('runtime:worker-failed')
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ guard: 'runtime:worker-failed', lane: 'worker' })
    expect(sent[0].limit).toBeUndefined()
  })

  it('once per (script, stop) per tab, and at most the per-tab cap', async () => {
    const sent = []
    setRuntimeStopReporter((b) => sent.push(b))
    const run = workerRunner(realWorkerFactory())
    await runOnce(run, docOf(DOUBLING, 'a'), bars())
    await runOnce(run, docOf(DOUBLING, 'b'), bars())     // same script, same stop
    expect(sent).toHaveLength(1)
    for (let i = 0; i < RUNTIME_STOP_BEACONS_PER_TAB + 5; i += 1) {
      await runOnce(run, docOf(`${DOUBLING}// ${i}\n`, `c${i}`), bars())
    }
    expect(sent).toHaveLength(RUNTIME_STOP_BEACONS_PER_TAB)
  })

  it('a limit name is kept only when it is a declared limit, and only on runtime:limit', () => {
    const def = docOf(PLAIN)
    const lim = (message) => runtimeStopBeaconOf(def, bars(), { guard: 'runtime:limit', message }, 5, 'worker')
    expect(lim('… (MEMORY: at most 1, it reached 2) …').limit).toBe('MEMORY')
    expect(lim('… (SECRET_THING: at most 1, it reached 2) …').limit).toBeUndefined()
    expect(runtimeStopBeaconOf(def, bars(), { guard: 'runtime:failed', message: '(MEMORY: at most 1' }, 5, 'main'))
      .toEqual({ guard: 'runtime:failed', hash: runtimeSourceHash(PLAIN).slice(0, 12), bars: 40, ms: 5, lane: 'main' })
    expect(runtimeStopBeaconOf(def, bars(), { guard: 'runtime:killed' }, 5, 'worker')).toBeNull()
    expect(RUNTIME_STOP_BEACON_GUARDS).not.toContain('runtime:killed')
  })

  it('the default sender is a keepalive, credentialed JSON fetch to the telemetry route, never sendBeacon, and never throws', async () => {
    const calls = []
    const beacons = []
    const nav = globalThis.navigator
    const had = 'sendBeacon' in nav
    const prev = nav.sendBeacon
    nav.sendBeacon = (...a) => { beacons.push(a); return true }
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((url, init) => {
      calls.push([url, init])
      return Promise.resolve(new Response(null, { status: 200 }))
    })
    try {
      await runOnce(workerRunner(realWorkerFactory()), docOf(DOUBLING, 'z'), bars())
      expect(calls).toHaveLength(1)
      const [url, init] = calls[0]
      expect(url).toBe(RUNTIME_STOP_BEACON_URL)
      expect(init).toMatchObject({ method: 'POST', keepalive: true, credentials: 'include',
        headers: { 'Content-Type': 'application/json' } })
      expect(JSON.parse(init.body)).toMatchObject({ guard: 'runtime:limit', limit: 'MEMORY' })
      expect(beacons).toEqual([])
      // a REJECTED request and a THROWING fetch both cost nothing
      resetRuntimeAsync()
      // ⛔ a REJECTED request must be HANDLED by the sender (an unhandled one is a
      // console error on every offline stop): the sender attaches a rejection handler
      const handled = []
      fetchSpy.mockImplementation(() => {
        const p = Promise.reject(new TypeError('offline'))
        p.catch(() => {})                                     // keep the RAIL itself quiet
        const out = {
          then: (ok, bad) => { if (typeof bad === 'function') handled.push('then'); return p.then(ok, bad) },
          catch: (bad) => { if (typeof bad === 'function') handled.push('catch'); return p.catch(bad) },
        }
        return out
      })
      expect((await runOnce(workerRunner(realWorkerFactory()), docOf(DOUBLING, 'y'), bars())).err.guard).toBe('runtime:limit')
      expect(handled.length).toBeGreaterThan(0)
      resetRuntimeAsync()
      fetchSpy.mockImplementation(() => { throw new TypeError('refused') })
      expect((await runOnce(workerRunner(realWorkerFactory()), docOf(DOUBLING, 'x'), bars())).err.guard).toBe('runtime:limit')
      await new Promise((r) => setTimeout(r, 0))            // an unhandled rejection would surface here
    } finally {
      fetchSpy.mockRestore()
      if (had) nav.sendBeacon = prev
      else delete nav.sendBeacon
    }
  })
})
