// app/src/components/chart/builder/hubPageAnswer.test.js
//
// ─── ⭐⭐ THE HUB — A DOOR ANSWER THE PAGE MADE STILL GETS ITS STATUS WHEN THE REPORT'S WORKER IS REPLACED ──────────
//
// docs/pine/evidence/2026-11-20-paste-worker/EVIDENCE.md, section 4. When the chart door's worker cannot answer (it
// died, the watchdog), the page makes the door's answer itself and hands it to the report's worker, where the editor
// status panel's status is made (`inspectAsync.pageDoorRefOf`). If that worker is replaced before it reads it, the
// status with it was never made and the panel said "checking" forever. The page now keeps the answers it made and
// hands them again to every new report worker (`linkHub`).
//
// Two stand-in report workers, each the REAL handler in its OWN fresh module graph (a new worker holds nothing the old
// one held); the first is stopped right after the page handed it the answer, before it read it.
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createKeyedWorkerService, createMemberDoorService, __setMemberDoorServiceForTests, doorWorkerFailedAnswer } from './memberPane/memberDoorAsync'
import {
  INSPECT_WORKER_JOB, INSPECT_LIBRARY_WORKER_JOB, __setInspectServicesForTests, __setHubChannelForTests, hubMessageForTests,
  linkHub, pageDoorRefOf, hubStatusOf, reportKeyOf,
} from './inspectAsync'
import { inspectSource } from './inspectSource'
import { editorStatus } from './editorStatus'
import { FakeDoorWorker, importWorkerCore, fakeChannel, canonOf } from '../../../testing/builder/memberDoor.testkit.js'

const REPO = path.resolve(__dirname, '../../../../..')
const SOURCE = fs.readFileSync(path.join(REPO, 'corpus/committed', 'rvol__05fcd9e160.pine'), 'utf8')

let cores = []
beforeAll(async () => { for (let i = 0; i < 3; i += 1) cores.push(await importWorkerCore(vi)) }, 120000)
afterEach(() => { __setInspectServicesForTests({}); __setMemberDoorServiceForTests(null); __setHubChannelForTests(null) })

const settle = async () => { for (let i = 0; i < 20; i += 1) await Promise.resolve() }
/** The report of `args`, landed through `svc` (resolves with the landed answer and the release). */
function reportOf(svc, args) {
  return new Promise((resolve) => {
    let release = null
    release = svc.subscribe(args, (landed) => { Promise.resolve().then(() => resolve({ landed, release })) })
  })
}

describe('⭐⭐ the hub: a page-made door answer gets its status from a report worker that replaced the first', () => {
  it('the first report worker stops before reading it; the next one is handed it again and makes the status', async () => {
    vi.stubEnv('VITE_PINE_MEMBER_PANE_ENABLED', '1')
    const made = []
    const reports = createKeyedWorkerService({ job: INSPECT_WORKER_JOB, onMessage: hubMessageForTests,
      factory: () => { const w = new FakeDoorWorker(cores[made.length]); made.push(w); return w } })
    __setInspectServicesForTests({ inspect: reports, library: createKeyedWorkerService({ job: INSPECT_LIBRARY_WORKER_JOB, factory: () => new FakeDoorWorker(cores[2]) }) })
    __setMemberDoorServiceForTests(createMemberDoorService({ factory: () => new FakeDoorWorker(cores[2]) }))
    __setHubChannelForTests(fakeChannel)
    linkHub()
    const args = { source: SOURCE, dialect: 'auto' }
    const first = await reportOf(reports, args)
    const key = reportKeyOf(first.landed.report)
    expect(key, 'the report crossed from a worker').toBeTruthy()
    // the chart door's worker could not answer: the page made the door's answer, and hands it to the report's worker
    const pane = doorWorkerFailedAnswer('it stopped with an error')
    const ref = pageDoorRefOf(pane, SOURCE)
    expect(ref).toBeTruthy()
    // ... which stops before it reads it (the message is still in its queue)
    made[0].onerror({ message: 'gone', preventDefault() {} })
    await settle()
    expect(hubStatusOf(key, ref.key, ref.version), 'no status yet: the worker that was handed the answer is gone').toBe(null)
    // the report of the same text, asked again (an undo; the panel reopened): a new report worker
    first.release()
    const again = await reportOf(reports, args)
    await settle()
    expect(made.length, 'a second report worker').toBe(2)
    expect(reportKeyOf(again.landed.report)).toBe(key)
    const st = hubStatusOf(key, ref.key, ref.version)
    expect(st, 'the status with the page-made door answer was made by the new worker').toBeTruthy()
    expect(canonOf(st, { hidden: true })).toBe(canonOf(editorStatus({ report: inspectSource(SOURCE, 'auto'), pane, savedRow: null, inspectedSource: SOURCE }), { hidden: true }))
    again.release()
    vi.unstubAllEnvs()
  }, 240000)
})
