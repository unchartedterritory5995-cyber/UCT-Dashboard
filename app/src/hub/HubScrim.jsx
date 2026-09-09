// HubScrim — covers the page while the fan is open and blocks pointer events beneath it.
// See docs/plans/joystick/00-master-spec-v1.4.md §5 (dim + freeze) and §2c (volume-pane exclusion).

import styles from './hub.module.css'

/**
 * Full-viewport dim layer. Presentational only — `open` and `excludeBottom`
 * are both owned by the caller (HubRoot's gesture engine).
 *
 * `excludeBottom` (a CSS length, e.g. `"calc(22% + 32px)"`) keeps the scrim
 * off that much of the BOTTOM of the viewport — Phase 2 passes
 * `CHART_SCRIM_EXCLUDE_BOTTOM` (constants.js) on the portrait phone chart so
 * the scrim never covers the volume pane region (spec §2c). Implemented by
 * overriding just the `bottom` inset rather than shrinking the element's
 * height from a fixed top, so top/left/right stay a plain full-bleed `inset:
 * 0` in every other case.
 *
 * @param {object} props
 * @param {boolean} props.open
 * @param {string|number|null} [props.excludeBottom] A CSS length; when set, the scrim's bottom
 *   edge sits this far above the true bottom of the viewport instead of covering it.
 * @param {(e: import('react').PointerEvent) => void} [props.onPointerDown] Tapping the scrim is
 *   how `stickyFan` is dismissed (spec §C2) — wired by the caller, not decided here.
 */
export default function HubScrim({ open, excludeBottom = null, onPointerDown }) {
  if (!open) return null

  return (
    <div
      data-testid="hub-scrim"
      className={styles.scrim}
      style={excludeBottom != null ? { bottom: excludeBottom } : undefined}
      aria-hidden="true"
      onPointerDown={onPointerDown}
    />
  )
}
