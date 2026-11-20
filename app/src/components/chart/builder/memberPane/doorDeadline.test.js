// app/src/components/chart/builder/memberPane/doorDeadline.test.js
//
// ⭐⭐ THE DOOR DEADLINE (door-deadline unit, 2026-11-20; NUMBER PENDING) — ONE CLOCK FOR A WHOLE MEMBER-DOOR CALL.
// `memberPaneDefinition` runs many translations in a row on the page's main thread, and every bound the translator
// has was per translation: three public scripts held a member's tab for minutes before they were
// refused by name (`engine/ast/doorDeadline.js`). These rails feed SYNTHETIC slow scripts (licence-held scripts are
// never committed): a chain whose every line doubles the tree it reads (`a1 = a0 + a0[1]`, ...) is served, slowly,
// and its cost is spread over the door's several translations.
//   * wall clock: the refusal arrives within the deadline plus a slack, by name, with the door's sentence;
//   * a clock that advances per read (time = the door's own checks, the same on every machine): the deadline is ONE
//     for the whole call, so a script whose every translation fits a fresh budget is still stopped;
//   * a fast script is unaffected (the same answer, byte for byte, as with a deadline that never comes), a trip
//     never leaks into the next call, and a saved script whose re-check ran out of time keeps its picture.
import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  memberPaneDefinition, __setMemberDoorBudgetForTests, doorTimeoutSentence, MEMBER_DOOR_BUDGET_MS, DOOR_TIMED_OUT,
} from './memberPaneDefinition'
import { retranslateRow } from './savedScriptUpgrade'
import { translatePine, translateBudgetExpired, withDoorDeadline } from '../../engine/ast/pine'
import { doorWindowOpen, doorTick, DoorDeadlineError } from '../../engine/ast/doorDeadline'

const LF = String.fromCharCode(10)
/** `depth` lines, each doubling the tree the next one reads; `input` adds a knob, so the door translates more than
 *  once (the declare-every-input probe, then the declared translation). */
function chain(depth, { input = false } = {}) {
  const lines = ['//@version=5', 'indicator("door deadline rail")']
  if (input) lines.push('k = input.float(1.0, "k")', 'a0 = close * k')
  else lines.push('a0 = close')
  for (let i = 1; i <= depth; i += 1) lines.push(`a${i} = a${i - 1} + a${i - 1}[1]`)
  lines.push(`plot(a${depth})`)
  return lines.join(LF)
}
const FAST = ['//@version=5', 'indicator("fast")', 'len = input.int(20, "Length")', 'plot(ta.sma(close, len))'].join(LF)
const memberView = () => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '0')
}
const timed = (fn) => {
  const t0 = performance.now()
  const value = fn()
  return { value, ms: performance.now() - t0 }
}
/** A clock that advances one unit per read: "time" is how many checks the door made. */
const counting = () => {
  const f = () => { f.reads += 1; return f.reads }
  f.reads = 0
  return f
}

afterEach(() => {
  __setMemberDoorBudgetForTests(null)
  vi.unstubAllEnvs()
})

describe('the door deadline, on the wall clock', () => {
  // a slow synthetic: its door call runs for seconds (measured locally ~19 s at depth 17, served when let finish)
  const SLOW = chain(17)
  const BUDGET_MS = 400
  // the work the door cannot interrupt between two checks (one jsep parse of the printed formula, measured ~0.3 s at
  // this depth on the dev PC) on a runner up to ~3x slower, plus the call's own overhead
  const SLACK_MS = 1500

  it('refuses a slow script BY NAME within the deadline plus the slack, with the door sentence', () => {
    memberView()
    __setMemberDoorBudgetForTests(BUDGET_MS)
    const { value: d, ms } = timed(() => memberPaneDefinition({ source: SLOW, id: 'u_door-deadline' }))
    expect(d.ok).toBe(false)
    expect(d.guard).toBe('pine:timeout')
    expect(d.reason).toBe(doorTimeoutSentence(BUDGET_MS))
    expect(d[DOOR_TIMED_OUT]).toBe(true)
    expect(d.definition).toBe(null)
    // it ran until the deadline (it was not refused for another reason), and stopped there
    expect(ms).toBeGreaterThanOrEqual(BUDGET_MS)
    expect(ms).toBeLessThan(BUDGET_MS + SLACK_MS)
  }, 120000)

  it('the sentence is member-readable and names the budget in seconds', () => {
    expect(doorTimeoutSentence(30000)).toMatch(/^this script is not drawn: checking it took longer than 30 seconds/)
    expect(doorTimeoutSentence(30000)).toMatch(/not a mistake in the script\.$/)
    expect(doorTimeoutSentence(300000)).toMatch(/^this script is not drawn: checking it took longer than 5 minutes,/)
    expect(doorTimeoutSentence()).toBe(doorTimeoutSentence(MEMBER_DOOR_BUDGET_MS))
    expect(Number.isInteger(MEMBER_DOOR_BUDGET_MS) && MEMBER_DOOR_BUDGET_MS >= 10000).toBe(true)
  })

  it('a trip never leaks: the window is closed after the call and the next script is served', () => {
    memberView()
    __setMemberDoorBudgetForTests(BUDGET_MS)
    const tripped = memberPaneDefinition({ source: SLOW, id: 'u_door-deadline' })
    expect(tripped[DOOR_TIMED_OUT]).toBe(true)
    expect(doorWindowOpen()).toBe(false)
    expect(translateBudgetExpired()).toBe(false)
    expect(() => doorTick()).not.toThrow()
    __setMemberDoorBudgetForTests(null)
    const next = memberPaneDefinition({ source: FAST, id: 'u_door-fast' })
    expect(next.ok, next.reason).toBe(true)
    expect(translatePine(FAST, { strict: true }).ok).toBe(true)
  }, 120000)
})

describe('the door deadline reaches the walk no translation budget bounded (a growing window fold)', () => {
  // ⭐ a window an `unshift` fills and a `while ... pop` bounds, reduced: its fold is built by copying, and the copy
  // doubles each slot (the running value appears in both arms), so its time grows as 2^slots with no Resolver step
  // and no budget in it (`pine.js::tokensTicking`). Measured on a public script: most of a door call of minutes.
  const WINDOW = [
    '//@version=5', 'indicator("door deadline window rail")',
    'var w = array.new_float()', 'if close > open', '    w.unshift(close - open)',
    'while w.size() > 19', '    w.pop()', 'plot(w.avg())',
  ].join(LF)

  it('a doubling window fold is stopped at the deadline, by name, within the slack', () => {
    memberView()
    __setMemberDoorBudgetForTests(400)
    const { value: d, ms } = timed(() => memberPaneDefinition({ source: WINDOW, id: 'u_door-window' }))
    expect(d.ok).toBe(false)
    expect(d.guard).toBe('pine:timeout')
    expect(d.reason).toBe(doorTimeoutSentence(400))
    expect(ms).toBeLessThan(400 + 1500)
  }, 180000)
})

describe('the door deadline is ONE clock for the whole call (a clock that advances per read)', () => {
  // ⭐ CALIBRATED ON ITSELF: the call is run once with a deadline that never comes, which counts its checks and proves
  // the script is served; then with half that many. A deadline that restarted with each translation would let every
  // translation of this script finish (each holds well under half the call's checks) and the script would be served.
  const SCRIPT = chain(12, { input: true })

  it('a script spread over several translations is stopped at the call deadline, within a few checks', () => {
    memberView()
    const free = counting()
    __setMemberDoorBudgetForTests(1e12, free)
    const whole = memberPaneDefinition({ source: SCRIPT, id: 'u_door-steps' })
    expect(whole.ok, whole.reason).toBe(true)
    expect(free.reads).toBeGreaterThan(40)
    const half = Math.floor(free.reads / 2)
    const clock = counting()
    __setMemberDoorBudgetForTests(half, clock)
    const d = memberPaneDefinition({ source: SCRIPT, id: 'u_door-steps' })
    expect(d.ok).toBe(false)
    expect(d.guard).toBe('pine:timeout')
    expect(d[DOOR_TIMED_OUT]).toBe(true)
    // the open reads the clock twice; the trip is found at the first check past the deadline, and the call stops there
    expect(clock.reads).toBeGreaterThan(half)
    expect(clock.reads).toBeLessThanOrEqual(half + 8)
  }, 120000)
})

describe('a fast script is unaffected', () => {
  it('the same answer, byte for byte, as under a deadline that never comes, and far inside the real budget', () => {
    memberView()
    const { value: real, ms } = timed(() => memberPaneDefinition({ source: FAST, id: 'u_door-fast' }))
    expect(real.ok, real.reason).toBe(true)
    expect(real[DOOR_TIMED_OUT]).toBe(undefined)
    expect(ms).toBeLessThan(MEMBER_DOOR_BUDGET_MS / 4)
    __setMemberDoorBudgetForTests(1e12)
    const never = memberPaneDefinition({ source: FAST, id: 'u_door-fast' })
    expect(JSON.stringify(real.definition)).toBe(JSON.stringify(never.definition))
    expect(JSON.stringify(real.notes)).toBe(JSON.stringify(never.notes))
    expect(JSON.stringify(real.rows)).toBe(JSON.stringify(never.rows))
  })

  it('with no window open the walks read no clock and never throw', () => {
    const boom = () => { throw new Error('a clock was read with no door window open') }
    const d = vi.spyOn(Date, 'now').mockImplementation(boom)
    const p = vi.spyOn(performance, 'now').mockImplementation(boom)
    try {
      for (let i = 0; i < 10000; i += 1) doorTick()
      expect(translateBudgetExpired()).toBe(false)
    } finally { d.mockRestore(); p.mockRestore() }
  })

  it('a throw that is not the deadline propagates unchanged, and the window still closes', () => {
    expect(() => withDoorDeadline(1e9, () => { throw new RangeError('not the door') })).toThrow(RangeError)
    expect(doorWindowOpen()).toBe(false)
    const r = withDoorDeadline(1, () => { for (;;) doorTick() }, counting())
    expect(r.tripped).toBe(true)
    expect(r.value).toBe(null)
    expect(doorWindowOpen()).toBe(false)
    expect(new DoorDeadlineError(5).guard).toBe('pine:timeout')
  })
})

describe('a saved script whose re-check ran out of time keeps its picture', () => {
  it('retranslateRow answers inconclusive (drawn as stored), never refused, for a door timeout', () => {
    memberView()
    __setMemberDoorBudgetForTests(400)
    const row = { def_id: 'u_saved', version: 3, pine_source: chain(17), definition: { id: 'u_saved', compute: { kind: 'ast' } } }
    const r = retranslateRow(row, memberPaneDefinition)
    expect(r.status).toBe('inconclusive')
    expect(r.reason).toMatch(/^the check ran out of time: this script is not drawn/)
    // CONTROL: a refusal that is not the deadline is still a refusal
    const refused = retranslateRow(row, () => ({ ok: false, reason: 'this script declares nothing a chart can draw', guard: null }))
    expect(refused.status).toBe('refused')
  }, 120000)
})
