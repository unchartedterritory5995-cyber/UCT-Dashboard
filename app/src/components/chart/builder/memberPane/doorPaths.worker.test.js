// app/src/components/chart/builder/memberPane/doorPaths.worker.test.js
//
// ─── ⭐⭐ THE PASTE WORKER — INDICATOR HOUSE'S COPY AND INSPECT-A-BAR BUILD IN THE DOOR'S WORKER ───────────────────────
//
// Two more member paths that ran the member door (`memberPaneDefinition`) on the page's main thread: Indicator House's
// copy of a Pine entry (`IndicatorHouseTab.buildPineCopy`, on the press) and inspect-a-bar (`inspect/inspectDoors.build`,
// the script and every probe copy of it). Both now ask the door's worker for one build (`memberDoorAsync.doorBuildOnce`).
//
// A stand-in worker runs the REAL handler in a fresh module graph; every door call is counted by where it ran. Each path
// answers exactly as it did on the main thread, with NO door call on the main thread, and leaves the service holding
// nothing. ⛔ The page's modules are imported after the worker's graph is made (`importWorkerCore` resets the registry;
// a path that imports the door's service on demand must find the one this rail installs).
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const D = vi.hoisted(() => ({ inWorker: false, main: 0, worker: 0 }))
vi.mock('./memberPaneDefinition', async (importOriginal) => {
  const m = await importOriginal()
  return {
    ...m,
    memberPaneDefinition: (...args) => {
      if (D.inWorker) D.worker += 1
      else D.main += 1
      return m.memberPaneDefinition(...args)
    },
  }
})

import { FakeDoorWorker, importWorkerCore, canonOf } from '../../../../testing/builder/memberDoor.testkit.js'

const REPO = path.resolve(__dirname, '../../../../../..')
const corpus = (n) => fs.readFileSync(path.join(REPO, 'corpus/committed', n), 'utf8')
const RVOL = corpus('rvol__05fcd9e160.pine')
const ATR = corpus('atr-support-and-resistance__3e9ddb38c4.pine')

class CountingWorker extends FakeDoorWorker {
  answer(job) {
    D.inWorker = true
    try { super.answer(job) } finally { D.inWorker = false }
  }
}

let core = null
let door = null
let house = null
let doors = null
let bars = null
let workerCore = null
beforeAll(async () => {
  core = await importWorkerCore(vi)
  door = await import('./memberDoorAsync')
  house = await import('../../IndicatorHouseTab')
  doors = await import('../inspect/inspectDoors')
  bars = await import('../inspect/barInspection')
  workerCore = await import('./memberDoorWorkerCore')
}, 120000)
let svc = null
function withWorkers() {
  svc = door.createMemberDoorService({ factory: () => new CountingWorker(core) })
  door.__setMemberDoorServiceForTests(svc)
}
function noWorkers() {
  // (the page's own service where there are no workers: the door builds on this thread, as before)
  door.__setMemberDoorServiceForTests(door.createMemberDoorService({ factory: null }))
}
beforeEach(() => { D.main = 0; D.worker = 0; vi.stubEnv('VITE_PINE_MEMBER_PANE_ENABLED', '1') })
afterEach(() => { door.__setMemberDoorServiceForTests(null); vi.unstubAllEnvs() })
const vs = (v) => canonOf(v, { hidden: true })

describe('⭐⭐ Indicator House\'s copy of a Pine entry builds in the door\'s worker', () => {
  it('each entry: the copy is the main thread\'s, field for field; no door call on the main thread', async () => {
    let copies = 0
    for (const [name, pine] of [['RVOL', RVOL], ['ATR levels', ATR]]) {
      const item = { pine, name }
      noWorkers()
      const main0 = D.main
      const here = await house.buildPineCopy(item, 'u_0123456789ab')
      expect(D.main - main0, `${name}: the control builds on the main thread`).toBeGreaterThan(0)
      withWorkers()
      const before = { ...D }
      const off = await house.buildPineCopy(item, 'u_0123456789ab')
      expect(D.main - before.main, `${name}: door calls on the MAIN thread for the copy`).toBe(0)
      expect(D.worker - before.worker, `${name}: one door call in the worker`).toBe(1)
      expect(vs(off), `${name}: the copy is the main thread's`).toBe(vs(here))
      await Promise.resolve(); await Promise.resolve()
      expect(svc.stats().held, `${name}: the build released once read`).toBe(0)
      if (here && here.doc) copies += 1
    }
    expect(copies, 'a copy was made (the rail is not comparing two refusals)').toBeGreaterThan(0)
  }, 240000)
})

describe('⭐⭐ inspect-a-bar builds the script and its probe copies in the door\'s worker', () => {
  // a compute that only reads what the door built (the chart's own compute is not this rail's subject)
  const compute = (def) => ({ lane: 'host', outputs: (def.plots || []).map((p, i) => ({ key: p.key || `p${i}`, title: p.title || `p${i}`, values: [1, 2, 3] })) })
  it('the door\'s answer and the whole inspection are the main thread\'s; no door call on the main thread', async () => {
    for (const [name, source] of [['RVOL', RVOL], ['ATR levels', ATR]]) {
      noWorkers()
      const hereBuilt = await doors.build(source)
      const here = await bars.inspectScript({ source, bars: [], names: doors.names, build: doors.build, compute })
      withWorkers()
      const before = { ...D }
      const offBuilt = await doors.build(source)
      const off = await bars.inspectScript({ source, bars: [], names: doors.names, build: doors.build, compute })
      expect(D.main - before.main, `${name}: door calls on the MAIN thread for the inspection`).toBe(0)
      expect(D.worker - before.worker, `${name}: the script and its probe copies built in the worker`).toBeGreaterThan(1)
      // the page reads the door's answer without its translation (#2254); every other field is the main thread's
      expect(vs(offBuilt), `${name}: the door's answer is the main thread's`).toBe(vs(workerCore.doorForPage(hereBuilt)))
      expect(vs(off), `${name}: the inspection is the main thread's`).toBe(vs(here))
      await Promise.resolve(); await Promise.resolve()
      expect(svc.stats().held, `${name}: every build released once read`).toBe(0)
    }
  }, 300000)
})
