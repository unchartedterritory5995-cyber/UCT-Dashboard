// app/src/components/chart/engine/__tests__/hostLaneWorker.parity.test.js
//
// ─── ⭐⭐ HOST WORKER — THE WORKER'S ANSWER IS THE MAIN THREAD'S, BYTE FOR BYTE, OVER THE CORPUS ───
//
// docs/pine/evidence/2026-11-17-host-lane-worker/EVIDENCE.md. For EVERY committed script the member
// door installs on the host lane, the chart's request is answered twice: on the main thread, as
// before (`computeFor` with no pane: `astLaneColumns`), and through the host lane's worker path
// (`computeFor` with a chart pane: `hostLaneAsync.js` plans it, posts it, a stand-in worker runs the
// worker's own handler over a STRUCTURED CLONE of the exact message, the answer is cloned back and
// finished). Every route is forced to the worker (`__routeEveryHostDocumentForTests`), cheap documents
// included, so the comparison covers the whole lane and not only what the cost estimate sends.
//
// Compared: every own property of the answer, enumerable or not (the columns BYTE for byte, the
// column reasons, the runtime.error stop, the chart-clock, other-symbol, lower-timeframe and
// withheld-bar reports, the run-read parts, a window's record), and each object's frozen depth.
//
// Three bar sets, from two committed captures:
//   daily          the newest N bars of the AAPL daily capture, unix-second times, no listing
//   daily-listing  the FIRST N bars of the same capture, from AAPL's listing day
//                  (`historyFromListing`), with ISO date times (what a daily chart's bars carry)
//   intraday       the newest N bars of the SPY 60-minute capture
// N = 600 by default (the chart's first paint); `HOST_WORKER_PARITY_BARS` widens it.
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import * as registry from '../nativeRegistry'
import { enterMemberDoor, HARNESS_DEF_ID } from './vendorHarness/ourSide'
import {
  setHostLaneWorkerFactory, resetHostLaneAsync, __routeEveryHostDocumentForTests, isHostLanePending, hostLaneStats,
  hostObjectsOffThread, hostObjectsSendable,
} from '../hostLaneAsync'
import { hostObjectRun, hostObjectReaderOpts } from '../hostObjects'
import { standInWorkers, firstDifference } from './hostLaneStandIn'
import { asMember } from '../../../../testing/runtimeGate'

const REPO = path.resolve(process.cwd(), '..')
const N = Number(process.env.HOST_WORKER_PARITY_BARS || 600)
const ONLY = process.env.HOST_LANE_COST_ONLY ? new Set(process.env.HOST_LANE_COST_ONLY.split(',')) : null
const capture = (f) => JSON.parse(fs.readFileSync(path.join(REPO, 'tests', 'fixtures', 'vendor', 'harness', f), 'utf8')).bars.rows
const toBars = (rows, isoDates = false) => rows.map(([t, o, h, l, c, v]) => ({
  t: isoDates ? new Date(t * 1000).toISOString().slice(0, 10) : t, o, h, l, c, v,
}))

const AAPL = Object.freeze({ ticker: 'AAPL', exchange: 'NASDAQ' })
const SPY = Object.freeze({ ticker: 'SPY', exchange: 'AMEX' })

let SETS = null
beforeAll(() => {
  const daily = capture('vw-deadband-ticks-aapl-1d-2026-09-28.json')
  const hourly = capture('smarter-snr-spy-60-2026-11-14.json')
  SETS = [
    { name: 'daily', bars: toBars(daily.slice(-N)), ctx: { sym: 'AAPL', symbol: AAPL, tf: 'D', newestBarIsForming: false } },
    { name: 'daily-listing', bars: toBars(daily.slice(0, N), true),
      ctx: { sym: 'AAPL', symbol: AAPL, tf: 'D', newestBarIsForming: false, historyFromListing: true } },
    { name: 'intraday', bars: toBars(hourly.slice(-N)), ctx: { sym: 'SPY', symbol: SPY, tf: '60', newestBarIsForming: false } },
  ]
})

// ⭐ THE MEMBER DOOR WITH THE RUNTIME PANE OFF (`hostLaneCost.measure.test.js`'s host view): every
// script a member's door can put on the host lane is a host document here, the 81 of the evidence.
let workers
beforeAll(() => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '0')
  resetHostLaneAsync()
  __routeEveryHostDocumentForTests(true)
})
afterEach(() => { registry.uninstallUserDefinition(HARNESS_DEF_ID) })
afterAll(() => {
  setHostLaneWorkerFactory(null)
  resetHostLaneAsync()
  vi.unstubAllEnvs()
})
// ⛔ The member's doors in a beforeEach, never a beforeAll: the test grant re-opens them before every
// test (`src/testing/runtimeGate.js`), so a beforeAll narrowing here ran every test under the grant
// (test-grant census, 2026-11-19; it measured green with the grant off too).
asMember({ allow: true, pane: true, hkd: true })

const corpus = path.join(REPO, 'corpus', 'committed')
const FILES = fs.readdirSync(corpus).filter((f) => f.endsWith('.pine')).sort()
  .filter((f) => !ONLY || ONLY.has(f.replace(/\.pine$/, '')) || ONLY.has(f.replace(/__.*$|\.pine$/g, '')))

/** The two answers for one document on one bar set: the main thread's, and the worker path's. */
function bothAnswers(def, set) {
  let main = null
  let mainErr = null
  try { main = registry.computeFor(def, set.bars, undefined, { ...set.ctx }) } catch (e) { mainErr = e }
  const ctx = { ...set.ctx, hostPane: `parity\u0001${set.name}` }
  let first
  let firstErr = null
  try { first = registry.computeFor(def, set.bars, undefined, ctx) } catch (e) { firstErr = e }
  if (firstErr) return { main, mainErr, worker: null, workerErr: firstErr, pendingFirst: false }
  const pendingFirst = isHostLanePending(first)
  workers.drain()
  let worker = null
  let workerErr = null
  try { worker = registry.computeFor(def, set.bars, undefined, ctx) } catch (e) { workerErr = e }
  return { main, mainErr, worker, workerErr, pendingFirst }
}

const tally = { docs: 0, compared: 0, threw: 0, bars: 0, drawings: 0, drawn: 0, records: {} }

/** The drawings as the binder reads them: the run, and the reader's facts it reads. */
const drawingsOf = (host) => (host ? {
  run: host.run,
  reader: { program: { pineVersion: host.reader.program ? host.reader.program.pineVersion : undefined },
    form: host.reader.form, failed: host.reader.failed, refusals: host.reader.refusals, chartClock: host.reader.chartClock },
} : null)

/** The host object program on both threads: `hostObjectRun` here, and the worker path's answer. */
function bothDrawings(def, set) {
  const opts = hostObjectReaderOpts(set.ctx, undefined)
  let main = null
  let mainErr = null
  try { main = drawingsOf(hostObjectRun(def, set.bars, opts)) } catch (e) { mainErr = e }
  const pane = `parity\u0001objects\u0001${set.name}`
  const first = hostObjectsOffThread(def, set.bars, opts, pane)
  workers.drain()
  let worker = null
  let workerErr = null
  try { worker = hostObjectsOffThread(def, set.bars, opts, pane) } catch (e) { workerErr = e }
  return { main, mainErr, first, worker, workerErr }
}

describe('host lane worker: byte-equal to the main thread over the committed corpus', () => {
  it.each(FILES)('%s', (file) => {
    const source = fs.readFileSync(path.join(corpus, file), 'utf8')
    let door
    try { door = enterMemberDoor(source) } catch { return }
    const def = door.def
    if (!def || !def.compute || def.compute.kind !== 'ast') return
    tally.docs += 1
    workers = standInWorkers()
    setHostLaneWorkerFactory(workers.factory)
    for (const set of SETS) {
      const before = hostLaneStats().posted
      const r = bothAnswers(def, set)
      if (r.mainErr) {
        // ⭐ the main thread threw: the worker path throws the same (name, message, guard)
        expect(r.workerErr, `${file} ${set.name}: the main thread threw ${r.mainErr.message}`).toBeTruthy()
        expect(r.workerErr.message).toBe(r.mainErr.message)
        expect(r.workerErr.guard).toBe(r.mainErr.guard)
        tally.threw += 1
        continue
      }
      expect(r.workerErr, `${file} ${set.name}: ${r.workerErr && r.workerErr.message}`).toBeNull()
      // non-vacuity: the answer DID come from the worker (a pending answer first, then a post)
      expect(r.pendingFirst, `${file} ${set.name}: the first answer was not pending`).toBe(true)
      expect(hostLaneStats().posted, `${file} ${set.name}: nothing was posted`).toBeGreaterThan(before)
      expect(isHostLanePending(r.worker), `${file} ${set.name}: still pending after the worker answered`).toBe(false)
      expect(firstDifference(r.main, r.worker), `${file} ${set.name}`).toBeNull()
      for (const k of Reflect.ownKeys(r.main)) {
        if (typeof k === 'string' && !Object.getOwnPropertyDescriptor(r.main, k).enumerable) tally.records[k] = (tally.records[k] || 0) + 1
      }
      tally.compared += 1
      tally.bars += set.bars.length
      // ── and its DRAWINGS (the host object program), when the worker takes them ──
      if (hostObjectsSendable(def)) {
        const d = bothDrawings(def, set)
        if (d.mainErr) {
          expect(d.workerErr && d.workerErr.message, `${file} ${set.name} drawings`).toBe(d.mainErr.message)
          continue
        }
        expect(d.first && d.first.pending, `${file} ${set.name}: the drawings were not sent`).toBe(true)
        expect(d.workerErr, `${file} ${set.name} drawings: ${d.workerErr && d.workerErr.message}`).toBeNull()
        expect(d.worker && d.worker.done, `${file} ${set.name}: the drawings did not land`).toBe(true)
        expect(firstDifference(d.main, d.worker.host), `${file} ${set.name} drawings`).toBeNull()
        tally.drawings += 1
        if (d.main && d.main.run && d.main.run.live.length) tally.drawn += 1
      }
    }
    resetHostLaneAsync()
    __routeEveryHostDocumentForTests(true)
  }, 600000)

  it('compared a corpus, not nothing', () => {
    // eslint-disable-next-line no-console
    console.log(`[host-worker parity] records compared: ${JSON.stringify(tally.records)}`)
    // eslint-disable-next-line no-console
    console.log(`[host-worker parity] ${tally.docs} host documents, ${tally.compared} answers byte-equal, ${tally.threw} equal throws, ${tally.bars} bars; drawings equal on ${tally.drawings} (${tally.drawn} drawing something)`)
    if (!ONLY) {
      expect(tally.docs).toBeGreaterThan(70)
      expect(tally.compared).toBeGreaterThan(200)
      expect(tally.drawings).toBeGreaterThan(90)
      expect(tally.drawn).toBeGreaterThan(30)
    } else {
      expect(tally.compared + tally.threw).toBeGreaterThan(0)
    }
  })
})
