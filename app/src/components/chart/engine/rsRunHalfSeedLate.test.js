// ─── ⭐⭐ RS RATING L10 — A SERIES ONLY THE RUN HALF READS STILL RECOMPUTES THE CHART WHEN IT LANDS ───
//
// ⚰️ 2026-11-17, production, in session (smoke@ on AGL, instrumented): RS Rating added from "Your
// indicators" stayed refused `runtime:request` for minutes on some loads (2 of 4) and drew on the
// others. Recorded timelines: refused when SPX landed at 27.6 s and the seed only at 37.5 s (the
// `runtime:request` beacon fired at 28.0 s); drawn when both landed together at 15.6 s, and always drawn
// through the door (its preview had fetched both first).
// Cause: the binder recomputes an instance when `otherSymbolsSignature` moves, and that signature
// listed only the tickers the PLOT TREES read (SPX). The rating label reads the seed (`request.seed`
// → RSRATING) in the run half alone, so a seed that landed after a refused run never moved the
// signature, and the memo kept the refusal. The signature now covers `otherSymbolRequestsOf` (the
// trees' reads and the translation's recorded `meta.otherSymbols`).
// This rail drives the REAL binder: SPX in, the seed's fetch failed (waiting on its retry), then the
// seed lands with nothing else changed.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import * as registry from './nativeRegistry'
import { createBinder } from './binder'
import { addInstance } from './instanceControls'
import { mergeChartSettings } from '../chartDefaults'
import { createFakeChart } from './__tests__/fakeChart'
import { memberPaneDefinition } from '../builder/memberPane/memberPaneDefinition'
import { runtimeColumnsFor, resetRuntimeSessions, resetRuntimeLedgers } from './runtime/runtimeColumns'
import { __permitRuntimePaneForTests } from './runtimePaneGate'
import { __allowEveryRuntimeScriptForTests, setRuntimeKillList, runtimeSourceHash } from './runtimeKill'
import { setRunHalfObjectEvidence } from './runHalfRailSeam'
import { objectRenderDropsFor, resetObjectRenderDrops } from './objectRenderNotice'
import { otherSymbolsSignature, symTickersOf } from './otherSymbols'

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
const SEED_FAILED = { bars: [], status: 'error', retryAt: 0 }
const SEED_IN = { bars: SEED, status: 'available', newestBarIsForming: false }

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
  setRunHalfObjectEvidence([])
  resetObjectRenderDrops()
  setRuntimeKillList([])
  resetRuntimeSessions()
  resetRuntimeLedgers()
  vi.unstubAllEnvs()
})

function libraryInstance() {
  // the stored row, as "Your indicators" installs it
  const stored = JSON.parse(JSON.stringify(memberPaneDefinition({ source: RS, name: 'RS Rating', id: 'u_rs-l10-late' }).definition))
  const { installed, errors } = registry.installUserDefinitions([stored])
  expect(installed.length, errors.join(' | ')).toBe(1)
  const def = installed[0]
  defId = def.id
  const fake = createFakeChart()
  const binder = createBinder({ chart: fake.chart, LWC: fake.LWC })
  const cs = addInstance(mergeChartSettings({}), def.id, registry)
  const instances = (cs.indicatorInstances || []).filter((i) => i.defId === def.id)
  const sync = (secondary) => binder.sync({
    enabled: true, cs, instances, registry, bars: CHART, tf: 'D', symbol: SYMBOL, newestBarIsForming: true,
    historyFromListing: true, secondary, exchangeOf: (t) => (t === 'SPX' ? 'SP' : null),
    adjustTime: (t) => t, applyData: (series, data) => series.setData(data), plan: { fresh: true },
    resolvePlacement: () => ({ paneIndex: 0, scaleId: def.id, scaleOptions: {} }),
    createObjectLayer: () => ({ set: () => {}, clear: () => {} }),
  })
  return { def, sync, id: instances[0].instanceId }
}
const served = (id) => !!(objectRenderDropsFor(id) && objectRenderDropsFor(id).servedByRun === true)

describe('L10 — the seed landing after SPX recomputes the run half', () => {
  it('the fixture: RS Rating\'s plot trees read SPX only; the seed is read by the run half alone', () => {
    const { def } = libraryInstance()
    expect([...symTickersOf(def)]).toEqual(['SPX'])
    expect(otherSymbolsSignature(def, new Map([['SPX', SPX_IN], [SEED_KEY, SEED_FAILED]])))
      .not.toBe(otherSymbolsSignature(def, new Map([['SPX', SPX_IN], [SEED_KEY, SEED_IN]])))
  })

  it('refused while the seed\'s fetch has failed, then DRAWN when it lands (nothing else changes)', () => {
    const c = libraryInstance()
    c.sync(new Map([['SPX', SPX_IN], [SEED_KEY, SEED_FAILED]]))
    expect(served(c.id)).toBe(false)
    c.sync(new Map([['SPX', SPX_IN], [SEED_KEY, SEED_IN]]))
    expect(served(c.id)).toBe(true)
  })

  it('⛔ CONTROL: both series in hand at the first sync draw at once', () => {
    const c = libraryInstance()
    c.sync(new Map([['SPX', SPX_IN], [SEED_KEY, SEED_IN]]))
    expect(served(c.id)).toBe(true)
  })
})
