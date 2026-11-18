// ─── ⭐⭐ RS RATING L10b — A RUN WAITING FOR ANOTHER SYMBOL STAYS A WAIT ACROSS THE WORKER ───
//
// ⚰️ 2026-11-18 00:45Z, production (#1733's restart window, smoke@ on AGL, `tools/rs_library_load_probe.py`
// with the refusal-creation hooks armed): RS Rating added from "Your indicators" flashed refused
// `runtime:request` on load 3 of 3. Its run half went pending, pending, then REFUSED at 15.13 s (beacon at
// 15.3 s), pending again and served at 15.93 s. SPX landed at 15.0 s and the seed at 16.0 s, so the seed was
// still in flight. Loads 1 and 2 (seed 0.1 to 0.2 s behind SPX) never refused.
// Cause: a run that waits for another symbol's bars throws `runtime:request` with `pending: true`
// (`runtimeColumns.js`), and `nativeRegistry.js::withRunHalf` holds a pending error as pending. On the
// main thread the error object arrives as thrown. Off it, `runtimeWorker.js` posted only `{name, message,
// guard, limit, bar, ms}` and `runtimeAsync.js::errorOf` rebuilt only those, so `pending` was lost and the
// wait came back as a refusal. That happened only when a worker run finished before the seed landed, which
// is why it showed in slow restart windows.
// This rail runs the RS run half through the REAL worker module (stub `self`, each message structured-
// cloned as the browser does), with SPX in hand and the seed still loading.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import * as registry from './nativeRegistry'
import { memberPaneDefinition } from '../builder/memberPane/memberPaneDefinition'
import { runtimeColumnsFor, resetRuntimeSessions, resetRuntimeLedgers, setRuntimeRunner, onRuntimeColumnsLanded } from './runtime/runtimeColumns'
import { workerRunner, resetRuntimeAsync } from './runtime/runtimeAsync'
import { errorImageOf, errorFromImage } from './runtime/errorImage'
import { runHalfOf } from './runtime/runtimeObjects'
import { __permitRuntimePaneForTests } from './runtimePaneGate'
import { __allowEveryRuntimeScriptForTests, setRuntimeKillList, runtimeSourceHash } from './runtimeKill'
import { setRunHalfObjectEvidence } from './runHalfRailSeam'

const REPO = path.resolve(process.cwd(), '..')
const RS = fs.readFileSync(path.join(REPO, 'docs/pine/rs-rating/rs-rating-fred6724__pziQwiT2.pine'), 'utf8')
const SEED_KEY = 'SEED_FRED6725_RS_RATING:RSRATING'
const TODAY = '2026-11-17'
const utcMidnight = (iso) => Date.parse(`${iso}T00:00:00Z`) / 1000
const SESSIONS = (() => {
  const out = []
  for (let t = Date.parse(`${TODAY}T00:00:00Z`); out.length < 600; t -= 86400000) {
    const wd = new Date(t).getUTCDay()
    if (wd !== 0 && wd !== 6) out.unshift(new Date(t).toISOString().slice(0, 10))
  }
  return out
})()
const CHART = SESSIONS.map((t, i) => {
  const c = 80 + 20 * Math.sin(i / 17) + i * 0.05
  return { t, o: c - 0.4, h: c + 1.1, l: c - 1.2, c, v: 1e6 + i }
})
const SPX = SESSIONS.map((iso, i) => {
  const c = 5400 + 300 * Math.sin(i / 41) + i * 3
  return { t: utcMidnight(iso), o: c - 5, h: c + 20, l: c - 22, c, v: 3e9 }
})
const SEED = SESSIONS.slice(-35, -1).map((t, i) => ({ t, o: 0, h: 1000, l: 0, c: 300 - 7 * i, v: 0 }))
const SYMBOL = { ticker: 'AGL', exchange: 'NYSE', industry: 'Medical Care Facilities', sector: 'Healthcare', securityType: 'stock' }
const SPX_IN = { bars: SPX, status: 'available', newestBarIsForming: true }
const SEED_LOADING = { bars: [], status: 'loading' }
const SEED_IN = { bars: SEED, status: 'available', newestBarIsForming: false }

// ONE stub `self` for the worker module's lifetime: the module assigns its handler once
const SELF = { postMessage: (m) => SELF.out.push(m), out: [] }
async function realWorkerFactory() {
  vi.stubGlobal('self', SELF)
  await import('./runtime/runtimeWorker.js')
  return () => ({
    postMessage(msg) {
      queueMicrotask(() => {
        SELF.out.length = 0
        SELF.onmessage({ data: structuredClone(msg) })
        const reply = structuredClone(SELF.out[0])
        this.onmessage({ data: reply })
      })
    },
    terminate() {},
  })
}

let defId = null
beforeEach(() => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
  __permitRuntimePaneForTests()
  __allowEveryRuntimeScriptForTests()
  setRuntimeKillList([])
  registry.registerRuntimeLane(runtimeColumnsFor)
  setRunHalfObjectEvidence([{ sha256: runtimeSourceHash(RS), captures: [
    { capture: 'a', verdict: 'MATCH', objectsV2: true, runtimeOn: true },
    { capture: 'b', verdict: 'MATCH', objectsV2: true, runtimeOn: true }] }])
})
afterEach(() => {
  if (defId) registry.uninstallUserDefinition(defId)
  defId = null
  setRuntimeRunner(null)
  resetRuntimeAsync()
  setRunHalfObjectEvidence([])
  setRuntimeKillList([])
  resetRuntimeSessions()
  resetRuntimeLedgers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

function libraryDef() {
  const stored = JSON.parse(JSON.stringify(memberPaneDefinition({ source: RS, name: 'RS Rating', id: 'u_rs-l10b-worker' }).definition))
  const { installed, errors } = registry.installUserDefinitions([stored])
  expect(installed.length, errors.join(' | ')).toBe(1)
  defId = installed[0].id
  return installed[0]
}
const ctxWith = (secondary) => ({ tf: 'D', symbol: SYMBOL, newestBarIsForming: true, historyFromListing: true, secondary,
  exchangeOf: (t) => (t === 'SPX' ? 'SP' : null) })

/** Every run-half state the definition goes through on these inputs, through the worker, until the
 *  worker has answered every run it was handed. */
async function runHalfStatesThroughWorker(def, secondary) {
  setRuntimeRunner(workerRunner(await realWorkerFactory()))
  const states = []
  for (let pass = 0; pass < 6; pass += 1) {
    let landed = false
    const off = onRuntimeColumnsLanded(() => { landed = true })
    const rh = runHalfOf(registry.computeFor(def, CHART, {}, ctxWith(secondary)))
    states.push(rh ? `${rh.state}:${rh.code}` : 'none')
    for (let i = 0; i < 50 && !landed; i += 1) await new Promise((r) => setTimeout(r, 0))
    off()
    if (!landed) break // nothing more in flight: the last state stands
  }
  return states
}

describe('L10b — a run waiting for the seed stays pending across the worker', () => {
  it('the real worker posts the wait AS a wait (`pending: true`), guard intact', async () => {
    const def = libraryDef()
    const states = await runHalfStatesThroughWorker(def, new Map([['SPX', SPX_IN], [SEED_KEY, SEED_LOADING]]))
    expect(states.length).toBeGreaterThan(1) // the worker answered at least once
    expect(states.filter((s) => s.startsWith('refused'))).toEqual([])
    expect(states[states.length - 1]).toBe(`pending:${registry.RUN_HALF_REQUEST_PENDING}`)
  })

  it('⛔ CONTROL: with both series in hand the same worker path SERVES (the rail can see a served run)', async () => {
    const def = libraryDef()
    const states = await runHalfStatesThroughWorker(def, new Map([['SPX', SPX_IN], [SEED_KEY, SEED_IN]]))
    expect(states[states.length - 1]).toBe('served:null')
  })

  it('⛔⛔ THE RULE: every plain field crosses, a field nobody named included; an object field does not', async () => {
    const thrown = Object.assign(new Error('waiting'), { guard: 'runtime:request', pending: true, limit: 'ops', bar: 41,
      notNamedAnywhereYet: 'crosses', aCount: 0, aFlag: false, nothing: null, cause: { deep: true } })
    // the worker's side, then the structured clone the browser makes, then the main thread's side
    const back = errorFromImage(structuredClone(errorImageOf(thrown)))
    expect(back).toBeInstanceOf(Error)
    expect(back.message).toBe('waiting')
    expect(back.name).toBe('Error')
    for (const k of ['guard', 'pending', 'limit', 'bar', 'notNamedAnywhereYet', 'aCount', 'aFlag']) expect(back[k], k).toBe(thrown[k])
    expect(back.cause).toBeUndefined()
    expect('nothing' in back).toBe(false)
  })

  it('the main thread keeps a worker error\'s `pending` (the rebuilt error is still a wait)', async () => {
    const reply = { ok: false, error: { name: 'Error', message: 'still loading', guard: 'runtime:request', pending: true,
      limit: null, bar: null, ms: 3 } }
    const run = workerRunner(() => ({
      postMessage(msg) { queueMicrotask(() => this.onmessage({ data: { ...reply, id: msg.id } })) }, terminate() {} }))
    const err = await new Promise((resolve) => run({ id: 'x', compute: { source: '' } }, [], {}, (e) => resolve(e)))
    expect(err.guard).toBe('runtime:request')
    expect(err.pending).toBe(true)
  })
})
