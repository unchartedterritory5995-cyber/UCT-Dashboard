// app/src/components/chart/engine/__tests__/hostLaneLearnedRoute.rail.test.js
//
// ─── ⭐⭐ ONE DOOR FOR EVERY CHART PANE'S HOST VALUES: THE RAILS ──────────────────────────────────────────
//
// docs/pine/evidence/2026-11-19-host-lane-learned-route/EVIDENCE.md. `hostLaneAsync.hostLaneColumns` answers
// every chart pane's host request: the values memoised for their bars, computed on the main thread when this
// tab has MEASURED them cheap at this size (`hostLaneRoute.js`), in the host worker otherwise.
//
//   A. the route's memory: what it predicts from what it measured; bounded; per tab; never persisted;
//   B. the route through the door, and ⛔ THE ROUTE NEVER CHANGES A VALUE: the same documents asked the same
//      requests under a CHEAP clock (every pass measured free: the main thread) and a DEAR one (every pass
//      measured dear: the worker) answer the same columns, byte for byte, as the main thread did before
//      this door existed (`computeFor` with no pane);
//   C. ⛔ THE MEMO CANNOT SERVE A STALE PICTURE: a forming bar that moved, a bar appended and a historical
//      bar corrected, each IN PLACE on the same array, are each computed again (both routes);
//   D. the repetition fault: a binder whose run half is in flight asks again on every sync, and the values
//      are computed ONCE (Fred RS, the production case);
//   E. Fred RS at 5m with its supply (SPX at 5m and D, its own daily rows, the seed): main = worker = memo,
//      byte for byte, runtime pane on and off;
//   F. a timeframe switch while the values compute draws nothing of the old timeframe's.
//
// Every rail here was broken on purpose and seen red (the evidence, section 6).
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as registry from '../nativeRegistry'
import { createBinder } from '../binder'
import { createFakeChart } from './fakeChart'
import { enterMemberDoor, HARNESS_DEF_ID } from './vendorHarness/ourSide'
import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'
import { hostLaneCostOf } from '../hostLaneCost'
import {
  setHostLaneWorkerFactory, resetHostLaneAsync, isHostLanePending, hostLaneStats, barsRevisionOf,
} from '../hostLaneAsync'
import {
  learnCost, predictedMs, computesOnMain, resetHostLaneRoute, hostLaneCostMemorySize, __setHostLaneCostClockForTests,
  HOST_MAIN_BUDGET_MS, HOST_UNMEASURED_MAIN_ROWS, HOST_OTHER_TF_MARGIN, HOST_COST_MEMORY, HOST_COST_SAMPLES,
} from '../hostLaneRoute'
import { LONG_TASK_MS } from '../hostLaneCost'
import { FIRST_PAINT_MAX } from '../../../../utils/barsBackfill'
import { standInWorkers, firstDifference } from './hostLaneStandIn'
import { runtimeColumnsFor, resetRuntimeSessions, resetRuntimeLedgers, setRuntimeRunner } from '../runtime/runtimeColumns'
import { workerRunner, resetRuntimeAsync } from '../runtime/runtimeAsync'
import { runHalfOf } from '../runtime/runtimeObjects'
import { OWN_DAILY_KEY } from '../otherSymbols'
import { __permitRuntimePaneForTests, __resetRuntimePanePermission } from '../runtimePaneGate'
import { __allowEveryRuntimeScriptForTests, __resetRuntimeAllowList, setRuntimeKillList, runtimeSourceHash } from '../runtimeKill'
import { setRunHalfObjectEvidence } from '../runHalfRailSeam'
import { __resetHostKnownDivergence, __ignoreHostKnownDivergenceForTests } from '../hostKnownDivergence'

vi.setConfig({ testTimeout: 300000 })

const REPO = path.resolve(process.cwd(), '..')
const corpusFile = (slug) => {
  const dir = path.join(REPO, 'corpus', 'committed')
  const f = fs.readdirSync(dir).find((x) => x.startsWith(`${slug}__`) || x === `${slug}.pine`)
  return fs.readFileSync(path.join(dir, f), 'utf8')
}
const capture = (f) => JSON.parse(fs.readFileSync(path.join(REPO, 'tests', 'fixtures', 'vendor', 'harness', f), 'utf8')).bars.rows
const DAILY = capture('vw-deadband-ticks-aapl-1d-2026-09-28.json')
const HOURLY = capture('smarter-snr-spy-60-2026-11-14.json')
const barsOf = (rows) => rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }))
const AAPL = Object.freeze({ ticker: 'AAPL', exchange: 'NASDAQ' })
const SPY = Object.freeze({ ticker: 'SPY', exchange: 'AMEX' })
const CTX_D = Object.freeze({ sym: 'AAPL', symbol: AAPL, tf: 'D', newestBarIsForming: false })
const CTX_60 = Object.freeze({ sym: 'SPY', symbol: SPY, tf: '60', newestBarIsForming: false })

/** Cheap, window work (#1711's estimate reads 0 recurrence steps for every one but the last), and over it. */
const CHEAP = 'donchian-channels'
const WINDOW = ['smart-money-volume-index-algoalpha', 'reverse-stochastic-momentum-index-on-chart', 'madrid-moving-average-ribbon']
const COSTLY = 'trend-duration-forecast-chartprime'

const CHEAP_CLOCK = () => 0
const DEAR_CLOCK = () => 1e6

let workers
const doorDef = (slug) => {
  const door = enterMemberDoor(corpusFile(slug))
  expect(door.def && door.def.compute && door.def.compute.kind, `${slug} is a host document`).toBe('ast')
  return door.def
}
const hostView = () => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '0')
  __resetRuntimePanePermission()
  __resetRuntimeAllowList()
  __resetHostKnownDivergence()
}

beforeEach(() => {
  hostView()
  resetHostLaneAsync()
  workers = standInWorkers()
  setHostLaneWorkerFactory(workers.factory)
})
afterEach(() => {
  registry.uninstallUserDefinition(HARNESS_DEF_ID)
  setHostLaneWorkerFactory(null)
  resetHostLaneAsync()
  setRuntimeRunner(null)
  resetRuntimeAsync()
  resetRuntimeSessions()
  resetRuntimeLedgers()
  setRunHalfObjectEvidence([])
  setRuntimeKillList([])
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  __ignoreHostKnownDivergenceForTests()
  __permitRuntimePaneForTests()
  __allowEveryRuntimeScriptForTests()
})

const paneCtx = (ctx, name = 'p') => ({ ...ctx, hostPane: `route\u0001${name}` })

/** A chart pane's FINAL answer: asked, the worker drained, asked again until it is no longer pending. */
function settled(def, bars, ctx) {
  let a = registry.computeFor(def, bars, undefined, ctx)
  for (let i = 0; i < 4 && isHostLanePending(a); i += 1) {
    workers.drain()
    a = registry.computeFor(def, bars, undefined, ctx)
  }
  return a
}

// ─── A. the route's memory ─────────────────────────────────────────────────────────────────────────────
describe('A. the route predicts from what this tab measured; bounded, per tab, never persisted', () => {
  beforeEach(() => resetHostLaneRoute())

  it('its two constants are derived from their authorities, never typed', () => {
    expect(HOST_MAIN_BUDGET_MS).toBe(LONG_TASK_MS)
    expect(HOST_UNMEASURED_MAIN_ROWS).toBe(FIRST_PAINT_MAX)
  })

  it('a document not measured: the main thread over a first paint\'s rows, the worker above them', () => {
    expect(predictedMs('d', 'D', 600)).toBeNull()
    expect(computesOnMain('d', 'D', HOST_UNMEASURED_MAIN_ROWS)).toBe(true)
    expect(computesOnMain('d', 'D', HOST_UNMEASURED_MAIN_ROWS + 1)).toBe(false)
  })

  it('one measured size: its cost at or below it, its cost per row above it', () => {
    learnCost('d', 'D', 1000, 20)
    expect(predictedMs('d', 'D', 400)).toBe(20)      // a shorter series never costs more
    expect(predictedMs('d', 'D', 1000)).toBe(20)
    expect(predictedMs('d', 'D', 5000)).toBe(100)    // the fixed cost spread over more rows: an over-estimate
    expect(computesOnMain('d', 'D', 2000)).toBe(true)   // 40 ms
    expect(computesOnMain('d', 'D', 3000)).toBe(false)  // 60 ms
  })

  it('two measured sizes: the straight line through them (between and above), never below the larger', () => {
    learnCost('fred', '5', 600, 25)
    learnCost('fred', '5', 28800, 356)
    expect(predictedMs('fred', '5', 1152)).toBeCloseTo(25 + (331 / 28200) * 552, 6)
    expect(predictedMs('fred', '5', 300)).toBe(25)
    expect(predictedMs('fred', '5', 30000)).toBeCloseTo(356 + (331 / 28200) * 1200, 6)
    expect(computesOnMain('fred', '5', 1152)).toBe(true)
    expect(computesOnMain('fred', '5', 28800)).toBe(false)
  })

  it('another timeframe\'s measurement, doubled; the timeframe\'s own, once measured, as it is', () => {
    learnCost('fred', 'D', 668, 20)
    expect(predictedMs('fred', '5', 1152)).toBeCloseTo(20 * (1152 / 668) * HOST_OTHER_TF_MARGIN, 6)
    expect(computesOnMain('fred', '5', 1152)).toBe(false)
    learnCost('fred', '5', 1152, 30)
    expect(predictedMs('fred', '5', 1152)).toBe(30)
    expect(computesOnMain('fred', '5', 1152)).toBe(true)
  })

  it('two passes of one size keep the dearer cost per row; a size within 10% is the same size', () => {
    learnCost('d', 'D', 1000, 20)
    learnCost('d', 'D', 1050, 10)
    expect(predictedMs('d', 'D', 1050)).toBeCloseTo(20 / 1000 * 1050, 6)
    learnCost('d', 'D', 1000, 40)
    expect(predictedMs('d', 'D', 1050)).toBeCloseTo(40 / 1000 * 1050, 6)
  })

  it('⛔ bounded: at most HOST_COST_MEMORY documents (the least recently measured forgotten first), HOST_COST_SAMPLES sizes each', () => {
    for (let i = 0; i < HOST_COST_MEMORY + 40; i += 1) learnCost(`doc${i}`, 'D', 1000, 5)
    expect(hostLaneCostMemorySize()).toBe(HOST_COST_MEMORY)
    expect(predictedMs('doc0', 'D', 1000)).toBeNull()
    expect(predictedMs(`doc${HOST_COST_MEMORY + 39}`, 'D', 1000)).toBe(5)
    for (const n of [100, 300, 900, 2700, 8100, 24300]) learnCost('many', 'D', n, n / 100)
    // the smallest and the largest are kept; the prediction between them is still a straight line
    expect(predictedMs('many', 'D', 50)).toBe(1)
    expect(predictedMs('many', 'D', 24300)).toBe(243)
    const rows = []
    for (let n = 100; n <= 24300; n += 100) rows.push(predictedMs('many', 'D', n))
    expect(rows.every((p, i) => i === 0 || p >= rows[i - 1])).toBe(true)
    expect(HOST_COST_SAMPLES).toBeLessThanOrEqual(4)
  })

  it('⛔ per tab and never persisted: the module reads and writes no storage of any kind', () => {
    const src = fs.readFileSync(path.join(REPO, 'app/src/components/chart/engine/hostLaneRoute.js'), 'utf8')
      .replace(/^\s*\/\/.*$/gm, '')
    for (const banned of ['localStorage', 'sessionStorage', 'indexedDB', 'document.cookie', 'caches', 'fetch(', 'navigator']) {
      expect(src.includes(banned), banned).toBe(false)
    }
    const setItem = vi.fn()
    vi.stubGlobal('localStorage', { setItem, getItem: vi.fn(), removeItem: vi.fn() })
    learnCost('x', 'D', 1000, 3)
    predictedMs('x', 'D', 1000)
    expect(setItem).not.toHaveBeenCalled()
    resetHostLaneRoute()
    expect(predictedMs('x', 'D', 1000)).toBeNull()   // a reload (a reset) starts empty
  })
})

// ─── B. the route through the door ─────────────────────────────────────────────────────────────────────
describe('B. the route through the door', () => {
  it('a document not measured: its first paint on the main thread (measured there); measured cheap, its deep history too', () => {
    __setHostLaneCostClockForTests(CHEAP_CLOCK)
    const def = doorDef(CHEAP)
    const first = registry.computeFor(def, barsOf(DAILY.slice(-600)), undefined, paneCtx(CTX_D))
    expect(isHostLanePending(first)).toBe(false)
    expect(hostLaneStats().mainComputed).toBe(1)
    expect(hostLaneStats().posted).toBe(0)
    // measured cheap by its own first paint: its deep history stays on the main thread too
    const deep = registry.computeFor(def, barsOf(DAILY.slice(-3000)), undefined, paneCtx(CTX_D))
    expect(isHostLanePending(deep)).toBe(false)
    expect(hostLaneStats().posted).toBe(0)
  })

  it('a deep history this tab has not measured goes to the worker', () => {
    const def = doorDef(CHEAP)
    const deep = registry.computeFor(def, barsOf(DAILY.slice(-3000)), undefined, paneCtx(CTX_D))
    expect(isHostLanePending(deep)).toBe(true)
    expect(hostLaneStats().posted).toBe(1)
  })

  it('the worker\'s own timing teaches the route: measured cheap there, the next deep history stays on the main thread', () => {
    __setHostLaneCostClockForTests(CHEAP_CLOCK)
    const def = doorDef(CHEAP)
    settled(def, barsOf(DAILY.slice(-3000)), paneCtx(CTX_D))
    expect(hostLaneStats().posted).toBe(1)
    const next = registry.computeFor(def, barsOf(DAILY.slice(-3001, -1)), undefined, paneCtx(CTX_D))
    expect(isHostLanePending(next), 'the worker\'s measurement was not learned').toBe(false)
    expect(hostLaneStats().posted).toBe(1)
  })

  it('measured dear, the worker; measured cheap, the main thread; over #1711\'s estimate, always the worker', () => {
    const cheap = doorDef(CHEAP)
    __setHostLaneCostClockForTests(DEAR_CLOCK)
    registry.computeFor(cheap, barsOf(DAILY.slice(-600)), undefined, paneCtx(CTX_D))
    const dear = registry.computeFor(cheap, barsOf(DAILY.slice(-601, -1)), undefined, paneCtx(CTX_D))
    expect(isHostLanePending(dear), 'a document measured dear stayed on the main thread').toBe(true)
    registry.uninstallUserDefinition(HARNESS_DEF_ID)
    resetHostLaneAsync()
    const costly = doorDef(COSTLY)
    expect(hostLaneCostOf(costly).over).toBe(true)
    __setHostLaneCostClockForTests(CHEAP_CLOCK)
    const c = registry.computeFor(costly, barsOf(DAILY.slice(-300)), undefined, paneCtx(CTX_D))
    expect(isHostLanePending(c), 'a document over the estimate stayed on the main thread').toBe(true)
  })

  it('a document that throws on the main thread throws the same through the door, computed once for its bars', () => {
    const def = { id: 'u_route-throws', compute: { kind: 'ast', fn: 'sha256:route-throws', ast: { type: 'no-such-node' } },
      plots: [{ key: 'value' }], inputs: [] }
    const bars = barsOf(DAILY.slice(-300))
    let plain = null
    try { registry.computeFor(def, bars, undefined, { ...CTX_D }) } catch (e) { plain = e }
    expect(plain, 'non-vacuity: the document throws on the main thread').toBeTruthy()
    const caught = []
    for (let i = 0; i < 2; i += 1) {
      try { registry.computeFor(def, bars, undefined, paneCtx(CTX_D)) } catch (e) { caught.push(e) }
    }
    expect(caught.map((e) => [e.message, e.guard])).toEqual([[plain.message, plain.guard], [plain.message, plain.guard]])
    expect(hostLaneStats().mainComputed, 'a throw is remembered for its bars, not computed again').toBe(0)
    expect(caught[1]).toBe(caught[0])
  })

  it('a request that is not a chart pane\'s never reaches the door (no memo, no route, no measurement)', () => {
    const def = doorDef(CHEAP)
    const bars = barsOf(DAILY.slice(-600))
    registry.computeFor(def, bars, undefined, { ...CTX_D })
    registry.computeFor(def, bars, undefined, { ...CTX_D })
    expect(hostLaneStats()).toMatchObject({ mainComputed: 0, memoHits: 0, posted: 0 })
  })

  it('⛔⛔ THE ROUTE NEVER CHANGES A VALUE: a cheap and a dear clock over the same documents answer the same columns', () => {
    const asks = [barsOf(DAILY.slice(-600)), barsOf(DAILY.slice(-2000)), barsOf(DAILY.slice(-2001, -1))]
    let differed = 0
    for (const slug of [CHEAP, ...WINDOW, COSTLY]) {
      const answers = {}
      const posted = {}
      for (const [name, clock] of [['cheap', CHEAP_CLOCK], ['dear', DEAR_CLOCK]]) {
        resetHostLaneAsync()
        workers = standInWorkers()
        setHostLaneWorkerFactory(workers.factory)
        __setHostLaneCostClockForTests(clock)
        const def = doorDef(slug)
        answers[name] = asks.map((bars) => settled(def, bars, paneCtx(CTX_D, slug)))
        posted[name] = hostLaneStats().posted
        registry.uninstallUserDefinition(HARNESS_DEF_ID)
      }
      const def = doorDef(slug)
      asks.forEach((bars, i) => {
        const before = registry.computeFor(def, bars, undefined, { ...CTX_D })
        for (const name of ['cheap', 'dear']) {
          expect(isHostLanePending(answers[name][i]), `${slug} ${name} ask ${i}: still pending`).toBe(false)
          expect(firstDifference(before, answers[name][i]), `${slug} ${name} ask ${i}`).toBeNull()
        }
      })
      registry.uninstallUserDefinition(HARNESS_DEF_ID)
      // non-vacuity: the two clocks DID route differently (a document over the estimate goes to the worker under both)
      if (slug !== COSTLY) {
        expect(posted.cheap, `${slug}: the cheap clock sent a job`).toBe(0)
        expect(posted.dear, `${slug}: the dear clock kept every ask on the main thread`).toBeGreaterThan(0)
        differed += 1
      } else {
        expect(posted.cheap).toBeGreaterThan(0)
      }
    }
    expect(differed).toBe(1 + WINDOW.length)
  })
})

// ─── C. the memo cannot serve a stale picture ─────────────────────────────────────────────────────────
describe('C. ⛔ the memo cannot serve a stale picture: a bar changed IN PLACE is computed again', () => {
  const edits = {
    'a forming bar that moved': (bars) => { const l = bars[bars.length - 1]; l.c += 0.37; l.h += 50; l.l -= 50 },
    'a bar appended': (bars) => { const l = bars[bars.length - 1]; bars.push({ ...l, t: l.t + 86400, c: l.c + 1, h: l.h + 60 }) },
    'a historical bar corrected': (bars) => { const b = bars[bars.length - 5]; b.h += 80; b.l -= 80; b.v += 1000 },
  }

  it('the rows\' revision moves with every one of them, and only with them', () => {
    const bars = barsOf(DAILY.slice(-600))
    const r0 = barsRevisionOf(bars)
    expect(barsRevisionOf(barsOf(DAILY.slice(-600)))).toBe(r0)   // the same content, another array: the same revision
    for (const [name, edit] of Object.entries(edits)) {
      const b = barsOf(DAILY.slice(-600))
      edit(b)
      expect(barsRevisionOf(b), name).not.toBe(r0)
    }
    const z = barsOf(DAILY.slice(-600))
    z[3].c = -0
    const w = barsOf(DAILY.slice(-600))
    w[3].c = 0
    expect(barsRevisionOf(z)).not.toBe(barsRevisionOf(w))
  })

  for (const route of ['main', 'worker']) {
    it.each(Object.keys(edits))(`${route} route: %s`, (name) => {
      __setHostLaneCostClockForTests(route === 'main' ? CHEAP_CLOCK : DEAR_CLOCK)
      const def = doorDef(CHEAP)
      const bars = barsOf(DAILY.slice(-600))
      if (route === 'worker') {
        // measured dear on another array first, so these bars go to the worker
        registry.computeFor(def, barsOf(DAILY.slice(-601, -1)), undefined, paneCtx(CTX_D))
      }
      const first = settled(def, bars, paneCtx(CTX_D))
      expect(firstDifference(registry.computeFor(def, barsOf(DAILY.slice(-600)), undefined, { ...CTX_D }), first)).toBeNull()
      const at = hostLaneStats()
      edits[name](bars)            // ⛔ the SAME array, changed in place
      const again = settled(def, bars, paneCtx(CTX_D))
      const now = hostLaneStats()
      if (route === 'main') expect(now.mainComputed - at.mainComputed, `${name}: served from the memo`).toBe(1)
      else expect(now.posted - at.posted, `${name}: served from the memo`).toBe(1)
      const copy = bars.map((b) => ({ ...b }))
      expect(firstDifference(registry.computeFor(def, copy, undefined, { ...CTX_D }), again), name).toBeNull()
      expect(firstDifference(first, again), `${name}: the answer did not move`).not.toBeNull()
    })
  }
})

// ─── Fred RS (the production case) ────────────────────────────────────────────────────────────────────
const RS = fs.readFileSync(path.join(REPO, 'docs/pine/rs-rating/rs-rating-fred6724__pziQwiT2.pine'), 'utf8')
const SEED_KEY = 'SEED_FRED6725_RS_RATING:RSRATING'
const ET = (iso, hh, mm) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d, hh + 5, mm) / 1000 }
function sessions(n, end = '2026-11-18') {
  const out = []
  for (let t = Date.parse(`${end}T00:00:00Z`); out.length < n; t -= 86400000) {
    const wd = new Date(t).getUTCDay()
    if (wd !== 0 && wd !== 6) out.unshift(new Date(t).toISOString().slice(0, 10))
  }
  return out
}
/** RDDT-like 5m rows 04:00-20:00 ET, and SPX at 5m in the regular session of the newest 40% of the days only
 *  (the chart reaches before the SPX bars held: Fred's series is `na` there, as on production). */
function fiveMinute(days) {
  const chart = []
  const spx = []
  const list = sessions(days)
  list.forEach((d, di) => {
    for (let k = 0; k < 192; k += 1) {
      const t = ET(d, 4, 0) + k * 300
      const i = chart.length
      const c = 150 + 30 * Math.sin(i / 700) + 5 * Math.sin(i / 37) + i * 0.0005
      chart.push({ t, o: c - 0.2, h: c + 0.5, l: c - 0.6, c, v: 1e4 + (i % 97) })
      if (t >= ET(d, 9, 30) && t < ET(d, 16, 0) && di >= Math.floor(days * 0.6)) {
        const s = 6500 + 200 * Math.sin(i / 900) + i * 0.01
        spx.push({ t, o: s - 1, h: s + 2, l: s - 2, c: s, v: 1e6 })
      }
    }
  })
  return { chart, spx }
}
const DAILY_DAYS = sessions(700)
const utcMid = (iso) => Date.parse(`${iso}T00:00:00Z`) / 1000
const SPX_D = DAILY_DAYS.map((d, i) => ({ t: utcMid(d), o: 1, h: 1, l: 1, c: 5000 + i * 3 + 100 * Math.sin(i / 30), v: 1 }))
const OWN_D = DAILY_DAYS.slice(-420).map((d, i) => ({ t: d, o: 1, h: 1, l: 1, c: 40 + i * 0.3 + 10 * Math.sin(i / 20), v: 1 }))
const SEED = DAILY_DAYS.slice(-35, -1).map((t, i) => ({ t, o: 0, h: 1000, l: 0, c: 300 - 7 * i, v: 0 }))
const RDDT = Object.freeze({ ticker: 'RDDT', exchange: 'NYSE', industry: 'Internet Software/Services', sector: 'Technology Services', securityType: 'stock' })
const fredCtx = (spx) => ({
  sym: 'RDDT', tf: '5', newestBarIsForming: false, symbol: RDDT,
  secondary: new Map([
    ['SPX', { bars: spx, status: 'available', newestBarIsForming: false }],
    ['SPX@D', { bars: SPX_D, status: 'available', newestBarIsForming: false }],
    [OWN_DAILY_KEY, { bars: OWN_D, status: 'available', newestBarIsForming: false }],
    [SEED_KEY, { bars: SEED, status: 'available', newestBarIsForming: false }],
  ]),
  exchangeOf: (t) => (t === 'SPX' ? 'SP' : null),
})
const runtimeOn = () => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
  __permitRuntimePaneForTests()
  __allowEveryRuntimeScriptForTests()
  setRuntimeKillList([])
  registry.registerRuntimeLane(runtimeColumnsFor)
  setRunHalfObjectEvidence([{ sha256: runtimeSourceHash(RS), captures: [
    { capture: 'a', verdict: 'MATCH', objectsV2: true, runtimeOn: true },
    { capture: 'b', verdict: 'MATCH', objectsV2: true, runtimeOn: true }] }])
}
let fredId = null
function fredDef() {
  const stored = JSON.parse(JSON.stringify(memberPaneDefinition({ source: RS, name: 'RS Rating', id: 'u_fred-route-rail' }).definition))
  const { installed, errors } = registry.installUserDefinitions([stored])
  expect(installed.length, errors.join(' | ')).toBe(1)
  fredId = installed[0].id
  expect(installed[0].compute.kind).toBe('ast')
  return installed[0]
}
afterEach(() => { if (fredId) registry.uninstallUserDefinition(fredId); fredId = null })

// ─── D. the repetition fault ───────────────────────────────────────────────────────────────────────────
describe('D. a run half in flight: the binder asks on every sync, the values are computed ONCE', () => {
  it('Fred RS, its run half never answering (production: SPX, the seed, the run itself in flight)', () => {
    runtimeOn()
    // the run half's worker never answers: the binder's own memo stays empty (`halfPending`) and it asks again
    setRuntimeRunner(workerRunner(() => ({ postMessage() {}, terminate() {} })))
    setHostLaneWorkerFactory(null)          // the main thread's route: what production did for Fred before
    const def = fredDef()
    expect(def.compute.runtimeObjects, 'Fred RS carries a run half').toBeTruthy()
    expect(hostLaneCostOf(def).over, '#1711\'s estimate reads Fred RS as cheap (window work)').toBe(false)
    const { chart, spx } = fiveMinute(6)
    let asked = 0
    const reg = { ...registry, computeFor: (...a) => { asked += 1; return registry.computeFor(...a) } }
    const fake = createFakeChart()
    const binder = createBinder({ chart: fake.chart, LWC: fake.LWC, scope: 'route-rail' })
    const ctx = { enabled: true, registry: reg, bars: chart, adjustTime: (t) => t, plan: { fresh: true },
      applyData: (series, data) => { if (series && data) series.setData(data) },
      resolvePlacement: () => ({ paneIndex: 0, scaleId: 'right', scaleOptions: { autoScale: true } }),
      instances: [{ instanceId: 'pine:fred', defId: def.id, inputs: {}, hidden: false }], ...fredCtx(spx) }
    const SYNCS = 6
    for (let i = 0; i < SYNCS; i += 1) binder.sync(ctx)
    const stats = hostLaneStats()
    expect(asked, 'the binder asked on every sync (its memo is empty while the run half waits)').toBe(SYNCS)
    expect(stats.mainComputed, 'the values were computed again on a sync').toBe(1)
    expect(stats.memoHits).toBe(SYNCS - 1)
    const last = registry.computeFor(def, chart, {}, { ...fredCtx(spx), hostPane: 'route-rail\u0001pine:fred' })
    expect((runHalfOf(last) || {}).state, 'the run half is in flight (the fault\'s condition)').toBe('pending')
  })
})

// ─── E. Fred RS at 5m ──────────────────────────────────────────────────────────────────────────────────
describe('E. Fred RS at 5m with its supply: the main thread, the worker and the memo answer the same bytes', () => {
  for (const view of ['runtime pane off', 'runtime pane on']) {
    it(view, () => {
      if (view === 'runtime pane on') runtimeOn()
      const def = fredDef()
      const { chart, spx } = fiveMinute(14)   // 2,688 rows: past a first paint's
      expect(chart.length).toBeGreaterThan(HOST_UNMEASURED_MAIN_ROWS)
      const fc = fredCtx(spx)   // ONE supply, as the chart holds it (an entry is the same object until it changes)
      const before = registry.computeFor(def, chart, {}, { ...fc })
      const plotKeys = Object.keys(before)
      expect(plotKeys.length).toBeGreaterThan(0)
      expect(Object.values(before).some((col) => Array.from(col).some(Number.isFinite)), 'non-vacuity: Fred draws').toBe(true)
      // the worker (not measured, a deep history)
      const pending = registry.computeFor(def, chart, {}, { ...fc, hostPane: 'fred\u0001w' })
      expect(isHostLanePending(pending)).toBe(true)
      workers.drain()
      const viaWorker = registry.computeFor(def, chart, {}, { ...fc, hostPane: 'fred\u0001w' })
      expect(firstDifference(before, viaWorker), 'worker').toBeNull()
      // the memo (the same request again)
      expect(firstDifference(before, registry.computeFor(def, chart, {}, { ...fc, hostPane: 'fred\u0001w' })), 'memo').toBeNull()
      // the main thread (no worker)
      resetHostLaneAsync()
      setHostLaneWorkerFactory(null)
      const viaMain = registry.computeFor(def, chart, {}, { ...fc, hostPane: 'fred\u0001m' })
      expect(hostLaneStats().mainComputed).toBe(1)
      expect(firstDifference(before, viaMain), 'main').toBeNull()
      expect(firstDifference(before, registry.computeFor(def, chart, {}, { ...fc, hostPane: 'fred\u0001m' })), 'main memo').toBeNull()
      expect(hostLaneStats().memoHits).toBe(1)
    })
  }
})

// ─── F. a timeframe switch while the values compute ───────────────────────────────────────────────────
describe('F. a timeframe switch while the values compute draws nothing of the old timeframe', () => {
  /** SPY at 30 minutes, from the hourly capture: each hour split in two, so every hourly bar's time is a 30-minute
   *  bar's time too (an old picture re-aligned on time WOULD find bars to draw on). */
  const halfHours = (rows) => barsOf(rows).flatMap((b) => [{ ...b, c: (b.o + b.c) / 2, v: b.v / 2 }, { ...b, t: b.t + 1800, o: (b.o + b.c) / 2, v: b.v / 2 }])
  const CTX_30 = Object.freeze({ sym: 'SPY', symbol: SPY, tf: '30', newestBarIsForming: false })
  const cases = [
    ['1D -> 60m (no bar time shared)', () => barsOf(DAILY.slice(-600)), CTX_D, () => barsOf(HOURLY.slice(-600)), CTX_60],
    ['60m -> 30m (every old bar time is a new bar time)', () => barsOf(HOURLY.slice(-600)), CTX_60, () => halfHours(HOURLY.slice(-600)), CTX_30],
  ]
  it.each(cases)('%s: the old values drawn, the new request in the worker, no series holds an old value meanwhile', (_n, oldBars, oldCtx, newBars, newCtx) => {
    __setHostLaneCostClockForTests(DEAR_CLOCK)
    doorDef(CHEAP)
    const fake = createFakeChart()
    const binder = createBinder({ chart: fake.chart, LWC: fake.LWC, scope: 'route-rail-f' })
    const sync = (bars, c) => binder.sync({ enabled: true, registry, bars, adjustTime: (t) => t, plan: { fresh: true },
      applyData: (series, data) => { if (series && data) series.setData(data) },
      resolvePlacement: () => ({ paneIndex: 0, scaleId: 'right', scaleOptions: { autoScale: true } }),
      instances: [{ instanceId: 'pine:f', defId: HARNESS_DEF_ID, inputs: {}, hidden: false }], ...c })
    const lastSetOf = (s) => {
      const sets = fake.calls.filter((c) => c.id === s.__id && c.method === 'setData')
      return sets.length ? sets[sets.length - 1].args[0] : []
    }
    const holdsAt = (times) => (s) => lastSetOf(s).some((p) => p && Number.isFinite(p.value) && times.has(p.time))
    const removed = () => new Set(fake.calls.filter((c) => c.method === 'removeSeries').map((c) => c.args[0] && c.args[0].__id))
    const a = oldBars()
    sync(a, oldCtx)                                      // a first paint: the main thread
    const oldTimes = new Set(a.map((b) => b.t))
    const drawnOld = fake.seriesCreated.filter(holdsAt(oldTimes))
    expect(drawnOld.length, 'non-vacuity: the old timeframe\'s values were drawn').toBeGreaterThan(0)
    const b = newBars()
    sync(b, newCtx)                                      // measured dear: the worker; pending, no picture of THIS pane
    expect(hostLaneStats().posted).toBe(1)
    const gone = removed()
    for (const s of fake.seriesCreated) {
      if (gone.has(s.__id)) continue
      expect(holdsAt(oldTimes)(s), `${s.__id} still holds the old timeframe's values against the new bars`).toBe(false)
    }
    workers.drain()
    sync(b, newCtx)
    const live = fake.seriesCreated.filter((s) => !removed().has(s.__id))
    const drawnNew = live.filter(holdsAt(new Set(b.map((x) => x.t))))
    expect(drawnNew.length, 'the landed values were drawn').toBe(drawnOld.length)
  })
})
