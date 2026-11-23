// app/src/components/chart/engine/__tests__/hostLaneWorker.rail.test.js
//
// ─── ⭐⭐ HOST WORKER — THE RAILS (docs/pine/evidence/2026-11-17-host-lane-worker/EVIDENCE.md) ────────
//
//   1. the route: a cheap document, and every request that is not a chart's, stays on the main
//      thread; a costly one goes to the worker; ONE authority (#1711's `hostLaneCostOf`);
//   2. stale-while-revalidate: a poll's recompute keeps the pane's last values drawn (re-aligned on
//      bar time), the binder neither memoises nor releases them, and the landed values replace them;
//      the first load shows nothing until the values land (the pane's loading state);
//   3. a superseded result never paints: a newer request of a pane replaces its waiting one, and a
//      symbol switch never draws the old symbol's values, before or after the old job lands;
//   3b. a superseded RUNNING job stops at once (its worker terminated, a fresh one takes the newer job),
//      except the pane's first picture, which finishes on a retired worker and is drawn; a late older
//      answer is dropped; a cancel is never a failure; no worker state outlives its worker
//      (docs/pine/evidence/2026-11-18-host-lane-worker-followups/EVIDENCE.md);
//   4. a worker that fails never blanks a pane: no worker, a crash, a refused post -> the main thread
//      (values equal to today's); past the watchdog -> refused BY NAME, said on the strip;
//   5. what the worker computes is the main thread's function on the main thread's arguments: every
//      `ctx.<field>` the values read crosses, every record they attach is re-attached, and the
//      worker's closure holds no registry, network, storage or build flag.
//
// The worker is a stand-in that runs the worker's own handler over structured clones of the exact
// messages (`hostLaneStandIn.js`). Every rail here was broken on purpose and seen red (the evidence).
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest'
import * as registry from '../nativeRegistry'
import { createBinder } from '../binder'
import { createFakeChart } from './fakeChart'
import { enterMemberDoor, HARNESS_DEF_ID } from './vendorHarness/ourSide'
import { hostLaneCostOf } from '../hostLaneCost'
import {
  setHostLaneWorkerFactory, resetHostLaneAsync, isHostLanePending, hostLaneStats, hostLaneRunsOffThread,
  hostLaneStopOf, HOST_WORKER_UNRESPONSIVE_GUARD, HOST_WORKER_WATCHDOG_MS, HOST_WORKER_MAX_STARTS,
  hostObjectsOffThread, hostObjectsSendable,
} from '../hostLaneAsync'
import { hostObjectReaderOpts } from '../hostObjects'
import { HOST_CTX_FIELDS, HOST_CTX_CARRIED, packRows, unpackRows, errorImageOf, errorFromImage } from '../hostLaneWire'
import * as errorImage from '../runtime/errorImage'
import { TableRefusal, isRefusal } from '../ast/parse'
import { AST_SIDE_RECORDS, astSideRecordsOf, withAstSideRecords, withColumnErrors, withRuntimeErrorStop } from '../astColumns'
import { runtimeErrorNoticeFor, resetRuntimeErrorNotices } from '../runtimeErrorNotice'
import { standInWorkers, firstDifference } from './hostLaneStandIn'
import { asMember } from '../../../../testing/runtimeGate'
import { walk, chainOf, FORBIDDEN_MODULES, FORBIDDEN_PATTERNS } from '../../../../../../tools/pine_runtime_closure.mjs'

const REPO = path.resolve(process.cwd(), '..')
const ENGINE = 'app/src/components/chart/engine'
const corpusFile = (slug) => {
  const dir = path.join(REPO, 'corpus', 'committed')
  const f = fs.readdirSync(dir).find((x) => x.startsWith(`${slug}__`) || x === `${slug}.pine`)
  return fs.readFileSync(path.join(dir, f), 'utf8')
}
const daily = JSON.parse(fs.readFileSync(path.join(REPO, 'tests', 'fixtures', 'vendor', 'harness',
  'vw-deadband-ticks-aapl-1d-2026-09-28.json'), 'utf8')).bars.rows
const barsOf = (rows) => rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }))
const AAPL = Object.freeze({ ticker: 'AAPL', exchange: 'NASDAQ' })
const MSFT = Object.freeze({ ticker: 'MSFT', exchange: 'NASDAQ' })
const CTX = Object.freeze({ sym: 'AAPL', symbol: AAPL, tf: 'D', newestBarIsForming: false })

/** A COSTLY host document (recurrences over the budget) and a CHEAP one, through the member door. */
const COSTLY = 'trend-duration-forecast-chartprime'
const CHEAP = 'donchian-channels'

let workers
const doorDef = (slug) => {
  const door = enterMemberDoor(corpusFile(slug))
  expect(door.def && door.def.compute && door.def.compute.kind, `${slug} is a host document`).toBe('ast')
  return door.def
}

beforeAll(() => {
  // the member door with the runtime pane off (`hostLaneCost.measure.test.js`'s host view): every
  // script here is a host document
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '0')
})
// ⛔ The member's doors in a beforeEach, never a beforeAll: the test grant re-opens them before every
// test (`src/testing/runtimeGate.js`), so a beforeAll narrowing here ran every test under the grant
// (test-grant census, 2026-11-19; it measured green with the grant off too).
asMember({ allow: true, pane: true, hkd: true })
afterAll(() => {
  vi.unstubAllEnvs()
})
beforeEach(() => {
  resetHostLaneAsync()
  resetRuntimeErrorNotices()
  workers = standInWorkers()
  setHostLaneWorkerFactory(workers.factory)
})
afterEach(() => {
  registry.uninstallUserDefinition(HARNESS_DEF_ID)
  setHostLaneWorkerFactory(null)
  resetHostLaneAsync()
  vi.useRealTimers()
})

const pane = (name = 'p') => ({ ...CTX, hostPane: `rail\u0001${name}` })

// ─── 1. the route ─────────────────────────────────────────────────────────────────────────────────
describe('1. the route: cheap documents stay on the main thread (one authority, #1711)', () => {
  it('the costly document goes to the worker; the cheap one is answered at once, as before', () => {
    const bars = barsOf(daily.slice(-300))
    const costly = doorDef(COSTLY)
    expect(hostLaneCostOf(costly).over).toBe(true)
    expect(hostLaneRunsOffThread(costly)).toBe(hostLaneCostOf(costly).over)
    const a = registry.computeFor(costly, bars, undefined, pane())
    expect(isHostLanePending(a)).toBe(true)
    expect(hostLaneStats().posted).toBe(1)
    registry.uninstallUserDefinition(HARNESS_DEF_ID)

    const cheap = doorDef(CHEAP)
    expect(hostLaneCostOf(cheap).over).toBe(false)
    expect(hostLaneRunsOffThread(cheap)).toBe(false)
    const c = registry.computeFor(cheap, bars, undefined, pane('cheap'))
    expect(isHostLanePending(c)).toBe(false)
    expect(hostLaneStats().posted).toBe(1)   // nothing more was posted
    expect(firstDifference(registry.computeFor(cheap, bars, undefined, { ...CTX }), c)).toBeNull()
  })

  it('a request that is not a chart pane\'s (no `hostPane`) is never sent, whatever it costs', () => {
    const bars = barsOf(daily.slice(-300))
    const costly = doorDef(COSTLY)
    const a = registry.computeFor(costly, bars, undefined, { ...CTX })
    expect(isHostLanePending(a)).toBe(false)
    expect(Object.keys(a).length).toBeGreaterThan(0)
    expect(hostLaneStats().posted).toBe(0)
  })
})

// ─── 2. stale-while-revalidate ─────────────────────────────────────────────────────────────────────
const placement = () => ({ paneIndex: 0, scaleId: 'right', scaleOptions: { autoScale: true } })
const syncCtx = (bars, extra = {}) => ({
  enabled: true, registry, bars, adjustTime: (t) => t, plan: { fresh: true },
  applyData: (series, data) => { if (series && data) series.setData(data) }, resolvePlacement: placement,
  instances: [{ instanceId: 'pine:rail', defId: HARNESS_DEF_ID, inputs: {}, hidden: false }],
  ...CTX, ...extra,
})
let fakeCalls = []
const finiteValues = (series) => {
  const sets = series ? fakeCalls.filter((c) => c.id === series.__id && c.method === 'setData') : []
  const last = sets.length ? sets[sets.length - 1].args[0] : []
  return last.filter((p) => p && Number.isFinite(p.value)).map((p) => [p.time, p.value])
}

describe('2. stale-while-revalidate: a recompute never blanks the pane', () => {
  it('the computeFor answer: empty while the first load computes, the last values (on bar time) during a poll', () => {
    const def = doorDef(COSTLY)
    const a = barsOf(daily.slice(-301, -1))
    const first = registry.computeFor(def, a, undefined, pane())
    expect(isHostLanePending(first)).toBe(true)
    expect(Object.keys(first)).toEqual([])   // the first load: no picture, the pane's loading state
    workers.drain()
    const done = registry.computeFor(def, a, undefined, pane())
    expect(isHostLanePending(done)).toBe(false)
    const keys = Object.keys(done)
    expect(keys.length).toBeGreaterThan(0)
    // a poll: the newest bar moved and a new one arrived (a NEW array, as the chart's poll makes)
    const b = barsOf(daily.slice(-300))
    b[b.length - 2] = { ...b[b.length - 2], c: b[b.length - 2].c + 0.01 }
    const polled = registry.computeFor(def, b, undefined, pane())
    expect(isHostLanePending(polled)).toBe(true)
    expect(Object.keys(polled).sort()).toEqual([...keys].sort())
    let compared = 0
    for (const k of keys) {
      expect(polled[k].length).toBe(b.length)
      for (let j = 0; j < b.length - 1; j += 1) {   // bar j of b is bar j + 1 of a
        expect(Object.is(polled[k][j], done[k][j + 1]), `${k}[${j}]`).toBe(true)
        if (Number.isFinite(polled[k][j])) compared += 1
      }
      expect(Number.isNaN(polled[k][b.length - 1])).toBe(true)   // a bar the old answer never held
    }
    expect(compared).toBeGreaterThan(50)
    workers.drain()
    const fresh = registry.computeFor(def, b, undefined, pane())
    expect(isHostLanePending(fresh)).toBe(false)
    expect(firstDifference(registry.computeFor(def, b, undefined, { ...CTX }), fresh)).toBeNull()
  })

  it('the binder keeps the series drawn through a poll, never memoises the stale picture, and draws the landed values', () => {
    doorDef(COSTLY)
    const fake = createFakeChart()
    fakeCalls = fake.calls
    const binder = createBinder({ chart: fake.chart, LWC: fake.LWC, scope: 'rail' })
    const a = barsOf(daily.slice(-301, -1))
    binder.sync(syncCtx(a))
    expect(fake.seriesCreated.length).toBe(0)        // the first load: nothing drawn yet
    workers.drain()
    binder.sync(syncCtx(a))
    const bound = fake.seriesCreated.filter((s) => finiteValues(s).length)
    expect(bound.length).toBeGreaterThan(0)
    const removedBefore = fake.count('removeSeries')
    const before = new Map(bound.map((s) => [s, finiteValues(s)]))
    // the poll
    const b = barsOf(daily.slice(-300))
    binder.sync(syncCtx(b))
    expect(fake.count('removeSeries'), 'a poll released the series while its values computed').toBe(removedBefore)
    for (const s of bound) {
      const now = finiteValues(s)
      expect(now.length, 'the pane went blank during the recompute').toBeGreaterThan(0)
      const was = new Map(before.get(s))
      for (const [t, v] of now) expect(v).toBe(was.get(t))   // the last values, at the same times
    }
    // landed: the next sync draws the fresh values (a memoised stale picture would never ask again)
    workers.drain()
    binder.sync(syncCtx(b))
    const fresh = registry.computeFor(registry.getDefinition(HARNESS_DEF_ID), b, undefined, { ...CTX })
    for (const s of bound) {
      const now = new Map(finiteValues(s))
      expect(now.has(b[b.length - 1].t), 'the landed values never replaced the stale picture').toBe(
        Object.values(fresh).some((col) => Number.isFinite(col[b.length - 1])))
    }
  })
})

describe('2b. the landing repaints a noop plan (StockChart leaves a series untouched when its bars did not change)', () => {
  it('a poll costs the renderer ONE setData per series (the landing\'s); the landed values are set though the plan is noop', () => {
    doorDef(COSTLY)
    const fake = createFakeChart()
    fakeCalls = fake.calls
    const binder = createBinder({ chart: fake.chart, LWC: fake.LWC, scope: 'rail' })
    // ⭐ StockChart's own rule (`_applyData`): a noop plan (the same bars, the same settings) touches
    // no series; new bars are a full setData
    let last = null
    const sync = (bars) => {
      const plan = last === bars ? { noop: true } : { fresh: true }
      last = bars
      binder.sync({ ...syncCtx(bars), plan, applyData: (series, data) => { if (series && data && !plan.noop) series.setData(data) } })
    }
    const a = barsOf(daily.slice(-301, -1))
    sync(a)
    workers.drain()
    sync(a)                                   // landed, first bind
    const b = barsOf(daily.slice(-300))       // the poll: a new bar
    const setsBefore = fake.count('setData')
    sync(b)                                   // pending: the series keep the picture they hold
    expect(fake.count('setData') - setsBefore, 'a pending poll re-set the series (the renderer paid twice)').toBe(0)
    workers.drain()
    sync(b)                                   // landed: the SAME bars, a noop plan
    const series = fake.seriesCreated.filter((sr) => finiteValues(sr).length).length
    expect(fake.count('setData') - setsBefore, 'one setData per series: the landing\'s').toBe(series)
    const fresh = registry.computeFor(registry.getDefinition(HARNESS_DEF_ID), b, undefined, { ...CTX })
    const newest = b[b.length - 1].t
    const want = Object.values(fresh).filter((col) => Number.isFinite(col[b.length - 1])).length
    expect(want, 'non-vacuity: the fresh values draw on the newest bar').toBeGreaterThan(0)
    const drawnOnNewest = fake.seriesCreated.filter((sr) => new Map(finiteValues(sr)).has(newest)).length
    expect(drawnOnNewest, 'the landed values never reached the series: a noop plan kept the stale picture').toBeGreaterThan(0)
  })
})

// ─── 3. a superseded result never paints ───────────────────────────────────────────────────────────
describe('3. a newer request supersedes an older one, waiting or running', () => {
  it('only the newest waiting job of a pane is ever posted; the replaced one is forgotten, not pending forever', () => {
    // two panes share the one worker: pane q's job holds it while pane p asks three times
    const def = doorDef(COSTLY)
    const a1 = barsOf(daily.slice(-302, -2))
    const a2 = barsOf(daily.slice(-301, -1))
    const a3 = barsOf(daily.slice(-300))
    registry.computeFor(def, a1, undefined, pane('q'))   // in the worker (another pane's)
    registry.computeFor(def, a2, undefined, pane())      // waiting
    registry.computeFor(def, a3, undefined, pane())      // replaces a2
    expect(hostLaneStats().posted).toBe(1)
    expect(hostLaneStats().superseded).toBe(1)
    expect(hostLaneStats().cancelled, 'another pane\'s request stopped a running job').toBe(0)
    workers.drain()
    expect(hostLaneStats().posted).toBe(2)            // a1, then a3: a2 never
    expect(firstDifference(registry.computeFor(def, a3, undefined, { ...CTX }), registry.computeFor(def, a3, undefined, pane()))).toBeNull()
    // a2 asked again is a NEW job (its pending entry was forgotten), not a pending answer forever
    const again = registry.computeFor(def, a2, undefined, pane())
    expect(isHostLanePending(again)).toBe(true)
    workers.drain()
    expect(isHostLanePending(registry.computeFor(def, a2, undefined, pane()))).toBe(false)
  })

  it('a symbol switch stops the old symbol\'s RUNNING job at once: never answered, never drawn; the new symbol computes on a fresh worker', () => {
    const def = doorDef(COSTLY)
    const aapl = barsOf(daily.slice(-300))
    registry.computeFor(def, aapl, undefined, pane())
    workers.drain()
    expect(isHostLanePending(registry.computeFor(def, aapl, undefined, pane()))).toBe(false)   // AAPL drawn
    // a poll's job for AAPL is in the worker when the member switches to MSFT
    const aaplPoll = barsOf(daily.slice(-301, -1))
    registry.computeFor(def, aaplPoll, undefined, pane())
    expect(workers.made.length).toBe(1)
    const msft = barsOf(daily.slice(-300)).map((r) => ({ ...r, c: r.c * 1.5, h: r.h * 1.5, l: r.l * 1.5, o: r.o * 1.5 }))
    const mctx = { ...pane(), sym: 'MSFT', symbol: MSFT }
    const before = registry.computeFor(def, msft, undefined, mctx)
    expect(isHostLanePending(before)).toBe(true)
    expect(Object.keys(before), 'the old symbol\'s values were drawn on the new symbol').toEqual([])
    // ⭐ the AAPL poll's worker is stopped NOW, not when it finishes; MSFT is on a fresh worker
    expect(workers.made[0].terminated, 'the superseded running job kept its worker computing').toBe(true)
    expect(workers.made.length).toBe(2)
    expect(workers.made[1].inbox.length).toBe(1)
    expect(hostLaneStats()).toMatchObject({ cancelled: 1, retired: 0, lost: 0, broken: false })
    // the stopped job is never answered: only MSFT lands
    workers.drain()
    expect(hostLaneStats().landed).toBe(2)            // AAPL's first, then MSFT
    const msftDone = registry.computeFor(def, msft, undefined, mctx)
    expect(isHostLanePending(msftDone)).toBe(false)
    expect(firstDifference(registry.computeFor(def, msft, undefined, { ...CTX, sym: 'MSFT', symbol: MSFT }), msftDone)).toBeNull()
    // the stopped job's entry was forgotten: AAPL's poll bars asked again are a new job, not pending forever
    expect(isHostLanePending(registry.computeFor(def, aaplPoll, undefined, pane()))).toBe(true)
    workers.drain()
    expect(isHostLanePending(registry.computeFor(def, aaplPoll, undefined, pane()))).toBe(false)
  })
})

// ─── 3b. a superseded RUNNING job (docs/pine/evidence/2026-11-18-host-lane-worker-followups) ─────────
describe('3b. a running job its pane superseded: stopped, or (the first picture) finished on a retired worker', () => {
  const first = () => barsOf(daily.slice(-300))             // the first paint
  const deep = () => barsOf(daily.slice(-900))              // the deep history: the same newest bars and more

  it('the first picture is never thrown away: its worker is retired, the deep job starts at once beside it, and the first picture is drawn', () => {
    const def = doorDef(COSTLY)
    const a = first()
    const b = deep()
    expect(Object.keys(registry.computeFor(def, a, undefined, pane()))).toEqual([])   // the loading state
    expect(isHostLanePending(registry.computeFor(def, b, undefined, pane()))).toBe(true)
    // ⭐ the 600-bar job keeps computing on its own worker; the deep job did not wait behind it
    expect(workers.made.length).toBe(2)
    expect(workers.made[0].terminated, 'the first picture was thrown away').toBe(false)
    expect(workers.made[1].inbox.length, 'the deep job waited behind the running one').toBe(1)
    expect(hostLaneStats()).toMatchObject({ retired: 1, cancelled: 0, retiring: true, inFlight: true, lost: 0 })
    // the first picture lands: drawn (re-aligned on bar time) while the deep job computes, and its
    // worker is terminated
    expect(workers.answerFrom(0)).toBe(true)
    expect(workers.made[0].terminated, 'the retired worker outlived its one job').toBe(true)
    expect(hostLaneStats().retiring).toBe(false)
    const firstDone = registry.computeFor(def, a, undefined, { ...CTX })
    const meanwhile = registry.computeFor(def, b, undefined, pane())
    expect(isHostLanePending(meanwhile)).toBe(true)
    const keys = Object.keys(firstDone)
    expect(keys.length).toBeGreaterThan(0)
    expect(Object.keys(meanwhile).sort(), 'the first picture was not drawn while the deep job computed').toEqual([...keys].sort())
    let compared = 0
    const off = b.length - a.length
    for (const k of keys) {
      for (let j = 0; j < a.length; j += 1) {
        expect(Object.is(meanwhile[k][off + j], firstDone[k][j]), `${k}[${off + j}]`).toBe(true)
        if (Number.isFinite(firstDone[k][j])) compared += 1
      }
    }
    expect(compared).toBeGreaterThan(50)
    // the deep job lands: equal to today's
    expect(workers.answerFrom(1)).toBe(true)
    const done = registry.computeFor(def, b, undefined, pane())
    expect(isHostLanePending(done)).toBe(false)
    expect(firstDifference(registry.computeFor(def, b, undefined, { ...CTX }), done)).toBeNull()
  })

  it('a symbol switch during the first load stops the old symbol\'s first job: it would never be drawn, so it is not retired', () => {
    const def = doorDef(COSTLY)
    registry.computeFor(def, first(), undefined, pane())     // AAPL's first paint, nothing drawn yet
    const msft = first().map((r) => ({ ...r, c: r.c * 1.5, h: r.h * 1.5, l: r.l * 1.5, o: r.o * 1.5 }))
    const mctx = { ...pane(), sym: 'MSFT', symbol: MSFT }
    expect(Object.keys(registry.computeFor(def, msft, undefined, mctx))).toEqual([])
    expect(workers.made[0].terminated, 'the old symbol\'s first job kept computing (retired)').toBe(true)
    expect(hostLaneStats()).toMatchObject({ cancelled: 1, retired: 0, retiring: false })
    workers.drain()
    expect(firstDifference(registry.computeFor(def, msft, undefined, { ...CTX, sym: 'MSFT', symbol: MSFT }),
      registry.computeFor(def, msft, undefined, mctx))).toBeNull()
  })

  it('an older answer that lands after a newer one of its pane is dropped: a picture is only replaced by a newer one', () => {
    const def = doorDef(COSTLY)
    const a = first()
    const b = deep()
    registry.computeFor(def, a, undefined, pane())
    registry.computeFor(def, b, undefined, pane())
    expect(workers.answerFrom(1)).toBe(true)                  // the deep job lands FIRST
    expect(isHostLanePending(registry.computeFor(def, b, undefined, pane()))).toBe(false)
    expect(workers.answerFrom(0)).toBe(true)                  // then the retired first paint
    expect(workers.made[0].terminated).toBe(true)
    expect(hostLaneStats().dropped, 'the late older answer was taken').toBe(1)
    // a poll: the stale picture it draws is the DEEP one (it holds bars the first paint never held)
    const poll = barsOf(daily.slice(-899))
    const polled = registry.computeFor(def, poll, undefined, pane())
    expect(isHostLanePending(polled)).toBe(true)
    const deepDone = registry.computeFor(def, b, undefined, { ...CTX })
    // a bar the deep history holds and the first paint never did (b[j] is poll[j - 1])
    let k = null
    let j = -1
    for (const x of Object.keys(deepDone)) {
      const at = deepDone[x].findIndex((v, i) => i >= 1 && i < b.length - a.length && Number.isFinite(v))
      if (at >= 0) { k = x; j = at; break }
    }
    expect(k, 'non-vacuity: the deep answer draws a bar the first paint never held').toBeTruthy()
    expect(Object.is(polled[k][j - 1], deepDone[k][j]), 'an older answer replaced the newer picture').toBe(true)
  })

  it('a poll superseded while it computes is stopped (the pane keeps its last picture); a cancel is never a failure', () => {
    const def = doorDef(COSTLY)
    const a = first()
    registry.computeFor(def, a, undefined, pane())
    workers.drain()
    expect(isHostLanePending(registry.computeFor(def, a, undefined, pane()))).toBe(false)   // drawn
    let last = null
    for (let k = 1; k <= HOST_WORKER_MAX_STARTS + 2; k += 1) {
      const poll = barsOf(daily.slice(-300 - k, -k))
      const got = registry.computeFor(def, poll, undefined, pane())
      expect(isHostLanePending(got)).toBe(true)
      expect(Object.keys(got).length, `poll ${k}: the pane went blank`).toBeGreaterThan(0)
      last = poll
    }
    // every superseded poll's worker was stopped at once, and the tab never gave up on the worker
    expect(workers.made.slice(0, -1).every((w) => w.terminated), 'a superseded poll kept computing').toBe(true)
    expect(hostLaneStats()).toMatchObject({ cancelled: HOST_WORKER_MAX_STARTS + 1, retired: 0, lost: 0, broken: false })
    workers.drain()
    const done = registry.computeFor(def, last, undefined, pane())
    expect(isHostLanePending(done)).toBe(false)
    expect(firstDifference(registry.computeFor(def, last, undefined, { ...CTX }), done)).toBeNull()
  })

  it('no worker state leaks across a stop: the fresh worker is handed the document in its first message', () => {
    const def = doorDef(COSTLY)
    registry.computeFor(def, first(), undefined, pane())
    workers.drain()
    registry.computeFor(def, barsOf(daily.slice(-301, -1)), undefined, pane())
    expect(workers.made[0].inbox[0].def, 'non-vacuity: the warm worker held the document').toBeUndefined()
    registry.computeFor(def, barsOf(daily.slice(-302, -2)), undefined, pane())   // stops that poll
    expect(workers.made[0].terminated).toBe(true)
    expect(workers.made[1].inbox[0].def, 'the fresh worker was not handed the document').toBeTruthy()
    expect(hostLaneStats().docs).toBe(1)
  })
})

// ─── 4. a worker that fails never blanks a pane ────────────────────────────────────────────────────
describe('4. a failed worker: the main thread, or a refusal by name, never a silent blank', () => {
  it('no worker can be started: the job is computed on the main thread at once, values unchanged', () => {
    setHostLaneWorkerFactory(() => { throw new Error('no worker here') })
    const def = doorDef(COSTLY)
    const bars = barsOf(daily.slice(-300))
    const got = registry.computeFor(def, bars, undefined, pane())
    expect(isHostLanePending(got)).toBe(false)
    expect(firstDifference(registry.computeFor(def, bars, undefined, { ...CTX }), got)).toBeNull()
    expect(hostLaneStats().broken).toBe(true)
  })

  it('a crash mid-job: that job on the main thread, the next one on a fresh worker; after the last start, the main thread', () => {
    const def = doorDef(COSTLY)
    const sets = [-303, -302, -301, -300].map((end, i) => barsOf(daily.slice(end - 300 + 1 + i, end + 1 + i)))
    for (let k = 0; k < HOST_WORKER_MAX_STARTS; k += 1) {
      const bars = sets[k]
      expect(isHostLanePending(registry.computeFor(def, bars, undefined, pane()))).toBe(true)
      workers.made[workers.made.length - 1].onerror(new Event('error'))
      const got = registry.computeFor(def, bars, undefined, pane())
      expect(isHostLanePending(got), `crash ${k + 1}: the job was left pending`).toBe(false)
      expect(firstDifference(registry.computeFor(def, bars, undefined, { ...CTX }), got)).toBeNull()
    }
    expect(workers.made.length).toBe(HOST_WORKER_MAX_STARTS)
    expect(hostLaneStats().broken).toBe(true)
    const after = registry.computeFor(def, sets[3], undefined, pane())
    expect(isHostLanePending(after)).toBe(false)   // the tab computes on the main thread, as before
    expect(workers.made.length).toBe(HOST_WORKER_MAX_STARTS)
  })

  it('a document the post refuses (it does not clone): the main thread', () => {
    const def = doorDef(COSTLY)
    setHostLaneWorkerFactory(() => ({ postMessage() { throw new DOMException('could not be cloned', 'DataCloneError') }, terminate() {} }))
    const bars = barsOf(daily.slice(-300))
    const got = registry.computeFor(def, bars, undefined, pane())
    expect(isHostLanePending(got)).toBe(false)
    expect(firstDifference(registry.computeFor(def, bars, undefined, { ...CTX }), got)).toBeNull()
  })

  it('past the watchdog: the job is refused BY NAME on every plot, and the binder says so on the strip', () => {
    vi.useFakeTimers()
    doorDef(COSTLY)
    const fake = createFakeChart()
    const binder = createBinder({ chart: fake.chart, LWC: fake.LWC, scope: 'rail' })
    const bars = barsOf(daily.slice(-300))
    binder.sync(syncCtx(bars))
    vi.advanceTimersByTime(HOST_WORKER_WATCHDOG_MS + 1)
    const def = registry.getDefinition(HARNESS_DEF_ID)
    const got = registry.computeFor(def, bars, undefined, pane())
    expect(isHostLanePending(got)).toBe(false)
    const errs = registry.columnErrors(got)
    expect(Object.keys(errs).length).toBeGreaterThan(0)
    for (const e of Object.values(errs)) expect(e.guard).toBe(HOST_WORKER_UNRESPONSIVE_GUARD)
    expect(hostLaneStopOf(got).sentence).toMatch(/did not answer/)
    binder.sync(syncCtx(bars))
    expect(runtimeErrorNoticeFor('pine:rail', 'rail')).toMatch(/did not answer/)
  })
})

// ─── 6. the drawings (the host object program) ─────────────────────────────────────────────────────
describe('6. the drawings: off the main thread, evaluated once per bars array, the picture kept through a poll', () => {
  /** A drawing script whose VALUES are cheap (the main thread) and whose drawings cost a long task. */
  const DRAWER = 'fib-retracement'
  const layerFake = () => {
    const sets = []
    return { sets, set(state, sig) { sets.push({ state, sig }); return true }, clear() { sets.push({ cleared: true }) } }
  }
  /** Does the layer hold a picture now (its last `set` was a state, not `null` or a clear)? */
  const drawnNow = (layer) => {
    const last = layer.sets[layer.sets.length - 1]
    return !!(last && last.state)
  }

  it('the program\'s drawings are a worker job; a repaint with the same bars evaluates nothing; a poll keeps the picture; a symbol switch takes it down', () => {
    const def = doorDef(DRAWER)
    expect(hostLaneCostOf(def).over).toBe(false)   // its values stay on the main thread
    const layer = layerFake()
    const fake = createFakeChart()
    const binder = createBinder({ chart: fake.chart, LWC: fake.LWC, scope: 'rail' })
    const ctx = (bars, extra) => ({ ...syncCtx(bars, extra), createObjectLayer: () => layer })
    const a = barsOf(daily.slice(-301, -1))
    binder.sync(ctx(a))
    expect(hostLaneStats().posted).toBe(1)                      // the drawings went to the worker
    expect(drawnNow(layer)).toBe(false)                        // nothing drawn until they land
    workers.drain()
    binder.sync(ctx(a))
    expect(drawnNow(layer), 'the landed drawings were not drawn').toBe(true)
    const setsAfterLanding = layer.sets.length
    // a repaint with the SAME bars: no job, no evaluation (it would have posted again, or computed here)
    binder.sync(ctx(a))
    binder.sync(ctx(a))
    expect(hostLaneStats().posted, 'a repaint evaluated the drawings again').toBe(1)
    // a poll: the last picture stays while the new one computes
    const b = barsOf(daily.slice(-300))
    binder.sync(ctx(b))
    expect(hostLaneStats().posted).toBe(2)
    const sinceLanding = layer.sets.slice(setsAfterLanding)
    expect(sinceLanding.some((x) => x.cleared || !x.state), 'the drawings were taken down during a poll').toBe(false)
    workers.drain()
    binder.sync(ctx(b))
    expect(drawnNow(layer)).toBe(true)
    // a symbol switch: the old symbol's drawings are taken down at once, never left on the new chart
    const msft = barsOf(daily.slice(-300)).map((r) => ({ ...r, c: r.c * 2, h: r.h * 2, l: r.l * 2, o: r.o * 2 }))
    binder.sync(ctx(msft, { sym: 'MSFT', symbol: MSFT }))
    expect(drawnNow(layer), 'the old symbol\'s drawings stayed on the new symbol').toBe(false)
    workers.drain()
    binder.sync(ctx(msft, { sym: 'MSFT', symbol: MSFT }))
    expect(drawnNow(layer)).toBe(true)
  })

  it('a program that reads the runtime lane\'s values (C18) stays on the main thread', () => {
    const def = doorDef('poor-man039s-volume-profile')
    expect(def.objects && def.objects.runtime).toBeTruthy()
    expect(hostObjectsSendable(def)).toBe(false)
    expect(hostObjectsOffThread(def, barsOf(daily.slice(-300)), hostObjectReaderOpts(CTX, undefined), 'rail\u0001x')).toBeNull()
    expect(hostLaneStats().posted).toBe(0)
  })
})

// ─── 5. the same function, on the same arguments ───────────────────────────────────────────────────
describe('5. the worker computes the main thread\'s function on the main thread\'s arguments', () => {
  const closure = walk([`${ENGINE}/astColumns.js`])
  it('every `ctx.<field>` the values read crosses to the worker', () => {
    const re = /\bctx\s*(?:&&\s*ctx)?\s*\.\s*([A-Za-z_]\w*)|\bctx\?\.([A-Za-z_]\w*)/g
    // the translator's own compile context (`pine.js`) and the presentation helpers name a `ctx` of
    // their own; the values' readers are these modules
    const readers = ['astColumns.js', 'otherSymbols.js', 'lowerTf.js', 'evaluability.js', 'calcBarsWindow.js']
    // ⭐ (train e95, the 2b bind audit) `ctx.inputs` is the GATE's binding (`evaluability.js::evaluability` ->
    // `gateDocument`), which the values never call: the worker's compute takes the instance's inputs as `computeFor`'s
    // own argument. Exempt in that module only, so a values reader that read it would still be red here.
    const GATE_ONLY = new Map([['inputs', 'evaluability.js']])
    const read = new Set()
    for (const [m, info] of closure.modules) {
      if (!readers.some((r) => m.endsWith(`/engine/${r}`))) continue
      for (const x of info.source.matchAll(re)) {
        const f = x[1] || x[2]
        if (GATE_ONLY.has(f) && m.endsWith(`/engine/${GATE_ONLY.get(f)}`)) continue
        read.add(f)
      }
    }
    expect(read.size).toBeGreaterThan(6)
    const carried = new Set([...HOST_CTX_FIELDS, ...HOST_CTX_CARRIED, 'newest_bar_is_forming'])
    expect([...read].filter((f) => !carried.has(f)), 'a context field the worker is not handed').toEqual([])
  })

  it('every field of every bar crosses, as it was: an ISO-date time, -0, NaN, Infinity, null, a field one bar lacks', () => {
    const rows = [
      { t: '1980-12-12', o: -0, h: 1.5, l: NaN, c: Infinity, v: 10 },
      { t: '1980-12-15', o: 2, h: null, l: 1, c: 2.25, v: 20, x: 'extra' },
      { t: '1980-12-16', o: 3, h: 4, l: 2, c: 3.5, v: -Infinity },
    ]
    const { pack, transfer } = packRows(rows)
    const back = unpackRows(structuredClone(pack, { transfer }))
    expect(back.length).toBe(rows.length)
    rows.forEach((r, i) => {
      expect(Object.keys(back[i]).sort(), `bar ${i}`).toEqual(Object.keys(r).sort())
      for (const k of Object.keys(r)) expect(Object.is(back[i][k], r[k]), `bar ${i}.${k}`).toBe(true)
    })
  })

  it('a throw crosses by the ONE rule for errors at a worker boundary (`runtime/errorImage.js`): every plain field', () => {
    // one implementation: the wire's doors ARE the runtime lane's
    expect(errorImageOf).toBe(errorImage.errorImageOf)
    expect(errorFromImage).toBe(errorImage.errorFromImage)
    const thrown = new TableRefusal('interpret:steps', 'accum over 5000 bars is too many steps')
    Object.assign(thrown, { pending: true, limit: 'STEPS', bar: 4211, ms: 12.5 })
    const back = errorFromImage(structuredClone(errorImageOf(thrown)), 'the host lane failed')
    expect(back.name).toBe('TableRefusal')
    expect(back.message).toBe(thrown.message)
    for (const k of ['guard', 'pending', 'limit', 'bar', 'ms']) expect(back[k], k).toBe(thrown[k])
    expect(isRefusal(back)).toBe(true)          // the chart's side reads it as the refusal it was
  })

  it('every record the values carry crosses and is re-attached exactly as attached (keys, non-enumerable, frozen depth)', () => {
    // one values map carrying every record: astColumns' own attach helpers where they are exported,
    // its record table (`AST_SIDE_RECORDS`) for the rest
    const out = { a: new Float64Array([1, NaN, -0]) }
    withColumnErrors(out, { b: { guard: 'g:one', message: 'one' } })
    withRuntimeErrorStop(out, { reached: false, unknown: [{ line: 3, why: 'w' }], unread: [] })
    withAstSideRecords(out, {
      __lowerTf: { served: ['5'], refused: [{ code: '1', refusal: 'r', reason: 'x' }] },
      __otherSymbols: { served: ['SPY'], refused: [{ ticker: 'QQQ', code: 'c', reason: 'y' }] },
      __withheldBars: { a: { 'pine:tie-unwitnessed': new Float64Array([0, 1, 0]) } },
      __chartClock: { withheld: [{ code: 'k', reason: 'z', plots: ['a'] }] },
    })
    expect(Object.keys(astSideRecordsOf(out)).sort()).toEqual(Object.keys(AST_SIDE_RECORDS).sort())
    const back = withAstSideRecords({ a: out.a }, structuredClone(astSideRecordsOf(out)))
    expect(firstDifference(out, back)).toBeNull()
    expect(Object.isFrozen(back.__columnErrors)).toBe(true)   // non-vacuity: the depth is compared
  })

  it('every record the values attach is re-attached on the chart\'s side', () => {
    const src = fs.readFileSync(path.join(REPO, ENGINE, 'astColumns.js'), 'utf8')
    const names = [...src.matchAll(/Object\.defineProperty\(out,\s*([A-Z_]+)\b/g)].map((m) => m[1])
    const values = Object.fromEntries([...src.matchAll(/^const ([A-Z_]+) = '(__\w+)'/gm)].map((m) => [m[1], m[2]]))
    expect(names.length).toBeGreaterThan(4)
    for (const n of names) expect(Object.keys(AST_SIDE_RECORDS), n).toContain(values[n])
  })

  it('the worker\'s closure is host-neutral: no registry, no network, no storage, no build flag', () => {
    const w = walk([`${ENGINE}/hostLaneWorker.js`])
    expect(w.modules.has(`${ENGINE}/objectRuntime.js`)).toBe(true)   // non-vacuity: the drawings' evaluator is in
    // ⭐ the object reader is named in the SERVER bundle's list (it must not ride there); for the worker
    // what matters is what it reaches, and it no longer reaches the registry (`objectRuntimeSeam.js`)
    for (const m of Object.keys(FORBIDDEN_MODULES)) {
      if (m === `${ENGINE}/objectColumns.js`) continue
      expect(w.modules.has(m), chainOf(w.modules, m)).toBe(false)
    }
    const hits = []
    for (const [m, info] of w.modules) {
      for (const k of ['network', 'build flag', 'storage']) if (FORBIDDEN_PATTERNS[k].test(info.source)) hits.push(`${k}: ${m}`)
    }
    expect(hits).toEqual([])
  })
})
