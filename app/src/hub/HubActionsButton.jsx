// HubActionsButton — the always-visible, WCAG 2.5.1 door to every action in the current mode.
// See docs/plans/joystick/00-master-spec-v1.4.md §5 (Actions button) and §C2 (why it must exist).

import { useLayoutEffect, useRef, useState } from 'react'
import Sheet from '../components/mobile/Sheet'
import HubScrubRange from './HubScrubRange'
import UIcon from '../components/ui/UIcon'
// The app's ONE haptics helper — the same module `useJoystick.js:16` imports for the gesture
// door. Never a second `navigator.vibrate` call site (constants.js:160).
import { escalateCue } from './escalateCue.js'
import styles from './hub.module.css'
import { PAD_PX, EDGE_OFFSET_PX, BOTTOM_OFFSET_PX } from './constants'

// Matches `--tap-min` (tokens.css). A literal here rather than `var(--tap-min)`
// so the size is directly readable off the button's OWN declared inline
// style, per the spec's test requirement ("the Actions button is >=44px by
// its declared style") — jsdom does not resolve an external stylesheet's
// custom properties through `element.style`, only what was set inline.
const MIN_TAP_PX = 44

// Gap between the button's outer edge and the pad's inner edge — the
// prototype has no equivalent element to copy this from (it predates the
// Actions button, added at the Phase 1 gate), so this is a presentational
// default, not a spec-given number.
const INNER_GAP_PX = 6

/**
 * How far BELOW the Actions button the Feedback button sits, in the same column (D-25).
 *
 * ⭐ THE SLOT WAS CHOSEN BY MEASUREMENT, not by eye. Every other hub element is anchored off the
 * same three constants, so the occupied bands at rest are computable: the pad and knob own
 * x[24..108] y[68..152]; the chip owns y[96..124] from x 118 inward; the Actions button owns
 * x[114..158] y[88..132]; the coach mark sits at y[162..] out to x 234; the edge tab (hidden
 * state only) owns x[0..44] y[92..136]. The band BELOW the Actions button in its own column —
 * y[38..82], x[114..158] — is the one rest-state rectangle no hub element claims, and it is the
 * band the app already reserves for a FAB: the voice orb and the old Feedback FAB both sat there,
 * and both are unmounted while the hub is up (`Layout.jsx`'s gate reads `hubWouldRender`).
 *
 * ⛔ IT MIRRORS WITH THE HUB, on the pad's edge — NOT on the far one. The deferred row remembers
 * the old FAB as bottom-LEFT and "never actually collided", and putting it back there would be
 * two mistakes: it breaks §C2:769 ("mirroring moves the hub as a unit", railed by
 * `mirrorsAsAUnit.test.jsx`) and, for a left-handed member whose pad is on the left, it strands
 * the one-tap affordance under the other hand.
 */
const FEEDBACK_DROP_PX = MIN_TAP_PX + INNER_GAP_PX

function idsHas(ids, id) {
  if (!ids) return false
  if (typeof ids.has === 'function') return ids.has(id)
  if (Array.isArray(ids)) return ids.includes(id)
  return false
}

/**
 * A real `<button>`, visible at rest (not only while the fan is open), that
 * opens a sheet listing every action of the current mode plus a Feedback
 * entry. This is the load-bearing accessibility path: VoiceOver and TalkBack
 * both reserve two-finger tap for their own use, so the Peek gesture never
 * reaches the page for a screen-reader user (spec §C2) — this button is the
 * only door that satisfies WCAG 2.5.1 for those users.
 *
 * Uses `components/mobile/Sheet.jsx` for the sheet body — its focus trap,
 * Escape handling and focus restore are not reimplemented here. Forces
 * `role="list"`/`role="listitem"` around the actions because iOS VoiceOver
 * drops list semantics under `list-style: none` (§C2). Disabled actions get
 * `aria-disabled`, never the native `disabled` attribute — a `disabled`
 * control can be unreachable by VoiceOver's touch sweep, which would hide
 * the very actions whose reason we want announced.
 *
 * @param {object} props
 * @param {string} props.mode Current mode label, e.g. "Scan" — the button's own name is "{mode} actions".
 * @param {import('./registry').HubAction[]} [props.actions] The current mode's full fan (both rings).
 * @param {boolean} [props.mirrored] Left-handed mode — positions on the inner (right) side of the knob instead.
 * @param {Set<string>|string[]} [props.disabledIds] Action ids whose `requires` is currently unmet.
 * @param {(action: import('./registry').HubAction) => string|null} [props.disabledReason]
 *   Optional human reason surfaced next to a disabled action (e.g. "Needs a symbol").
 * @param {(action: import('./registry').HubAction) => void} [props.onAction] Fired when an enabled action is picked.
 * @param {() => void} [props.onFeedback] Fired when the Feedback entry is picked.
 * @param {boolean} [props.hapticsEnabled] The member's `joystick_hub.haptics` preference.
 *   Defaults to `true` — the SAME "unset means on" rule the gesture door applies
 *   (`useJoystick.js:126`, `const hapticsEnabled = settings.haptics !== false`) and the same
 *   value `HUB_SETTINGS_DEFAULTS.haptics` starts a fresh account with (`useHubSettings.js:56`).
 *
 *   ⛔ UNWIRED AT THE ONE CALL SITE. `HubRoot.jsx:414-423` does not pass this prop, so a member
 *   who has explicitly turned haptics OFF still feels the sheet's cue. Closing that needs ONE
 *   line in `HubRoot.jsx` — `hapticsEnabled={settings.haptics !== false}` — where `settings` is
 *   already in scope (`HubRoot.jsx:73`) and already handed to `useJoystick` (`HubRoot.jsx:216`).
 *   Left undone here only because this stream does not own `HubRoot.jsx` (H8, Increment 4
 *   Stream E). Default `true` was chosen over `false` deliberately: `false` would have shipped
 *   the cue built, tested green and unreachable, which is the worse of the two failures.
 */
export default function HubActionsButton({
  mode,
  // The mounted section config and the shared ctx — passed straight through to the scrub range
  // so it drives the SECTION'S OWN onScrub/onScrubCommit rather than a second implementation.
  config,
  ctx,
  actions = [],
  mirrored = false,
  disabledIds,
  disabledReason,
  onAction,
  onFeedback,
  onHide,
  hapticsEnabled = true,
  // ⭐ The commit cue's wiring, supplied by HubRoot so ONE place decides what the cue looks like.
  // Both default to "no visual" — unwired, this door degrades to haptics-only, which is what it
  // did before, rather than crashing on a missing prop.
  cueEl = null,
  cueClassName = '',
  // ⭐ G3-15: the button reports its OWN rendered width upward, and nothing else may guess it.
  // Optional — unwired, this reports nothing and the chip stays where it was, which is the
  // pre-fix geometry rather than a crash. See the effect below.
  onMeasure = null,
}) {
  // ⚰️ THE `open` / `onOpenChange` PAIR IS GONE, with the gesture it existed for. This button was
  // made optionally controlled so the two-finger Peek could open the SAME sheet rather than a
  // second one. Peek was removed by owner ruling (2026-09-10) and `HubRoot` was its only caller,
  // so the props were a capability with no consumer and a comment naming a feature that no longer
  // exists — which reads as precedent to whoever finds it next. The button owns its own state
  // again, which is what it did before §C1 and what every test already assumed.
  const [open, setOpen] = useState(false)
  const label = `${mode} actions`

  // "On the inner side of the knob (left of it when right-handed, right of
  // it when mirrored)" (spec §2c/§5) — fixed off the same anchor every other
  // hub piece uses, vertically centred on the pad.
  const verticalOffset = PAD_PX / 2 - MIN_TAP_PX / 2
  const sideStyle = mirrored
    ? { left: `${EDGE_OFFSET_PX + PAD_PX + INNER_GAP_PX}px` }
    : { right: `${EDGE_OFFSET_PX + PAD_PX + INNER_GAP_PX}px` }

  /**
   * ⛔⛔ G3-15 — READ AT LAYOUT, NEVER TYPED. The chip has to clear this button, and the owner's
   * ruling is explicit that the number comes from the rendered box, not from a constant copied
   * into `HubChip`. This is the only place that can honestly answer "how wide is it": the button
   * declares `minWidth: MIN_TAP_PX` but its real width is whatever the icon, padding and the
   * member's Dynamic Type setting make it, and a hand-typed 44 in the chip would be right until
   * the first day it was not.
   *
   * ⭐ `useLayoutEffect`, not `useEffect`: the chip re-renders off this value, and a paint at the
   * old anchor followed by a corrected one is a visible jump on every mount.
   *
   * ⚠️ `getBoundingClientRect()` RETURNS 0 IN JSDOM, which has no layout engine — so a bare
   * measurement would report "no button" to every unit test and the chip would never move in any
   * of them (`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`: the rail would pass by
   * measuring nothing). A zero therefore falls back to `MIN_TAP_PX`, which is not a hard-coded
   * anchor — it is this button's OWN declared floor, from the same constant the inline style
   * uses, and a real browser overrides it with the real number on the same frame.
   *
   * `ResizeObserver` keeps it honest afterwards (Dynamic Type, an icon swap); its absence is not
   * an error, only the loss of the follow-up — jsdom ships none.
   */
  const btnRef = useRef(null)
  useLayoutEffect(() => {
    const el = btnRef.current
    if (!onMeasure || !el) return undefined
    const report = () => {
      const measured = Math.round(el.getBoundingClientRect().width)
      onMeasure(measured > 0 ? measured : MIN_TAP_PX)
    }
    report()
    if (typeof ResizeObserver !== 'function') return undefined
    const ro = new ResizeObserver(report)
    ro.observe(el)
    return () => ro.disconnect()
  }, [onMeasure])

  const handlePick = (action) => {
    if (idsHas(disabledIds, action.id)) return
    // ⛔⛔ ONE IMPLEMENTATION, AND THIS DOOR NO LONGER OWNS A COPY OF IT.
    //
    // §C2's equal-path rule is about the CUE too, not only the outcome. The gesture door has fired
    // a cue on every action since Phase 2 and escalated on `escalate` since B5; this door — the
    // ONLY door a VoiceOver or TalkBack member has, because both screen readers eat the two-finger
    // Peek — once fired nothing at all, then fired a SECOND COPY of the same branch. Both are gone:
    // `escalateCue` decides, for both doors, and this passes it the wiring HubRoot supplies.
    //
    // ⭐ AND IT IS WHY THE VISUAL FALLBACK MATTERS MOST HERE. `haptics.warn()` returns false
    // wherever `navigator.vibrate` is absent — every iPhone — so on iOS a member using the
    // accessible door got no escalation at all on the most destructive actions in the hub.
    // `escalateCue` consults that return value and paints the knob dot when it is false.
    escalateCue(action, {
      el: typeof cueEl === 'function' ? cueEl() : (cueEl?.current ?? cueEl ?? null),
      className: cueClassName,
      hapticsEnabled,
    })
    setOpen(false)
    onAction?.(action)
  }

  const handleFeedback = () => {
    setOpen(false)
    onFeedback?.()
  }

  const handleHide = () => {
    setOpen(false)
    onHide?.()
  }

  return (
    <>
      <button
        type="button"
        ref={btnRef}
        className={styles.actionsButton}
        style={{
          ...sideStyle,
          bottom: `calc(env(safe-area-inset-bottom) + ${BOTTOM_OFFSET_PX + verticalOffset}px)`,
          minWidth: MIN_TAP_PX,
          minHeight: MIN_TAP_PX,
        }}
        aria-label={label}
        onClick={() => setOpen(true)}
      >
        <UIcon name="sliders" size={18} />
      </button>

      {/* ⛔ D-25 — FEEDBACK IS ONE TAP AGAIN. The gate decision moved it behind the two-finger
          Peek, which made it a gesture plus two taps; and with the hub up, `Layout.jsx` stops
          mounting `<FeedbackWidget/>`, so that WAS the only feedback path a mobile member had.
          The row offered "reverse the decision, or promote Feedback to an inner-ring action" —
          the ring is not available: measured against the registry, six of ten modes already sit
          at `INNER_MAX` (scan, chart, journal, catalysts, notebook, home all have 4), so
          promoting it would evict a shipped action from six fans or ship a ring over its cap.
          So the decision is reversed instead, and the affordance comes back as its own control.
          ⭐ THE SHEET ENTRY STAYS. This is an icon button; the sheet's row is the labelled,
          screen-reader path (VoiceOver and TalkBack both eat the two-finger Peek, §C2) and the
          discoverable one. Two doors, one destination — never two destinations. */}
      {onFeedback ? (
        <button
          type="button"
          data-testid="hub-feedback"
          className={styles.feedbackButton}
          style={{
            ...sideStyle,
            bottom: `calc(env(safe-area-inset-bottom) + ${BOTTOM_OFFSET_PX + verticalOffset - FEEDBACK_DROP_PX}px)`,
            minWidth: MIN_TAP_PX,
            minHeight: MIN_TAP_PX,
          }}
          aria-label="Send feedback"
          onClick={() => {
            // The same cue the sheet's own rows fire for a non-escalating pick — now through
            // `escalateCue` with no action, which IS the non-escalating branch. ⭐ That keeps the
            // rail true in the strong form: exactly one non-test file in the hub may call the
            // haptics helper for a cue, so a third copy cannot appear without failing it.
            escalateCue(null, { hapticsEnabled })
            onFeedback()
          }}
        >
          <UIcon name="chat" size={18} />
        </button>
      ) : null}

      <Sheet open={open} onClose={() => setOpen(false)} variant="auto" title={label} ariaLabel={label}>
        {/* ⭐ SCRUB'S NO-DRAG DOOR, and it belongs HERE rather than on the pad (§C2).
            Every ACTION already had one — this sheet, opened by a single tap on the Actions
            button, which is what actually satisfies WCAG 2.5.1. Scrub had none: it is a
            continuous value, not a list entry, so the only way to move it was a precise drag.
            Putting the range inside the sheet means the one door a member can already reach
            without dragging now reaches everything the mode can do, not just its actions.
            Renders null for a mode with no scrub — an inert slider would announce a capability
            the section does not have. */}
        <HubScrubRange config={config} ctx={ctx} label={mode} />
        <ul className={styles.actionList} role="list">
          {actions.map((action) => {
            const disabled = idsHas(disabledIds, action.id)
            const reason = disabled ? disabledReason?.(action) : null
            return (
              <li key={action.id} role="listitem" className={styles.actionListItem}>
                <button
                  type="button"
                  className={styles.actionListButton}
                  aria-disabled={disabled ? 'true' : undefined}
                  onClick={() => handlePick(action)}
                >
                  <UIcon name={action.icon} size={18} />
                  <span>{action.label}</span>
                  {reason ? <span className={styles.actionReason}>{reason}</span> : null}
                </button>
              </li>
            )
          })}
          <li role="listitem" className={styles.actionListItem}>
            <button type="button" className={styles.actionListButton} onClick={handleFeedback}>
              <UIcon name="chat" size={18} />
              <span>Feedback</span>
            </button>
          </li>
          {onHide ? (
            <li role="listitem" className={styles.actionListItem}>
              {/* The member's opt-out. It lives in the SHEET, not on the pad, because it must
                  be reachable by a screen-reader user and by anyone who cannot perform the
                  drag — the same WCAG 2.5.1 single-pointer path every other action uses. */}
              <button type="button" className={styles.actionListButton} onClick={handleHide}>
                <UIcon name="moveStop" size={18} />
                <span>Hide joystick</span>
              </button>
            </li>
          ) : null}
        </ul>
      </Sheet>
    </>
  )
}
