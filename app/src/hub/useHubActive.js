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

import { useContext } from 'react'
import useHubSettings from './useHubSettings'
import { AuthContext } from '../context/AuthContext'

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
  const auth = useContext(AuthContext)

  // ⛔ THE SERVER-SIDE KILL SWITCH OUTRANKS EVERYTHING, INCLUDING AN EXPLICIT
  // STORED PREFERENCE. `HUB_PREVIEW_ENABLED=false` in Railway hides the hub for
  // every user with no redeploy — the backend re-reads the env var per request
  // and carries the answer on the auth payload the client already polls.
  //
  // ⭐ `=== false`, NEVER a truthiness test. `undefined` means "a backend that
  // predates this field, or a payload that did not parse" — neither is a
  // decision to kill a shipped feature, and treating them as one would hide the
  // hub for everyone the first time /api/auth/me hiccuped. Only an explicit
  // false from the server counts.
  //
  // Read through `useContext(AuthContext)` rather than the `useAuth()` helper so
  // this hook stays callable outside a provider (it returns null there, and the
  // optional chain leaves the flag undefined = not killed) — HubRoot's own tests
  // render it bare.
  if (auth?.hubPreviewEnabled === false) return false

  if (!settings.enabled) return false
  // jsdom ships none of the three checks below, which is itself meaningful: an unstubbed test
  // environment looks exactly like a browser too old for the hub, and is treated as one.
  if (typeof CSS === 'undefined' || typeof CSS.supports !== 'function') return false
  // ⛔ BOTH SPELLINGS, OR THE HUB EXCLUDES EVERY IPHONE.
  //
  // Measured on a real device (Phase 2 device run 1, iPhone 15 Pro / iOS 17.3.1):
  //     CSS.supports('backdrop-filter', 'blur(1px)')          -> FALSE
  //     CSS.supports('-webkit-backdrop-filter', 'blur(1px)')  -> true
  // iOS Safari ships the property under the `-webkit-` prefix only. Testing the
  // unprefixed name alone therefore failed the capability floor on 100% of iOS — for
  // a control that is MOBILE-ONLY by design — while every other gate (visualViewport,
  // 393x659, pointer: coarse) passed. `hub-root` count on iOS was 0.
  //
  // ⭐ It was invisible locally by construction: jsdom implements neither, so it fails
  // this check either way and the suite reads that as "correctly treated as an old
  // browser". A green unit test and a blank iPhone are the same observation here.
  // `hub.module.css` already declares both properties on every glass surface (verified),
  // so the CSS half never had this bug — only the JS gate did.
  const backdrop = CSS.supports('backdrop-filter', 'blur(1px)')
    || CSS.supports('-webkit-backdrop-filter', 'blur(1px)')
  if (!backdrop) return false
  if (typeof window.visualViewport === 'undefined') return false
  if (typeof window.matchMedia !== 'function') return false
  // Mobile + touch only. Canonical breakpoint (1024), never a new literal.
  if (!window.matchMedia('(max-width: 1023px) and (pointer: coarse)').matches) return false
  return true
}
