// Joystick hub — useJoystick(): the gesture engine. Turns a pointer stream into hub state.
// See docs/plans/joystick/00-master-spec-v1.4.md §5 (Phase 2) and §C1 (the gesture vocabulary).

import { useEffect, useRef, useState } from 'react'
import {
  TRAVEL_PX,
  HOLD_MS,
  DOUBLE_TAP_MS,
  FLICK_MS,
  openAtPx,
  FAN_RADIUS_OUTER,
  EDGE_GUARD_PX,
  EDGE_GUARD_TRAVEL_PX,
} from './constants.js'
import { resolveTarget, ringForPointer } from './fanGeometry.js'
import haptics from '../components/mobile/haptics.js'

// ⭐ THE HOOK RENDERS NOTHING. It owns one pointer-driven state machine and calls back into the
// six handlers the caller supplies (mode.onTap/onDoubleTap live on the mode object itself — see
// registry.js — everything else is a hook argument). The components own every pixel.

/**
 * @typedef {{x: number, y: number}} Vec2
 * @typedef {import('./fanGeometry.js').ResolveResult} ResolveResult
 *   `{action, index, angle, ring}` — see fanGeometry.js `resolveTarget`.
 *
 * @typedef {Object} JoystickState
 * @property {boolean}  open        The fan is visible.
 * @property {0|1|null} ring        0 = outer (hard push), 1 = inner (soft push), null = no push yet.
 * @property {ResolveResult|null} target  The nearest selectable action, or null.
 * @property {boolean}  dragging    A push (soft/hard) is actively in progress.
 * @property {boolean}  scrubbing   A hold-then-drag scrub is actively in progress.
 * @property {Vec2}     knob        Visual knob offset from pad centre, clamped to `travelPx`.
 * @property {boolean}  sticky      The fan is open only because a no-target release left it open
 *                                  (`settings.stickyFan`) — distinct from an ordinary open push.
 * @property {boolean}  edgeGuarded The Android edge guard (§2c) is deferring knob movement.
 */

const INITIAL_STATE = {
  open: false,
  ring: null,
  target: null,
  /**
   * Pointer is DOWN but has not yet travelled `openAtPx` — the moment before the gesture commits
   * to being a drag. The knob shows it as a pressed dot, which is the only feedback a user gets
   * that the control heard the touch at all; without it a slow, careful press (exactly what a
   * tremor user produces) looks like nothing is happening.
   * Goes false as soon as the fan opens or a scrub starts — it means "pressed, undecided".
   */
  pressing: false,
  dragging: false,
  scrubbing: false,
  knob: { x: 0, y: 0 },
  sticky: false,
  edgeGuarded: false,
}

/** Read the pad's centre in viewport coordinates. Zero in jsdom (no layout) — by design: every
 * caller of this hook passes dx/dy that are already centre-relative in tests, and in the real
 * browser `padRef` gives the true centre. Nothing here is asserted on in tests. */
function centerOf(padRef) {
  const el = padRef && padRef.current
  if (el && typeof el.getBoundingClientRect === 'function') {
    const r = el.getBoundingClientRect()
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 }
  }
  return { cx: 0, cy: 0 }
}

/** The knob's drawn offset never exceeds `travelPx`, even though a real drag reaches out to a
 * bubble 96-150px away (fanGeometry's radii) — the knob is a bounded joystick nub, not a cursor. */
function clampToTravel(dx, dy, travelPx) {
  const dist = Math.hypot(dx, dy)
  if (dist === 0 || dist <= travelPx) return { x: dx, y: dy }
  const k = travelPx / dist
  return { x: dx * k, y: dy * k }
}

/**
 * A flick always resolves against the OUTER ring (spec C1), regardless of how far the finger
 * physically travelled — a 120ms flick rarely reaches the ring threshold, and the vocabulary does
 * not ask it to. Rather than re-deriving wedge/angle selection here (a second authority over the
 * geometry `fanGeometry.resolveTarget` already owns), rescale the release vector to the outer
 * ring's own DRAWN radius — same direction, so the same angle — and hand it to the real
 * `resolveTarget`. Every other rule (quadrant, select window, nearest-wedge) runs unmodified.
 *
 * ⭐ SCALED TO `FAN_RADIUS_OUTER`, NOT `ringSplitPx`. Under reach mode the ring is decided by
 * proximity to a DRAWN radius, so placing the vector exactly on the outer radius says "outer"
 * unambiguously and keeps saying it if travel or the split fraction is ever retuned. Scaling to
 * `ringSplitPx` (12px at default travel) happens to land on outer today only via the legacy
 * short-push branch — correct by coincidence, which is the kind of thing that quietly inverts.
 */
function forceOuterRing(dx, dy) {
  const dist = Math.hypot(dx, dy)
  if (dist === 0) return null
  const k = FAN_RADIUS_OUTER / dist
  return { dx: dx * k, dy: dy * k }
}

/**
 * The gesture engine. Pure state + callbacks — draws nothing.
 *
 * @param {Object} args
 * @param {import('./registry.js').HubMode} [args.mode]
 * @param {Object} [args.settings]            travelPx, holdMs, doubleTapMs, stickyFan, haptics, handedness.
 * @param {{current: HTMLElement|null}} [args.padRef]
 * @param {(target: ResolveResult) => void} [args.onFire]
 * @param {(scrub: {delta: number, axis: 'x'|'y'}) => void} [args.onScrub]
 * @param {() => void} [args.onScrubCommit]
 * @param {() => void} [args.onHome]
 * @returns {{handlers: Object, state: JoystickState, dismiss: () => void}}
 */
export default function useJoystick({
  mode,
  settings = {},
  padRef,
  onFire,
  onScrub,
  onScrubCommit,
  onHome,
} = {}) {
  const travelPx = settings.travelPx ?? TRAVEL_PX
  const holdMs = settings.holdMs ?? HOLD_MS
  const doubleTapMs = settings.doubleTapMs ?? DOUBLE_TAP_MS
  const stickyFan = settings.stickyFan !== false
  const hapticsEnabled = settings.haptics !== false
  const mirrored = settings.handedness === 'left'
  const openThreshold = openAtPx(travelPx)
  const fan = mode?.fan ?? []

  const [state, setState] = useState(INITIAL_STATE)

  // Per-gesture bookkeeping. Refs, not state — the FSM must read/write synchronously inside a
  // single pointer-event handler, and none of this is ever rendered directly.
  const phaseRef = useRef('idle') // 'idle' | 'down' | 'pushing' | 'scrubbing'
  const startRef = useRef(null) // {x, y, t}
  const lastRef = useRef(null) // {x, y} — last sample, for per-move scrub deltas
  const maxDistRef = useRef(0) // farthest centre-distance reached this gesture
  const targetRef = useRef(null) // last resolved target, for selection-change haptics
  // Last ring this gesture settled on. A ref, not state: hysteresis is consulted inside the
  // pointermove handler and state would lag a render behind the finger, which is exactly the
  // window a tremor crosses the threshold in.
  const ringRef = useRef(null)
  const openFiredRef = useRef(false) // the "open" haptic fires once per gesture
  const holdReachedRef = useRef(false)
  const holdTimerRef = useRef(null)
  const pointerIdRef = useRef(null)
  const edgeGuardRef = useRef({ active: false, startX: 0, startY: 0 })
  // Double-tap disambiguation timer. Deliberately OUTSIDE resetGesture — it spans two separate
  // press-release gestures, not one.
  const pendingTapRef = useRef(null)

  function clearHoldTimer() {
    if (holdTimerRef.current != null) {
      clearTimeout(holdTimerRef.current)
      holdTimerRef.current = null
    }
  }

  function resetGesture() {
    startRef.current = null
    lastRef.current = null
    maxDistRef.current = 0
    targetRef.current = null
    ringRef.current = null
    openFiredRef.current = false
    holdReachedRef.current = false
    edgeGuardRef.current = { active: false, startX: 0, startY: 0 }
    pointerIdRef.current = null
    clearHoldTimer()
    phaseRef.current = 'idle'
  }

  useEffect(
    () => () => {
      clearHoldTimer()
      if (pendingTapRef.current != null) clearTimeout(pendingTapRef.current)
    },
    [],
  )

  function fireTarget(target) {
    if (hapticsEnabled) {
      // Owner ruling (Phase 2 gate), mirrored in constants.js:
      //   fan open -> tap() · target change -> tap() · fire -> impact()
      //   action leads to a COMMIT SHEET -> warn()
      // The triple pulse is the "you are about to be asked to commit something" cue, and it is the
      // only escalation in the set.
      //
      // ⛔ B5 — THIS BRANCHED ON `kind === 'confirm'` AND THAT WAS A PROXY, NOT THE RULE. The
      // ruling's own words are "commit sheet -> warn()", and `kind` only happened to name that set.
      // B3 moved journal.moveStop/breakeven/close to kind:'run' to stop two sheets stacking — they
      // still open a sheet that asks the member to commit, but the cue silently downgraded to
      // impact() on all three, including Close, the most destructive action in the hub. The marker
      // is declared in the registry so the cue stops riding on a `kind` that changes for unrelated
      // reasons; `validateRegistry` requires it on every kind:'confirm' so the old set cannot shrink.
      if (target?.action?.escalate) haptics.warn()
      else haptics.impact()
    }
    onFire?.(target)
  }

  /** Ordinary (non-flick) release while the fan was open: fire on a target, else obey stickyFan. */
  function releaseOntoFan(dx, dy) {
    const resolved = resolveTarget({
      dx, dy, actions: fan, travelPx, mirrored, prevRing: ringRef.current,
    })
    if (resolved) {
      fireTarget(resolved)
      setState((s) => ({
        ...s,
        open: false,
        sticky: false,
        dragging: false,
        target: null,
        ring: null,
        knob: { x: 0, y: 0 },
      }))
      return
    }
    if (stickyFan) {
      // §C2: release with no target keeps the fan open, dismissed only via dismiss().
      setState((s) => ({
        ...s,
        open: true,
        sticky: true,
        dragging: false,
        target: null,
        ring: null,
        knob: { x: 0, y: 0 },
      }))
      return
    }
    setState((s) => ({
      ...s,
      open: false,
      sticky: false,
      dragging: false,
      target: null,
      ring: null,
      knob: { x: 0, y: 0 },
    }))
  }

  const onPointerDown = (e) => {
    const el = padRef && padRef.current
    if (el && typeof el.setPointerCapture === 'function') {
      // Load-bearing, not a nicety (spec §5): travel is 24px but the fan reaches 150px, so every
      // real drag leaves the pad's own hit-box almost immediately.
      try {
        el.setPointerCapture(e.pointerId)
      } catch {
        /* unsupported in this environment (e.g. jsdom) — harmless */
      }
    }
    pointerIdRef.current = e.pointerId
    startRef.current = { x: e.clientX, y: e.clientY, t: Date.now() }
    lastRef.current = { x: e.clientX, y: e.clientY }
    maxDistRef.current = 0
    targetRef.current = null
    ringRef.current = null
    openFiredRef.current = false
    holdReachedRef.current = false
    phaseRef.current = 'down'
    setState((st) => ({ ...st, pressing: true }))

    // Android edge guard (§2c): only a pointerdown starting near the RIGHT viewport edge engages.
    const vw = typeof window !== 'undefined' && typeof window.innerWidth === 'number' ? window.innerWidth : Infinity
    const nearRightEdge = vw - e.clientX <= EDGE_GUARD_PX
    edgeGuardRef.current = { active: nearRightEdge, startX: e.clientX, startY: e.clientY }

    clearHoldTimer()
    holdTimerRef.current = setTimeout(() => {
      holdReachedRef.current = true
    }, holdMs)

    setState((s) => ({ ...s, edgeGuarded: nearRightEdge }))
  }

  const onPointerMove = (e) => {
    if (phaseRef.current === 'idle') return

    if (edgeGuardRef.current.active) {
      const leftward = edgeGuardRef.current.startX - e.clientX
      const upward = edgeGuardRef.current.startY - e.clientY
      const inward = Math.max(leftward, upward)
      if (inward < EDGE_GUARD_TRAVEL_PX) return // knob does not move yet
      edgeGuardRef.current.active = false
      setState((s) => ({ ...s, edgeGuarded: false }))
    }

    const { cx, cy } = centerOf(padRef)
    const dx = e.clientX - cx
    const dy = e.clientY - cy
    const dist = Math.hypot(dx, dy)
    maxDistRef.current = Math.max(maxDistRef.current, dist)

    if (phaseRef.current === 'scrubbing') {
      const prev = lastRef.current ?? { x: e.clientX, y: e.clientY }
      lastRef.current = { x: e.clientX, y: e.clientY }
      const ddx = e.clientX - prev.x
      const ddy = e.clientY - prev.y
      if (ddx !== 0 || ddy !== 0) {
        const axis = Math.abs(ddx) >= Math.abs(ddy) ? 'x' : 'y'
        const raw = axis === 'x' ? ddx : ddy
        onScrub?.({ delta: raw / travelPx, axis })
      }
      setState((s) => ({ ...s, knob: clampToTravel(dx, dy, travelPx) }))
      return
    }

    // A hold that turns into a drag is Scrub — never a fan push, whatever the distance (C1).
    if (holdReachedRef.current) {
      phaseRef.current = 'scrubbing'
      lastRef.current = { x: e.clientX, y: e.clientY }
      setState((s) => ({
        ...s,
        scrubbing: true,
        dragging: false,
        open: false,
        sticky: false,
        target: null,
        ring: null,
      }))
      return
    }

    if (dist >= openThreshold) {
      clearHoldTimer() // crossing into a push means this was never a hold
      if (!openFiredRef.current) {
        openFiredRef.current = true
        if (hapticsEnabled) haptics.tap()  // fan open -> tap() (owner ruling)
      }
      phaseRef.current = 'pushing'
      // ONE ring decision per move, computed here and handed to resolveTarget rather
      // than recomputed there. `prevRing` carries the hysteresis: without a ref the
      // previous value would come from state and lag a render behind the finger.
      const ring = ringForPointer(dist, { travelPx, prevRing: ringRef.current })
      ringRef.current = ring
      const resolved = resolveTarget({ dx, dy, actions: fan, travelPx, mirrored, ring })
      const prevId = targetRef.current?.action?.id ?? null
      const nextId = resolved?.action?.id ?? null
      if (prevId !== nextId && hapticsEnabled) haptics.tap()
      targetRef.current = resolved
      setState((s) => ({
        ...s,
        open: true,
        sticky: false,
        dragging: true,
        pressing: false,
        ring,
        target: resolved,
        knob: clampToTravel(dx, dy, travelPx),
      }))
      return
    }

    // Still under the open threshold: the knob tracks the finger, nothing opens yet.
    setState((s) => ({ ...s, knob: clampToTravel(dx, dy, travelPx) }))
  }

  const onPointerUp = (e) => {
    const el = padRef && padRef.current
    if (el && typeof el.releasePointerCapture === 'function' && pointerIdRef.current != null) {
      try {
        el.releasePointerCapture(pointerIdRef.current)
      } catch {
        /* already released, or unsupported — harmless */
      }
    }
    clearHoldTimer()

    const elapsed = Date.now() - (startRef.current?.t ?? Date.now())
    const phase = phaseRef.current

    // Scrub always ends in a commit — never a fire, a tap, or Home.
    if (phase === 'scrubbing') {
      setState((s) => ({ ...s, scrubbing: false, dragging: false, pressing: false }))
      onScrubCommit?.()
      resetGesture()
      return
    }

    const { cx, cy } = centerOf(padRef)
    const dx = e.clientX - cx
    const dy = e.clientY - cy
    const dist = Math.hypot(dx, dy)
    const travelled = Math.max(maxDistRef.current, dist)

    // Flick: a press under FLICK_MS that travelled far enough. Evaluated at release time from the
    // release vector itself, independent of whatever ring the live push-tracking above landed on.
    if (elapsed < FLICK_MS && travelled >= openThreshold) {
      const outer = forceOuterRing(dx, dy)
      const flickTarget = outer ? resolveTarget({ dx: outer.dx, dy: outer.dy, actions: fan, travelPx, mirrored }) : null

      if (flickTarget && flickTarget.action.flickable !== false) {
        fireTarget(flickTarget)
        setState((s) => ({
          ...s,
          open: false,
          pressing: false,
          sticky: false,
          dragging: false,
          target: null,
          ring: null,
          knob: { x: 0, y: 0 },
        }))
      } else if (flickTarget) {
        // flickable:false (Journal's Close, etc.) — open the fan instead of firing anything.
        setState((s) => ({
          ...s,
          open: true,
          pressing: false,
          sticky: false,
          dragging: false,
          ring: flickTarget.ring,
          target: flickTarget,
          knob: { x: 0, y: 0 },
        }))
      } else {
        // The flick direction matched no outer action — fall back to an ordinary release.
        releaseOntoFan(dx, dy)
      }
      resetGesture()
      return
    }

    if (phase === 'pushing') {
      releaseOntoFan(dx, dy)
      resetGesture()
      return
    }

    // phase === 'down': either a hold-without-drag (Home) or a tap/double-tap.
    if (holdReachedRef.current) {
      // Never also a tap (C1) — this branch returns before the tap logic below ever runs.
      onHome?.()
      resetGesture()
      return
    }

    if (pendingTapRef.current != null) {
      clearTimeout(pendingTapRef.current)
      pendingTapRef.current = null
      mode?.onDoubleTap?.()
    } else {
      pendingTapRef.current = setTimeout(() => {
        pendingTapRef.current = null
        mode?.onTap?.()
      }, doubleTapMs)
    }
    resetGesture()
  }

  const onPointerCancel = () => {
    if (phaseRef.current === 'scrubbing') {
      onScrubCommit?.()
    }
    resetGesture()
    setState((s) => ({
      ...s,
      open: false,
      sticky: false,
      dragging: false,
      pressing: false,
      scrubbing: false,
      target: null,
      ring: null,
      knob: { x: 0, y: 0 },
      edgeGuarded: false,
    }))
  }

  /** For the knob/scrim tap, to close a sticky-open (or flick-opened) fan. */
  const dismiss = () => {
    resetGesture()
    setState((s) => ({
      ...s,
      open: false,
      sticky: false,
      dragging: false,
      pressing: false,
      scrubbing: false,
      target: null,
      ring: null,
      knob: { x: 0, y: 0 },
    }))
  }

  return {
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel },
    state,
    dismiss,
  }
}
