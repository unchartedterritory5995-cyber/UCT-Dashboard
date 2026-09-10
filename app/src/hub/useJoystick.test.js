// app/src/hub/useJoystick.test.js — coverage for the gesture engine's FSM.
// See docs/plans/joystick/00-master-spec-v1.4.md §5 (Phase 2) and §C1 (the gesture vocabulary).

import { describe, it as vitestIt, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import useJoystick from './useJoystick.js'
import { modesById } from './registry.js'
import { TRAVEL_PX, HOLD_MS, DOUBLE_TAP_MS, FLICK_MS, openAtPx, ringSplitPx, EDGE_GUARD_PX, EDGE_GUARD_TRAVEL_PX } from './constants.js'

// ⚠️ RAIL (house convention — mirrors useHubCursor.test.js): `vitest -t <regex>` is a regex
// filter, and a filter matching nothing exits 0 and reads as a PASS. `definedCount` counts every
// `it()` call below as the file is collected (happens regardless of `-t`); `executedCount` counts
// only the ones that actually ran. `afterAll` asserts they're equal AND non-zero, so a `-t` typo,
// or a stray `.only`/`.skip`, fails loudly instead of silently reporting fewer green tests as a
// full pass. A `-t` matching NONE of this file's tests still reports 0/0 without a root `afterAll`
// running at all (vitest 4) — that total-exclusion gap can only be closed from outside the file;
// this catches every partial one, which is the common real case.
let definedCount = 0
let executedCount = 0
function it(name, fn) {
  definedCount += 1
  return vitestIt(name, async (...args) => {
    executedCount += 1
    return fn(...args)
  })
}
afterAll(() => {
  expect(executedCount).toBeGreaterThan(0)
  expect(executedCount).toBe(definedCount)
})

// ── Fixtures ──────────────────────────────────────────────────────────────
// No DOM layout anywhere below: padRef is always `undefined`/`{current:null}`, so the hook's own
// `centerOf()` falls back to (0,0) and every `clientX/clientY` IS the dx/dy offset from pad
// centre. Nothing here reads a `getBoundingClientRect()` value or asserts on one.

let uid = 0
function makeAction(ring, extra = {}) {
  uid += 1
  return { id: `a${uid}`, label: 'A', icon: 'x', ring, color: '--x', kind: 'run', ...extra }
}
function makeMode(fan, overrides = {}) {
  return {
    id: 'test',
    label: 'Test',
    tapHint: 'tap: x',
    onTap: vi.fn(),
    onDoubleTap: vi.fn(),
    fan,
    ...overrides,
  }
}
/** A point at `dist` px from centre, at `angleDeg` standard math degrees (0=right, 90=up) — the
 * exact inverse of `fanGeometry.pointerAngle`, so a fixture built this way resolves to that angle. */
function vecAtAngle(dist, angleDeg) {
  const rad = (angleDeg * Math.PI) / 180
  return { dx: Math.cos(rad) * dist, dy: -Math.sin(rad) * dist }
}

const OPEN = openAtPx(TRAVEL_PX)
const SPLIT = ringSplitPx(TRAVEL_PX)
const SOFT_DIST = OPEN + (SPLIT - OPEN) / 2 // strictly between open and split -> inner ring
const HARD_DIST = SPLIT + 5 // strictly past split -> outer ring

function down(handlers, x, y, pointerId = 1) {
  handlers.onPointerDown({ clientX: x, clientY: y, pointerId })
}
function move(handlers, x, y, pointerId = 1) {
  handlers.onPointerMove({ clientX: x, clientY: y, pointerId })
}
function up(handlers, x, y, pointerId = 1) {
  handlers.onPointerUp({ clientX: x, clientY: y, pointerId })
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  delete navigator.vibrate
})

describe('useJoystick', () => {
  // ── Tap / double-tap ──────────────────────────────────────────────────────

  it('tap fires mode.onTap after the double-tap window closes', () => {
    const mode = makeMode([])
    const { result } = renderHook(() => useJoystick({ mode }))

    act(() => down(result.current.handlers, 0, 0))
    act(() => up(result.current.handlers, 0, 0))
    expect(mode.onTap).not.toHaveBeenCalled() // still pending, disambiguating

    act(() => vi.advanceTimersByTime(DOUBLE_TAP_MS + 1))
    expect(mode.onTap).toHaveBeenCalledTimes(1)
    expect(mode.onDoubleTap).not.toHaveBeenCalled()
  })

  it('double-tap fires mode.onDoubleTap and never the pending single tap', () => {
    const mode = makeMode([])
    const { result } = renderHook(() => useJoystick({ mode }))

    act(() => down(result.current.handlers, 0, 0))
    act(() => up(result.current.handlers, 0, 0)) // tap 1: schedules the pending single
    act(() => down(result.current.handlers, 0, 0))
    act(() => up(result.current.handlers, 0, 0)) // tap 2: cancels it, fires double

    expect(mode.onDoubleTap).toHaveBeenCalledTimes(1)
    expect(mode.onTap).not.toHaveBeenCalled()

    // The cancelled first timer must never fire late.
    act(() => vi.advanceTimersByTime(DOUBLE_TAP_MS + 50))
    expect(mode.onTap).not.toHaveBeenCalled()
  })

  // ── Hold ──────────────────────────────────────────────────────────────────

  it('hold for holdMs without crossing the open threshold fires onHome', () => {
    const mode = makeMode([])
    const onHome = vi.fn()
    const { result } = renderHook(() => useJoystick({ mode, onHome }))

    act(() => down(result.current.handlers, 0, 0))
    act(() => vi.advanceTimersByTime(HOLD_MS))
    act(() => up(result.current.handlers, 0, 0))

    expect(onHome).toHaveBeenCalledTimes(1)
  })

  it('a hold never also fires a tap on release', () => {
    const mode = makeMode([])
    const onHome = vi.fn()
    const { result } = renderHook(() => useJoystick({ mode, onHome }))

    act(() => down(result.current.handlers, 0, 0))
    act(() => vi.advanceTimersByTime(HOLD_MS))
    act(() => up(result.current.handlers, 0, 0))
    expect(onHome).toHaveBeenCalledTimes(1)

    // Give any (incorrectly-scheduled) pending tap every chance to fire late.
    act(() => vi.advanceTimersByTime(DOUBLE_TAP_MS + 50))
    expect(mode.onTap).not.toHaveBeenCalled()
    expect(mode.onDoubleTap).not.toHaveBeenCalled()
  })

  // ── Hold + drag = Scrub ────────────────────────────────────────────────────

  it('hold then drag emits normalized scroll deltas, then commits on release', () => {
    const mode = makeMode([])
    const onScrub = vi.fn()
    const onScrubCommit = vi.fn()
    const onHome = vi.fn()
    const onFire = vi.fn()
    const { result } = renderHook(() => useJoystick({ mode, onScrub, onScrubCommit, onHome, onFire }))

    act(() => down(result.current.handlers, 0, 0))
    act(() => vi.advanceTimersByTime(HOLD_MS)) // hold reached, no drag yet

    act(() => move(result.current.handlers, 5, 0)) // establishes the scrub baseline
    expect(onScrub).not.toHaveBeenCalled()
    expect(result.current.state.scrubbing).toBe(true)
    expect(result.current.state.open).toBe(false) // scrub never opens the fan

    act(() => move(result.current.handlers, 12, 0)) // dx +7 -> axis x
    act(() => move(result.current.handlers, 12, 9)) // dy +9 -> axis y

    expect(onScrub).toHaveBeenCalledTimes(2)
    expect(onScrub.mock.calls[0][0]).toEqual({ delta: 7 / TRAVEL_PX, axis: 'x' })
    expect(onScrub.mock.calls[1][0]).toEqual({ delta: 9 / TRAVEL_PX, axis: 'y' })

    act(() => up(result.current.handlers, 12, 9))
    expect(onScrubCommit).toHaveBeenCalledTimes(1)
    expect(onHome).not.toHaveBeenCalled()
    expect(onFire).not.toHaveBeenCalled()
    expect(mode.onTap).not.toHaveBeenCalled()
  })

  // ── Soft / hard push ────────────────────────────────────────────────────

  it('a soft push (past open, under the ring split) selects an inner action', () => {
    const inner = makeAction(1, { id: 'inner.only' })
    const mode = makeMode([inner])
    const { result } = renderHook(() => useJoystick({ mode }))

    const { dx, dy } = vecAtAngle(SOFT_DIST, 135)
    act(() => down(result.current.handlers, 0, 0))
    act(() => move(result.current.handlers, dx, dy))

    expect(result.current.state.open).toBe(true)
    expect(result.current.state.dragging).toBe(true)
    expect(result.current.state.ring).toBe(1)
    expect(result.current.state.target?.action.id).toBe('inner.only')
  })

  it('a hard push (at or past the ring split) selects an outer action', () => {
    const outer = makeAction(0, { id: 'outer.only' })
    const mode = makeMode([outer])
    const { result } = renderHook(() => useJoystick({ mode }))

    const { dx, dy } = vecAtAngle(HARD_DIST, 135)
    act(() => down(result.current.handlers, 0, 0))
    act(() => move(result.current.handlers, dx, dy))

    expect(result.current.state.open).toBe(true)
    expect(result.current.state.dragging).toBe(true)
    expect(result.current.state.ring).toBe(0)
    expect(result.current.state.target?.action.id).toBe('outer.only')
  })

  // ── Flick ─────────────────────────────────────────────────────────────────

  it('a flick fires an allowed outer action without an intermediate move event', () => {
    const outer = makeAction(0, { id: 'outer.flick', flickable: true })
    const mode = makeMode([outer])
    const onFire = vi.fn()
    const { result } = renderHook(() => useJoystick({ mode, onFire }))

    const { dx, dy } = vecAtAngle(OPEN + 5, 135)
    act(() => down(result.current.handlers, 0, 0))
    // No pointermove at all: elapsed stays 0 (< FLICK_MS), and the release vector alone carries
    // enough travelled distance — exactly the fast-flick case a real touch stream produces.
    act(() => up(result.current.handlers, dx, dy))

    expect(onFire).toHaveBeenCalledTimes(1)
    expect(onFire.mock.calls[0][0].action.id).toBe('outer.flick')
    expect(result.current.state.open).toBe(false)
  })

  it('a flick on a flickable:false action opens the fan and fires nothing', () => {
    const close = makeAction(0, { id: 'outer.close', kind: 'confirm', flickable: false, confirmText: () => 'x' })
    const mode = makeMode([close])
    const onFire = vi.fn()
    const { result } = renderHook(() => useJoystick({ mode, onFire }))

    const { dx, dy } = vecAtAngle(OPEN + 5, 135)
    act(() => down(result.current.handlers, 0, 0))
    act(() => up(result.current.handlers, dx, dy))

    expect(onFire).not.toHaveBeenCalled()
    expect(result.current.state.open).toBe(true)
    expect(result.current.state.target?.action.id).toBe('outer.close')
    expect(result.current.state.ring).toBe(0)
  })

  // ── Android edge guard ────────────────────────────────────────────────────

  it('the edge guard defers knob movement near the right viewport edge', () => {
    const VIEWPORT_W = 400
    vi.stubGlobal('innerWidth', VIEWPORT_W)
    const mode = makeMode([])
    const { result } = renderHook(() => useJoystick({ mode }))

    // Strictly within EDGE_GUARD_PX of the right edge (derived, never a magic offset).
    const edgeStartX = VIEWPORT_W - (EDGE_GUARD_PX - 2)
    act(() => down(result.current.handlers, edgeStartX, 0))
    expect(result.current.state.edgeGuarded).toBe(true)
    expect(result.current.state.knob).toEqual({ x: 0, y: 0 })

    // Leftward (inward) travel under EDGE_GUARD_TRAVEL_PX: still guarded, knob still frozen.
    act(() => move(result.current.handlers, edgeStartX - (EDGE_GUARD_TRAVEL_PX - 1), 0))
    expect(result.current.state.edgeGuarded).toBe(true)
    expect(result.current.state.knob).toEqual({ x: 0, y: 0 })

    // Enough inward travel clears the guard; the knob resumes tracking.
    act(() => move(result.current.handlers, edgeStartX - (EDGE_GUARD_TRAVEL_PX + 1), 0))
    expect(result.current.state.edgeGuarded).toBe(false)
    expect(result.current.state.knob).not.toEqual({ x: 0, y: 0 })
  })

  // ── Sticky fan ────────────────────────────────────────────────────────────

  it('sticky-fan release with no target stays open, then dismiss() closes it', () => {
    const solo = makeAction(0, { id: 'solo' }) // wedge at 135deg only
    const mode = makeMode([solo])
    const onFire = vi.fn()
    const { result } = renderHook(() => useJoystick({ mode, onFire, settings: { stickyFan: true } }))

    // Down-right is outside the fan's quadrant entirely (fanGeometry's own "how a user cancels").
    act(() => down(result.current.handlers, 0, 0))
    act(() => move(result.current.handlers, HARD_DIST, HARD_DIST))
    act(() => vi.advanceTimersByTime(FLICK_MS + 50)) // make sure this isn't read as a flick
    act(() => up(result.current.handlers, HARD_DIST, HARD_DIST))

    expect(onFire).not.toHaveBeenCalled()
    expect(result.current.state.open).toBe(true)
    expect(result.current.state.sticky).toBe(true)
    expect(result.current.state.target).toBeNull()

    act(() => result.current.dismiss())
    expect(result.current.state.open).toBe(false)
    expect(result.current.state.sticky).toBe(false)
  })

  // ── Haptics ───────────────────────────────────────────────────────────────

  it('haptics are suppressed when settings.haptics === false, and fire otherwise (control)', () => {
    navigator.vibrate = vi.fn(() => true)
    const outer = makeAction(0, { id: 'outer.h' })

    const off = renderHook(() => useJoystick({ mode: makeMode([outer]), settings: { haptics: false } }))
    const { dx, dy } = vecAtAngle(HARD_DIST, 135)
    act(() => down(off.result.current.handlers, 0, 0))
    act(() => move(off.result.current.handlers, dx, dy))
    act(() => vi.advanceTimersByTime(FLICK_MS + 10)) // force the ordinary release path, not a flick
    act(() => up(off.result.current.handlers, dx, dy))
    expect(navigator.vibrate).not.toHaveBeenCalled()

    // Control: the identical gesture with haptics left on DOES vibrate — proves the mock/gesture
    // sequence above would have caught a real call, so the suppressed case isn't vacuously green.
    const on = renderHook(() => useJoystick({ mode: makeMode([outer]) }))
    act(() => down(on.result.current.handlers, 0, 0))
    act(() => move(on.result.current.handlers, dx, dy))
    act(() => vi.advanceTimersByTime(FLICK_MS + 10))
    act(() => up(on.result.current.handlers, dx, dy))
    expect(navigator.vibrate).toHaveBeenCalled()
  })

  // ── B5: the escalation rides on `escalate`, not on `kind` ─────────────────────────────────
  //
  // ⛔ WHY THIS RAIL EXISTS. The owner ruling is "commit sheet -> warn()", and `useJoystick`
  // encoded it as `kind === 'confirm'` — a PROXY that held only until B3 moved the Journal's three
  // committing actions to kind:'run' to stop two sheets stacking. The cue silently downgraded to
  // impact() on all three, Close included, with every test green: nothing anywhere asserted which
  // haptic fired for which action.
  //
  // The patterns are distinguishable at the argument (`components/mobile/haptics.js:13-16`):
  // tap() -> 10 · impact() -> 18 · warn() -> [22, 60, 22]. So this observes `navigator.vibrate`
  // through the REAL fireTarget path rather than spying on an internal.

  const WARN = [22, 60, 22]
  const IMPACT = 18

  /** Drive one deliberate (non-flick) push-and-release onto the sole outer action of `fan`. */
  function fireOnly(action) {
    const { dx, dy } = vecAtAngle(HARD_DIST, 135)
    const hook = renderHook(() => useJoystick({ mode: makeMode([action]) }))
    act(() => down(hook.result.current.handlers, 0, 0))
    act(() => move(hook.result.current.handlers, dx, dy))
    act(() => vi.advanceTimersByTime(FLICK_MS + 10)) // deliberate release, never a flick
    act(() => up(hook.result.current.handlers, dx, dy))
  }

  it('B5 — an escalate action fires warn(); a plain run action fires impact() and NEVER warn()', () => {
    navigator.vibrate = vi.fn(() => true)

    fireOnly(makeAction(0, { id: 'outer.commits', escalate: true }))
    expect(navigator.vibrate, 'a committing action lost its escalation').toHaveBeenCalledWith(WARN)

    navigator.vibrate.mockClear()

    fireOnly(makeAction(0, { id: 'outer.plain' }))
    expect(navigator.vibrate).toHaveBeenCalledWith(IMPACT)
    expect(navigator.vibrate, 'an ordinary run action escalated — the marker is being ignored')
      .not.toHaveBeenCalledWith(WARN)
  })

  // ⭐ ONE TEST PER ACTION, not one loop over three. Attribution is the point: when this goes red
  // it must say WHICH action lost its escalation, and the other two must stay visibly green.
  // ⭐ The fan is taken from the shipped registry, never re-declared here — a fixture that
  // restated it would stay green through exactly the regression this rail exists to catch.
  for (const id of ['journal.moveStop', 'journal.breakeven', 'journal.close']) {
    it(`B5 — ${id} escalates to warn(), driven from the REAL registry fan`, () => {
      navigator.vibrate = vi.fn(() => true)
      const action = modesById.journal.fan.find((a) => a.id === id)
      expect(action, `${id} is missing from the registry`).toBeTruthy()
      fireOnly(action)
      expect(navigator.vibrate, `${id} fired impact() instead of warn() — B3's silent downgrade`)
        .toHaveBeenCalledWith(WARN)
    })
  }
})
