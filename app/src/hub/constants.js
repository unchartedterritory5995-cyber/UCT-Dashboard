// Joystick hub — every tunable number in one place. Imported by the engine, the UI and the tests.
// See docs/plans/joystick/00-master-spec-v1.4.md §5 (Phase 2 constants) and §C1 (the vocabulary).
//
// ⭐ WHY THESE ARE EXPORTED CONSTANTS AND NOT LITERALS AT THE USE SITE: three of them are
// user-adjustable at runtime (`travelPx`, `holdMs`, the double-tap window — spec §C2 motor
// settings), and two more are DERIVED from `travelPx` rather than fixed. A literal sprinkled
// through the engine would make a user's tremor setting silently partial.

/** Max distance the knob visually travels from centre, in px. USER-ADJUSTABLE (16–48). */
export const TRAVEL_PX = 24

/**
 * Travel at which the fan opens.
 *
 * ⛔ DERIVED FROM TRAVEL, NOT FIXED. At the default 24px travel this is 10px = 42% of the way out.
 * Hard-coding 10px would turn "open the fan" into 62% of travel for a user who lowers travel to
 * 16px for tremor — a materially different gesture the settings screen never described.
 * Use `openAtPx(travelPx)`, never the bare constant, anywhere travel can be user-set.
 */
export const OPEN_AT_PX = 10
export const OPEN_AT_RATIO = OPEN_AT_PX / TRAVEL_PX
export const openAtPx = (travelPx = TRAVEL_PX) => travelPx * OPEN_AT_RATIO

/** Fraction of travel past which a push selects the OUTER ring instead of the inner one. */
export const RING_SPLIT = 0.8
export const ringSplitPx = (travelPx = TRAVEL_PX) => travelPx * RING_SPLIT

/** Hold-to-Home. USER-ADJUSTABLE (300–1200). */
export const HOLD_MS = 500

/** Window in which a second tap counts as Reverse. USER-ADJUSTABLE (200–600). */
export const DOUBLE_TAP_MS = 280

/** A press shorter than this, that travelled at least `openAtPx`, is a flick. */
export const FLICK_MS = 120

/** Fan radii, px from the pad centre. */
export const FAN_RADIUS_OUTER = 150
export const FAN_RADIUS_INNER = 96

/**
 * The fan occupies ONE quadrant opening toward the upper-left, expressed in standard math degrees
 * (0° = right, 90° = up), so the usable arc is 90°…180°. QUADRANT_DEG widens that to [60, 210] as
 * the ACCEPTANCE band: a thumb arcing off the end of the fan should still resolve to the end
 * action rather than falling into dead space.
 */
export const QUADRANT_DEG = [60, 210]

/**
 * An action is selectable within this many degrees of its own wedge centre — a **FLOOR, not a cap**.
 *
 * ⛔ DO NOT "FIX" THIS BACK TO A FLAT ±30°. Selection uses
 * `fanGeometry.selectWindowFor(n) = max(30°, half-spacing)`, with nearest-wins resolving the
 * overlap that produces in dense fans. Accepted at the Phase 2 gate, and it exists because a flat
 * ±30° left a **dead zone**: two actions sit at 90° and 180°, so a thumb at 135° — the middle of
 * the fan, the most natural place to point — was 45° from both and selected nothing. Every
 * 2-action ring in the registry had that hole, Flow's entire fan included. A dead patch in the
 * middle of the fan defeats the whole reason selection is by angle rather than by hit-testing a
 * bubble. Rail: `fanGeometry.test.js`, "keeps the middle of a 2-action fan LIVE".
 */
export const SELECT_WINDOW_DEG = 30

/**
 * Android claims edge swipes from BOTH screen edges and a browser tab cannot opt out (deferred
 * D-28). A pointerdown starting within EDGE_GUARD_PX of the right edge does not move the knob
 * until the pointer has travelled EDGE_GUARD_TRAVEL_PX inward — so a system back-swipe that the
 * browser then cancels leaves no half-opened fan behind.
 */
export const EDGE_GUARD_PX = 20
export const EDGE_GUARD_TRAVEL_PX = 10

/**
 * ⚰️ THERE ARE NO HAPTIC DURATION CONSTANTS HERE, DELIBERATELY.
 *
 * An earlier draft of this file exported `HAPTIC_OPEN_MS = 8`, `HAPTIC_TARGET_MS = 4`,
 * `HAPTIC_FIRE_MS = 12` and `HAPTIC_CONFIRM_PATTERN = [10,40,10]` — the numbers the spec names.
 * They were unusable: `app/src/components/mobile/haptics.js` exposes `tap()` / `impact()` /
 * `success()` / `warn()`, each with its own fixed pattern baked in and **no parameter**. Nothing
 * could have consumed them, so they were four authoritative-looking numbers that no code path read
 * — the exact shape of drift this repo keeps paying for.
 *
 * ⭐ THE MAPPING (owner ruling, Phase 2 gate) — `app/src/components/mobile/haptics.js`:
 *
 *     fan open        → tap()
 *     target change   → tap()
 *     action fires    → impact()
 *     confirm sheet   → warn()
 *
 * Open and target-change deliberately share `tap()`: both are "something moved under your thumb",
 * and the escalation the hand should feel is reserved for the two events that actually DO
 * something — a fire, and a sheet asking for confirmation.
 *
 * ⛔ Never add a second `navigator.vibrate` call site. If a duration genuinely needs to change,
 * change it in `haptics.js`, where every consumer in the app already reads it.
 */

/** Pad geometry (px). The pad's own box; `right`/`bottom` offsets live in the CSS. */
export const PAD_PX = 84
export const KNOB_PX = 38

/** Spec §2c: `right: 24px; bottom: calc(env(safe-area-inset-bottom) + 68px)`. */
export const EDGE_OFFSET_PX = 24
export const BOTTOM_OFFSET_PX = 68

/**
 * On the portrait phone chart the scrim must not cover the volume band.
 *
 * ⚠️ THIS IS AN APPROXIMATION AND MUST BE DESCRIBED AS ONE. The volume pane is drawn inside the
 * Lightweight Charts canvas and has no DOM element, so there is nothing to measure from outside.
 * 22% is the chart's OWN default `cs.volume.paneHeightPct`, and `calc(22% + 32px)` is the value
 * `StockChart.module.css` already uses as the range bar's "above the volume pane" fallback.
 * It is wrong in three known ways: volume is an overlay band inside the price pane by default
 * (not a pane at all), the user can drag the divider anywhere in [8%, 45%], and volume can be off
 * entirely. See deferred D-26 for the real fix.
 */
export const CHART_SCRIM_EXCLUDE_BOTTOM = 'calc(22% + 32px)'
