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
 * @property {boolean}  [escalate]  the action leads to a surface asking the member to COMMIT, so
 *                                  the fire haptic escalates to warn() (`useJoystick.js:197`).
 *                                  Required on kind:'confirm', legal on kind:'run' — see B5.
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


// ═════════════════════════════════════════════════════════════════════════════
// PHASE 3 CONTRACTS — the seam between the hub and a SECTION PAGE
// ═════════════════════════════════════════════════════════════════════════════
//
// Everything above documents the seam INSIDE `app/src/hub/`. Phase 3 adds a harder one: a section
// config is supplied by a PAGE, at runtime, and a wrong one fails SILENTLY. A missing `onScrub` is
// not an error — it is a gesture that does nothing, on a control whose whole premise is that it
// does something.
//
// There is no TypeScript here, so a `@typedef` is a comment that enforces nothing. That is exactly
// what Phase 2 cost: every prop across an unowned seam was wrong, the hub was non-functional, and
// BOTH unit suites were green throughout. So the Phase 3 contract is CHECKED where the object
// crosses the boundary — `useHubMode` on registration, the confirm sheet on render.
//
// ⭐ AND IT MAKES THIS FILE REACHABLE. `contracts.js` sat on the repo's unreachable-module list
// because a typedef-only module has no runtime importer — and a file nothing imports is a file
// nothing can enforce. These validators give it real callers, which takes it off that list
// legitimately instead of by writing it into an exceptions table.
//
// ⛔ DEV THROWS, PRODUCTION LOGS. A bad config is a programming error: loud in dev and in tests.
// It must NOT white-screen a member's page in production for a control that is a shortcut over a
// page that works without it. The split is `import.meta.env.DEV`, already used in `HubRoot.jsx`.

/** Thrown by every validator below in DEV. Named so a test can assert the KIND, not the string. */
export class HubContractError extends TypeError {
  constructor(message) {
    super(message)
    this.name = 'HubContractError'
  }
}

const isDev = () => {
  try { return Boolean(import.meta.env?.DEV) } catch { return false }
}

/** One reporting policy for every validator — see the DEV/PROD note in the header. */
function report(what, problems) {
  if (!problems.length) return
  const message = `[hub contract] ${what}: ${problems.join('; ')}`
  if (isDev()) throw new HubContractError(message)
  // eslint-disable-next-line no-console
  console.error(message)
}

const isFn = (v) => typeof v === 'function'
const isNum = (v) => typeof v === 'number' && Number.isFinite(v)

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 3 CONTRACTS — every typedef below has a matching `validate*` (railed)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} HubListAdapter
 * How a section exposes the list its cursor walks. The hub never reaches into a page's state; it
 * is handed this.
 * @property {any[]} items
 *   The list AS RENDERED — post filter/sort/merge, in display order. ⛔ Never the raw fetch:
 *   Screener, Journal and Catalysts each re-derive their array locally, and handing over the raw
 *   one makes next/prev visit rows that are not visually adjacent.
 * @property {(item: any, index: number) => string|number} identityKey
 *   Stable per-item identity. The cursor's "is this the same list?" test is the ordered join of
 *   these, NOT the array reference — so a 15s poll returning new objects for the same rows does
 *   not send the cursor home.
 * @property {(index: number) => void} scrollTo
 *   Bring row `index` into view. Required, not optional: a cursor that moves off-screen has
 *   silently stopped being a cursor.
 */

/**
 * The context object every mode callback receives — `onTap`, `onDoubleTap`, `onScrub`,
 * `onScrubCommit`, `readout`, and every action's `run` / `confirmText` / `enabled`.
 *
 * Built in ONE place (`HubRoot.jsx`, the `ctx` useMemo) and read-only apart from `navigate`.
 *
 * ⭐ R-G, 2026-09-10 — `navigate` IS THE ONE ADDITION THAT ACTS. Everything else here is a value
 * or a ref. Before it, a registry-declared mode could not navigate at all: `App.jsx` uses
 * `BrowserRouter`, so there is no `router.navigate` singleton to import, and navigation existed
 * only inside `HubRoot.runAction`. Every section that wanted to DO something had to be mounted
 * from its own page — which blocked §3.8's Home scrub outright, and is why `lastSection` was
 * built, persisted and threaded into this object with zero readers.
 *
 * ⛔ IT IS THE SAME FUNCTION `runAction` CALLS, not a second one. `HubRoot`'s `navigateTo` is used
 * by the navigate branch, by `goHome`, and by this field — so there is exactly ONE navigation
 * authority, and it carries `resolveNavTarget` so "what path does mode X live at" is not
 * re-answered by whichever caller happened to pass a mode id. Rails:
 * `hub/navigationAuthority.test.jsx` proves the identity and that no second navigation path
 * exists anywhere under `app/src/hub/**`.
 *
 * @typedef {object} HubActionCtx
 * @property {string|null} mode              The active mode id.
 * @property {string|null} symbol            The shared symbol, or null.
 * @property {string|null} timeframe
 * @property {*} activeScan
 * @property {*} selectedPosition
 * @property {{current: *}} chartRef
 * @property {*} livePrice
 * @property {boolean} isStreaming
 * @property {string|null} lastSection       Most recently visited SECTION mode id (never `home`).
 * @property {(to: string) => void} navigate  Mode id OR path; `resolveNavTarget` normalises it.
 */

/**
 * @typedef {Object} HubSectionConfig
 * What a page registers with `useHubMode` to become the hub's controller while it is mounted.
 * @property {string} id                      A registry mode id (`registry.js` `modes`).
 * @property {(ctx: object) => void} [onTap]
 * @property {(ctx: object) => void} [onDoubleTap]
 * @property {(ctx: object, scrub: {delta: number, axis: 'x'|'y'}) => void} [onScrub]
 *   ⛔ **TWO ARGUMENTS, CONTEXT FIRST.** `HubRoot.jsx:147` calls `onScrub(ctx, scrub)` and
 *   `registry.js:49` has documented that shape since Phase 2. This typedef said `onScrub(scrub)`
 *   for one commit, and the contract TEST hand-wired the one-argument form to match itself — so a
 *   section built against it would have read `ctx.delta === undefined` on the real page while its
 *   own suite stayed green. That is the Phase 2 seam failure verbatim, reproduced inside the file
 *   written to prevent it, and `validateSectionConfig` cannot catch it (arity is not a shape).
 *   `contractArity.test.js` now derives this from `HubRoot.jsx` instead of restating it.
 *   `delta` is normalized 0..1 along the pad's travel; `axis` says which way the member dragged.
 * @property {(ctx: object) => void} [onScrubCommit]
 *   Fired once on release, after the last `onScrub`. Also context-first (`HubRoot.jsx:151`).
 * @property {(ctx: object) => (string|{label: string, value: string})} [readout]
 *   What the chip shows during a scrub. Context-first like the others. Called per step; must be
 *   cheap and must not mutate.
 * @property {HubListAdapter} [listAdapter]   Required only if the section has a cursor.
 */

/**
 * @typedef {Object} HubCursorApi
 * The shared cursor's public surface (`useHubCursor.js` owns the implementation; this is the shape
 * a section is allowed to rely on).
 * @property {*} item
 * @property {number} index                   -1 when the list is empty.
 * @property {number} count
 * @property {() => void} next                Clamps at the last item; never wraps.
 * @property {() => void} prev                Clamps at the first item; never wraps.
 * @property {(delta: number) => void} scrubTo  0..1, clamped at both ends.
 * @property {(i: number) => Record<string,string>} itemProps
 * @property {(nodes: ArrayLike<Element|null|undefined>) => void} paintCursor
 */

/**
 * @typedef {Object} HubConfirmPayload
 * What opens the confirm sheet. ⚰️ THIS SAID "the sheet is the ONLY way a Phase 3 gesture writes
 * anything" — corrected under owner ruling B4, 2026-09-09. It is ONE commit surface of several:
 * the Journal's stop actions commit through `StopConfirmSheet`, Close through
 * `ClosePositionModal`, and Plan trade through `PlanTradeSheet`. The hub's complete write surface
 * is enumerated and ENFORCED in `writePaths.test.js` — read the manifest there, not a sentence
 * here, because a sentence here is what produced the "exactly two write paths" disagreement.
 * ⚠️ The related claim "a gesture never commits directly (spec §C2, WCAG 2.5.1)" also does not
 * hold universally: `scan.flag` is a `run` action that toggles and syncs with no confirmation
 * surface at all (`screenerSection.js:250`). That is defensible — it is a reversible toggle —
 * but it is an exception to §C2 that nothing had written down. Filed for the owner.
 * @property {string} title
 * @property {string} body                    Plain English. Shown to the member verbatim.
 * @property {string} primaryLabel            The button that performs the write.
 * @property {() => (void|Promise<void>)} onConfirm  Fired at most ONCE per sheet.
 * @property {Array<{name: string, type: 'number'|'text', value: (string|number),
 *   min?: number, max?: number, step?: number}>} [fields]
 *   The EQUAL path, not a fallback: steppers and a numeric input operating on the same value the
 *   gesture produced, for a member who cannot perform a fine drag. This is why the sheet exists
 *   at all rather than the gesture committing.
 */

/**
 * @typedef {Object} PlanTradeSheetProps
 * @property {string} symbol
 * @property {number} entry
 * @property {number} stop
 * @property {number} size
 * @property {string} [sourceMode]            Which section the plan came from.
 * @property {(planned: object) => void} [onPlanned]  Called with the created row.
 * @property {() => void} onClose
 */

/**
 * @typedef {(string|{label: string, value: string})} ChipReadout
 * What `readout()` may return. A bare string is the whole chip; the object form lets the chip
 * style the label and the value differently without the section knowing how.
 */

// ─── validators ──────────────────────────────────────────────────────────────

/**
 * @param {HubListAdapter} adapter
 * @param {string} [where] Call-site label, so a failure names the section rather than the hub.
 */
export function validateListAdapter(adapter, where = 'listAdapter') {
  const p = []
  if (!adapter || typeof adapter !== 'object') {
    report(where, ['expected an object'])
    return adapter
  }
  if (!Array.isArray(adapter.items)) p.push('items must be an array (the RENDERED list, in display order)')
  if (!isFn(adapter.identityKey)) p.push('identityKey must be a function (item, index) => string|number')
  // ⛔ scrollTo is REQUIRED. A cursor that advances off-screen has silently stopped being a
  // cursor: `index` still moves, `data-hub-cursor` still lands, and the member sees nothing.
  if (!isFn(adapter.scrollTo)) p.push('scrollTo must be a function (index) => void')
  report(where, p)
  return adapter
}

/**
 * @param {HubSectionConfig} config
 * @param {string} [where]
 */
export function validateSectionConfig(config, where = 'section config') {
  const p = []
  if (!config || typeof config !== 'object') {
    report(where, ['expected an object'])
    return config
  }
  if (typeof config.id !== 'string' || !config.id) p.push('id must be a non-empty mode id')
  for (const k of ['onTap', 'onDoubleTap', 'onScrub', 'onScrubCommit', 'readout']) {
    if (config[k] != null && !isFn(config[k])) p.push(`${k} must be a function when present`)
  }
  // ⭐ A scrub that reports nothing is the silent half of this seam: the member drags, the value
  // moves, and the chip shows the mode name as though nothing is happening.
  if (isFn(config.onScrub) && !isFn(config.readout)) {
    p.push('a section with onScrub must also supply readout() — a scrub the chip cannot narrate is invisible')
  }
  if (isFn(config.onScrubCommit) && !isFn(config.onScrub)) {
    p.push('onScrubCommit without onScrub can never fire')
  }
  report(`${where} (${config?.id ?? 'no id'})`, p)
  if (config.listAdapter != null) validateListAdapter(config.listAdapter, `${where} (${config.id}) listAdapter`)
  return config
}

/** @param {HubCursorApi} api */
export function validateCursorApi(api, where = 'cursor api') {
  const p = []
  if (!api || typeof api !== 'object') {
    report(where, ['expected an object'])
    return api
  }
  if (!isNum(api.index)) p.push('index must be a finite number (-1 when empty)')
  if (!isNum(api.count)) p.push('count must be a finite number')
  for (const k of ['next', 'prev', 'scrubTo', 'itemProps', 'paintCursor']) {
    if (!isFn(api[k])) p.push(`${k} must be a function`)
  }
  report(where, p)
  return api
}

/**
 * @param {HubActionCtx} ctx
 *
 * ⛔ THE ONE FIELD THAT CAN BE SILENTLY ABSENT. Every other member of ctx is a value that is
 * legitimately null — no symbol selected, no position, nothing streaming — so a missing one is
 * indistinguishable from an empty one and there is nothing to check. `navigate` is different: it is
 * the seam R-G added, and a mode that receives a ctx without it does not throw, it simply does
 * NOTHING on release. That is the present-and-inert failure `registry.js:614` forbids, arriving by
 * omission rather than by design.
 */
export function validateActionCtx(ctx, where = 'action ctx') {
  const p = []
  if (!ctx || typeof ctx !== 'object') {
    report(where, ['expected an object'])
    return ctx
  }
  if (!isFn(ctx.navigate)) {
    p.push('navigate must be a function — without it a mode callback cannot act, and fails silently')
  }
  // `chartRef` is a ref container, not a value: a plain object with `current`. A mode that reaches
  // for `.current` on undefined throws inside a gesture handler, where nothing catches it.
  if (ctx.chartRef != null && typeof ctx.chartRef !== 'object') p.push('chartRef must be a ref object or null')
  report(where, p)
  return ctx
}

/** @param {HubConfirmPayload} payload */
export function validateConfirmPayload(payload, where = 'confirm payload') {
  const p = []
  if (!payload || typeof payload !== 'object') {
    report(where, ['expected an object'])
    return payload
  }
  for (const k of ['title', 'body', 'primaryLabel']) {
    if (typeof payload[k] !== 'string' || !payload[k].trim()) p.push(`${k} must be a non-empty string`)
  }
  if (!isFn(payload.onConfirm)) p.push('onConfirm must be a function')
  if (payload.fields != null) {
    if (!Array.isArray(payload.fields)) p.push('fields must be an array when present')
    else payload.fields.forEach((f, i) => {
      if (!f || typeof f !== 'object') { p.push(`fields[${i}] must be an object`); return }
      if (typeof f.name !== 'string' || !f.name) p.push(`fields[${i}].name must be a non-empty string`)
      if (f.type !== 'number' && f.type !== 'text') p.push(`fields[${i}].type must be 'number' or 'text'`)
      if (f.value == null) p.push(`fields[${i}].value is required`)
      if (f.type === 'number') {
        for (const k of ['min', 'max', 'step']) {
          if (f[k] != null && !isNum(f[k])) p.push(`fields[${i}].${k} must be a number when present`)
        }
        // ⛔ A stepper with no step is a stepper that cannot step — the accessible path silently
        // becomes worse than the gesture it exists to equal.
        if (f.step == null) p.push(`fields[${i}].step is required on a number field (the stepper's increment)`)
      }
    })
  }
  report(where, p)
  return payload
}

/** @param {PlanTradeSheetProps} props */
export function validatePlanTradeSheetProps(props, where = 'plan-trade sheet props') {
  const p = []
  if (!props || typeof props !== 'object') {
    report(where, ['expected an object'])
    return props
  }
  if (typeof props.symbol !== 'string' || !props.symbol.trim()) p.push('symbol must be a non-empty string')
  for (const k of ['entry', 'stop', 'size']) {
    if (!isNum(props[k])) p.push(`${k} must be a finite number`)
  }
  // Mirrors the backend's hard 422: at stop === entry the SIDE is undefined, the risk is zero and
  // r_value is null. A plan that cannot say what it risks is not a plan.
  if (isNum(props.entry) && isNum(props.stop) && props.entry === props.stop) {
    p.push('stop must differ from entry — at stop === entry the side is undefined and the risk is zero')
  }
  if (!isFn(props.onClose)) p.push('onClose must be a function')
  if (props.onPlanned != null && !isFn(props.onPlanned)) p.push('onPlanned must be a function when present')
  report(where, p)
  return props
}

/** @param {ChipReadout} readout */
export function validateChipReadout(readout, where = 'chip readout') {
  const p = []
  if (typeof readout === 'string') { report(where, p); return readout }
  if (!readout || typeof readout !== 'object') p.push('must be a string or {label, value}')
  else {
    if (typeof readout.label !== 'string' || !readout.label) p.push('label must be a non-empty string')
    if (typeof readout.value !== 'string' || !readout.value) p.push('value must be a non-empty string')
  }
  report(where, p)
  return readout
}
