// ─── ⭐⭐ (Fred RS run half, 2026-11-26) THE RUN HALF IS ASKED BESIDE ITS HOST JOB, NOT AFTER IT ───
//
// ⚰️ Measured (production-flag bundles, smoke@ AGL 1D, n=20 reloads, 2026-11-26): the RS Rating label landed ~900 ms
// after the candles. One serial step in that: the run half was asked only once the host lane's values LANDED
// (`astLaneFinish` → `astRunExtras` → `withRunHalf`), so a chart whose host values went to the host worker posted its
// run after the host worker answered (170-300 ms later), and the label waited for both, one after the other.
// The run reads the bars, the settings and the other-symbol cache, never the host's values; only the rails compare
// the two, once both are in. So `computeFor` asks the run half the moment the host job goes out (`primeRunHalf`),
// and the host's landing finds the same run by its memo.
// These rails fail when the run is asked only after the host lands again, when the early ask is a DIFFERENT run
// (asked twice), or when the early ask draws or refuses anything itself.
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as registry from '../nativeRegistry'
import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'
import {
  setHostLaneWorkerFactory, resetHostLaneAsync, isHostLanePending, setFirstPageEnabled, __routeEveryHostDocumentForTests,
} from '../hostLaneAsync'
import { standInWorkers } from './hostLaneStandIn'
import {
  runtimeColumnsFor, computeRuntimeColumns, setRuntimeRunner, resetRuntimeSessions, resetRuntimeLedgers,
  RUNTIME_PANE_TIME_BUDGET_MS,
} from '../runtime/runtimeColumns'
import { RUN_HALF_KEY, RUNTIME_OBJECTS_KEY } from '../runtime/runtimeObjects'
import { runtimeSourceHash } from '../runtimeKill'
import { setRunHalfObjectEvidence } from '../runHalfRailSeam'

vi.setConfig({ testTimeout: 300000 })

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
const BARS = SESSIONS.map((t, i) => { const c = 80 + 20 * Math.sin(i / 17) + i * 0.05; return { t, o: c - 0.4, h: c + 1.1, l: c - 1.2, c, v: 1e6 + i } })
const SPX = SESSIONS.map((iso, i) => { const c = 5400 + 300 * Math.sin(i / 41) + i * 3; return { t: utcMidnight(iso), o: c - 5, h: c + 20, l: c - 22, c, v: 3e9 } })
const SEED = SESSIONS.slice(-35, -1).map((t, i) => ({ t, o: 0, h: 1000, l: 0, c: 300 - 7 * i, v: 0 }))
const SYMBOL = { ticker: 'AGL', exchange: 'NYSE', industry: 'Medical Care Facilities', sector: 'Healthcare', securityType: 'stock' }
const PANE = 'rh\u0001a'
const ctxOf = (extra = {}) => ({
  tf: 'D', symbol: SYMBOL, newestBarIsForming: true, historyFromListing: true,
  secondary: new Map([['SPX', { bars: SPX, status: 'available', newestBarIsForming: true }],
    [SEED_KEY, { bars: SEED, status: 'available', newestBarIsForming: false }]]),
  exchangeOf: (t) => (t === 'SPX' ? 'SP' : null), ...extra,
})

let defId = null
function fredDef() {
  const stored = JSON.parse(JSON.stringify(memberPaneDefinition({ source: RS, name: 'RS Rating', id: 'u_rh-primed' }).definition))
  const { installed, errors } = registry.installUserDefinitions([stored])
  expect(installed.length, errors.join(' | ')).toBe(1)
  defId = installed[0].id
  return installed[0]
}

/** The runtime worker, stood in: every run asked is recorded, and answered only when the rail says so. */
function standInRunner() {
  const asked = []
  const runner = (def, rows, ctx, done) => { asked.push({ def, rows, ctx, done, answered: false }) }
  const answerAll = () => {
    for (const a of asked) {
      if (a.answered) continue
      a.answered = true
      let cols = null
      let err = null
      try { cols = computeRuntimeColumns(a.def, a.rows, a.ctx, { budgetMs: RUNTIME_PANE_TIME_BUDGET_MS }) } catch (e) { err = e }
      a.done(err, cols)
    }
  }
  return { asked, runner, answerAll }
}

let workers
let rt
// a fresh bars array per case: the run memo is keyed on the array (`runtimeColumnsFor`)
let CHART
beforeEach(() => {
  CHART = BARS.map((b) => ({ ...b }))
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
  registry.registerRuntimeLane(runtimeColumnsFor)
  setRunHalfObjectEvidence([{ sha256: runtimeSourceHash(RS), captures: [
    { capture: 'a', verdict: 'MATCH', objectsV2: true, runtimeOn: true },
    { capture: 'b', verdict: 'MATCH', objectsV2: true, runtimeOn: true }] }])
  resetHostLaneAsync()
  setFirstPageEnabled(false)
  workers = standInWorkers()
  setHostLaneWorkerFactory(workers.factory)
  rt = standInRunner()
  setRuntimeRunner(rt.runner)
})
afterEach(() => {
  if (defId) registry.uninstallUserDefinition(defId)
  defId = null
  setRuntimeRunner(null)
  setHostLaneWorkerFactory(null)
  setFirstPageEnabled(true)
  __routeEveryHostDocumentForTests(false)
  resetHostLaneAsync()
  resetRuntimeSessions()
  resetRuntimeLedgers()
  setRunHalfObjectEvidence([])
  vi.unstubAllEnvs()
})

const runs = () => rt.asked.filter((a) => a.def && String(a.def.id).endsWith('u_rh-primed~run'))

describe('the run half is asked beside its host job', () => {
  it('the host values go to the worker: the run half is asked in the SAME paint, over the same bars', () => {
    __routeEveryHostDocumentForTests(true)
    const def = fredDef()
    const cols = registry.computeFor(def, CHART, {}, ctxOf({ hostPane: PANE }))
    expect(isHostLanePending(cols), 'the host values are in the worker').toBe(true)
    expect(workers.posted(), 'the host job went out').toBeGreaterThan(0)
    // ⛔ THE RAIL: before the host lands, its run half is already asked
    expect(runs().length, 'the run half is asked while the host is still in its worker').toBe(1)
    expect(runs()[0].rows, 'over the very bars the host computes').toBe(CHART)
    // and nothing is drawn or refused by the early ask: the pending answer carries no run-half state
    expect(cols[RUN_HALF_KEY], 'the early ask writes no state').toBeUndefined()
  })

  it('the host lands after the run: the drawings are served AT ONCE, from the run already asked (one run, not two)', () => {
    __routeEveryHostDocumentForTests(true)
    const def = fredDef()
    const ctx = ctxOf({ hostPane: PANE })
    registry.computeFor(def, CHART, {}, ctx)
    expect(runs().length).toBe(1)
    rt.answerAll()                       // the run lands first (it started first)
    workers.drain()                      // then the host values
    const landed = registry.computeFor(def, CHART, {}, ctx)
    expect(isHostLanePending(landed)).toBe(false)
    const state = landed[RUN_HALF_KEY]
    expect(state && state.state, `the run half is served in the paint the host lands in (${JSON.stringify(state)})`).toBe('served')
    expect(landed[RUNTIME_OBJECTS_KEY] && landed[RUNTIME_OBJECTS_KEY].live.length, 'the RS label is drawn').toBeGreaterThan(0)
    // ⛔ ONE RUN: the host's landing found the early run by its memo
    expect(runs().length, 'the early ask and the landing are one run').toBe(1)
  })

  it('⛔ CONTROL: host values computed on this thread ask the run half exactly once, as before', () => {
    const def = fredDef()
    const cols = registry.computeFor(def, CHART, {}, ctxOf({ hostPane: PANE }))
    expect(isHostLanePending(cols)).toBe(false)
    expect(runs().length).toBe(1)
    expect(cols[RUN_HALF_KEY] && cols[RUN_HALF_KEY].state).toBe('pending')
  })

  it('⛔ CONTROL: a request no chart pane owns asks nothing early (it is computed whole, as before)', () => {
    __routeEveryHostDocumentForTests(true)
    const def = fredDef()
    registry.computeFor(def, CHART, {}, ctxOf())
    expect(workers.posted()).toBe(0)
    expect(runs().length).toBe(1)
  })
})
