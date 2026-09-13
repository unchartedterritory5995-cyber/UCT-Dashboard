// Joystick hub — the G0 gesture trace. An in-memory ring buffer the owner can copy out on real
// glass. See docs/plans/joystick/g0-flick-trace-plan.md, and glass-acceptance.md precondition G0-1.
//
// ⛔⛔ NO SINK, NO NETWORK, EVER. Master spec §8's "no analytics" holds: nothing in this file may
// POST, fetch, beacon, or write to a server. The ONE export path is the member pressing "Copy
// trace" in Settings and pasting the JSON back by hand. That is not a limitation to be engineered
// around later — it is the reason this instrument was allowed to exist at all.
//
// ⛔ AND NO VERDICTS. This module records what it is handed and nothing else. It never re-derives
// whether a gesture "was" a flick, never compares `elapsed` against `FLICK_MS` itself, never
// resolves a target. Every decision field comes from the branch in `useJoystick.js` that actually
// took the decision (that handler returns a descriptor; see `withTrace` there). A trace that
// re-computed its own verdict would be a SECOND AUTHORITY over the gesture engine — it would agree
// with the engine right up until the moment the two disagreed, which is the only moment anyone
// would ever read it (`lesson_a_second_authority_over_one_value`).

import { FLICK_MS, TRAVEL_PX, OPEN_AT_RATIO } from './constants.js'

/**
 * ⛔ THE RING IS CAPPED, AND THE WINDOW BOUNDS SHIP WITH THE ROWS.
 *
 * `lesson_a_saturated_instrument_reports_zero`: a full buffer reads exactly like a quiet one
 * unless it says so. Every export carries `recorded` (total events ever seen), `kept`, `dropped`,
 * and the `firstSeq`/`lastSeq` of the window — so "500 rows" can never be mistaken for "500 events
 * happened", and a capture that silently lost the beginning of the session announces it.
 */
export const GESTURE_TRACE_CAP = 500

/** Circular buffer. `writes` only ever increases; it is BOTH the sequence number of the newest row
 *  and the total count, which is what makes `dropped` derivable rather than tracked separately. */
const ring = new Array(GESTURE_TRACE_CAP)
let writes = 0

/**
 * Record one row. Returns its sequence number.
 *
 * ⚠️ Callers are expected to be gated: `useJoystick` only calls this when the trace toggle is on,
 * so that with the toggle OFF the pointer path does not even build a row object. The gate is at the
 * CALL SITE on purpose — a gate inside here would still pay for the argument object on every
 * pointer event of every gesture of every member.
 */
export function recordGestureEvent(row) {
  writes += 1
  ring[(writes - 1) % GESTURE_TRACE_CAP] = { seq: writes, ...row }
  return writes
}

/** The buffer, oldest row first, with the window bounds that make its size interpretable. */
export function readGestureTrace() {
  const kept = Math.min(writes, GESTURE_TRACE_CAP)
  const rows = []
  for (let i = writes - kept; i < writes; i += 1) rows.push(ring[i % GESTURE_TRACE_CAP])
  return {
    capacity: GESTURE_TRACE_CAP,
    recorded: writes,
    kept,
    dropped: Math.max(0, writes - kept),
    firstSeq: kept ? writes - kept + 1 : null,
    lastSeq: kept ? writes : null,
    rows,
  }
}

/** Start a fresh capture. The owner presses this between the SE run and the 15 Pro run. */
export function clearGestureTrace() {
  writes = 0
  ring.fill(undefined)
}

/**
 * The device block. Pasted traces identify their own hardware so the operator never has to
 * annotate which phone a capture came from — the SE-vs-15-Pro diff is the entire point of G0-1,
 * and two files that look alike with no device stamp is how that diff gets mixed up.
 */
function deviceInfo() {
  const nav = typeof navigator !== 'undefined' ? navigator : null
  const win = typeof window !== 'undefined' ? window : null
  return {
    userAgent: nav && typeof nav.userAgent === 'string' ? nav.userAgent : null,
    maxTouchPoints: nav && Number.isFinite(nav.maxTouchPoints) ? nav.maxTouchPoints : null,
    devicePixelRatio: win && Number.isFinite(win.devicePixelRatio) ? win.devicePixelRatio : null,
    screenWidth: win && win.screen && Number.isFinite(win.screen.width) ? win.screen.width : null,
    screenHeight: win && win.screen && Number.isFinite(win.screen.height) ? win.screen.height : null,
    innerWidth: win && Number.isFinite(win.innerWidth) ? win.innerWidth : null,
    innerHeight: win && Number.isFinite(win.innerHeight) ? win.innerHeight : null,
  }
}

/** The whole payload, ready for the clipboard. */
export function gestureTracePayload() {
  const t = readGestureTrace()
  return {
    trace: 'uct-joystick-g0',
    schema: 1,
    capturedAt: new Date().toISOString(),
    // ⭐ READ FROM constants.js, never retyped. The thresholds the engine compared against are part
    // of the evidence: a trace whose `flickMs` disagrees with the build that produced it is
    // unreadable, and a hand-typed 120 here would be the artifact that drifted.
    constants: { FLICK_MS, TRAVEL_PX, OPEN_AT_RATIO },
    device: deviceInfo(),
    window: {
      capacity: t.capacity,
      recorded: t.recorded,
      kept: t.kept,
      dropped: t.dropped,
      firstSeq: t.firstSeq,
      lastSeq: t.lastSeq,
    },
    rows: t.rows,
  }
}

/** The clipboard string. Indented: a human reads this before pasting it anywhere. */
export function gestureTraceJson() {
  return JSON.stringify(gestureTracePayload(), null, 2)
}
