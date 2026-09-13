// Joystick hub — the one-time coach mark (Phase 2.5 preview).
//
// A member who has never seen this control has no way to discover that DRAGGING it does
// anything; a glass circle in a corner reads as a button. One tooltip, once, then never again.
//
// ⛔ DISMISSED THROUGH THE SETTINGS BLOB, NOT localStorage. The hub's other preferences
// (`enabled`, `handedness`) already live server-side in `joystick_hub`, and this must too — a
// member who sees the hint on their phone should not see it again on their tablet, and
// `localStorage` is per-device by definition. It is also why dismissal survives a cache clear.
//
// ⭐ IT DISMISSES ITSELF ON THE FIRST REAL USE, not only on the X. Someone who works out the
// gesture unaided has already learned the thing the hint teaches, and showing it again after
// that is noise.

import { useEffect, useRef } from 'react'
import styles from './hub.module.css'

/**
 * @param {object} props
 * @param {boolean} props.show      Whether the hint is still un-dismissed.
 * @param {boolean} props.mirrored  Left-handed: the hint sits on the other side.
 * @param {boolean} props.used      The member has opened the fan at least once this session.
 * @param {() => void} props.onDismiss  Persist the dismissal.
 */
export default function HubCoachMark({ show, mirrored = false, used = false, onDismiss }) {
  const dismissedRef = useRef(false)

  // First real use counts as "understood" — persist once, never on every subsequent open.
  useEffect(() => {
    if (show && used && !dismissedRef.current) {
      dismissedRef.current = true
      onDismiss?.()
    }
  }, [show, used, onDismiss])

  if (!show || used) return null

  return (
    <div
      className={styles.coachMark}
      role="status"
      aria-live="polite"
      style={mirrored ? { left: '24px', right: 'auto' } : undefined}
    >
      <span className={styles.coachMarkText}>Drag for shortcuts · hold to go home</span>
      <button
        type="button"
        className={styles.coachMarkClose}
        aria-label="Dismiss hint"
        onClick={() => { dismissedRef.current = true; onDismiss?.() }}
      >
        ×
      </button>
    </div>
  )
}
