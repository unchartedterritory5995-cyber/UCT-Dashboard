// W3 / R9 — the smoothness instrument is ON THE GESTURE PATH, and behind the SAME gate as the
// trace. `hubSmoothness.test.js` proves the instrument measures; this file proves it is wired.
//
// ⛔⛔ THE TWO ARE DIFFERENT CLAIMS AND ONLY ONE OF THEM IS ABOUT CODE THAT RUNS. A module can be
// correct, fully unit-tested and green forever while nothing calls it — that is the exact defect
// `components/screener/reachable.test.js` exists for, and the one this module was in for the hour
// between being written and being wired. A unit test is structurally blind to a severed wire.
//
// ⛔ AND THE GATE IS THE OTHER HALF. The capture opens a requestAnimationFrame loop for the length
// of a gesture. If it ran for a member rather than only for an admin who turned "Record gesture
// trace" on, it would be a per-frame cost on the pointer path of the exact feature whose complaint
// was that it is "too glitchy" — an instrument making the thing it measures worse. So the OFF case
// is asserted against a COUNTER, not against an absence of output.
import { describe, it as vitestIt, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { renderHook } from '@testing-library/react'

import useJoystick from './useJoystick'
import { clearGestureTrace, readGestureTrace } from './gestureTrace.js'
import { TRAVEL_PX, openAtPx } from './constants.js'

let definedCount = 0
let executedCount = 0
function it(name, fn) {
  definedCount += 1
  return vitestIt(name, (...args) => { executedCount += 1; return fn(...args) })
}
afterAll(() => {
  expect(executedCount).toBeGreaterThan(0)
  expect(executedCount).toBe(definedCount)
})

const OPEN = openAtPx(TRAVEL_PX)
const fan = [{ id: 'outer.flick', label: 'A', icon: 'x', ring: 0, color: '--x', kind: 'run' }]

let stamp = 1000
const ev = (x, y) => ({
  pointerId: 1, clientX: x, clientY: y, pointerType: 'touch',
  isPrimary: true, pressure: 0.5, timeStamp: (stamp += 8),
})

/** A fake rAF that COUNTS and can be pumped by hand. Real rAF never fires in jsdom's test loop. */
let rafCalls = 0
let cafCalls = 0
let queued = []
let savedRaf
let savedCaf

beforeEach(() => {
  clearGestureTrace()
  rafCalls = 0
  cafCalls = 0
  queued = []
  savedRaf = globalThis.requestAnimationFrame
  savedCaf = globalThis.cancelAnimationFrame
  globalThis.requestAnimationFrame = (cb) => { rafCalls += 1; queued.push(cb); return queued.length }
  globalThis.cancelAnimationFrame = () => { cafCalls += 1 }
})
afterEach(() => {
  globalThis.requestAnimationFrame = savedRaf
  globalThis.cancelAnimationFrame = savedCaf
})

/** Deliver n frames at `gap` ms apart, so a summary has real numbers in it. */
function pump(n, gap = 16.67, from = 5000) {
  let t = from
  for (let i = 0; i < n; i += 1) {
    const cb = queued.shift()
    if (!cb) return
    t += gap
    cb(t)
  }
}

function mount(trace) {
  return renderHook(() => useJoystick({
    mode: { id: 'test', label: 'Test', fan },
    settings: { traceGestures: trace },
    onFire: vi.fn(), onTap: vi.fn(), onDoubleTap: vi.fn(),
    onScrub: vi.fn(), onScrubCommit: vi.fn(), onHome: vi.fn(),
  }))
}

const lastRow = () => {
  const rows = readGestureTrace().rows
  return rows.length ? rows[rows.length - 1] : null
}

describe('the capture rides the trace gate — it is not a second switch', () => {
  it('⛔ TOGGLE OFF: not one animation frame is requested', () => {
    const { result, unmount } = mount(false)
    result.current.handlers.onPointerDown(ev(0, 0))
    result.current.handlers.onPointerMove(ev(OPEN + 5, -5))
    result.current.handlers.onPointerUp(ev(OPEN + 5, -5))
    unmount()

    expect(rafCalls, 'a member pays for a per-frame loop on every gesture').toBe(0)
    expect(readGestureTrace().recorded, 'the toggle is off — nothing is recorded either').toBe(0)
  })

  it('⭐ CONTROL — TOGGLE ON: the loop starts, so the zero above is a gate and not a broken stub',
    () => {
      const { result, unmount } = mount(true)
      result.current.handlers.onPointerDown(ev(0, 0))
      expect(rafCalls, 'the capture never started with the toggle ON').toBeGreaterThan(0)
      result.current.handlers.onPointerUp(ev(0, 0))
      unmount()
    })
})

describe('the summary reaches the row a member copies out', () => {
  it('the pointerup row carries a smoothness summary with real frame numbers', () => {
    const { result, unmount } = mount(true)
    result.current.handlers.onPointerDown(ev(0, 0))
    pump(12)                                   // twelve clean 60fps frames
    result.current.handlers.onPointerMove(ev(OPEN + 5, -5))
    pump(6)
    result.current.handlers.onPointerUp(ev(OPEN + 5, -5))

    const row = lastRow()
    expect(row.type).toBe('pointerup')
    expect(row.smoothness, 'the capture never reached the trace row').not.toBeNull()
    expect(row.smoothness.valid, `voided as ${row.smoothness?.voidReason}`).toBe(true)
    expect(row.smoothness.frames).toBeGreaterThan(1)
    expect(row.smoothness.gapMs.p50).toBeGreaterThan(0)
    expect(row.smoothness.droppedFrames).toBe(0)
    unmount()
  })

  it('the rows BETWEEN down and up carry smoothness: null — a shape, not a gap', () => {
    const { result, unmount } = mount(true)
    result.current.handlers.onPointerDown(ev(0, 0))
    pump(4)
    result.current.handlers.onPointerMove(ev(10, -10))
    const mid = lastRow()
    expect(mid.type).toBe('pointermove')
    expect('smoothness' in mid, 'the key is missing, so its absence is ambiguous').toBe(true)
    expect(mid.smoothness, 'a mid-gesture row cannot have a summary yet').toBeNull()
    result.current.handlers.onPointerUp(ev(10, -10))
    unmount()
  })

  it('⛔ THE OTHER ANSWER — a stalled gesture reports the stall, through the real wiring', () => {
    // Same path, same assertions, one changed input: the frames arrive 70ms apart.
    const { result, unmount } = mount(true)
    result.current.handlers.onPointerDown(ev(0, 0))
    pump(10, 70)
    result.current.handlers.onPointerUp(ev(0, 0))

    const s = lastRow().smoothness
    expect(s.valid).toBe(true)
    expect(s.droppedFrames, 'the wired instrument cannot see a stall the module can').toBeGreaterThan(0)
    expect(s.gapMs.max).toBeGreaterThan(60)
    unmount()
  })
})

describe('it never damages the gesture it measures', () => {
  it('⛔ a capture that throws does NOT take the gesture down', () => {
    // rAF itself explodes — the worst case, since it is called from inside the pointer handler.
    globalThis.requestAnimationFrame = () => { throw new Error('boom') }
    const { result, unmount } = mount(true)

    expect(() => {
      result.current.handlers.onPointerDown(ev(0, 0))
      result.current.handlers.onPointerMove(ev(OPEN + 5, -5))
      result.current.handlers.onPointerUp(ev(OPEN + 5, -5))
    }, 'the instrument broke the gesture').not.toThrow()

    // And the gesture still recorded its own trace rows — the engine was untouched.
    expect(readGestureTrace().recorded).toBeGreaterThan(0)
    unmount()
  })

  it('⛔ UNMOUNTING MID-GESTURE STOPS THE LOOP — the pending frame must not RE-ARM', () => {
    // ⚰️ THE FIRST VERSION OF THIS TEST WAS VACUOUS AND A MUTATION PROVED IT. It did
    // `unmount(); queued = []; pump(5)` and asserted the rAF count had not moved — but `pump`
    // drains `queued`, which had just been emptied, so no callback ever ran and the count could
    // not have moved whether the cleanup existed or not. Deleting the cleanup effect entirely
    // left it GREEN. `lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`.
    //
    // ⭐ THE FIX IS TO MODEL WHAT A BROWSER ACTUALLY DOES: unmounting does not un-schedule a frame
    // that is already pending, so that callback still fires. The question is whether it RE-ARMS.
    // A live loop calls rAF again and runs forever; a stopped one returns at its `running` guard.
    const { result, unmount } = mount(true)
    result.current.handlers.onPointerDown(ev(0, 0))
    pump(3)
    expect(rafCalls).toBeGreaterThan(0)
    expect(queued.length, 'no frame is pending, so this test would prove nothing').toBeGreaterThan(0)

    unmount()                       // thumb still down: route change, hide, or useHubActive flip

    const before = rafCalls
    const pending = queued.shift() // the frame the browser had already scheduled
    pending(9999)                  // ...still fires

    expect(rafCalls, 'the rAF loop re-armed after unmount — it outlives the component and drains '
      + 'the battery of the exact device being diagnosed').toBe(before)
  })
})
