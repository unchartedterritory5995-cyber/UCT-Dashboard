// @vitest-environment node
// app/src/components/chart/builder/memberPane/doorHeartbeat.test.js
//
// ─── ⭐⭐ e96 — THE DOOR HEARTBEAT: A SLOW CHECK BEATS, A HUNG ONE IS STOPPED (coordinator ruling 2026-11-23) ────────
//
// Engine 94 moved a paste's build and PasteBox's report into the member door's Web Worker and replaced the 10 s cut
// with deterministic budgets, so the page's watchdog is now 25.5 minutes. A worker that HANGS would hold a member on
// "Checking your script..." that long; a worker that is merely SLOW is legitimate. So:
//   1. THE WORKER BEATS FROM ITS OWN STEPS (`engine/workPulse.js`): the translator's step budget (`countCallStep`),
//      the door window's walks (`doorDeadlinePassed`) and the VM's bars each drive the pulse, and the worker's handler
//      posts a beat as a job starts and at least every `MEMBER_DOOR_HEARTBEAT_MS` while it works (both jobs: the chart
//      door's build and PasteBox's report). Each site, removed, turns its own rail red.
//   2. THE PAGE'S SILENCE BOUND (`memberDoorAsync.js`): a worker that owes an answer and has said nothing for 30 s is
//      dead: the build refused by name (`pine:door-silent`, ONE sentence), the worker terminated and replaced, every
//      ask it owed answered, nothing left spinning; a SLOW worker that beats is never stopped by it (the 25-minute
//      deadline's watchdog stays the budget for real work).
// The clocks are counted, never read: a pulse clock that moves a fixed step per read, and fake timers on the page.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { translatePine, withDoorDeadline } from '../../engine/ast/pine'
import { doorTick } from '../../engine/ast/doorDeadline'
import { setWorkPulse, WORK_PULSE_PERIOD } from '../../engine/workPulse'
import { buildRuntimeIr } from '../../engine/ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../../engine/runtime/lowerIr.js'
import { execute } from '../../engine/runtime/vm.js'
import {
  createMemberDoorService, createKeyedWorkerService, doorSilentSentence, MEMBER_DOOR_SILENT_GUARD, DOOR_WORKER_STOPPED,
  MEMBER_DOOR_WATCHDOG_MS,
} from './memberDoorAsync'
import { MEMBER_PANE_DEF_PREFIX, DOOR_TIMED_OUT } from './memberPaneDefinition'
import { memberDoorImage } from './memberDoorImage'
import { MEMBER_DOOR_JOB, INSPECT_JOB, BEAT, MEMBER_DOOR_HEARTBEAT_MS } from './memberDoorProtocol'
import { INSPECT_WORKER_JOB, INSPECT_LIBRARY_WORKER_JOB } from '../inspectAsync'
import { importWorkerCore } from '../../../../testing/builder/memberDoor.testkit.js'

const REPO = path.resolve(__dirname, '../../../../../..')
const member = (n) => fs.readFileSync(path.join(REPO, 'tests/fixtures/member', n), 'utf8')
const CLOUDS = member('uncharted-clouds.pine')
const RVOL = fs.readFileSync(path.join(REPO, 'corpus/committed', 'rvol__05fcd9e160.pine'), 'utf8')

/** A pulse clock that moves `stepMs` per read (so "time" is a count of the pulse's own reads), with the count. */
const steppingClock = (stepMs) => {
  let t = 0
  const f = () => { f.reads += 1; t += stepMs; return t }
  f.reads = 0
  return f
}

/** Runs `fn` with a pulse installed that beats on every read of its clock; returns the beats and the clock's reads. */
function pulsed(fn) {
  const beats = []
  const clock = steppingClock(MEMBER_DOOR_HEARTBEAT_MS)
  setWorkPulse((t) => beats.push(t), { everyMs: MEMBER_DOOR_HEARTBEAT_MS, clock })
  try { fn() } finally { setWorkPulse(null) }
  return { beats: beats.length, reads: clock.reads }
}

beforeEach(() => {
  vi.stubEnv('VITE_PINE_MEMBER_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
  setWorkPulse(null)
})

describe('1. the worker beats from its own steps', () => {
  it('⭐⭐ the translator\'s step loop (`countCallStep`): a translation beats once per pulse period of its steps', () => {
    const got = pulsed(() => translatePine(CLOUDS))
    // the installer reads the clock once; every later read is a step-loop read, and each one beats (5 s per read)
    expect(got.reads - 1, 'the step loop read the pulse clock').toBeGreaterThan(1)
    expect(got.beats, 'and beat at each read').toBe(got.reads - 1)
  }, 120000)

  it('⭐ the door window\'s walks (`doorDeadlinePassed`): a walk with no resolution step in it beats too', () => {
    // three pulse periods of a walk's ticks inside a door window, on a door clock that never moves (no trip), no Resolver
    const got = pulsed(() => withDoorDeadline(60000, () => { for (let i = 0; i < 3 * WORK_PULSE_PERIOD; i += 1) doorTick() }, () => 0))
    expect(got.beats, 'one beat per sampled clock read of the walk').toBe(3)
    // ⛔ THE CONTROL: the same walk with no door window open reads no clock and beats nothing
    expect(pulsed(() => { for (let i = 0; i < 3 * WORK_PULSE_PERIOD; i += 1) doorTick() }).beats).toBe(0)
  })

  it('⭐ the VM\'s bars (`execute`): a probe run beats from its instruction charge', () => {
    const n = 2000
    const bars = Array.from({ length: n }, (_, i) => { const c = 100 + Math.sin(i / 7); return { t: 1500000000 + i * 86400, o: c, h: c + 1, l: c - 1, c, v: 1000 } })
    const src = '//@version=6\nindicator("hb")\ns = 0.0\nfor i = 0 to 20\n    s := s + close[i] * i\nplot(s)\n'
    const built = buildRuntimeIr(src, { bars, inputs: {}, objectsInRun: true, tf: 'D', basePeriod: 'D' })
    expect(built.ok, built.refusal && built.refusal.message).toBe(true)
    const p = lowerIrProgram(built.ir)
    const ctx = { bars: n, series: ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(bars.map((b) => b[k]))),
      columns: p.columns, confirmed: true, barTimes: bars.map((b) => b.t), requestBars: {} }
    let instructions = 0
    const got = pulsed(() => { instructions = execute(p, ctx).budget.counts.TOTAL_INSTRUCTIONS })
    expect(instructions, 'the run is long enough to cross pulse periods').toBeGreaterThan(40 * WORK_PULSE_PERIOD)
    // a read each time a bar's charge crosses a period (a bar is charged whole), and a beat at each read
    expect(got.beats, 'the run beat from its bars').toBeGreaterThan(10)
    expect(got.beats).toBe(got.reads - 1)
  })

  it('⭐⭐ the worker\'s handler: both jobs beat as they start, then from their steps, each beat naming its job', async () => {
    const core = await importWorkerCore(vi)
    const posted = []
    // this worker's clock moves 2.5 s per read: a beat is due on every 2nd read of the pulse
    const clock = steppingClock(2500)
    core.setPagePost((m) => posted.push(structuredClone(m)), { clock, everyMs: MEMBER_DOOR_HEARTBEAT_MS })
    try {
      const jobs = [
        { kind: MEMBER_DOOR_JOB, id: 41, key: 'D41', version: 1, args: { source: CLOUDS, id: MEMBER_PANE_DEF_PREFIX } },
        { kind: INSPECT_JOB, id: 42, key: 'R42', version: 1, args: { source: CLOUDS, dialect: 'auto' } },
      ]
      for (const job of jobs) {
        posted.length = 0
        const reply = core.answerJobOfKind(structuredClone({ ...job, image: memberDoorImage() }))
        expect(reply.ok, `job ${job.id} answered`).toBe(true)
        const beats = posted.filter((m) => m.type === BEAT)
        expect(beats[0], `job ${job.id}: a beat as it starts`).toEqual({ type: BEAT, id: job.id, ms: 0 })
        expect(beats.length, `job ${job.id}: and beats from its steps while it works`).toBeGreaterThan(2)
        expect(beats.every((b) => b.id === job.id), 'every beat names the job').toBe(true)
        // at least every 5 s of the worker's clock, never more often
        const gaps = beats.slice(1).map((b, i) => b.ms - beats[i].ms)
        expect(Math.min(...gaps), 'never more often than the heartbeat').toBeGreaterThanOrEqual(MEMBER_DOOR_HEARTBEAT_MS)
      }
    } finally {
      core.setPagePost(null)
    }
  }, 240000)
})

// ─── the page: a stand-in worker the rail speaks for, and the page's fake timers ───────────────────────────────────────
class ScriptedWorker {
  constructor() {
    this.jobs = []
    this.messages = []
    this.terminated = false
    this.onmessage = null
    this.onerror = null
    this.onmessageerror = null
  }
  postMessage(msg) {
    if (this.terminated) return
    if (msg && typeof msg.kind === 'string' && msg.kind !== 'peer') this.jobs.push(msg)
    else this.messages.push(msg)
  }
  say(data) { if (!this.terminated && this.onmessage) this.onmessage({ data }) }
  beat() { const j = this.jobs[this.jobs.length - 1]; this.say({ type: BEAT, id: j ? j.id : null, ms: 0 }) }
  answerDoor(answer) {
    const j = this.jobs[this.jobs.length - 1]
    this.say({ id: j.id, ok: true, answer, hidden: [], lost: 0, consults: [], warmed: false, consultPending: false, ms: 1 })
  }
  terminate() { this.terminated = true }
}
const scripted = () => {
  const made = []
  return { made, factory: () => { const w = new ScriptedWorker(); made.push(w); return w } }
}
const DRAWN = { ok: true, definition: { id: 'x', compute: { kind: 'ast' } }, reason: null, guard: null, rows: [], notes: [] }

/** Advances the page's fake clock by `ms`, the worker beating every `everyMs` meanwhile (`w` null: silent). */
function run(ms, w = null, everyMs = MEMBER_DOOR_HEARTBEAT_MS) {
  for (let left = ms; left > 0; left -= everyMs) {
    vi.advanceTimersByTime(Math.min(everyMs, left))
    if (w && left > everyMs) w.beat()
  }
}

describe('2. the page: a silent worker is dead within 30 s; a slow worker that beats is never stopped by it', () => {
  it('⭐⭐ a silent door worker: refused by name at 30 s (not a moment before), terminated and replaced', () => {
    vi.useFakeTimers()
    const { made, factory } = scripted()
    const svc = createMemberDoorService({ factory })
    const got = []
    const off = svc.subscribe({ source: RVOL }, (l) => got.push(l))
    expect(made).toHaveLength(1)
    vi.advanceTimersByTime(29999)
    expect(got, 'nothing yet: a worker is given 30 s to say anything').toHaveLength(0)
    expect(made[0].terminated).toBe(false)
    vi.advanceTimersByTime(1)
    expect(got, 'at 30 s of silence the build is refused').toHaveLength(1)
    expect(got[0].built.ok).toBe(false)
    expect(got[0].built.guard).toBe(MEMBER_DOOR_SILENT_GUARD)
    expect(got[0].built.reason, 'the one sentence').toBe(doorSilentSentence())
    expect(got[0].built.reason).toContain('30 seconds')
    expect(got[0].built[DOOR_WORKER_STOPPED], 'a fact about the check, never the script').toBe(true)
    expect(made[0].terminated, 'the silent worker is terminated').toBe(true)
    expect(made, 'and replaced').toHaveLength(2)
    expect(made[1].terminated).toBe(false)
    expect(made[1].jobs, 'nothing is asked of the replacement until someone asks').toHaveLength(0)
    expect(svc.stats()).toMatchObject({ silent: 1, watchdog: 0, busy: false, listening: false })
    // ⛔ nothing left spinning: no build owed, no timer armed
    expect(svc.sinceOf(svc.keyOf({ source: RVOL })), 'the check is over').toBe(null)
    off()
    svc.dispose()
  })

  it('⭐⭐ a SLOW worker that beats is never stopped by the bound: 10 minutes of beats, then its answer lands', () => {
    vi.useFakeTimers()
    const { made, factory } = scripted()
    const svc = createMemberDoorService({ factory })
    const got = []
    const off = svc.subscribe({ source: RVOL }, (l) => got.push(l))
    run(10 * 60 * 1000, made[0])
    expect(got, 'still working').toHaveLength(0)
    expect(made[0].terminated, 'a worker that beats is alive').toBe(false)
    expect(svc.stats().beats).toBeGreaterThan(100)
    made[0].answerDoor(DRAWN)
    expect(got).toHaveLength(1)
    expect(got[0].built).toEqual(DRAWN)
    expect(svc.stats()).toMatchObject({ silent: 0, watchdog: 0, answered: 1, listening: false })
    expect(made).toHaveLength(1)
    off()
    svc.dispose()
  })

  it('a worker that beats and THEN goes quiet: refused 30 s after its last word, not 30 s after the job', () => {
    vi.useFakeTimers()
    const { made, factory } = scripted()
    const svc = createMemberDoorService({ factory })
    const got = []
    const off = svc.subscribe({ source: RVOL }, (l) => got.push(l))
    run(2 * 60 * 1000, made[0])
    made[0].beat()                       // its last word, at 2:00
    vi.advanceTimersByTime(29999)
    expect(got).toHaveLength(0)
    vi.advanceTimersByTime(1)
    expect(got).toHaveLength(1)
    expect(got[0].built.guard).toBe(MEMBER_DOOR_SILENT_GUARD)
    off()
    svc.dispose()
  })

  it('⭐ the 25-minute deadline stays the budget for real work: a worker that beats past it is stopped by the watchdog', () => {
    vi.useFakeTimers()
    const { made, factory } = scripted()
    const svc = createMemberDoorService({ factory })
    const got = []
    const off = svc.subscribe({ source: RVOL }, (l) => got.push(l))
    run(MEMBER_DOOR_WATCHDOG_MS - 5000, made[0])
    expect(got).toHaveLength(0)
    run(10000, made[0])
    expect(got).toHaveLength(1)
    expect(got[0].built.guard).toBe('pine:timeout')
    expect(got[0].built[DOOR_TIMED_OUT]).toBe(true)
    expect(svc.stats()).toMatchObject({ watchdog: 1, silent: 0 })
    off()
    svc.dispose()
  })

  it('⭐⭐ PasteBox\'s report: a silent worker\'s report is the engine fault, named, in the same sentence; replaced', () => {
    vi.useFakeTimers()
    const { made, factory } = scripted()
    const svc = createKeyedWorkerService({ job: INSPECT_WORKER_JOB, factory })
    const got = []
    const off = svc.subscribe({ source: RVOL, dialect: 'auto' }, (l) => got.push(l))
    vi.advanceTimersByTime(29999)
    expect(got).toHaveLength(0)
    vi.advanceTimersByTime(1)
    expect(got).toHaveLength(1)
    const { report } = got[0]
    expect(report.ok).toBe(false)
    expect(report.error, 'nothing to save: the controlled error report').toBe(doorSilentSentence())
    expect(report.refusal.guard).toBe(MEMBER_DOOR_SILENT_GUARD)
    expect(report.refusal.message).toBe(doorSilentSentence())
    expect(made[0].terminated).toBe(true)
    expect(made).toHaveLength(2)
    off()
    svc.dispose()
  })

  it('the several-scripts summary: a silent worker is said in the same sentence', () => {
    vi.useFakeTimers()
    const { factory } = scripted()
    const svc = createKeyedWorkerService({ job: INSPECT_LIBRARY_WORKER_JOB, factory })
    const got = []
    const off = svc.subscribe({ scripts: [RVOL, RVOL] }, (l) => got.push(l))
    vi.advanceTimersByTime(30000)
    expect(got).toHaveLength(1)
    expect(got[0].report).toBe(null)
    expect(got[0].error.message).toBe(doorSilentSentence())
    off()
    svc.dispose()
  })

  it('an ask the silent worker owed is answered (null: its caller falls back), never left waiting', async () => {
    vi.useFakeTimers()
    const { made, factory } = scripted()
    const svc = createKeyedWorkerService({ job: INSPECT_WORKER_JOB, factory })
    let answer = 'pending'
    svc.ask({ type: 'objects-ask', reportKey: 'k' }).then((a) => { answer = a })
    expect(made).toHaveLength(1)
    vi.advanceTimersByTime(29999)
    await Promise.resolve()
    expect(answer).toBe('pending')
    vi.advanceTimersByTime(1)
    await Promise.resolve()
    expect(answer).toBe(null)
    expect(made[0].terminated).toBe(true)
    expect(svc.stats().silent).toBe(1)
    svc.dispose()
  })

  it('the CONTROL: an idle worker owes nothing, so its silence is no death', () => {
    vi.useFakeTimers()
    const { made, factory } = scripted()
    const svc = createMemberDoorService({ factory })
    const got = []
    const off = svc.subscribe({ source: RVOL }, (l) => got.push(l))
    made[0].answerDoor(DRAWN)
    expect(got).toHaveLength(1)
    vi.advanceTimersByTime(5 * 60 * 1000)
    expect(svc.stats().silent).toBe(0)
    expect(made[0].terminated).toBe(false)
    off()
    svc.dispose()
  })
})

describe('3. how long a check has run: the service keeps one start per build', () => {
  it('sinceOf: the page clock when the build began, kept through the build, cleared when it lands', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-23T15:00:00Z'))
    const { made, factory } = scripted()
    const svc = createMemberDoorService({ factory })
    const key = svc.keyOf({ source: RVOL })
    const t0 = Date.now()
    const off = svc.subscribe({ source: RVOL }, () => {})
    expect(svc.sinceOf(key)).toBe(t0)
    run(42000, made[0])
    expect(svc.sinceOf(key), 'one start, however long it runs').toBe(t0)
    // a second reader of the same build reads the same start
    const off2 = svc.subscribe({ source: RVOL, id: MEMBER_PANE_DEF_PREFIX }, () => {})
    expect(svc.sinceOf(key)).toBe(t0)
    made[0].answerDoor(DRAWN)
    expect(svc.sinceOf(key)).toBe(null)
    off()
    off2()
    svc.dispose()
  })
})
