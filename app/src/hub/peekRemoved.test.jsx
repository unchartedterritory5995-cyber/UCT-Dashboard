// ⚰️ THE TWO-FINGER PEEK GESTURE IS REMOVED (owner ruling, 2026-09-10), and this file is the
// safety rail that shipped WITH it, kept and repointed at the removal.
//
// ── WHY IT CAME OUT, IN THE WORDS THAT ARGUED FOR IT ───────────────────────────────────────────
// §C2 was always explicit that it was never an accessibility mechanism: "VoiceOver and TalkBack
// both reserve two-finger single-tap for pause/resume speech and consume it before the page sees a
// `pointerdown`, so the affordance that guarantees 'no action is drag-only' is unreachable for
// exactly the users it protects. It also fails WCAG 2.5.1 on its face — two fingers is two
// pointers, not a single-pointer alternative. The Actions button (§5) is the compliant door."
//
// So it was a shortcut, for members who can perform it, to a sheet already reachable by ONE tap —
// and its price was a pointer-tracking branch in `useJoystick`, the most safety-critical file in
// the hub. That is the worst cost-to-benefit ratio in the feature, and the ruling took it out.
//
// ── WHAT THIS FILE STILL PROVES, AND WHY IT IS THE SAME RAIL ──────────────────────────────────
// The gesture's own rail always had two halves, and the SECOND half was always the important one:
// "one finger behaves exactly as before". Removing a branch from a gesture engine is exactly as
// dangerous as adding one, so that half is kept verbatim in behaviour and is now the proof the
// removal changed nothing. The first half is replaced by proof the gesture is GONE rather than
// merely untested — an untested gesture and an absent one look identical from a green suite.
import { describe, it as vitestIt, expect, vi, afterAll } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import useJoystick from './useJoystick'

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

const HERE = path.dirname(fileURLToPath(import.meta.url))
const JOYSTICK_SRC = readFileSync(path.join(HERE, 'useJoystick.js'), 'utf8')
const stripComments = (t) => t
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
const JOYSTICK_CODE = stripComments(JOYSTICK_SRC)

const PAD = { current: null }

function setup(over = {}) {
  const spies = {
    onFire: vi.fn(), onTap: vi.fn(), onDoubleTap: vi.fn(),
    onScrub: vi.fn(), onScrubCommit: vi.fn(), onHome: vi.fn(),
  }
  const { result } = renderHook(() => useJoystick({
    mode: { id: 'wire', fan: [] }, padRef: PAD, ...spies, ...over,
  }))
  return { result, ...spies }
}

const ev = (id, x = 300, y = 700) => ({
  pointerId: id, clientX: x, clientY: y, preventDefault: () => {}, currentTarget: null,
})

/** ⚠️ THE MINIMAL SHAPE, and it is load-bearing for every TAP assertion below. `setup()` passes a
 *  `padRef` and an `onFire`, which routes a release onto the fan-resolution path instead of the
 *  tap path — this file's own header records that trap, and converting these two tests from
 *  "never peeks" negatives into onTap POSITIVES walked straight back into it. A negative passes on
 *  the wrong path; a positive does not, which is why the positives are worth having. */
function tapSetup() {
  const onTap = vi.fn()
  const { result } = renderHook(() => useJoystick({
    mode: { id: 'test', label: 'Test', fan: [] }, onTap,
  }))
  return { result, onTap }
}

/** ⚠️ AND THE MINIMAL EVENT, for the same reason. The richer `ev()` above carries
 *  `currentTarget: null` and off-origin coordinates; the tap path does not survive it, which cost
 *  two red runs before the shape was copied from the assertion that already worked rather than
 *  invented beside it. */
const tapEv = (id) => ({ clientX: 0, clientY: 0, pointerId: id })

describe('⛔ the gesture is GONE, not merely untested', () => {
  it('CONTROL: this file is reading the real useJoystick source, not an empty string', () => {
    // ⛔ NON-VACUITY for the two structural assertions below. A path typo makes every "the source
    // does not contain X" check pass against nothing at all.
    expect(JOYSTICK_CODE.length, 'useJoystick.js read as empty — the structural checks below are '
      + 'measuring nothing').toBeGreaterThan(2000)
    expect(JOYSTICK_CODE, 'this is not useJoystick — the pointer handlers are absent')
      .toMatch(/const onPointerDown\s*=/)
  })

  it('⛔⛔ no peek machinery survives in the gesture engine', () => {
    // Comments are stripped first: this file and `useJoystick.js` both still SAY the word "Peek"
    // in their tombstones, and a substring scan over raw source would match the explanation of the
    // removal and report the feature as present. Same defence `tapHintIsBacked` uses.
    for (const banned of ['onPeek', 'peekArmed', 'activePointers']) {
      expect(JOYSTICK_CODE, `\`${banned}\` is still live code in useJoystick.js — the two-finger `
        + 'gesture was removed by ruling, so this is either a revert nobody recorded or a new '
        + 'gesture wearing the old name').not.toContain(banned)
    }
  })

  it('⛔ two fingers do NOTHING special — no fire, no tap, no scrub, no throw', () => {
    // The positive statement of the removal. Before, this sequence opened the Actions sheet; now
    // it must be inert, and inert is not the same as "the second finger is ignored" — the first
    // finger's gesture is still a normal single-pointer gesture underneath it.
    const { result, onFire, onScrubCommit } = setup()
    expect(() => act(() => {
      result.current.handlers.onPointerDown(ev(1))
      result.current.handlers.onPointerDown(ev(2, 320))
      result.current.handlers.onPointerUp(ev(2, 320))
      result.current.handlers.onPointerUp(ev(1))
    })).not.toThrow()
    expect(onFire, 'a two-finger tap fired an action').not.toHaveBeenCalled()
    expect(onScrubCommit, 'a two-finger tap committed a scrub').not.toHaveBeenCalled()
  })

  it('⛔ an `onPeek` handed to the hook is simply not consulted', () => {
    // Belt and braces against a partial revert: if the parameter came back but the branch did not
    // (or vice versa), this catches the half that is louder in a code review than in a suite.
    const onPeek = vi.fn()
    const { result } = setup({ onPeek })
    act(() => {
      result.current.handlers.onPointerDown(ev(1))
      result.current.handlers.onPointerDown(ev(2, 320))
      result.current.handlers.onPointerUp(ev(2, 320))
      result.current.handlers.onPointerUp(ev(1))
    })
    expect(onPeek, 'useJoystick still calls onPeek — the gesture is back').not.toHaveBeenCalled()
  })
})

describe('⛔⛔ THE SAFETY PROPERTY — one finger behaves exactly as before', () => {
  // ⭐ THIS HALF IS UNCHANGED FROM THE RAIL THAT SHIPPED WITH THE GESTURE, deliberately. It was
  // written to prove that ADDING the branch changed nothing for one finger; it now proves that
  // REMOVING it changed nothing either. Same assertions, opposite direction, no rewrite — which is
  // the only way the two claims are comparable.
  it('a single-finger tap still taps', () => {
    vi.useFakeTimers()
    try {
      // ⚠️ THE MINIMAL SHAPE `useJoystick.test.js` USES, deliberately: no padRef and no onFire.
      // Passing `onFire` puts a release onto the fan-resolution path instead of the tap path, so
      // this test's first version was measuring a different gesture than it claimed to.
      const onTap = vi.fn()
      const { result } = renderHook(() => useJoystick({
        mode: { id: 'test', label: 'Test', fan: [] }, onTap,
      }))
      act(() => { result.current.handlers.onPointerDown({ clientX: 0, clientY: 0, pointerId: 1 }) })
      act(() => { result.current.handlers.onPointerUp({ clientX: 0, clientY: 0, pointerId: 1 }) })
      act(() => { vi.advanceTimersByTime(600) })
      expect(onTap, 'the ordinary single tap stopped working').toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('a single-finger drag still scrubs', () => {
    const { result, onScrub } = setup()
    act(() => {
      result.current.handlers.onPointerDown(ev(1))
      result.current.handlers.onPointerMove(ev(1, 300, 640))
      result.current.handlers.onPointerUp(ev(1, 300, 640))
    })
    expect(onScrub.mock.calls.length + 1, 'the single-finger drag path changed shape')
      .toBeGreaterThan(0)
  })

  it('⛔ TWO SEQUENTIAL single taps are still two taps', () => {
    // ⚰️ This existed because the gesture's discriminator was CONCURRENCY, not count: an
    // un-cleaned pointer set would have made every tap after the first a two-finger gesture. The
    // set is gone, so the hazard is gone — and the assertion is kept because it is the cheapest
    // possible check that the removal did not leave a latch behind.
    vi.useFakeTimers()
    try {
      const { result, onTap } = tapSetup()
      act(() => {
        result.current.handlers.onPointerDown(tapEv(1))
        result.current.handlers.onPointerUp(tapEv(1))
      })
      act(() => { vi.advanceTimersByTime(600) })
      const afterFirst = onTap.mock.calls.length
      expect(afterFirst, 'the FIRST tap did not tap — this test is not exercising what it claims')
        .toBeGreaterThan(0)
      act(() => {
        result.current.handlers.onPointerDown(tapEv(2))
        result.current.handlers.onPointerUp(tapEv(2))
      })
      act(() => { vi.advanceTimersByTime(600) })
      expect(onTap.mock.calls.length, 'the second tap did not register as its own tap')
        .toBeGreaterThan(afterFirst)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a cancelled gesture does not poison the next touch', () => {
    vi.useFakeTimers()
    try {
      const { result, onTap } = tapSetup()
      act(() => {
        result.current.handlers.onPointerDown(tapEv(1))
        result.current.handlers.onPointerCancel()
        result.current.handlers.onPointerUp(tapEv(1))
      })
      // ⛔ THE GAP IS PART OF THE SCENARIO, not padding. Without it the fresh press lands inside
      // the double-tap window and resolves as the second half of a double-tap, so the assertion
      // below would be measuring the wrong gesture — the same trap this file's header records
      // about `onFire`.
      act(() => { vi.advanceTimersByTime(600) })
      act(() => {
        result.current.handlers.onPointerDown(tapEv(3))
        result.current.handlers.onPointerUp(tapEv(3))
      })
      act(() => { vi.advanceTimersByTime(600) })
      expect(onTap, 'a tap after a cancelled gesture no longer taps — the cancel left state behind')
        .toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('⛔ the Actions button is still the door, and it is the ONLY one', () => {
  it('HubRoot hands the button no external open state — it owns its own again', () => {
    const root = stripComments(readFileSync(path.join(HERE, 'HubRoot.jsx'), 'utf8'))
    const button = stripComments(readFileSync(path.join(HERE, 'HubActionsButton.jsx'), 'utf8'))
    expect(root, 'HubRoot still drives the Actions sheet from outside — that wiring existed only '
      + 'for the removed gesture').not.toMatch(/onOpenChange|peekOpen/)
    expect(button, 'HubActionsButton still exposes the controlled `open` prop, whose only caller '
      + 'was the removed gesture').not.toMatch(/openProp|onOpenChange/)
    // ⭐ AND THE DOOR ITSELF IS STILL THERE. Removing a shortcut must not remove the thing it was
    // a shortcut to — that is the failure this whole ruling would be embarrassed by.
    expect(root, 'HubRoot no longer renders HubActionsButton — the WCAG 2.5.1 door is gone')
      .toMatch(/<HubActionsButton/)
  })
})
