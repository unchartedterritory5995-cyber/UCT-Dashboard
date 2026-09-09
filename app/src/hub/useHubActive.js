// Joystick hub — useHubActive(): the ONE answer to "is the hub actually rendering right now?"
// See docs/plans/joystick/00-master-spec-v1.5.md §2 (mount conditions), §2c (the hub is the corner).
//
// ⭐ WHY THIS IS ITS OWN MODULE AND NOT A SECOND EXPORT FROM HubRoot.jsx.
//
// THREE places need this answer and they must never disagree:
//   1. `HubRoot.jsx`      — whether to render the hub at all;
//   2. `Layout.jsx`       — whether to keep mounting `<FeedbackWidget/>`;
//   3. `App.jsx`          — whether to keep mounting `<GlobalVoiceGate/>` (the voice orb).
//
// (2) and (3) exist because when the hub is up it is the ONLY floating control on a touch
// viewport — Voice moves to its inner ring and Feedback into its Actions sheet. If any of the
// three re-derived this predicate for itself, the failure would be silent and ugly: two controls
// stacked in one corner, or a corner with nothing in it at all. Wave 0 measured that overlap at
// 36-42px, so it is not hypothetical.
//
// It lives in its own file rather than beside the component because a module that exports both a
// component and a hook breaks React Fast Refresh (`react-refresh/only-export-components`), and
// because "one authority" reads better as a file than as a footnote on a component.

import useHubSettings from './useHubSettings'

/**
 * Every mount condition, in one place.
 *
 * ⚠️ This is the FULLY-gated signal, not merely `settings.enabled`: it includes the capability and
 * viewport floors. That is deliberate. On a device that fails the `backdrop-filter` /
 * `visualViewport` floor the hub does not render, so the orb and the feedback FAB must keep
 * rendering — otherwise the user is left with a corner containing nothing at all, having lost
 * Voice and Feedback to a control that never appeared.
 *
 * @returns {boolean}
 */
export default function useHubActive() {
  const { settings } = useHubSettings()

  if (!settings.enabled) return false
  // jsdom ships none of the three checks below, which is itself meaningful: an unstubbed test
  // environment looks exactly like a browser too old for the hub, and is treated as one.
  if (typeof CSS === 'undefined' || typeof CSS.supports !== 'function') return false
  if (!CSS.supports('backdrop-filter', 'blur(1px)')) return false
  if (typeof window.visualViewport === 'undefined') return false
  if (typeof window.matchMedia !== 'function') return false
  // Mobile + touch only. Canonical breakpoint (1024), never a new literal.
  if (!window.matchMedia('(max-width: 1023px) and (pointer: coarse)').matches) return false
  return true
}
