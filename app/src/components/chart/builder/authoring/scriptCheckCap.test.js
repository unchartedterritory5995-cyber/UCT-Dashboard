// app/src/components/chart/builder/authoring/scriptCheckCap.test.js
//
// ─── ⭐⭐ (engine 94, coordinator ruling 2026-11-22, interim) — THE AUTHORING CHECK'S MAIN-THREAD CAP ───────────
//
// The deterministic budgets took the translator's 10 s window away; every member path that translates runs in the
// member door's workers, bounded by the step budget, with no wall window but the last-resort stops sized in minutes.
// The authoring script check (`scriptAnswer.js::checkScript`) still runs on the page's main thread, so it passes the
// door API a short cap of its own (`doorDeadline.js::withMainThreadCap`, `SCRIPT_CHECK_CAP_MS`).
//   1. Past the cap the check is REFUSED BY NAME ("This script could not be checked here" and the cap's line): nothing
//      of the check is kept (never a part of it, never a document built while the cap ran out) and nothing goes back
//      to the assistant. Control: the same check on a clock that stands still is the uncapped check's verdict.
//   2. The cap is the authoring check's alone: the door's worker job and the report's worker job open no cap, and the
//      only wall window either opens is the door's own last-resort deadline. Control: the check opens exactly one cap.
//   3. The cap never outlives the check: no window stays open after it, capped or not.
// Mutants: ci/mutants/script-check-cap.json. (The worker rail runs last: it resets the module graph.)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

// every cap opened and every door window opened, in whichever module graph opened it (a stand-in worker's fresh graph
// re-runs this factory: the arrays are hoisted, so both graphs write to them)
const SEEN = vi.hoisted(() => ({ caps: [], windows: [] }))
vi.mock('../../engine/ast/doorDeadline.js', async (importOriginal) => {
  const m = await importOriginal()
  return {
    ...m,
    openDoorWindow: (budgetMs, clock) => { SEEN.windows.push(budgetMs); return m.openDoorWindow(budgetMs, clock) },
    withMainThreadCap: (capMs, fn, clock) => { SEEN.caps.push(capMs); return m.withMainThreadCap(capMs, fn, clock) },
  }
})

import { checkScript, verdictFrom, refusalOf, scriptNeedsFixing, SCRIPT_CHECK_CAP_MS, SCRIPT_CHECK_CAPPED_LINE,
  UNCHECKED_HEADLINE, UNCHECKED_STATE, SCRIPT_CHECK_ID } from './scriptAnswer'
import { inspectSource } from '../PineBox'
import { memberPaneDefinition, MEMBER_PANE_DEF_PREFIX, MEMBER_DOOR_BUDGET_MS } from '../memberPane/memberPaneDefinition'
import { editorStatus } from '../editorStatus'
import { memberDoorImage } from '../memberPane/memberDoorImage'
import { MEMBER_DOOR_JOB, INSPECT_JOB } from '../memberPane/memberDoorProtocol'
import { doorWindowOpen, withMainThreadCap, checkDoorDeadline } from '../../engine/ast/doorDeadline.js'
import { importWorkerCore } from '../../../../testing/builder/memberDoor.testkit.js'

const EXAMPLES = path.resolve(process.cwd(), 'src/components/chart/supportLoop/assistantExamples')
const TABLE = fs.readFileSync(path.join(EXAMPLES, 'table-summary.pine'), 'utf8')
// the paste check alone (no chart run): what the cap bounds
const engine = async () => ({ inspectSource, memberPaneDefinition, editorStatus, prepare: async () => {} })
/** A wall clock whose every read is 11 s after the last: any cap of 10 s has run out by its second read. */
const racing = () => { let t = 0; return () => (t += 11000) }
const still = () => 1000

beforeEach(() => {
  SEEN.caps.length = 0
  SEEN.windows.length = 0
  vi.stubEnv('VITE_PINE_MEMBER_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
})
afterEach(() => { vi.unstubAllEnvs() })

describe('⭐⭐ the door API\'s cap (`withMainThreadCap`): an expired cap answers capped, with no value, and closes', () => {
  it('a call past the cap is capped with NO value, even when no limb read the clock (the call\'s own length)', () => {
    const r = withMainThreadCap(10000, () => ({ built: true }), racing())
    expect(r.capped).toBe(true)
    expect(r.value).toBe(null)
    expect(doorWindowOpen()).toBe(false)
    // control: inside the cap the value is the call's
    expect(withMainThreadCap(10000, () => ({ built: true }), still)).toEqual({ value: { built: true }, capped: false, elapsedMs: 0 })
  })

  it('a limb that finds the cap passed trips it: the throw after the trip is the cap\'s, never the caller\'s', () => {
    const r = withMainThreadCap(10000, () => { checkDoorDeadline(); return { built: true } }, racing())
    expect(r).toEqual({ value: null, capped: true, elapsedMs: expect.any(Number) })
    expect(doorWindowOpen()).toBe(false)
    // control: a throw that is not the cap's is the caller's (and the window still closes)
    expect(() => withMainThreadCap(10000, () => { throw new Error('mine') }, still)).toThrow('mine')
    expect(doorWindowOpen()).toBe(false)
  })
})

describe('⭐⭐ the authoring check carries a main-thread cap, and past it the check is refused by name', () => {
  it('the cap is the translator\'s old window, 10 s, and the line says it', () => {
    expect(SCRIPT_CHECK_CAP_MS).toBe(10000)
    expect(SCRIPT_CHECK_CAPPED_LINE).toMatch(/^Checking it here took longer than 10 seconds,/)
    expect(UNCHECKED_HEADLINE).toBe('This script could not be checked here')
  })

  it('a check past its cap is REFUSED BY NAME: nothing of the check kept, nothing sent back to the assistant', async () => {
    const v = await checkScript(TABLE, { load: engine, capClock: racing() })
    expect(SEEN.caps, 'the check opened its cap').toEqual([SCRIPT_CHECK_CAP_MS])
    expect(v).toEqual({ runs: false, attaches: false, state: UNCHECKED_STATE, lane: 'host', headline: UNCHECKED_HEADLINE,
      withheld: [], notes: [SCRIPT_CHECK_CAPPED_LINE], errors: [], capped: true })
    // a cap is a fact about this window, never about the script: no repair is asked, and the button offers the editor
    expect(refusalOf(TABLE, v, 1)).toBe(null)
    expect(scriptNeedsFixing({ runs: v.runs, state: v.state })).toBe(false)
    expect(doorWindowOpen(), 'the cap never outlives the check').toBe(false)
  }, 120_000)

  it('control: the same check on a clock that stands still is the uncapped check\'s own verdict', async () => {
    const v = await checkScript(TABLE, { load: engine, capClock: still })
    const report = inspectSource(TABLE, 'pine')
    const pane = memberPaneDefinition({ source: TABLE, id: SCRIPT_CHECK_ID, name: 'script' })
    expect(v).toEqual(verdictFrom(editorStatus({ report, pane, savedRow: null, inspectedSource: TABLE }), pane))
    expect(v.runs).toBe(true)
    expect(v.capped).toBeUndefined()
    expect(doorWindowOpen()).toBe(false)
  }, 120_000)

  it('the default check opens its cap on the wall clock (no clock handed in), and closes it', async () => {
    await checkScript(TABLE, { load: engine })
    expect(SEEN.caps).toEqual([SCRIPT_CHECK_CAP_MS])
    expect(doorWindowOpen()).toBe(false)
  }, 120_000)
})

describe('⭐⭐ the cap is the authoring check\'s alone: a worker path never runs under a wall window', () => {
  it('the door\'s worker job and the report\'s worker job open no cap; the door\'s own deadline is the only window', async () => {
    // control first, in the page's graph: the authoring check opens exactly one cap, around the door's own window
    await checkScript(TABLE, { load: engine, capClock: still })
    expect(SEEN.caps, 'control: the authoring check opens its cap').toEqual([SCRIPT_CHECK_CAP_MS])
    expect(SEEN.windows, 'control: the spy sees the door\'s own window').toContain(MEMBER_DOOR_BUDGET_MS)
    const core = await importWorkerCore(vi)
    SEEN.caps.length = 0
    SEEN.windows.length = 0
    const door = structuredClone(core.answerMemberDoorJob(structuredClone(
      { kind: MEMBER_DOOR_JOB, id: 1, args: { source: TABLE, id: MEMBER_PANE_DEF_PREFIX }, image: memberDoorImage() })))
    const report = structuredClone(core.answerInspectJob(structuredClone(
      { kind: INSPECT_JOB, id: 2, key: 'R2', version: 1, args: { source: TABLE, dialect: 'pine' }, image: memberDoorImage() })))
    expect(door.ok, 'the door\'s worker answered').toBe(true)
    expect(report.ok, 'the report\'s worker answered').toBe(true)
    expect(SEEN.caps, 'no worker job opens a main-thread cap').toEqual([])
    // the spy sees windows (the door opens its own), and every one is the door's last-resort deadline, never a cap
    expect(SEEN.windows.length).toBeGreaterThan(0)
    expect([...new Set(SEEN.windows)]).toEqual([MEMBER_DOOR_BUDGET_MS])
    expect(Math.min(...SEEN.windows)).toBeGreaterThan(SCRIPT_CHECK_CAP_MS)
  }, 180_000)

})
