// Joystick hub — the way back.
//
// ⛔ WHY THIS EXISTS. "Hide joystick" used to write the preference off, and the only route back
// was an admin editing the database or the member pasting a fetch() into a devtools console.
// A control that can be dismissed and not recovered is a one-way door, and the owner hit it on
// the live admin preview the day it shipped.
//
// So hiding is now session-only by default, and even a PERSISTENT hide leaves this: a discreet
// 12x36 glass tab at the hub's own resting position. Tapping it restores the hub for the
// session and points at the permanent switch.
//
// ⭐ IT IS 12px WIDE ON PURPOSE. It has to be findable without being a second floating control
// competing with the one the member just dismissed — an edge sliver reads as "there is
// something here", not as a button demanding attention. The TAP TARGET is still 44px tall and
// extends inward invisibly, because WCAG 2.5.5 is about the touch area, not the paint.

import styles from './hub.module.css'

/**
 * @param {object} props
 * @param {boolean} props.persistent  The stored preference is off (as opposed to a session hide)
 *   — changes only the toast copy, never whether the tab appears.
 * @param {boolean} [props.mirrored]  Left-handed: the tab sits on the left edge.
 * @param {() => void} props.onRestore  Show the hub again for this session.
 */
export default function HubEdgeTab({ persistent, mirrored = false, onRestore }) {
  return (
    <button
      type="button"
      data-testid="hub-edge-tab"
      className={styles.edgeTab}
      // ⭐ The accessible name is the ACTION, not the shape. "Show joystick" is what a
      // screen-reader user needs; "tab" or "handle" would describe the pixels and tell them
      // nothing about what happens.
      aria-label="Show joystick"
      title="Show joystick"
      style={mirrored ? { left: 0, right: 'auto', borderRadius: '0 6px 6px 0' } : undefined}
      onClick={onRestore}
    >
      <span className={styles.edgeTabGrip} aria-hidden="true" />
    </button>
  )
}

/** The toast shown after a restore — copy differs by how it was hidden. */
export const restoreToast = (persistent) => (
  persistent
    ? 'Turn it back on permanently in Settings → Joystick'
    : 'Joystick back for this session'
)
