// Joystick hub — THE SHARED INTERFACE CONTRACT. Every prop shape, hook return and event payload
// that crosses a file boundary inside `app/src/hub/` is declared here, once.
// See docs/plans/joystick/00-master-spec-v1.5.md §D0 (file ownership) and 40-phase2-gate.md (retro).
//
// ⛔ DIRECTOR-OWNED, like registry.js. Agents build AGAINST this file and may not change it.
// A needed change goes through docs/plans/joystick/requests.md as a diff, and the Director applies
// it — so the contract can never be edited by the same pass that is trying to satisfy it.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THIS FILE EXISTS — the Phase 2 wave failure, recorded where it can prevent a repeat
// ─────────────────────────────────────────────────────────────────────────────
// Phase 2 built the gesture engine, the six presentational components and the integrator as three
// parallel workstreams. Nobody owned the interface between them, so each side invented one. EVERY
// prop across that seam was wrong:
//
//     HubFan      got `layout`  — wanted `actions`      -> rendered a wedge and ZERO bubbles
//     HubKnob     got `target`  — wanted `targetColor` + `offset`  -> never moved, never recoloured
//     HubChip     got `mode`/`hidden` — wanted `label`/`tapHint`/`open` -> rendered blank
//     HubScrim    got `onDismiss` — wanted `onPointerDown`  -> could not be tapped away
//
// The hub was, in plain terms, non-functional. **Every unit suite on both sides was GREEN the
// entire time**, because each half tested its own contract and neither tested the join. Component
// tests are structurally blind to a severed wire — the same defect class this repo has recorded
// before (`Screener.scanmount.test.jsx` exists for exactly this reason).
//
// Two things follow, and both are load-bearing:
//   1. The contract is written BEFORE the wave, not discovered during it.
//   2. `hubContracts.test.jsx` renders each component with the props DECLARED HERE and asserts the
//      DECLARED behaviour. If a component's real props drift from this file, that suite goes red —
//      which is the check that was missing.

/**
 * @typedef {Object} HubActionRef
 * A registry action as the UI sees it. The full shape is `registry.js`'s `HubAction`; these are
 * the fields anything downstream of the registry is allowed to rely on.
 * @property {string} id
 * @property {string} label     ≤10 chars, sentence case
 * @property {string} icon      a UICON_NAMES value
 * @property {0|1}    ring      0 = outer, 1 = inner
 * @property {string} color     a `--hub-*` token NAME, e.g. "--hub-mode-scan" (never a literal,
 *                              and never pre-wrapped in `var()` — components wrap it themselves)
 * @property {'navigate'|'run'|'confirm'|'home'} kind
 * @property {string[]} [requires]
 * @property {boolean}  [flickable]
 */

/**
 * @typedef {Object} ResolvedTarget
 * What `fanGeometry.resolveTarget` returns and what `useJoystick` hands `onFire`.
 * ⚠️ `onFire` receives THIS, not the bare action — the action is `resolved.action`. Getting that
 * wrong silently fires nothing, because `resolved.kind` is undefined.
 * @property {HubActionRef} action
 * @property {number} index
 * @property {number} angle   degrees, standard math orientation (0 = right, 90 = up)
 * @property {0|1}    ring
 */

/**
 * @typedef {Object} ScrubPayload
 * Emitted continuously while scrubbing. `delta` is normalized against `travelPx`, not raw pixels,
 * so a user's motor settings cannot change what a section receives.
 * @property {number} delta
 * @property {'x'|'y'} axis
 */

/**
 * @typedef {Object} JoystickState
 * The engine's public state. Anything not listed here is private to `useJoystick`.
 * @property {boolean} open        the fan is showing
 * @property {0|1|null} ring       which ring the current push selects
 * @property {ResolvedTarget|null} target
 * @property {boolean} pressing    pointer is down but has not yet travelled `openAtPx`
 * @property {boolean} dragging
 * @property {boolean} scrubbing
 * @property {{x: number, y: number}} knob   clamped visual offset from centre
 * @property {boolean} sticky      fan is held open after release (stickyFan)
 * @property {boolean} edgeGuarded pointerdown began inside the Android back-gesture edge band
 */

/**
 * @typedef {Object} JoystickApi
 * `useJoystick(...)`'s return value.
 * @property {{onPointerDown: Function, onPointerMove: Function, onPointerUp: Function, onPointerCancel: Function}} handlers
 * @property {JoystickState} state
 * @property {() => void} dismiss   closes a sticky/flick-opened fan (knob tap, scrim tap)
 */

/**
 * @typedef {Object} HubPadProps
 * ⭐ FORWARDS ITS REF. `useJoystick` reads the pad's true centre from it; every resolved angle
 * depends on that being the element the finger touches, not a stand-in wrapper.
 * @property {boolean} [mirrored]
 * @property {Function} [onPointerDown]
 * @property {Function} [onPointerMove]
 * @property {Function} [onPointerUp]
 * @property {Function} [onPointerCancel]
 * @property {string}   [className]
 */

/**
 * @typedef {Object} HubKnobProps
 * @property {string}  mode         the mode's LABEL (e.g. "Scan"), not its id — it is announced
 * @property {string}  [modeColor]  a `--hub-mode-*` token NAME; the component wraps it in `var()`
 * @property {string|null} [targetColor] token name of the targeted action; overrides modeColor
 * @property {{x: number, y: number}} [offset]
 * @property {boolean} [pressing]
 * @property {boolean} [dragging]
 * @property {boolean} [mirrored]
 */

/**
 * @typedef {Object} HubFanProps
 * ⚠️ Takes `actions` and computes its own layout via `fanGeometry.fanLayout`. Do NOT pass a
 * precomputed layout — one owner for the geometry.
 * @property {HubActionRef[]} actions
 * @property {boolean} [open]
 * @property {string|null} [selectedId]
 * @property {Set<string>|string[]} [disabledIds]
 * @property {boolean} [mirrored]
 */

/**
 * @typedef {Object} HubChipProps
 * @property {string} label
 * @property {string} tapHint
 * @property {string} [modeColor]  token NAME
 * @property {boolean} [scrubbing]
 * @property {string|null} [scrubReadout]  falls back to the literal "Scrub" while scrubbing
 * @property {boolean} [open]      TRUE hides the chip (the fan replaces it)
 * @property {boolean} [mirrored]
 */

/**
 * @typedef {Object} HubScrimProps
 * ⚠️ Dismiss is `onPointerDown`, not `onDismiss` — it must beat the page underneath to the event.
 * @property {boolean} open
 * @property {string|null} [excludeBottom]  a CSS length the scrim must NOT cover, bottom-anchored
 * @property {Function} [onPointerDown]
 */

/**
 * @typedef {Object} HubActionsButtonProps
 * The WCAG 2.5.1 path: every action reachable with one single-pointer tap, no drag.
 * @property {string} mode                the mode's LABEL
 * @property {HubActionRef[]} actions
 * @property {Set<string>|string[]} [disabledIds]
 * @property {string} [disabledReason]
 * @property {(action: HubActionRef) => void} [onAction]
 * @property {() => void} [onFeedback]    ⛔ MUST be wired: Layout stops mounting FeedbackWidget
 *                                        when the hub is active, so leaving this unwired deletes
 *                                        the only feedback path a mobile member has.
 * @property {boolean} [mirrored]
 */

/**
 * The colour contract, in one place because it was got wrong once.
 * The registry stores TOKEN NAMES (`"--hub-mode-scan"`). Components wrap them in `var()`
 * themselves. Passing a pre-wrapped `var(--x)` produces `var(var(--x))`, which silently resolves
 * to nothing — no error, no warning, just an uncoloured dot.
 * @param {string|null|undefined} tokenName
 * @returns {string|undefined}
 */
export function cssVar(tokenName) {
  return tokenName ? `var(${tokenName})` : undefined
}

/** Every key of `JoystickState`, so a test can assert the engine's public surface has not drifted. */
export const JOYSTICK_STATE_KEYS = Object.freeze([
  'open', 'ring', 'target', 'pressing', 'dragging', 'scrubbing', 'knob', 'sticky', 'edgeGuarded',
])

/**
 * The required prop names for each component, keyed by component name. The contract test renders
 * each component with exactly these and asserts the documented behaviour, so a rename on either
 * side of the seam fails loudly instead of rendering an empty control.
 */
export const COMPONENT_PROPS = Object.freeze({
  HubPad: Object.freeze(['mirrored', 'onPointerDown', 'onPointerMove', 'onPointerUp', 'onPointerCancel']),
  HubKnob: Object.freeze(['mode', 'modeColor', 'targetColor', 'offset', 'pressing', 'dragging', 'mirrored']),
  HubFan: Object.freeze(['actions', 'open', 'selectedId', 'disabledIds', 'mirrored']),
  HubChip: Object.freeze(['label', 'tapHint', 'modeColor', 'scrubbing', 'scrubReadout', 'open', 'mirrored']),
  HubScrim: Object.freeze(['open', 'excludeBottom', 'onPointerDown']),
  HubActionsButton: Object.freeze(['mode', 'actions', 'disabledIds', 'onAction', 'onFeedback', 'mirrored']),
})
