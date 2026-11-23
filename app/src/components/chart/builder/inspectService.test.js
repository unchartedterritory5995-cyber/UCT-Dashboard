// @vitest-environment node
// app/src/components/chart/builder/inspectService.test.js
//
// ─── ⭐⭐ THE PASTE WORKER — PASTEBOX'S REPORT, OFF THE MAIN THREAD: THE SAME REPORT, ONCE, BESIDE THE DOOR ────────
//
// `inspectAsync.js`: PasteBox's report of a text is computed in the member door's worker, on its OWN worker, keyed and
// shared like the chart door's build (`createKeyedWorkerService`). Over a stand-in Worker running the REAL handler in
// the worker's own module graph (`importWorkerCore`):
//   1. the report that lands is the synchronous call's, field for field (non-enumerable properties included), for
//      Pine (`inspectSource`, auto and pine) and for the Pine-only door (`inspectPine`), with the member's settings;
//   2. ONE computation per (text, dialect, settings, page state): two readers share it; a setting is another report;
//   3. it runs BESIDE the door's build, on another worker: both are in flight at once (the report never waits for it);
//   4. never a silent hang: a worker that dies, cannot start, or is past the watchdog answers the report a throw would
//      have (the controlled error report), by text; a handler that threw answers the same;
//   5. a paste of several scripts: the library summary is computed there too, once;
//   6. without workers (tests, a non-browser host): computed here, synchronously, as before (the fast control).
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { inspectSource, inspectPine } from './inspectSource'
import { inspectLibrary } from './libraryIntake'
import { INSPECT_WORKER_JOB, INSPECT_LIBRARY_WORKER_JOB, inspectKeyOf } from './inspectAsync'
import { reportForPage } from './inspectView'
import { createKeyedWorkerService, createMemberDoorService } from './memberPane/memberDoorAsync'
import { MEMBER_PANE_DEF_PREFIX } from './memberPane/memberPaneDefinition'
import { canonOf, fakeDoorWorkers, importWorkerCore } from '../../../testing/builder/memberDoor.testkit.js'
import { OUTCOME } from '../engine/ast/importOutcome'

const REPO = path.resolve(__dirname, '../../../../..')
const corpus = (n) => fs.readFileSync(path.join(REPO, 'corpus/committed', n), 'utf8')
const RVOL = corpus('rvol__05fcd9e160.pine')
const ADX = corpus('adx-and-di-for-v4__932.pine')
const TWIN = corpus('twin-range-filter__xF3L2PeXm7.pine')

let core = null
beforeAll(async () => { core = await importWorkerCore(vi) }, 120000)
beforeEach(() => { vi.stubEnv('VITE_PINE_MEMBER_PANE_ENABLED', '1') })
afterEach(() => { vi.unstubAllEnvs() })

const settle = async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve() }
const reportService = (opts = {}) => {
  const w = fakeDoorWorkers(core, opts)
  return { svc: createKeyedWorkerService({ job: INSPECT_WORKER_JOB, factory: w.factory }), made: w.made }
}
const hidden = (v) => canonOf(v, { hidden: true })

describe('1. the same report the synchronous call returned, field for field', () => {
  it('⭐⭐ Pine (auto and pine), the Pine-only door, and a member\'s settings', async () => {
    const { svc } = reportService()
    const cases = [
      [{ source: RVOL, dialect: 'auto' }, () => inspectSource(RVOL, 'auto')],
      [{ source: ADX, dialect: 'pine' }, () => inspectSource(ADX, 'pine')],
      [{ source: TWIN }, () => inspectPine(TWIN)],
      [{ source: RVOL, dialect: 'auto', opts: { inputValues: { len: 7 } } }, () => inspectSource(RVOL, 'auto', { inputValues: { len: 7 } })],
    ]
    for (const [args, sync] of cases) {
      const got = []
      const off = svc.subscribe(args, (l) => got.push(l))
      for (let i = 0; i < 50 && !got.length; i += 1) await settle()
      expect(got, inspectKeyOf(args)).toHaveLength(1)
      expect(got[0].offThread).toBe(true)
      // ⭐ the page reads the report light (`inspectView.reportForPage`): the main thread's, less what stays in the worker
      expect(hidden(got[0].report), `${inspectKeyOf(args).slice(0, 40)}: the worker's report is the main thread's`).toBe(hidden(reportForPage(sync())))
      off()
    }
    svc.dispose()
  }, 240000)
})

describe('2. ONE computation per text, dialect, settings and page state', () => {
  it('two readers of one text share one job; a setting is another report (the control)', async () => {
    const { svc, made } = reportService({ mode: 'hold' })
    const a = []
    const b = []
    const offA = svc.subscribe({ source: RVOL, dialect: 'auto' }, (l) => a.push(l))
    const offB = svc.subscribe({ source: RVOL, dialect: 'auto' }, (l) => b.push(l))
    expect(made.reduce((n, w) => n + w.jobs.length, 0), 'one job for two readers').toBe(1)
    made[0].release()
    await settle()
    expect(b[0]).toBe(a[0])
    const c = []
    const offC = svc.subscribe({ source: RVOL, dialect: 'auto', opts: { inputValues: { len: 9 } } }, (l) => c.push(l))
    expect(svc.stats().posted, 'a member\'s setting is another report').toBe(2)
    for (const w of made) w.release()
    await settle()
    offA(); offB(); offC()
    svc.dispose()
  }, 120000)

  it('an unknown argument is refused by name (a key that names what it computes)', () => {
    expect(() => inspectKeyOf({ source: 'x', id: 'y' })).toThrow(/`id` is not a report argument/)
    expect(inspectKeyOf({ source: 'x' })).toBe(inspectKeyOf({ source: 'x', dialect: undefined }))
    expect(inspectKeyOf({ source: 'x', dialect: 'auto' })).not.toBe(inspectKeyOf({ source: 'x' }))
  })
})

describe('3. beside the door, never behind it', () => {
  it('⭐⭐ the report and the door\'s build are in flight at once, on two workers', async () => {
    const door = fakeDoorWorkers(core, { mode: 'hold' })
    const report = fakeDoorWorkers(core, { mode: 'hold' })
    const doorSvc = createMemberDoorService({ factory: door.factory })
    const reportSvc = createKeyedWorkerService({ job: INSPECT_WORKER_JOB, factory: report.factory })
    const offD = doorSvc.subscribe({ source: ADX, id: MEMBER_PANE_DEF_PREFIX }, () => {})
    const got = []
    const offR = reportSvc.subscribe({ source: ADX, dialect: 'auto' }, (l) => got.push(l))
    expect(door.made).toHaveLength(1)
    expect(report.made).toHaveLength(1)
    expect(report.made[0]).not.toBe(door.made[0])
    expect(door.made[0].held, 'the door is building').toHaveLength(1)
    expect(report.made[0].held, 'and the report is computing at the same time').toHaveLength(1)
    report.made[0].release()          // the report lands while the door still builds
    await settle()
    expect(got).toHaveLength(1)
    expect(doorSvc.stats().busy, 'the door still builds; the report did not wait for it').toBe(true)
    door.made[0].release()
    await settle()
    offD(); offR()
    doorSvc.dispose(); reportSvc.dispose()
  }, 120000)
})

describe('4. never a silent hang: a worker that cannot answer is the controlled error report, by text', () => {
  const stoppedReport = async (opts, extra = {}) => {
    const w = fakeDoorWorkers(core, opts)
    const svc = createKeyedWorkerService({ job: INSPECT_WORKER_JOB, factory: w.factory, ...extra })
    const got = []
    const off = svc.subscribe({ source: ADX, dialect: 'auto' }, (l) => got.push(l))
    return { got, off, svc }
  }
  it('a worker that died', async () => {
    const { got, off, svc } = await stoppedReport({ mode: 'die' })
    for (let i = 0; i < 10 && !got.length; i += 1) await settle()
    expect(got).toHaveLength(1)
    expect(got[0].report.outcome.verdict).toBe(OUTCOME.ERROR)
    expect(JSON.stringify(got[0].report)).toMatch(/stopped before it answered \(it stopped with an error\)/)
    expect(svc.stats().died).toBe(1)
    off(); svc.dispose()
  })
  it('a worker past the watchdog', async () => {
    vi.useFakeTimers()
    try {
      const { got, off, svc } = await stoppedReport({ mode: 'hang' }, { watchdogMs: 1000 })
      await vi.advanceTimersByTimeAsync(1001)
      expect(got).toHaveLength(1)
      expect(got[0].report.outcome.verdict).toBe(OUTCOME.ERROR)
      expect(JSON.stringify(got[0].report)).toMatch(/ran past the time allowed/)
      expect(svc.stats().watchdog).toBe(1)
      off(); svc.dispose()
    } finally { vi.useRealTimers() }
  })
  it('a worker that would not start', async () => {
    const svc = createKeyedWorkerService({ job: INSPECT_WORKER_JOB, factory: () => { throw new Error('no') } })
    const got = []
    const off = svc.subscribe({ source: ADX, dialect: 'auto' }, (l) => got.push(l))
    expect(got).toHaveLength(1)
    expect(JSON.stringify(got[0].report)).toMatch(/it could not be started/)
    off(); svc.dispose()
  })
  it('a handler that threw: the report a throw always gave (the engine failed, nothing to save)', async () => {
    const throwing = { answerJobOfKind: (job) => ({ id: job.id, ok: false, error: { name: 'TypeError', message: 'x is not a function' }, consults: [], ms: 1 }) }
    const w = fakeDoorWorkers(throwing)
    const svc = createKeyedWorkerService({ job: INSPECT_WORKER_JOB, factory: w.factory })
    const got = []
    const off = svc.subscribe({ source: ADX, dialect: 'auto' }, (l) => got.push(l))
    for (let i = 0; i < 10 && !got.length; i += 1) await settle()
    expect(got[0].report.outcome.verdict).toBe(OUTCOME.ERROR)
    expect(JSON.stringify(got[0].report)).toMatch(/x is not a function/)
    off(); svc.dispose()
  })
})

describe('5. a paste of several scripts: the summary is computed there too, once', () => {
  it('the same library report, one job', async () => {
    const w = fakeDoorWorkers(core)
    const svc = createKeyedWorkerService({ job: INSPECT_LIBRARY_WORKER_JOB, factory: w.factory })
    const scripts = [RVOL, ADX]
    const got = []
    const off = svc.subscribe({ scripts }, (l) => got.push(l))
    for (let i = 0; i < 50 && !got.length; i += 1) await settle()
    expect(hidden(got[0].report)).toBe(hidden(inspectLibrary(scripts)))
    expect(svc.stats().posted).toBe(1)
    off(); svc.dispose()
  }, 120000)
})

describe('6. the fast control: without workers, computed here, synchronously, as before', () => {
  it('no Worker in this host: the report lands during the subscribe, the synchronous report itself', () => {
    const svc = createKeyedWorkerService({ job: INSPECT_WORKER_JOB })
    expect(svc.offThread).toBe(false)
    const got = []
    const off = svc.subscribe({ source: RVOL, dialect: 'auto' }, (l) => got.push(l))
    expect(got).toHaveLength(1)
    expect(got[0].offThread).toBe(false)
    expect(hidden(got[0].report)).toBe(hidden(inspectSource(RVOL, 'auto')))
    off(); svc.dispose()
  }, 120000)
})
