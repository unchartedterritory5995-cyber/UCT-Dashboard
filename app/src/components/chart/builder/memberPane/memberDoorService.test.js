// @vitest-environment node
// app/src/components/chart/builder/memberPane/memberDoorService.test.js
//
// ─── ⭐⭐ THE PASTE WORKER — THE SHARED, OFF-THREAD MEMBER DOOR: ONE BUILD, NO RACE, NO HANG ──────────────────
//
// `memberDoorAsync.js::createMemberDoorService` over a stand-in Worker (`memberDoor.testkit.js`) that runs the
// REAL handler in a FRESH module graph (so the page's state reaches it only through the job's image):
//   1. ONE door call per script and state: two subscribers (the pane's `{source, id}` and the status panel's
//      `{source}`) share one build, before and after it lands; a state that moved between them is a new build;
//   2. cancel-on-rebuild: a newer build stops the running one (its worker terminated), nobody is handed a build of
//      what they did not ask for, a stopped script still wanted is built again, and one build runs at a time;
//   3. the WATCHDOG: a worker that does not answer is stopped and the script refused by the deadline's own name;
//   4. a worker that DIES (an error, an unreadable answer, one that will not start, a job it cannot be sent) is
//      stopped and the script refused by name; a door that threw is said, never swallowed;
//   5. the CONTROL: a fast script answers at once, and its answer is the main thread's;
//   6. what the build did to the page is done on the page: its consults (the "still being checked" mark the
//      member pane's first-paste rule reads) and its warm of the runtime lane.
//   7. the permission: a worker that latched "not permitted" is never asked a permitted job (a latch only revokes):
//      a fresh worker is; a revocation needs none.
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createMemberDoorService, MEMBER_DOOR_WORKER_GUARD, doorFailedAnswer, MEMBER_DOOR_FAILED_GUARD } from './memberDoorAsync'
import { memberPaneDefinition, MEMBER_PANE_DEF_PREFIX, DOOR_TIMED_OUT } from './memberPaneDefinition'
import {
  setRuntimeKillList, __resetRuntimeAllowList, setRuntimeCapabilityAdmission, __resetRuntimeAdmission,
  runtimeConsultPendingOf,
} from '../../engine/runtimeKill'
import { runtimeLaneWarmAsks } from '../../engine/runtime/runtimeAsync'
import { __resetRuntimePanePermission, __permitRuntimePaneForTests } from '../../engine/runtimePaneGate'
import { canonOf, fakeDoorWorkers, FakeDoorWorker, importWorkerCore } from '../../../../testing/builder/memberDoor.testkit.js'

const REPO = path.resolve(__dirname, '../../../../../..')
const corpus = (n) => fs.readFileSync(path.join(REPO, 'corpus/committed', n), 'utf8')
const RVOL = corpus('rvol__05fcd9e160.pine')
const ADX = corpus('adx-and-di-for-v4__932.pine')
const STOP_TAKE = corpus('stop-loss-and-take-profit-in-example__YlblCbts4x.pine')

let core = null
beforeAll(async () => {
  core = await importWorkerCore(vi)
}, 120000)
beforeEach(() => {
  vi.stubEnv('VITE_PINE_MEMBER_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
})
afterEach(() => {
  vi.unstubAllEnvs()
  setRuntimeKillList([])
  __resetRuntimeAdmission()
})

const settle = async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve() }
const until = async (pred, ms = 20000) => {
  const t0 = Date.now()
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error('timed out waiting')
    await new Promise((r) => setTimeout(r, 5))
  }
}

describe('1. ONE door call per script and state', () => {
  it('⭐⭐ the pane and the status panel share ONE build: while it runs, and after it lands', async () => {
    const { factory, made } = fakeDoorWorkers(core, { mode: 'hold' })
    const svc = createMemberDoorService({ factory })
    const pane = []
    const status = []
    const late = []
    const offPane = svc.subscribe({ source: RVOL, id: MEMBER_PANE_DEF_PREFIX }, (l) => pane.push(l))
    const offStatus = svc.subscribe({ source: RVOL }, (l) => status.push(l))   // the status panel's own spelling
    expect(made).toHaveLength(1)
    expect(made[0].jobs, 'one job for two subscribers').toHaveLength(1)
    made[0].release()
    await settle()
    expect(pane).toHaveLength(1)
    expect(status).toHaveLength(1)
    expect(status[0], 'both read THE answer').toBe(pane[0])
    const offLate = svc.subscribe({ source: RVOL, id: MEMBER_PANE_DEF_PREFIX }, (l) => late.push(l))
    expect(late, 'a subscriber after it landed, in the same state, reads it at once').toEqual([pane[0]])
    expect(svc.stats().posted).toBe(1)
    expect(svc.stats().builds).toBe(1)
    offPane(); offStatus(); offLate()
    svc.dispose()
  }, 120000)

  it('a page state that moved between two subscribers is a NEW build (the control: sharing is per state)', async () => {
    const { factory, made } = fakeDoorWorkers(core)
    const svc = createMemberDoorService({ factory })
    const a = []
    const b = []
    const offA = svc.subscribe({ source: ADX }, (l) => a.push(l))
    await until(() => a.length === 1)
    setRuntimeKillList(['u_0123456789ab'])   // a list landed
    const offB = svc.subscribe({ source: ADX }, (l) => b.push(l))
    await until(() => b.length === 1)
    expect(svc.stats().posted).toBe(2)
    expect(made.reduce((n, w) => n + w.jobs.length, 0)).toBe(2)
    expect(a, 'the first subscriber reads the newer build too').toHaveLength(2)
    offA(); offB()
    svc.dispose()
  }, 120000)
})

describe('2. cancel-on-rebuild: never two builds racing, never a build nobody asked for', () => {
  it('⭐⭐ a newer script stops the running build; the stopped script, still wanted, is built after', async () => {
    // the builds alive when each job is posted: the held jobs of every worker not stopped, and this one
    let maxInFlight = 0
    const { factory, made } = fakeDoorWorkers(core, () => ({
      mode: 'hold',
      onPost: () => {
        const live = made.filter((w) => !w.terminated).reduce((n, w) => n + w.held.length, 0) + 1
        maxInFlight = Math.max(maxInFlight, live)
      },
    }))
    const svc = createMemberDoorService({ factory })
    const a = []
    const b = []
    const offA = svc.subscribe({ source: RVOL }, (l) => a.push(l))
    const offB = svc.subscribe({ source: ADX }, (l) => b.push(l))
    expect(made).toHaveLength(2)
    expect(made[0].terminated, 'the running build was stopped').toBe(true)
    expect(svc.stats().superseded).toBe(1)
    made[1].release()
    await settle()
    expect(b).toHaveLength(1)
    expect(a, 'the stopped script got nothing of the other script').toHaveLength(0)
    expect(made[1].jobs.map((j) => j.args.source === RVOL), 'the stopped script is built again, once the worker is free').toEqual([false, true])
    made[1].release()
    await settle()
    expect(a).toHaveLength(1)
    expect(canonOf(a[0].built)).toBe(canonOf(memberPaneDefinition({ source: RVOL, id: MEMBER_PANE_DEF_PREFIX })))
    expect(maxInFlight, 'one build at a time').toBe(1)
    offA(); offB()
    svc.dispose()
  }, 120000)

  it('⭐⭐ the member pane\'s rebuild (same script, a newer state): the old build is stopped, only the new one is read', async () => {
    const { factory, made } = fakeDoorWorkers(core, { mode: 'hold' })
    const svc = createMemberDoorService({ factory })
    const got = []
    const off1 = svc.subscribe({ source: ADX }, (l) => got.push(l))
    setRuntimeKillList(['u_0123456789ab'])   // the kill list landed: the pane asks again (release, subscribe)
    off1()
    expect(made[0].terminated, 'nobody reads the old build: its worker stopped').toBe(true)
    const off2 = svc.subscribe({ source: ADX }, (l) => got.push(l))
    made[made.length - 1].release()
    await settle()
    expect(got).toHaveLength(1)
    expect(svc.stats().stopped).toBe(1)
    off2()
    svc.dispose()
  }, 120000)

  it('a released build stops its worker and answers nobody', async () => {
    const { factory, made } = fakeDoorWorkers(core, { mode: 'hold' })
    const svc = createMemberDoorService({ factory })
    const got = []
    const off = svc.subscribe({ source: RVOL }, (l) => got.push(l))
    off()
    made[0].release()
    await settle()
    expect(made[0].terminated).toBe(true)
    expect(got).toHaveLength(0)
    svc.dispose()
  }, 120000)
})

describe('3. the WATCHDOG: a hung worker is stopped and the script refused by name', () => {
  it('⭐⭐ past the deadline and its grace: terminated, refused with the deadline\'s own answer', async () => {
    const { factory, made } = fakeDoorWorkers(core, { mode: 'hang' })
    const svc = createMemberDoorService({ factory, watchdogMs: 40, budgetMs: 300000 })
    const got = []
    const off = svc.subscribe({ source: RVOL }, (l) => got.push(l))
    await until(() => got.length === 1, 5000)
    expect(made[0].terminated).toBe(true)
    expect(got[0].built.ok).toBe(false)
    expect(got[0].built.guard).toBe('pine:timeout')
    expect(got[0].built[DOOR_TIMED_OUT]).toBe(true)
    expect(got[0].built.reason).toMatch(/longer than 5 minutes/)
    expect(svc.stats().watchdog).toBe(1)
    off()
    svc.dispose()
  }, 30000)
})

describe('4. a worker that dies is stopped and the script refused by name; a door that threw is said', () => {
  const refusedByName = async (factory) => {
    const svc = createMemberDoorService({ factory, watchdogMs: 60000 })
    const got = []
    const off = svc.subscribe({ source: RVOL }, (l) => got.push(l))
    await until(() => got.length === 1, 5000)
    off()
    svc.dispose()
    return got[0]
  }
  it('⭐⭐ an error it did not catch', async () => {
    const { factory, made } = fakeDoorWorkers(core, { mode: 'die' })
    const l = await refusedByName(factory)
    expect(l.built.guard).toBe(MEMBER_DOOR_WORKER_GUARD)
    expect(l.built.ok).toBe(false)
    expect(made[0].terminated).toBe(true)
  }, 30000)
  it('an answer this side cannot read', async () => {
    const { factory } = fakeDoorWorkers(core, { mode: 'garble' })
    expect((await refusedByName(factory)).built.guard).toBe(MEMBER_DOOR_WORKER_GUARD)
  }, 30000)
  it('a worker that will not start, and a job it cannot be sent', async () => {
    expect((await refusedByName(() => { throw new Error('no workers here') })).built.guard).toBe(MEMBER_DOOR_WORKER_GUARD)
    const unsendable = () => Object.assign(new FakeDoorWorker(core), { postMessage() { throw new Error('DataCloneError') } })
    expect((await refusedByName(unsendable)).built.guard).toBe(MEMBER_DOOR_WORKER_GUARD)
  }, 30000)
  it('a door that THREW in the worker reaches each consumer as an error (the pane words it by name)', async () => {
    const throwing = { answerMemberDoorJob: (job) => ({ id: job.id, ok: false, error: { name: 'TypeError', message: 'x is undefined' }, consults: [], ms: 1 }) }
    const { factory } = fakeDoorWorkers(throwing)
    const l = await refusedByName(factory)
    expect(l.built).toBe(null)
    expect(l.error).toEqual({ message: 'x is undefined' })
    const pane = doorFailedAnswer(l.error.message)
    expect(pane.guard).toBe(MEMBER_DOOR_FAILED_GUARD)
    expect(pane.reason).toContain('x is undefined')
  }, 30000)
})

describe('5. the CONTROL: a fast script answers at once, and its answer is the main thread\'s', () => {
  it('⭐ rvol: answered within a second of a fresh worker, byte for byte', async () => {
    const { factory } = fakeDoorWorkers(core)
    const svc = createMemberDoorService({ factory })
    const main = memberPaneDefinition({ source: RVOL, id: MEMBER_PANE_DEF_PREFIX })
    const got = []
    const t0 = Date.now()
    const off = svc.subscribe({ source: RVOL }, (l) => got.push(l))
    await until(() => got.length === 1, 10000)
    expect(Date.now() - t0).toBeLessThan(1000)
    expect(got[0].offThread).toBe(true)
    expect(canonOf(got[0].built)).toBe(canonOf(main))
    off()
    svc.dispose()
  }, 60000)
})

describe('6. what the build did to the page is done on the page', () => {
  it('⭐⭐ its consults: the "still being checked" mark the pane\'s first-paste rule reads is set HERE', async () => {
    __resetRuntimeAllowList()
    __resetRuntimeAdmission()
    setRuntimeCapabilityAdmission(true)
    expect(runtimeConsultPendingOf({ source: STOP_TAKE }), 'no consult has been made on this page').toBe(false)
    const { factory } = fakeDoorWorkers(core)
    const svc = createMemberDoorService({ factory })
    const got = []
    const off = svc.subscribe({ source: STOP_TAKE }, (l) => got.push(l))
    await until(() => got.length === 1)
    expect(got[0].consultPending).toBe(true)
    // the worker's graph is not this page's: only the replay of its consults can have set this
    expect(runtimeConsultPendingOf({ source: STOP_TAKE })).toBe(true)
    off()
    svc.dispose()
  }, 120000)

  it('its warm of the runtime lane (a runtime-lane document) is made on the page', async () => {
    // the first candidate the door draws on the runtime lane, warming it, on this thread (so the rail is not vacuous)
    const candidates = [ADX, STOP_TAKE, corpus('twin-range-filter__xF3L2PeXm7.pine'), corpus('inside-bar-boxes__2f747d848b.pine'),
      corpus('parabolic-sar__xoeoPMOWGJ.pine'), corpus('engulfingcandle__0df91dc775.pine')]
    let source = null
    for (const s of candidates) {
      const before = runtimeLaneWarmAsks()
      const main = memberPaneDefinition({ source: s, id: MEMBER_PANE_DEF_PREFIX })
      if (main.ok && main.lane === 'runtime' && runtimeLaneWarmAsks() > before) { source = s; break }
    }
    expect(source, 'a runtime-lane script among the candidates').toBeTruthy()
    const { factory } = fakeDoorWorkers(core)
    const svc = createMemberDoorService({ factory })
    const got = []
    const mid = runtimeLaneWarmAsks()
    const off = svc.subscribe({ source }, (l) => got.push(l))
    await until(() => got.length === 1)
    expect(got[0].built.lane).toBe('runtime')
    // the worker's graph counts its own asks; only the page's warm moves THIS count
    expect(runtimeLaneWarmAsks(), 'the page warmed the lane the door asked for').toBeGreaterThan(mid)
    off()
    svc.dispose()
  }, 120000)
})

describe('7. the permission: a worker that latched "not permitted" is never asked a permitted job', () => {
  it('⭐⭐ false -> true starts a FRESH worker (its answer is the permitted one); true -> false needs none', async () => {
    // three independent graphs, one per worker the service may start (a real worker is its own graph)
    const realms = []
    for (let i = 0; i < 3; i += 1) { vi.resetModules(); realms.push(await import('./memberDoorWorkerCore.js')) }
    // a script whose answer the permission changes (the runtime lane draws it only when permitted)
    const candidates = [ADX, STOP_TAKE, corpus('twin-range-filter__xF3L2PeXm7.pine'), corpus('inside-bar-boxes__2f747d848b.pine'),
      corpus('parabolic-sar__xoeoPMOWGJ.pine'), corpus('engulfingcandle__0df91dc775.pine')]
    let source = null
    let permitted = null
    for (const s of candidates) {
      const a = memberPaneDefinition({ source: s, id: MEMBER_PANE_DEF_PREFIX })
      if (a.ok && a.lane === 'runtime') { source = s; permitted = a; break }
    }
    expect(source, 'a runtime-lane script among the candidates').toBeTruthy()
    __resetRuntimePanePermission()
    const notPermitted = memberPaneDefinition({ source, id: MEMBER_PANE_DEF_PREFIX })
    expect(canonOf(notPermitted), 'the control: the permission changes this answer').not.toBe(canonOf(permitted))
    const made = []
    const svc = createMemberDoorService({ factory: () => { const w = new FakeDoorWorker(realms[made.length]); made.push(w); return w } })
    const got = []
    const ask = async () => {
      const n = got.length
      const off = svc.subscribe({ source }, (l) => got.push(l))
      await until(() => got.length === n + 1)
      off()
      return got[n].built
    }
    expect(canonOf(await ask())).toBe(canonOf(notPermitted))
    __permitRuntimePaneForTests()                       // the member's permission arrives
    expect(canonOf(await ask()), 'answered as permitted').toBe(canonOf(permitted))
    expect(made, 'a fresh worker').toHaveLength(2)
    expect(made[0].terminated).toBe(true)
    expect(svc.stats().relatched).toBe(1)
    __resetRuntimePanePermission()                      // revoked: the latch applies a revocation in place
    expect(canonOf(await ask()), 'answered as not permitted, by the same worker').toBe(canonOf(notPermitted))
    expect(made).toHaveLength(2)
    svc.dispose()
  }, 240000)
})
