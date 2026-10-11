// app/src/components/chart/engine/runtime/__tests__/runtimeWorkerWarmup.test.js
//
// ⭐ UIE PHASE 2 — the warm-up curtain and a WITHHELD drawings payload cross the worker.
//
// A column record's warm-up (`runtimeWarmupOf`) and drawings ride as NON-ENUMERABLE
// properties, which a structured clone drops. The REAL worker module (`runtimeWorker.js`)
// is run here with a stub `self`, its message is structured-cloned exactly as the browser
// does, and handed to the main thread's side (`runtimeAsync.js`): the curtain the host
// object gate reads (`nativeRegistry.runtimeObjectsWithheld`) must still be there.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { workerRunner, resetRuntimeAsync } from '../runtimeAsync.js'
import { runtimeWarmupOf, runtimeObjectsWithheldOf } from '../runtimeObjects.js'

const bars = Array.from({ length: 2000 }, (_, i) => {
  const c = 100 + 9 * Math.sin(i / 13) + i * 0.01
  return { t: 1500000000 + i * 86400, o: c - 0.2, h: c + 1, l: c - 1, c, v: 1000 }
})
const doc = (body, extra = {}) => ({ id: 'ww', meta: { runtimeHistory: 'listing' },
  compute: { kind: 'runtime', fn: 'runtime:ww', outputs: { v: 0 }, source: `//@version=6\nindicator("w")\n${body}`, ...extra } })

// ONE stub `self` for the module's lifetime: the worker module assigns its handler once
const posted = []
const SELF = { postMessage: (m) => posted.push(m) }
async function realWorkerMessage(def) {
  vi.stubGlobal('self', SELF)
  await import('../runtimeWorker.js')
  posted.length = 0
  SELF.onmessage({ data: { id: 7, def, rows: bars, ctx: { tf: 'D', newestBarIsForming: false } } })
  return structuredClone(posted[0])
}

afterEach(() => { resetRuntimeAsync(); vi.unstubAllGlobals() })

describe('⭐ the warm-up curtain survives the worker', () => {
  it('the real worker posts the curtain and a WITHHELD drawings payload beside the columns', async () => {
    const msg = await realWorkerMessage(doc('plot(ta.rsi(close, 14))\nif bar_index % 100 == 0\n    label.new(bar_index, high, "x")\n',
      { objects: true }))
    expect(msg.ok).toBe(true)
    expect(msg.warmup && msg.warmup.withheldBars).toBeGreaterThan(0)
    expect(msg.objects && msg.objects.status).toBe('WITHHELD')
  })

  it('the main thread re-attaches both, so the gate and the strip can read them', async () => {
    const msg = await realWorkerMessage(doc('plot(ta.rsi(close, 14))\n'))
    const factory = () => ({
      postMessage() { queueMicrotask(() => this.onmessage({ data: { ...msg, id: 1 } })) },
      terminate() {},
    })
    const run = workerRunner(factory)
    const cols = await new Promise((resolve) => run(doc('plot(ta.rsi(close, 14))\n'), bars, { tf: 'D' },
      (err, c) => resolve(c)))
    expect(runtimeWarmupOf(cols)).toEqual(msg.warmup)
    expect(runtimeObjectsWithheldOf(cols)).toBeNull()
    expect(Number.isNaN(cols.v[0])).toBe(true)
  })
})
