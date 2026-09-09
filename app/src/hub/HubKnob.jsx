// HubKnob — the lifted, opaque knob that sits on the glass pad.
// See docs/plans/joystick/00-master-spec-v1.4.md §5 (dot recolour) and §C2 (naming for the mode).

import styles from './hub.module.css'
import { PAD_PX, KNOB_PX, EDGE_OFFSET_PX, BOTTOM_OFFSET_PX } from './constants'

/**
 * Presentational knob. The gesture engine owns the drag offset and the
 * press/target state; this component only paints them.
 *
 * - `role="button"`, named for the CURRENT MODE — never the target action
 *   (§C2: "The knob is a single role="button" named for the current mode").
 * - The centre dot takes the mode's `--hub-mode-*` colour at rest, and the
 *   TARGET ACTION's own colour once a wedge is selected (spec §5: "on target
 *   change takes the target action's colour").
 * - Never translucent — `--hub-knob-face` is an opaque mix over
 *   `--bg-elevated`; the knob sits ON the glass, not IN it.
 * - The whole layer is `pointer-events: none`: HubPad beneath it is the real
 *   hit-surface (every pointer handler lives there per spec §5), so the knob
 *   must never intercept a drag. This does not remove it from assistive
 *   tech's SWIPE navigation, which walks the accessibility tree rather than
 *   doing touch hit-testing — only direct touch-explore at this exact pixel
 *   would be affected, and the Actions button (§2c) is the WCAG 2.5.1 door
 *   regardless. Not device-verified in this build — flagged in the report.
 *
 * @param {object} props
 * @param {string} props.mode Current mode label, e.g. "Scan" — becomes the accessible name ("Scan mode").
 * @param {string} props.modeColor A `--hub-mode-*` token NAME (e.g. "--hub-mode-scan") for the resting dot.
 * @param {string|null} [props.targetColor] A `--hub-*` token name for the currently targeted action; overrides modeColor.
 * @param {{x:number,y:number}} [props.offset] Current drag translate offset, px (screen coords, y down).
 * @param {boolean} [props.pressing] Long-press-in-progress visual (dot enlarges), per the reference prototype.
 * @param {boolean} [props.dragging] True while a drag is live — suppresses the spring-back transition.
 * @param {boolean} [props.mirrored] Left-handed mode — anchors to the left edge instead of the right.
 */
export default function HubKnob({
  mode,
  modeColor,
  targetColor = null,
  offset = { x: 0, y: 0 },
  pressing = false,
  dragging = false,
  mirrored = false,
}) {
  const sideStyle = mirrored ? { left: `${EDGE_OFFSET_PX}px` } : { right: `${EDGE_OFFSET_PX}px` }
  const dotColor = targetColor || modeColor

  return (
    <div
      className={styles.knobLayer}
      style={{
        ...sideStyle,
        bottom: `calc(env(safe-area-inset-bottom) + ${BOTTOM_OFFSET_PX}px)`,
        width: PAD_PX,
        height: PAD_PX,
      }}
    >
      <div
        role="button"
        aria-label={`${mode} mode`}
        className={`${styles.knobFace} ${dragging ? styles.knobDragging : ''}`.trim()}
        style={{
          width: KNOB_PX,
          height: KNOB_PX,
          transform: `translate(${offset.x}px, ${offset.y}px)`,
        }}
      >
        <span
          className={`${styles.knobDot} ${pressing ? styles.knobDotPressing : ''}`.trim()}
          style={{ backgroundColor: dotColor ? `var(${dotColor})` : undefined }}
        />
      </div>
    </div>
  )
}
