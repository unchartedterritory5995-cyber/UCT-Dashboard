// ─── ⭐⭐ (Fred RS, 2026-11-27) THE SAME CHART OPENED AGAIN DRAWS ITS RS RATING LABEL IN THE CANDLES' FRAME ───
//
// ⚰️ Measured (production-flag bundle of master 3ae19734c4, smoke@ AGL 1D, 12 cold + 12 warm reloads): the line lands
// with the candles, the label 715-2,169 ms after them, because the drawings come only from the worker's run. A run
// half that was SERVED is now kept (`runHalfKept.js`) under a fingerprint of everything the run and its rails read,
// and the same chart opened again (a reload: this tab's memory gone, the device's storage kept) is served it while
// its run is still in flight.
// These rails fail when the kept answer is not served on the reopen (the label waits for the run again), when it is
// served for a chart that is NOT the same (one close, the other-symbol bars, the bundle, a gate), or when the stored
// copy is not the payload itself (NaN, -0, undefined lost in JSON).
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as registry from '../nativeRegistry'
import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'
import { resetHostLaneAsync, isHostLanePending, setFirstPageEnabled } from '../hostLaneAsync'
import {
  runtimeColumnsFor, computeRuntimeColumns, setRuntimeRunner, resetRuntimeSessions, resetRuntimeLedgers,
  RUNTIME_PANE_TIME_BUDGET_MS,
} from '../runtime/runtimeColumns'
import { RUN_HALF_KEY, RUNTIME_OBJECTS_KEY } from '../runtime/runtimeObjects'
import { runtimeSourceHash } from '../runtimeKill'
import { setRunHalfObjectEvidence } from '../runHalfRailSeam'
import {
  __forgetRunHalfKeptMemoryForTests, __setRunHalfKeptEngineForTests, __flushRunHalfKeptForTests, keepRunHalfPayload, keptRunHalfPayload, sameDeep,
} from '../runHalfKept'

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
const PANE = 'rk\u0001a'
// every open hands fresh arrays and a fresh Map, as a reload does: a hit can never come from object identity
const ctxOf = ({ spx = SPX, symbol = SYMBOL } = {}) => ({
  tf: 'D', symbol: { ...symbol }, newestBarIsForming: true, historyFromListing: true, hostPane: PANE,
  secondary: new Map([['SPX', { bars: spx.map((b) => ({ ...b })), status: 'available', newestBarIsForming: true }],
    [SEED_KEY, { bars: SEED.map((b) => ({ ...b })), status: 'available', newestBarIsForming: false }]]),
  exchangeOf: (t) => (t === 'SPX' ? 'SP' : null),
})
const freshBars = () => BARS.map((b) => ({ ...b }))

let defId = null
function fredDef() {
  const stored = JSON.parse(JSON.stringify(memberPaneDefinition({ source: RS, name: 'RS Rating', id: 'u_rh-kept' }).definition))
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

/** A "reload": this tab's memory gone (run memo, sessions, the kept store's memory, a new worker), the device's
 *  localStorage left as it is. */
function reload() {
  __flushRunHalfKeptForTests()                    // the page's quiet-time write (pagehide does it on a real reload)
  __forgetRunHalfKeptMemoryForTests()
  resetRuntimeSessions()
  resetRuntimeLedgers()
  resetHostLaneAsync()
  setFirstPageEnabled(false)
  rt = standInRunner()
  setRuntimeRunner(rt.runner)
}

let rt
beforeEach(() => {
  localStorage.clear()
  __forgetRunHalfKeptMemoryForTests()
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
  registry.registerRuntimeLane(runtimeColumnsFor)
  setRunHalfObjectEvidence([{ sha256: runtimeSourceHash(RS), captures: [
    { capture: 'a', verdict: 'MATCH', objectsV2: true, runtimeOn: true },
    { capture: 'b', verdict: 'MATCH', objectsV2: true, runtimeOn: true }] }])
  resetHostLaneAsync()
  setFirstPageEnabled(false)
  rt = standInRunner()
  setRuntimeRunner(rt.runner)
})
afterEach(() => {
  if (defId) registry.uninstallUserDefinition(defId)
  defId = null
  setRuntimeRunner(null)
  setFirstPageEnabled(true)
  resetHostLaneAsync()
  resetRuntimeSessions()
  resetRuntimeLedgers()
  setRunHalfObjectEvidence([])
  __setRunHalfKeptEngineForTests(null)
  __forgetRunHalfKeptMemoryForTests()
  localStorage.clear()
  vi.unstubAllEnvs()
})

const runs = () => rt.asked.filter((a) => a.def && String(a.def.id).endsWith('u_rh-kept~run'))
const stateOf = (cols) => cols && cols[RUN_HALF_KEY]

/** First open: the run lands, the drawings are served (and kept). Returns the served payload. */
function firstOpen(def) {
  const bars = freshBars()
  const ctx = ctxOf()
  const pending = registry.computeFor(def, bars, {}, ctx)
  expect(isHostLanePending(pending)).toBe(false)
  expect(stateOf(pending) && stateOf(pending).state, 'the first open waits for its run').toBe('pending')
  rt.answerAll()
  const served = registry.computeFor(def, bars, {}, ctx)
  expect(stateOf(served) && stateOf(served).state, JSON.stringify(stateOf(served))).toBe('served')
  const payload = served[RUNTIME_OBJECTS_KEY]
  expect(payload && payload.live.length, 'the RS label is drawn').toBeGreaterThan(0)
  return payload
}


/** ⛔ CONTROL: the unchanged chart, on the same "page", IS served from the kept answer (a miss above is the change's) */
function expectUnchangedServed(def) {
  const cols = registry.computeFor(def, freshBars(), {}, ctxOf())
  expect(stateOf(cols) && stateOf(cols).state, 'control: the unchanged chart is served').toBe('served')
  expect(stateOf(cols).kept).toBe(true)
}

describe('the same chart opened again draws its run half in the frame its candles land in', () => {
  it('a reload draws the served drawings AT ONCE, while its run is still in flight (and the run is still asked)', () => {
    const def = fredDef()
    const payload = firstOpen(def)
    reload()
    const cols = registry.computeFor(def, freshBars(), {}, ctxOf())
    const state = stateOf(cols)
    // ⛔ THE RAIL: no run has answered on this "page", and the label is drawn
    expect(state && state.state, `served from the kept answer (${JSON.stringify(state)})`).toBe('served')
    expect(state.kept).toBe(true)
    expect(sameDeep(cols[RUNTIME_OBJECTS_KEY], payload), 'the very drawings the run served').toBe(true)
    expect(runs().length, 'the run is still asked').toBe(1)
    expect(runs()[0].answered, 'and has not answered').toBe(false)
  })

  it('⛔ one close of one bar moved: nothing kept is drawn, the chart waits for its run', () => {
    const def = fredDef()
    firstOpen(def)
    reload()
    const bars = freshBars()
    bars[bars.length - 1] = { ...bars[bars.length - 1], c: bars[bars.length - 1].c + 0.01 }
    const cols = registry.computeFor(def, bars, {}, ctxOf())
    expect(stateOf(cols) && stateOf(cols).state).toBe('pending')
    expect(cols[RUNTIME_OBJECTS_KEY]).toBeUndefined()
    expectUnchangedServed(def)
  })

  it('⛔ the other symbol\'s bars moved (SPX\'s first close): nothing kept is drawn', () => {
    const def = fredDef()
    firstOpen(def)
    reload()
    const spx = SPX.map((b, i) => (i === 0 ? { ...b, c: b.c + 1 } : b))
    const cols = registry.computeFor(def, freshBars(), {}, ctxOf({ spx }))
    expect(stateOf(cols) && stateOf(cols).state).toBe('pending')
    expectUnchangedServed(def)
  })

  it('⛔ a bar field the host line never reads moved (one volume): nothing kept is drawn (the bars are fingerprinted whole)', () => {
    const def = fredDef()
    firstOpen(def)
    reload()
    const bars = freshBars()
    bars[10] = { ...bars[10], v: bars[10].v + 1 }
    const cols = registry.computeFor(def, bars, {}, ctxOf())
    expect(stateOf(cols) && stateOf(cols).state).toBe('pending')
    expectUnchangedServed(def)
  })

  it('⛔ a context fact the host line never reads moved (the symbol sector): nothing kept is drawn', () => {
    const def = fredDef()
    firstOpen(def)
    reload()
    const cols = registry.computeFor(def, freshBars(), {}, ctxOf({ symbol: { ...SYMBOL, sector: 'Utilities' } }))
    expect(stateOf(cols) && stateOf(cols).state).toBe('pending')
    expectUnchangedServed(def)
  })

  it('⛔ another bundle (a deploy): nothing kept is drawn', () => {
    const def = fredDef()
    firstOpen(def)
    reload()
    __setRunHalfKeptEngineForTests('/assets/index-NEXTDEPLOY.js')
    const cols = registry.computeFor(def, freshBars(), {}, ctxOf())
    expect(stateOf(cols) && stateOf(cols).state).toBe('pending')
    __setRunHalfKeptEngineForTests(null)
    expectUnchangedServed(def)
  })

  it('⛔ a gate closed since (the runtime pane not built): refused, never the kept picture', () => {
    const def = fredDef()
    firstOpen(def)
    reload()
    vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '0')
    const cols = registry.computeFor(def, freshBars(), {}, ctxOf())
    expect(stateOf(cols) && stateOf(cols).state).toBe('refused')
    expect(cols[RUNTIME_OBJECTS_KEY]).toBeUndefined()
    vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
    expectUnchangedServed(def)
  })
})

describe('the kept store keeps the payload itself', () => {
  it('NaN, -0, Infinity and undefined come back as themselves, from the device\'s storage', () => {
    const payload = { status: 'ok', live: [{ id: 'l1', props: { y: NaN, x: -0, z: Infinity, w: -Infinity, u: undefined, t: 'RS 93' } }], withheld: {}, pineVersion: 5 }
    expect(keepRunHalfPayload('fp-1', payload)).toBe(true)
    __flushRunHalfKeptForTests()
    __forgetRunHalfKeptMemoryForTests()            // read back from localStorage, not memory
    const back = keptRunHalfPayload('fp-1')
    expect(back && back.live[0].props.t).toBe('RS 93')
    expect(Number.isNaN(back.live[0].props.y)).toBe(true)
    expect(Object.is(back.live[0].props.x, -0)).toBe(true)
    expect(back.live[0].props.z).toBe(Infinity)
    expect(back.live[0].props.w).toBe(-Infinity)
    expect(Object.prototype.hasOwnProperty.call(back.live[0].props, 'u')).toBe(true)
    expect(sameDeep(back, payload)).toBe(true)
  })

  it('⛔ a payload that is not plain data is not kept', () => {
    expect(keepRunHalfPayload('fp-2', { status: 'ok', live: [{ id: 'a', when: new Date(0) }] })).toBe(false)
    expect(keptRunHalfPayload('fp-2')).toBe(null)
  })
})
