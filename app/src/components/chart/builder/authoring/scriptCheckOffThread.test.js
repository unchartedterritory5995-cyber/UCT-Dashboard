// app/src/components/chart/builder/authoring/scriptCheckOffThread.test.js
//
// ─── ⭐⭐ UNIT (c), 2026-11-23 — THE AUTHORING SCRIPT CHECK RUNS IN THE MEMBER DOOR'S WORKERS ─────────────────────
//
// Create Indicator's check of a script the assistant wrote (`scriptAnswer.js::checkScript`) ran the report, the door
// and the status on the page's main thread, under engine 94's interim 10 s cap. It now reads the member door's
// workers (`scriptCheckOffThread.js`). Held here, through the REAL check with every door call, report, translation and
// status counted by where it ran (the rail pattern of `memberDoorPerPaste.test.jsx`):
//   1. a check makes ONE door build and ONE report, each in a worker, and NOTHING on the main thread: no door call, no
//      report, no translation, no status. Control: with no workers, the same check runs all of them on this thread.
//   2. the verdict is the main thread's, to the byte, on every assistant example and on scripts the engine refuses.
//   3. the build is the page's SHARED build (`{source}`, the member pane's key): a pane already reading the script and
//      the check make one build between them, and the check's release leaves the pane's answer in place.
//   4. the door and the report are waited for THEMSELVES, never against a timer of the check's; only the hub's own
//      step is bounded, by ONE named constant, and past it the check is refused by name with nothing computed here.
//   5. a fault of the window (a worker that died, a door that threw, a report that could not be made) is "could not
//      be checked here": nothing kept, nothing for the assistant to repair.
//   6. the member's Stop ends the wait and stops a build nobody else reads.
// Mutants: ci/mutants/u-script-check-worker.json. The wiring from `checkScript`'s own engine loader and from
// `settleScript` is held in `scriptCheckOffThread.wired.test.js` (this file resets the module graph for its workers).
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const D = vi.hoisted(() => ({ main: 0, worker: 0, inWorker: false, tMain: 0, tWorker: 0, iMain: 0, iWorker: 0, sMain: 0, sWorker: 0, throwInWorker: false }))
vi.mock('../editorStatus', async (importOriginal) => {
  const m = await importOriginal()
  return {
    ...m,
    editorStatus: (...args) => {
      if (D.inWorker) D.sWorker += 1
      else D.sMain += 1
      return m.editorStatus(...args)
    },
  }
})
vi.mock('../../engine/ast/pine', async (importOriginal) => {
  const m = await importOriginal()
  return {
    ...m,
    translatePine: (...args) => {
      if (D.inWorker) D.tWorker += 1
      else D.tMain += 1
      return m.translatePine(...args)
    },
  }
})
vi.mock('../inspectSource', async (importOriginal) => {
  const m = await importOriginal()
  const counted = (fn) => (...args) => {
    if (D.inWorker) D.iWorker += 1
    else D.iMain += 1
    return fn(...args)
  }
  return { ...m, inspectSource: counted(m.inspectSource), inspectPine: counted(m.inspectPine) }
})
vi.mock('../memberPane/memberPaneDefinition', async (importOriginal) => {
  const m = await importOriginal()
  return {
    ...m,
    memberPaneDefinition: (...args) => {
      if (D.inWorker) D.worker += 1
      else D.main += 1
      if (D.inWorker && D.throwInWorker) throw new Error('a defect of this engine (the rail\'s)')
      return m.memberPaneDefinition(...args)
    },
  }
})

import { checkScript, verdictFrom, refusalOf, scriptNeedsFixing, UNCHECKED_HEADLINE, UNCHECKED_STATE,
  SCRIPT_CHECK_UNFINISHED_LINE, SCRIPT_CHECK_ID } from './scriptAnswer'
import { judgeOffThread, HUB_STATUS_WAIT_MS, UNCHECKED_BECAUSE } from './scriptCheckOffThread'
import { inspectSource } from '../PineBox'
import { memberPaneDefinition, MEMBER_PANE_DEF_PREFIX } from '../memberPane/memberPaneDefinition'
import { editorStatus } from '../editorStatus'
import { runHereWhenLanded, verdictOnChart } from '../runsHere'
import { runtimeConsultPendingOf, runtimePendingReasonOf } from '../../engine/runtimeKill'
import { createMemberDoorService, createKeyedWorkerService, __setMemberDoorServiceForTests, memberDoorKeyOf } from '../memberPane/memberDoorAsync'
import { INSPECT_WORKER_JOB, INSPECT_LIBRARY_WORKER_JOB, __setInspectServicesForTests, __setHubChannelForTests, hubMessageForTests } from '../inspectAsync'
import { FakeDoorWorker, importWorkerCore, fakeChannel, canonOf } from '../../../../testing/builder/memberDoor.testkit.js'
// (train e96 x #2568, the door heartbeat) the silence and load bounds, and a heartbeat, for the composition rail below
import { MEMBER_DOOR_SILENCE_MS, MEMBER_DOOR_LOAD_MS, MEMBER_DOOR_SILENT_GUARD, MEMBER_DOOR_WORKER_GUARD } from '../memberPane/memberDoorAsync'
import { BEAT } from '../memberPane/memberDoorProtocol'

const APP = process.cwd()
const EXAMPLES = path.resolve(APP, 'src/components/chart/supportLoop/assistantExamples')
const example = (n) => fs.readFileSync(path.join(EXAMPLES, n), 'utf8')
const TABLE = example('table-summary.pine')
// ⭐ A text no other rail here asks about. The hub keeps the statuses it was sent by (report, door answer, page state),
// and a status of TABLE made in an earlier rail is still there: the rail of a status that never comes needs a text
// whose status nobody has made. (Found by its first run: TABLE's status "came" from the rail before it.)
const UNSEEN = `${TABLE}\n// a text no other rail has asked about\n`
const ALL_EXAMPLES = fs.readdirSync(EXAMPLES).filter((n) => n.endsWith('.pine')).sort()
// scripts the engine does not take whole: equality must hold for a refusal as for a pass
const REFUSED = {
  'not a script': 'this is not a script at all (((',
  'an unknown function': '//@version=5\nindicator("x")\nplot(ta.nothing_by_this_name(close, 14))\n',
  'empty': '',
}

/** The check's engine, from THIS graph's modules (the page's): the real functions the check's own loader hands it,
 *  with nothing to fetch. (The loader itself is held in `scriptCheckOffThread.wired.test.js`.) */
const engine = async () => ({
  inspectSource, memberPaneDefinition, editorStatus, runHereWhenLanded, verdictOnChart, judgeOffThread,
  consultPending: (pine) => runtimeConsultPendingOf({ source: pine }),
  pendingReason: (pine) => runtimePendingReasonOf({ source: pine }),
  prepare: async () => {},
})
const still = () => 1000

/** A stand-in worker that counts the calls it makes as the WORKER's. */
class CountingWorker extends FakeDoorWorker {
  answer(job) {
    D.inWorker = true
    try { super.answer(job) } finally { D.inWorker = false }
  }
  inWorker(fn) {
    D.inWorker = true
    try { return fn() } finally { D.inWorker = false }
  }
}
// each stand-in worker runs the REAL handler in a FRESH module graph, as a real worker is its own graph
let core = null
let reportCore = null
beforeAll(async () => {
  core = await importWorkerCore(vi)
  reportCore = await importWorkerCore(vi)
}, 180000)

let made = []
let madeReports = []
let svc = null
let reports = null
const noChannel = () => { throw new Error('no channel between the workers (the rail made none)') }
function useWorkers({ mode = 'answer', reportMode = 'answer', unpaired = false, watchdogMs } = {}) {
  made = []
  madeReports = []
  // ⭐ `unpaired`: the two workers have no channel between them, so the report's worker never has the door's answer
  // and the status of the pair is never made. The stand-in workers of one rail file share two handler graphs, and a
  // handler keeps the port an EARLIER rail paired it with (a real worker starts with none): both are let go of first.
  if (unpaired) { core.setPeer(null, null); reportCore.setPeer(null, null) }
  svc = createMemberDoorService({
    factory: () => { const w = new CountingWorker(core, { mode }); made.push(w); return w },
    ...(watchdogMs ? { watchdogMs } : {}),
  })
  __setMemberDoorServiceForTests(svc)
  reports = createKeyedWorkerService({ job: INSPECT_WORKER_JOB, onMessage: hubMessageForTests,
    factory: () => { const w = new CountingWorker(reportCore, { mode: reportMode }); madeReports.push(w); return w },
    ...(watchdogMs ? { watchdogMs } : {}) })
  const library = createKeyedWorkerService({ job: INSPECT_LIBRARY_WORKER_JOB, factory: () => new CountingWorker(reportCore) })
  __setInspectServicesForTests({ inspect: reports, library })
  __setHubChannelForTests(unpaired ? noChannel : fakeChannel)
}
function noWorkers() {
  __setMemberDoorServiceForTests(null)
  __setInspectServicesForTests({})
  __setHubChannelForTests(null)
}
/** Let what a timer just resolved run to its end (an async function's return, its `finally`, the caller's `then`). */
const settle = async () => { for (let i = 0; i < 20; i += 1) await Promise.resolve() }
const counts = () => ({ main: D.main, worker: D.worker, tMain: D.tMain, iMain: D.iMain, iWorker: D.iWorker, sMain: D.sMain, sWorker: D.sWorker })
const onMain = () => ({ door: D.main, report: D.iMain, translation: D.tMain, status: D.sMain })
const NOTHING_ON_MAIN = { door: 0, report: 0, translation: 0, status: 0 }

beforeEach(() => {
  for (const k of Object.keys(D)) D[k] = typeof D[k] === 'boolean' ? false : 0
  vi.stubEnv('VITE_PINE_MEMBER_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
})
afterEach(() => {
  noWorkers()
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('⭐⭐ a check costs ONE door build and ONE report, each in a worker, and NOTHING on the main thread', () => {
  it('no door call, no report, no translation and no status runs on the page; one of each runs in a worker', async () => {
    useWorkers()
    const v = await checkScript(TABLE, { load: engine })
    expect(onMain(), `the main thread's part of the check ${JSON.stringify(counts())}`).toEqual(NOTHING_ON_MAIN)
    expect(D.worker, 'door builds in the worker').toBe(1)
    expect(D.iWorker, 'reports in the worker').toBe(1)
    expect(D.sWorker, 'the status was made in the report\'s worker').toBeGreaterThanOrEqual(1)
    expect(made.length, 'one door worker').toBe(1)
    expect(madeReports.length, 'one report worker (another worker: the two compute at once)').toBe(1)
    // a real verdict of the script, not "could not be checked"
    expect(v.state).not.toBe(UNCHECKED_STATE)
    expect(v.attaches).toBe(true)
  }, 180_000)

  it('CONTROL: with no workers the same check runs the door, the report and the status on this thread (the counters see it)', async () => {
    noWorkers()
    expect(await judgeOffThread(TABLE), 'no workers here: the off-thread check stands aside').toBe(null)
    const v = await checkScript(TABLE, { load: engine, capClock: still })
    expect(D.main, 'the door ran on the main thread').toBe(1)
    expect(D.iMain, 'the report ran on the main thread').toBe(1)
    expect(D.sMain, 'the status was made on the main thread').toBe(1)
    expect(D.worker + D.iWorker + D.sWorker).toBe(0)
    expect(v.state).not.toBe(UNCHECKED_STATE)
  }, 180_000)
})

describe('⭐⭐ the verdict is the main thread\'s, to the byte', () => {
  const scripts = [...ALL_EXAMPLES.map((n) => [n, () => example(n)]), ...Object.entries(REFUSED).map(([n, s]) => [n, () => s])]
  it('the examples are all there (a rail over an empty list holds nothing)', () => {
    expect(ALL_EXAMPLES.length).toBeGreaterThanOrEqual(10)
  })
  it.each(scripts)('%s', async (_name, read) => {
    const pine = read()
    useWorkers()
    const off = await checkScript(pine, { load: engine })
    expect(onMain(), 'nothing of it ran on the page').toEqual(NOTHING_ON_MAIN)
    noWorkers()
    const here = await checkScript(pine, { load: engine, capClock: still })
    expect(here.capped, 'control: the main-thread check was not cut short').toBeUndefined()
    expect(canonOf(off)).toBe(canonOf(here))
    // and it is the paste path's own verdict (the check with no chart adds only "not run on a chart yet" to a pass)
    if (!here.runs && here.state !== UNCHECKED_STATE && here.checking !== true) {
      const report = inspectSource(pine, 'pine')
      const pane = memberPaneDefinition({ source: pine, id: SCRIPT_CHECK_ID, name: 'script' })
      const pasted = verdictFrom(editorStatus({ report, pane, savedRow: null, inspectedSource: pine }), pane)
      if (!pasted.runs) expect(canonOf(off)).toBe(canonOf(pasted))
    }
  }, 240_000)
})

describe('⭐ the build is the page\'s SHARED build of the text', () => {
  it('the check asks the door with the script and nothing else: the member pane\'s key', async () => {
    useWorkers()
    await checkScript(TABLE, { load: engine })
    const jobs = made.flatMap((w) => w.jobs)
    expect(jobs.length).toBe(1)
    expect(jobs[0].args).toEqual({ source: TABLE, id: MEMBER_PANE_DEF_PREFIX })
    expect(jobs[0].key).toBe(memberDoorKeyOf({ source: TABLE }))
    expect(madeReports.flatMap((w) => w.jobs).map((j) => j.args)).toEqual([{ source: TABLE, dialect: 'pine' }])
  }, 180_000)

  it('a pane already reading the script and the check make ONE build between them; the check\'s release leaves the pane\'s answer', async () => {
    useWorkers()
    const seen = []
    const release = svc.subscribe({ source: TABLE }, (landed) => seen.push(landed))   // as the member pane subscribes
    await vi.waitFor(() => expect(seen.length).toBe(1))
    const before = svc.stats()
    const v = await checkScript(TABLE, { load: engine })
    expect(v.state).not.toBe(UNCHECKED_STATE)
    expect(svc.stats().builds - before.builds, 'no second build of the same text').toBe(0)
    expect(svc.stats().posted - before.posted).toBe(0)
    expect(svc.stats().shared - before.shared, 'the check read the pane\'s build').toBe(1)
    expect(svc.stats().held, 'the pane still holds its answer').toBe(1)
    expect(made.every((w) => !w.terminated), 'nothing was stopped').toBe(true)
    release()
    expect(svc.stats().held).toBe(0)
  }, 180_000)

  it('the check holds nothing once it has answered: both subscriptions are released', async () => {
    useWorkers()
    await checkScript(TABLE, { load: engine })
    expect(svc.stats().held).toBe(0)
    expect(reports.stats().held).toBe(0)
  }, 180_000)
})

describe('⭐⭐ what is waited for, and how long', () => {
  it('the bound is ONE named constant, 1,700 ms, written in one place', () => {
    expect(HUB_STATUS_WAIT_MS).toBe(1700)
    // code, never prose: comments are stripped before the number is looked for
    const code = (file) => fs.readFileSync(path.join(APP, 'src/components/chart/builder/authoring', file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
    const hits = ['scriptCheckOffThread.js', 'scriptAnswer.js'].flatMap((f) => (code(f).match(/\b1[_,]?700\b/g) || []).map(() => f))
    expect(hits).toEqual(['scriptCheckOffThread.js'])
    expect(code('scriptCheckOffThread.js')).toMatch(/export const HUB_STATUS_WAIT_MS = 1700\b/)
    expect(code('scriptCheckOffThread.js')).toMatch(/statusWaitMs = HUB_STATUS_WAIT_MS\b/)
    // CONTROL: the stripper leaves code and takes comments (the derivation, with its 560, is a comment)
    expect(code('scriptCheckOffThread.js')).not.toMatch(/560/)
    expect(fs.readFileSync(path.join(APP, 'src/components/chart/builder/authoring/scriptCheckOffThread.js'), 'utf8')).toMatch(/3 x the p99[\s\S]{0,80}560 ms/)
  })

  it('a status that does not come is waited for exactly the bound, then refused by name; nothing is computed here', async () => {
    // the two workers are never paired, so the report's worker never has the door's answer to make the status of
    useWorkers({ unpaired: true })
    vi.useFakeTimers()
    let done
    judgeOffThread(UNSEEN).then((v) => { done = v })
    await vi.advanceTimersByTimeAsync(HUB_STATUS_WAIT_MS - 1)
    expect(D.worker, 'the door answered').toBe(1)
    expect(D.iWorker, 'the report answered').toBe(1)
    expect(done, 'one millisecond inside the bound: still waiting').toBeUndefined()
    await vi.advanceTimersByTimeAsync(1)
    await settle()
    expect(done).toEqual({ unchecked: true, because: UNCHECKED_BECAUSE.STATUS, waitedMs: HUB_STATUS_WAIT_MS })
    expect(onMain(), 'never a status (or anything else) computed on the page in its place').toEqual(NOTHING_ON_MAIN)
    expect(svc.stats().held + reports.stats().held, 'both subscriptions released').toBe(0)
    // and through the check: the honest verdict, with nothing for the assistant to repair
    let v
    checkScript(UNSEEN, { load: engine }).then((x) => { v = x })
    await vi.advanceTimersByTimeAsync(HUB_STATUS_WAIT_MS + 5)
    await settle()
    expect(v).toEqual({ runs: false, attaches: false, state: UNCHECKED_STATE, lane: 'host', headline: UNCHECKED_HEADLINE,
      withheld: [], notes: [SCRIPT_CHECK_UNFINISHED_LINE], errors: [], unfinished: true })
    expect(refusalOf(UNSEEN, v, 1)).toBe(null)
    expect(scriptNeedsFixing({ runs: v.runs, state: v.state })).toBe(false)
    expect(onMain()).toEqual(NOTHING_ON_MAIN)
  }, 180_000)

  it('CONTROL: paired, the status of a text nobody has asked about comes and the check answers well inside the bound', async () => {
    useWorkers()
    vi.useFakeTimers()
    let done
    judgeOffThread(`${UNSEEN}// (the control's own)\n`).then((v) => { done = v })
    await vi.advanceTimersByTimeAsync(50)
    expect(done && done.offThread).toBe(true)
    expect(done.status && typeof done.status.state).toBe('string')
    expect(Object.prototype.hasOwnProperty.call(done.pane, 'translation'), 'the page holds the LIGHT door answer').toBe(false)
  }, 180_000)

  it('the door is waited for ITSELF: ten minutes of a build still running is not a refusal, and its answer is then read', async () => {
    useWorkers({ mode: 'hold', watchdogMs: 24 * 3600 * 1000 })
    vi.useFakeTimers()
    let done
    judgeOffThread(TABLE).then((v) => { done = v })
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000)
    expect(done, 'no timer of the check\'s ended the wait for the door').toBeUndefined()
    expect(made[0].held.length, 'the build is still the worker\'s').toBe(1)
    made[0].release()
    await vi.advanceTimersByTimeAsync(50)
    expect(done && done.offThread).toBe(true)
    expect(onMain()).toEqual(NOTHING_ON_MAIN)
  }, 180_000)
})

describe('⭐ a fault of the window is "could not be checked here", never a fact about the script', () => {
  const plain = { runs: false, attaches: false, state: UNCHECKED_STATE, lane: 'host', headline: UNCHECKED_HEADLINE,
    withheld: [], notes: [], errors: [] }
  it.each([
    ['the door\'s worker died', { mode: 'die' }, UNCHECKED_BECAUSE.DOOR_WORKER],
    ['the door\'s answer could not be read', { mode: 'garble' }, UNCHECKED_BECAUSE.DOOR_WORKER],
    ['the report\'s worker died', { reportMode: 'die' }, UNCHECKED_BECAUSE.REPORT],
  ])('%s', async (_name, opts, because) => {
    useWorkers(opts)
    expect(await judgeOffThread(TABLE)).toEqual({ unchecked: true, because })
    const v = await checkScript(TABLE, { load: engine })
    expect(v).toEqual(plain)
    expect(refusalOf(TABLE, v, 1), 'nothing goes back to the assistant').toBe(null)
    expect(onMain(), 'and nothing was computed on the page in the worker\'s place').toEqual(NOTHING_ON_MAIN)
  }, 180_000)

  it('the door threw in its worker (a defect of this engine)', async () => {
    useWorkers()
    D.throwInWorker = true
    expect(await judgeOffThread(TABLE)).toEqual({ unchecked: true, because: UNCHECKED_BECAUSE.DOOR_THREW })
    expect(await checkScript(TABLE, { load: engine })).toEqual(plain)
    expect(onMain()).toEqual(NOTHING_ON_MAIN)
  }, 180_000)
})

describe('⭐ the member\'s Stop ends the wait', () => {
  it('a check waiting on a build is ended by `cancelled()`, and a build nobody else reads is stopped', async () => {
    useWorkers({ mode: 'hang', watchdogMs: 24 * 3600 * 1000 })
    vi.useFakeTimers()
    let stop = false
    let done
    judgeOffThread(TABLE, { cancelled: () => stop }).then((v) => { done = v })
    await vi.advanceTimersByTimeAsync(5000)
    expect(done, 'not stopped: still waiting on the door').toBeUndefined()
    stop = true
    await vi.advanceTimersByTimeAsync(300)
    await settle()
    expect(done).toEqual({ unchecked: true, because: UNCHECKED_BECAUSE.STOPPED })
    expect(made[0].terminated, 'the build nobody reads was stopped').toBe(true)
    expect(svc.stats().held + reports.stats().held).toBe(0)
  }, 180_000)

  it('the check hands `cancelled` to the workers\' check, and a stopped check is not a verdict about the script', async () => {
    useWorkers({ mode: 'hang', watchdogMs: 24 * 3600 * 1000 })
    vi.useFakeTimers()
    let stop = false
    let v
    checkScript(TABLE, { load: engine, cancelled: () => stop }).then((x) => { v = x })
    await vi.advanceTimersByTimeAsync(2000)
    expect(v).toBeUndefined()
    stop = true
    await vi.advanceTimersByTimeAsync(300)
    await settle()
    expect(v && v.state).toBe(UNCHECKED_STATE)
    expect(v.errors).toEqual([])
  }, 180_000)
})

// ─── ⭐⭐ TRAIN e96 x #2568 (the door heartbeat), coordinator ruling 2026-11-23 ───────────────────────────────────────
// While (c) waits on the door, the door's worker may go SILENT (its first word, then nothing for the silence bound:
// `pine:door-silent`) or never LOAD (no word in the load bound: `pine:door-worker`, "it did not start within 5
// minutes"). Either is a fault of the window: (c)'s plain "This script could not be checked here", nothing kept and
// nothing sent to the assistant, never a refusal of the script. Mutant: ci/mutants/e96-train-integration.json TJ11.
describe('⭐⭐ (train e96 x #2568) a door worker that goes silent or never loads while the check waits: "could not be checked here"', () => {
  const plain = { runs: false, attaches: false, state: UNCHECKED_STATE, lane: 'host', headline: UNCHECKED_HEADLINE,
    withheld: [], notes: [], errors: [] }
  /** The newest door worker says its first word (a start beat for the job it holds): it has loaded. */
  const firstWord = () => {
    const w = made[made.length - 1]
    const job = w.jobs[w.jobs.length - 1]
    w.onmessage({ data: { type: BEAT, id: job ? job.id : null, ms: 0 } })
  }

  it('silent: its first word, then nothing for the silence bound (pine:door-silent)', async () => {
    useWorkers({ mode: 'hang' })
    vi.useFakeTimers()
    let judged
    judgeOffThread(TABLE).then((v) => { judged = v })
    await vi.advanceTimersByTimeAsync(0)
    expect(made.length, 'the door worker holds the build').toBe(1)
    firstWord()
    await vi.advanceTimersByTimeAsync(MEMBER_DOOR_SILENCE_MS - 1)
    expect(judged, 'a moment inside the silence bound: still waiting').toBeUndefined()
    await vi.advanceTimersByTimeAsync(1)
    await settle()
    expect(svc.stats().silent, 'the silence bound stopped it').toBe(1)
    expect(judged).toEqual({ unchecked: true, because: UNCHECKED_BECAUSE.DOOR_WORKER })
    expect(onMain(), 'nothing computed on the page in its place').toEqual(NOTHING_ON_MAIN)
    // and through the check: the plain line, nothing for the assistant to repair
    let v
    checkScript(TABLE, { load: engine }).then((x) => { v = x })
    await vi.advanceTimersByTimeAsync(0)
    firstWord()
    await vi.advanceTimersByTimeAsync(MEMBER_DOOR_SILENCE_MS + 5)
    await settle()
    expect(v).toEqual(plain)
    expect(refusalOf(TABLE, v, 1), 'nothing goes back to the assistant').toBe(null)
    expect(scriptNeedsFixing({ runs: v.runs, state: v.state })).toBe(false)
    expect(MEMBER_DOOR_SILENT_GUARD).toBe('pine:door-silent')
  }, 180_000)

  it('never loads: no word within the load bound (pine:door-worker, "it did not start")', async () => {
    useWorkers({ mode: 'hang' })
    vi.useFakeTimers()
    let judged
    judgeOffThread(TABLE).then((v) => { judged = v })
    await vi.advanceTimersByTimeAsync(MEMBER_DOOR_SILENCE_MS * 2)
    expect(judged, 'a worker still loading is not silent').toBeUndefined()
    await vi.advanceTimersByTimeAsync(MEMBER_DOOR_LOAD_MS)
    await settle()
    expect(svc.stats()).toMatchObject({ unloaded: 1, silent: 0 })
    expect(judged).toEqual({ unchecked: true, because: UNCHECKED_BECAUSE.DOOR_WORKER })
    let v
    checkScript(TABLE, { load: engine }).then((x) => { v = x })
    await vi.advanceTimersByTimeAsync(MEMBER_DOOR_LOAD_MS + 5)
    await settle()
    expect(v).toEqual(plain)
    expect(refusalOf(TABLE, v, 1), 'nothing goes back to the assistant').toBe(null)
    expect(MEMBER_DOOR_WORKER_GUARD).toBe('pine:door-worker')
    expect(onMain()).toEqual(NOTHING_ON_MAIN)
  }, 180_000)
})
