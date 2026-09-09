// HubPad — the 84px circular glass pad with the brand's 8-tick compass ring.
// See docs/plans/joystick/00-master-spec-v1.4.md §2a (glass/ring) and §5 (pointer handlers).

import { forwardRef } from 'react'
import styles from './hub.module.css'
import { PAD_PX, EDGE_OFFSET_PX, BOTTOM_OFFSET_PX } from './constants'

/**
 * The circular glass hit-surface the gesture engine drags on. Presentational
 * only — every pointer handler below is supplied by the engine (HubRoot's
 * gesture code) and spread straight onto the root node; this component owns
 * no gesture state of its own.
 *
 * Position is the spec's one true offset (§2c), on every page:
 * `right: 24px; bottom: calc(env(safe-area-inset-bottom) + 68px)`, mirrored
 * to `left` for left-handed mode. The compass ring is `aria-hidden` — it is
 * the brand signature, not a control (§C2: "the pad and compass ring are
 * aria-hidden").
 *
 * @param {object} props
 * @param {boolean} [props.mirrored] Left-handed mode — anchors to the left edge instead of the right.
 * @param {(e: import('react').PointerEvent) => void} [props.onPointerDown]
 * @param {(e: import('react').PointerEvent) => void} [props.onPointerMove]
 * @param {(e: import('react').PointerEvent) => void} [props.onPointerUp]
 * @param {(e: import('react').PointerEvent) => void} [props.onPointerCancel]
 * @param {string} [props.className] Extra class names appended to the pad's own.
 *
 * ⭐ FORWARDS ITS REF, AND THAT IS LOAD-BEARING. `useJoystick` reads the pad's true centre from
 * this ref (`getBoundingClientRect`) to turn a pointer position into a centre-relative dx/dy —
 * every angle the fan resolves depends on it. An earlier build attached that ref to a WRAPPER
 * that merely occupied the same fixed box from the same constants; geometrically equivalent on
 * paper, but it made the engine's accuracy depend on two elements staying in sync, and jsdom
 * (which lays nothing out) could never have caught them drifting apart. The ref belongs on the
 * element the finger actually touches.
 */
const HubPad = forwardRef(function HubPad({
  mirrored = false,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  className = '',
}, ref) {
  const sideStyle = mirrored ? { left: `${EDGE_OFFSET_PX}px` } : { right: `${EDGE_OFFSET_PX}px` }

  return (
    <div
      ref={ref}
      data-testid="hub-pad"
      className={`${styles.pad} ${className}`.trim()}
      style={{
        ...sideStyle,
        bottom: `calc(env(safe-area-inset-bottom) + ${BOTTOM_OFFSET_PX}px)`,
        width: PAD_PX,
        height: PAD_PX,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      <div className={styles.padRing} aria-hidden="true" />
    </div>
  )
})

export default HubPad
