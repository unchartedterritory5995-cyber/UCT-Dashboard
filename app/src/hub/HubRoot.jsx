// Joystick hub — Phase 1 mount point (EMPTY positioned container; no knob/fan/gestures yet).
// See docs/plans/joystick/00-master-spec-v1.3.md §2c, §2f, §5, §8/§B11 (enable-gate) and docs/plans/joystick/20-wave05-ux.md §3.

import useHubSettings from './useHubSettings'
import useKeyboardVisible from '../hooks/useKeyboardVisible'

/**
 * The actual pad — split out from HubRoot so that `useKeyboardVisible()`
 * (the one thing in this file that subscribes to a `visualViewport` event
 * listener) is never even CALLED while the hub is gated off.
 *
 * HubRoot's early returns happen before this component exists at all, so
 * React never mounts it and its effect never subscribes. Do NOT inline this
 * back into HubRoot: that would make the hook call conditional on `enabled`,
 * which breaks across a toggle — HubRoot stays mounted for the life of the
 * app (Layout.jsx renders it unconditionally), so `enabled` can flip in
 * place (a settings change, an admin logging in) without HubRoot itself
 * remounting, and the rules of hooks require the same hooks in the same
 * order on every render of one component instance. This split is the ONE
 * piece of the Phase 1 mount worth keeping verbatim across every future
 * revision of this file: whatever else changes, gating off must never cost
 * a listener.
 */
function HubPad() {
  // Visibility only — position stays pure CSS (§2c / Wave 0.5 §3): driving
  // it from visualViewport.resize would add a guaranteed frame of lag the
  // compositor already avoids for a plain `position: fixed` element.
  const keyboardVisible = useKeyboardVisible()

  return (
    <div
      data-testid="hub-root"
      hidden={keyboardVisible}
      style={{
        position: 'fixed',
        right: '24px',
        bottom: 'calc(env(safe-area-inset-bottom) + 68px)',
        width: '84px',
        height: '84px',
        pointerEvents: 'none',
      }}
    />
  )
}

/**
 * Mounted once, as a sibling of `<FeedbackWidget/>` in Layout.jsx (§2c).
 *
 * Renders `null` unless ALL of the following hold — every check below is a
 * synchronous, one-time capability read, never a subscription, so a disabled
 * hub adds NO event listener of any kind:
 *   - `settings.enabled` — the ONE authority for this is `useHubSettings()`
 *     (`./useHubSettings.js`): explicit stored `joystick_hub.enabled` wins;
 *     otherwise `role === 'admin'`; otherwise disabled (spec v1.3 §8/§B11,
 *     Phase 1 gate wording). HubRoot does not re-derive any part of that
 *     rule — it only reads the resolved boolean.
 *   - `CSS.supports('backdrop-filter', 'blur(1px)')` — the glass minimum;
 *     below it there is no fallback variant, per spec (§2).
 *   - `typeof window.visualViewport !== 'undefined'` — iOS Safari 16 /
 *     Android Chrome 110 floor.
 *   - `matchMedia('(max-width: 1023px) and (pointer: coarse)').matches` —
 *     mobile + touch only; the hub never mounts on desktop.
 */
export default function HubRoot() {
  const { settings } = useHubSettings()

  if (!settings.enabled) return null
  if (typeof CSS === 'undefined' || typeof CSS.supports !== 'function') return null
  if (!CSS.supports('backdrop-filter', 'blur(1px)')) return null
  if (typeof window.visualViewport === 'undefined') return null
  if (typeof window.matchMedia !== 'function') return null
  if (!window.matchMedia('(max-width: 1023px) and (pointer: coarse)').matches) return null

  return <HubPad />
}
