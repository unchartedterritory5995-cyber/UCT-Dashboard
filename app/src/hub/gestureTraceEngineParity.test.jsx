/**
 * ⛔⛔ THE TWO PROPERTIES THAT MAKE THE G0 TRACE SAFE TO SHIP, both driven through the REAL hook.
 *
 *   1. WITH THE TOGGLE OFF, THE POINTER PATH IS UNCHANGED. Every gesture in the vocabulary is run
 *      twice — once with the trace off, once on — and the two outcomes must be identical, with the
 *      buffer empty in the first case. This is the shape `peekRemoved.test.jsx` uses for the
 *      removed Peek gesture, for the same reason it gives: adding a branch to a gesture engine is
 *      exactly as dangerous as removing one, and `useJoystick.js` is the most safety-critical file
 *      in the feature.
 *
 *   2. WITH IT ON, THE TRACE'S DECISION IS THE ENGINE'S DECISION. Each case asserts the recorded
 *      `decision` beside the engine's own observable behaviour — a fire, an open fan, a committed
 *      scrub — so the two can only agree by the trace reporting what actually happened. The
 *      structural half of this claim (the trace wrapper owns no decision vocabulary at all) is in
 *      `gestureTrace.test.js`; a trace that re-derived its verdict would be a second authority over
 *      the gesture engine and worse than no trace.
 *
 * ⚠️ SCOPE. This file drives `useJoystick` directly and hands it `settings.traceGestures`, so it
 * measures the ENGINE. That the flag is admin-only and off by default is decided one layer up, in
 * `useHubSettings` — railed in `useHubSettings.test.jsx` and `gestureTrace.test.js`.
 */
import { describe, it as vitestIt, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

import useJoystick from './useJoystick.js'
import { clearGestureTrace, readGestureTrace } from './gestureTrace.js'
import { TRAVEL_PX, HOLD_MS, DOUBLE_TAP_MS, FLICK_MS, openAtPx, ringSplitPx } from './constants.js'

// ⛔ `vitest -t` is a REGEX: a filter matching nothing exits 0 and reads as a PASS. House idiom.
let defined = 0
let executed = 0
function it(name, fn) {
  defined += 1
  return vitestIt(name, (...a) => { executed += 1; return fn(...a) })
}
afterAll(() => {
  expect(executed).toBeGreaterThan(0)
  expect(executed).toBe(defined)
})

// ── Fixtures. No padRef anywhere, so `centerOf()` is (0,0) and every clientX/Y IS the offset from
// pad centre — the same convention `useJoystick.test.js` uses. ──────────────────────────────────
const OPEN = openAtPx(TRAVEL_PX)
const HARD = ringSplitPx(TRAVEL_PX) + 5

function vecAtAngle(dist, deg) {
  const rad = (deg * Math.PI) / 180
  return { dx: Math.cos(rad) * dist, dy: -Math.sin(rad) * dist }
}
const FLICK_VEC = vecAtAngle(OPEN + 5, 135)
const PUSH_VEC = vecAtAngle(HARD, 135)

const action = (over) => ({ id: 'x', label: 'A', icon: 'x', ring: 0, color: '--x', kind: 'run', ...over })
const FLICKABLE = action({ id: 'outer.flick', flickable: true })
const NOT_FLICKABLE = action({ id: 'outer.close', flickable: false })

/** A realistic pointer event. `timeStamp` advances so the two clock deltas are real numbers. */
let stamp = 1000
const ev = (x, y, over = {}) => ({
  pointerId: 1,
  clientX: x,
  clientY: y,
  pointerType: 'touch',
  isPrimary: true,
  pressure: 0.5,
  timeStamp: (stamp += 8),
  ...over,
})

const down = (r, x, y, over) => r.current.handlers.onPointerDown(ev(x, y, over))
const move = (r, x, y, over) => r.current.handlers.onPointerMove(ev(x, y, over))
const up = (r, x, y, over) => r.current.handlers.onPointerUp(ev(x, y, over))

/**
 * Run one scripted gesture and return BOTH the engine's observable outcome and the trace.
 * The outcome snapshot is everything a caller of this hook can see — callbacks and state — which
 * is what makes the off/on comparison a real equivalence rather than a spot check.
 */
function drive(script, { trace, fan }) {
  clearGestureTrace()
  const spies = {
    onFire: vi.fn(),
    onTap: vi.fn(),
    onDoubleTap: vi.fn(),
    onScrub: vi.fn(),
    onScrubCommit: vi.fn(),
    onHome: vi.fn(),
  }
  const { result } = renderHook(() => useJoystick({
    mode: { id: 'test', label: 'Test', fan },
    settings: { traceGestures: trace },
    ...spies,
  }))
  script(result)
  const s = result.current.state
  return {
    outcome: {
      fired: spies.onFire.mock.calls.map((c) => c[0]?.action?.id ?? null),
      taps: spies.onTap.mock.calls.length,
      doubleTaps: spies.onDoubleTap.mock.calls.length,
      scrubs: spies.onScrub.mock.calls.map((c) => c[0]),
      scrubCommits: spies.onScrubCommit.mock.calls.length,
      homes: spies.onHome.mock.calls.length,
      open: s.open,
      sticky: s.sticky,
      dragging: s.dragging,
      scrubbing: s.scrubbing,
      pressing: s.pressing,
      ring: s.ring,
      targetId: s.target?.action?.id ?? null,
      knob: s.knob,
    },
    trace: readGestureTrace(),
  }
}

/** The newest row that carries a decision — i.e. the row written at a branch, not at a sample. */
const lastDecision = (t) => [...t.rows].reverse().find((r) => r.decision != null) ?? null

// ── The vocabulary, one case per branch `onPointerUp`/`onPointerCancel` can take ────────────────
const CASES = [
  {
    name: 'a flick onto a flickable outer action FIRES it',
    fan: [FLICKABLE],
    decision: 'flick-fire',
    targetId: 'outer.flick',
    run: (r) => {
      act(() => down(r, 0, 0))
      act(() => up(r, FLICK_VEC.dx, FLICK_VEC.dy))
    },
  },
  {
    name: 'a flick onto a flickable:false action OPENS the fan and fires nothing',
    fan: [NOT_FLICKABLE],
    decision: 'flick-open',
    targetId: 'outer.close',
    run: (r) => {
      act(() => down(r, 0, 0))
      act(() => up(r, FLICK_VEC.dx, FLICK_VEC.dy))
    },
  },
  {
    name: 'a deliberate push and release fires through the ordinary path',
    fan: [FLICKABLE],
    decision: 'press-fire',
    targetId: 'outer.flick',
    run: (r) => {
      act(() => down(r, 0, 0))
      act(() => move(r, PUSH_VEC.dx, PUSH_VEC.dy))
      act(() => vi.advanceTimersByTime(FLICK_MS + 10)) // deliberate, never a flick
      act(() => up(r, PUSH_VEC.dx, PUSH_VEC.dy))
    },
  },
  {
    name: 'a release with no target leaves the fan sticky',
    fan: [FLICKABLE],
    decision: 'press-sticky',
    targetId: null,
    run: (r) => {
      // Down-right is outside the fan's quadrant entirely — fanGeometry's own "how a user cancels".
      act(() => down(r, 0, 0))
      act(() => move(r, HARD, HARD))
      act(() => vi.advanceTimersByTime(FLICK_MS + 10))
      act(() => up(r, HARD, HARD))
    },
  },
  {
    name: 'a hold without a drag goes Home',
    fan: [],
    decision: 'home',
    targetId: null,
    run: (r) => {
      act(() => down(r, 0, 0))
      act(() => vi.advanceTimersByTime(HOLD_MS))
      act(() => up(r, 0, 0))
    },
  },
  {
    name: 'a hold then drag commits a scrub',
    fan: [],
    decision: 'scrub-commit',
    targetId: null,
    run: (r) => {
      act(() => down(r, 0, 0))
      act(() => vi.advanceTimersByTime(HOLD_MS))
      act(() => move(r, 5, 0))
      act(() => move(r, 12, 0))
      act(() => up(r, 12, 0))
    },
  },
  {
    name: 'a single tap schedules the pending tap',
    fan: [],
    decision: 'tap-pending',
    targetId: null,
    run: (r) => {
      act(() => down(r, 0, 0))
      act(() => up(r, 0, 0))
      act(() => vi.advanceTimersByTime(DOUBLE_TAP_MS + 20))
    },
  },
  {
    name: 'a double tap cancels the pending one',
    fan: [],
    decision: 'double-tap',
    targetId: null,
    run: (r) => {
      act(() => down(r, 0, 0))
      act(() => up(r, 0, 0))
      act(() => down(r, 0, 0))
      act(() => up(r, 0, 0))
      act(() => vi.advanceTimersByTime(DOUBLE_TAP_MS + 20))
    },
  },
  {
    name: 'a cancelled gesture records the cancel',
    fan: [FLICKABLE],
    decision: 'cancel',
    targetId: null,
    run: (r) => {
      act(() => down(r, 0, 0))
      act(() => r.current.handlers.onPointerCancel(ev(0, 0)))
    },
  },
]

beforeEach(() => {
  vi.useFakeTimers()
  clearGestureTrace()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  delete navigator.vibrate
})

describe('⛔⛔ 1. WITH THE TOGGLE OFF, THE POINTER PATH IS UNCHANGED', () => {
  for (const c of CASES) {
    it(`${c.name} — identical outcome off and on, and nothing recorded when off`, () => {
      const off = drive(c.run, { trace: false, fan: c.fan })
      const on = drive(c.run, { trace: true, fan: c.fan })

      expect(
        on.outcome,
        'the instrument CHANGED the gesture it measures. A trace that alters the thing it measures '
        + 'is worse than no trace, and this is the most safety-critical file in the feature.',
      ).toEqual(off.outcome)

      expect(
        off.trace.kept,
        'the trace recorded with the toggle OFF. The wrapper must not be applied at all in that '
        + 'case — see `handlers: traceOn ? withTrace() : {...}`.',
      ).toBe(0)

      // ⛔ NON-VACUITY. Without this, deleting the recorder entirely would make every case above
      // pass: "off records nothing" and "nothing records anything" are the same observation.
      expect(
        on.trace.kept,
        'the trace recorded NOTHING with the toggle ON — the equality above proves nothing',
      ).toBeGreaterThan(0)
    })
  }
})

describe('⛔⛔ 2. WITH IT ON, THE RECORDED DECISION IS THE ENGINE\'S OWN', () => {
  for (const c of CASES) {
    it(`${c.name} -> "${c.decision}"`, () => {
      const { outcome, trace } = drive(c.run, { trace: true, fan: c.fan })
      const row = lastDecision(trace)
      expect(row, 'no row carried a decision at all').toBeTruthy()
      expect(row.decision, `the engine's branch and the trace disagree for: ${c.name}`)
        .toBe(c.decision)
      expect(row.target?.id ?? null, 'the recorded target is not the one the engine resolved')
        .toBe(c.targetId)

      // ⭐ AND THE ENGINE'S OWN OBSERVABLE BEHAVIOUR, asserted beside it. The pair is the point:
      // a decision field that tracked the code would agree with both; one that re-derived its own
      // verdict could agree with neither without anybody noticing.
      if (c.decision === 'flick-fire' || c.decision === 'press-fire') {
        expect(outcome.fired, 'recorded a fire that never happened').toEqual([c.targetId])
      } else {
        expect(outcome.fired, 'the engine fired but the trace recorded something else').toEqual([])
      }
      if (c.decision === 'flick-open' || c.decision === 'press-sticky') {
        expect(outcome.open, 'recorded an opened fan that is not open').toBe(true)
      }
      if (c.decision === 'home') expect(outcome.homes).toBe(1)
      if (c.decision === 'scrub-commit') expect(outcome.scrubCommits).toBe(1)
      if (c.decision === 'tap-pending') expect(outcome.taps).toBe(1)
      if (c.decision === 'double-tap') expect(outcome.doubleTaps).toBe(1)
    })
  }
})

describe('the row itself — the fields G0-1 is diagnosed from', () => {
  it('⛔ the flick row carries the two comparisons the branch ACTUALLY made', () => {
    const { trace } = drive(CASES[0].run, { trace: true, fan: CASES[0].fan })
    const row = lastDecision(trace)

    // Cause A: `elapsed` is the engine's own number — the one measured against `flickMs`.
    expect(row.flickMs, 'the threshold in the row is not the engine\'s').toBe(FLICK_MS)
    expect(typeof row.elapsed).toBe('number')
    expect(row.elapsed, 'a fire was recorded for a press that was NOT under the flick window')
      .toBeLessThan(row.flickMs)

    // Cause B: travel against the open threshold, both as the branch saw them.
    expect(row.openThreshold).toBeCloseTo(openAtPx(TRAVEL_PX), 10)
    expect(row.travelled).toBeGreaterThanOrEqual(row.openThreshold)

    // Cause C: which bubble the vector resolved to, and whether it was allowed to fire.
    expect(row.target).toEqual({
      id: 'outer.flick', ring: 0, index: expect.any(Number), angle: expect.any(Number), flickable: true,
    })
  })

  it('⛔ THE CLOCK TRIPLE is present and the three are separate numbers', () => {
    const { trace } = drive(CASES[0].run, { trace: true, fan: CASES[0].fan })
    const row = lastDecision(trace)
    // The pair the trace plan calls load-bearing…
    expect(row.eventTs, 'event.timeStamp was not captured').toEqual(expect.any(Number))
    expect(row.perfNow, 'performance.now() was not captured').toEqual(expect.any(Number))
    expect(row.sinceDownEventTs, 'no event.timeStamp delta from pointerdown').toEqual(expect.any(Number))
    expect(row.sinceDownPerfNow, 'no performance.now() delta from pointerdown').toEqual(expect.any(Number))
    // …and the engine's own third clock, which is the one the branch compares. If these three ever
    // disagree on a device, that disagreement IS the G0-1 finding.
    expect(row.elapsed).toEqual(expect.any(Number))
    expect(row.sinceDownEventTs, 'the event clock advanced by the wrong amount for this script')
      .toBe(8)
  })

  it('EVERY pointer event is recorded, not only the decisive one', () => {
    const { trace } = drive(CASES[2].run, { trace: true, fan: CASES[2].fan })
    const types = trace.rows.map((r) => r.type)
    expect(types).toEqual(['pointerdown', 'pointermove', 'pointerup'])
    for (const r of trace.rows) {
      expect(r.pointerType, 'pointerType missing — a real finger and an automation pointer are the '
        + 'difference between a product finding and a harness one').toBe('touch')
      expect(r.isPrimary).toBe(true)
      expect(r.pressure).toBe(0.5)
      expect(typeof r.clientX).toBe('number')
      expect(typeof r.clientY).toBe('number')
      expect(typeof r.phase).toBe('string')
    }
  })

  it('⛔ an instrument that throws must NOT take the gesture with it', () => {
    // Only the fields the TRACE reads are hostile; everything the FSM reads is ordinary, so this
    // isolates the instrument. A trace that breaks a gesture breaks it only on the device being
    // diagnosed, which is the worst possible place for it.
    // ⚠️ Built with defineProperty, never a spread: spreading an object with a throwing getter
    // invokes it, and the fixture would explode in the test rather than in the code under test.
    const hostile = (x, y) => {
      const e = {
        pointerId: 1,
        clientX: x,
        clientY: y,
        pointerType: 'touch',
        isPrimary: true,
        pressure: 0.5,
        getCoalescedEvents() { throw new Error('getCoalescedEvents exploded') },
      }
      Object.defineProperty(e, 'timeStamp', { get() { throw new Error('timeStamp exploded') } })
      return e
    }
    const { outcome, trace } = drive((r) => {
      act(() => r.current.handlers.onPointerDown(hostile(0, 0)))
      act(() => r.current.handlers.onPointerUp(hostile(FLICK_VEC.dx, FLICK_VEC.dy)))
    }, { trace: true, fan: [FLICKABLE] })

    expect(outcome.fired, 'the flick stopped working because the instrument threw').toEqual(['outer.flick'])
    expect(trace.kept, 'nothing was recorded at all — the guard swallowed the row as well as the throw')
      .toBeGreaterThan(0)
    expect(lastDecision(trace).decision).toBe('flick-fire')
    expect(lastDecision(trace).eventTs, 'a clock that could not be read must record null, not a guess')
      .toBeNull()
  })
})
