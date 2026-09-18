// HubKnob — the lifted, opaque knob that sits on the glass pad.
// See docs/plans/joystick/00-master-spec-v1.4.md §5 (dot recolour) and §C2 (naming for the mode).

import { forwardRef } from 'react'
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
const HubKnob = forwardRef(function HubKnob({
  mode,
  modeColor,
  targetColor = null,
  offset = { x: 0, y: 0 },
  pressing = false,
  dragging = false,
  mirrored = false,
}, ref) {
  const sideStyle = mirrored ? { left: `${EDGE_OFFSET_PX}px` } : { right: `${EDGE_OFFSET_PX}px` }
  const dotColor = targetColor || modeColor

  /**
   * The light direction, in CSS `linear-gradient` terms: 0deg points up, 90deg right.
   * `offset` is screen coords with y DOWN, so the y term is negated to put 0deg at the top.
   *
   * ⛔ THE RESTING ANGLE IS STATED, NOT DERIVED. At rest `offset` is (0,0) and `atan2(0, 0)`
   * returns 0 — a degenerate vector. 0deg happens to be the value we want at rest (light from
   * above, per D2's single light direction), but it is written explicitly so that the resting
   * look is a decision on the record rather than a coincidence of how atan2 handles (0,0).
   */
  const atRest = offset.x === 0 && offset.y === 0
  const dragAngle = atRest ? 0 : (Math.atan2(offset.x, -offset.y) * 180) / Math.PI

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
        ref={ref}
        role="button"
        /**
         * ⛔⛔ `tabIndex` IS WHAT MAKES `focus()` DO ANYTHING. **D-46.**
         *
         * Spec §C4:952 promises *"Any action that opens a sheet returns focus to the knob on
         * close."* For the life of the feature that was false, and the reason was one attribute:
         * a `<div role="button">` with no `tabIndex` is **not focusable**, so `el.focus()` is a
         * silent no-op. The scope reconciliation found the missing focus CALL; the attribute was
         * the half underneath it, and fixing only the call would have shipped a second no-op.
         *
         * ⭐ `-1`, NOT `0`, and that is deliberate. The hub is mobile-only by construction
         * (`useHubActive.js:84` requires `pointer: coarse`) and §C2 states there is no keyboard in
         * this build, so adding the knob to a tab order nobody traverses would be noise. `-1`
         * makes it programmatically focusable while leaving the screen-reader swipe sweep — which
         * reaches `role="button"` regardless of `tabIndex` — exactly as it was.
         */
        tabIndex={-1}
        /**
         * ⭐ "Joystick, Scan" rather than "Scan mode" — owner ruling with D-46. §C2 requires the
         * knob be "named for the current mode" and this still is; what it adds is the product
         * noun, so a member who lands here from a closing sheet is told WHAT they have landed on
         * and not only which mode it is in. The old name read as a heading for the page.
         */
        aria-label={`Joystick, ${mode}`}
        className={`${styles.knobFace} ${dragging ? styles.knobDragging : ''}`.trim()}
        style={{
          width: KNOB_PX,
          height: KNOB_PX,
          transform: `translate(${offset.x}px, ${offset.y}px)`,
          /**
           * D3 — the specular rim catches light from the direction the thumb is travelling.
           *
           * ⭐ THIS IS THE ONE PLACE THE HUB CAN BEAT ITS REFERENCE SET CHEAPLY: the Camera
           * zoom dial's specular is faked from a model; ours is driven by the actual input,
           * because the drag vector is already in hand every frame.
           *
           * ⛔ IT COSTS NO NEW RENDER, AND THAT IS WHY IT IS SAFE. `w4-material-plan.md` D3
           * warns that a custom property set per frame from JS is a render-loop hazard (H14,
           * the 4.5-hour navigation freeze) and prescribes `element.style.setProperty` on a
           * ref. That prescription guards against ADDING a per-frame state update. This adds
           * none: `offset` is `state.knob`, so HubRoot ALREADY re-renders on every
           * pointermove to move the knob at all. Riding an existing render adds a property,
           * not a render. ⚠️ If the knob is ever moved off React state onto a transform ref,
           * this must move with it — it is not independently safe.
           */
          '--hub-drag-angle': `${dragAngle}deg`,
        }}
      >
        <span
          className={`${styles.knobDot} ${pressing ? styles.knobDotPressing : ''}`.trim()}
          style={{ backgroundColor: dotColor ? `var(${dotColor})` : undefined }}
        />
      </div>
    </div>
  )
})

export default HubKnob
