// HubActionsButton — the always-visible, WCAG 2.5.1 door to every action in the current mode.
// See docs/plans/joystick/00-master-spec-v1.4.md §5 (Actions button) and §C2 (why it must exist).

import { useState } from 'react'
import Sheet from '../components/mobile/Sheet'
import UIcon from '../components/ui/UIcon'
// The app's ONE haptics helper — the same module `useJoystick.js:16` imports for the gesture
// door. Never a second `navigator.vibrate` call site (constants.js:160).
import haptics from '../components/mobile/haptics.js'
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
  actions = [],
  mirrored = false,
  disabledIds,
  disabledReason,
  onAction,
  onFeedback,
  onHide,
  hapticsEnabled = true,
}) {
  const [open, setOpen] = useState(false)
  const label = `${mode} actions`

  // "On the inner side of the knob (left of it when right-handed, right of
  // it when mirrored)" (spec §2c/§5) — fixed off the same anchor every other
  // hub piece uses, vertically centred on the pad.
  const verticalOffset = PAD_PX / 2 - MIN_TAP_PX / 2
  const sideStyle = mirrored
    ? { left: `${EDGE_OFFSET_PX + PAD_PX + INNER_GAP_PX}px` }
    : { right: `${EDGE_OFFSET_PX + PAD_PX + INNER_GAP_PX}px` }

  const handlePick = (action) => {
    if (idsHas(disabledIds, action.id)) return
    if (hapticsEnabled) {
      // §C2's equal-path rule is about the CUE too, not only the outcome. The gesture door has
      // fired a cue on every action since Phase 2 and escalated on `escalate` since B5
      // (`useJoystick.js:197-198`: `if (target?.action?.escalate) haptics.warn()` / `else
      // haptics.impact()`); this door — the ONLY door a VoiceOver or TalkBack user has, because
      // both screen readers eat the two-finger Peek — fired nothing at all. A member who cannot
      // perform the drag got a silently quieter product on the most destructive actions in the
      // hub (journal.close among them).
      //
      // ⚠️ THIS IS A SECOND COPY OF THE BRANCH AT `useJoystick.js:197`, and that is a known cost,
      // not an oversight: the shared extraction would have to live in a module `useJoystick.js`
      // imports, and this stream does not own that file. What keeps the two from drifting is
      // `actionsSheetHaptic.test.jsx`, which derives the expected cue for EVERY action of a mode
      // from `registry`'s own `escalate` flag — the same authority line 197 reads — rather than
      // from a list re-typed next to either copy.
      //
      // ⚠️ Fires the HELPER, and asserts nothing about a vibration: iOS Safari exposes no
      // `navigator.vibrate` at all, so `haptics.warn()` there is a no-op that returns `false`
      // (`components/mobile/haptics.js:9`). The contract this path owes the member is the CALL.
      if (action?.escalate) haptics.warn()
      else haptics.impact()
    }
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

      <Sheet open={open} onClose={() => setOpen(false)} variant="auto" title={label} ariaLabel={label}>
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
