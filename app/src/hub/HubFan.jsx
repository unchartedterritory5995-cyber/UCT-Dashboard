// HubFan — the fan bubbles, quarter-circle wedge backdrop and per-action wedge highlight.
// See docs/plans/joystick/00-master-spec-v1.4.md §5 (fan geometry) and §C2 (colour is never the only signal).

import styles from './hub.module.css'
import UIcon from '../components/ui/UIcon'
import { PAD_PX, EDGE_OFFSET_PX, BOTTOM_OFFSET_PX, FAN_RADIUS_OUTER } from './constants'
import { fanLayout, wedgeAngles, selectWindowFor } from './fanGeometry'

// Spec §5: "Outer bubbles 46px, inner bubbles 36px." These two numbers exist
// only in prose (not in constants.js), so they are named once here rather
// than repeated at each use site below.
const BUBBLE_OUTER_PX = 46
const BUBBLE_INNER_PX = 36

/**
 * WCAG 2.5.5 minimum for a control you TAP rather than drag to.
 *
 * ⭐ Only applies while the fan is STICKY-open. During a drag, selection is by wedge
 * angle over a whole sector — the bubble's own box is irrelevant and a 36px circle is
 * a drawing, not a target. The moment the fan sticks open, the same circle becomes a
 * tappable control, and 36px is under the floor the rest of this app enforces via
 * `--tap-min`. The visual size does not change; the HIT BOX grows underneath it.
 */
const STICKY_HIT_MIN_PX = 44

// How far past the outer bubble ring the wedge backdrop's bounding square
// reaches, so the glass wash visually extends past the farthest bubble —
// mirrors the reference prototype's `--arc + 40px` sizing (prototype.html).
const WEDGE_MARGIN_PX = 40

function idsHas(ids, id) {
  if (!ids) return false
  if (typeof ids.has === 'function') return ids.has(id)
  if (Array.isArray(ids)) return ids.includes(id)
  return false
}

/**
 * A math-degree angle (0 = right, 90 = up) as the CSS `conic-gradient` stop
 * value for a quarter-circle pivoted at the pad centre, `from 180deg at 100%
 * 100%` — the exact mapping `prototype.html` uses for its wedge slices
 * (ported here to token colours; the trig itself is unchanged from the
 * reference so it does not need re-deriving or re-verifying).
 */
function cssAngle(mathDeg) {
  return mathDeg - 90
}

/**
 * Fixed-viewport style for the wedge backdrop, pivoted at the pad centre.
 *
 * The right-handed CSS (`right`, `border-radius: 100% 0 0 0`, the
 * `conic-gradient` in hub.module.css) is the one PROVEN recipe — copied
 * verbatim from the reference prototype. Rather than re-deriving a SECOND,
 * independently-verified formula for the mirrored case (a second authority
 * over the same shape, and one this build has no device to check), the
 * mirrored box is positioned at the same offset from the LEFT edge and then
 * flipped in place with `scaleX(-1)`. That is a derived equivalence, not a
 * guess: a box positioned at `left: L` with width `W` has its untransformed
 * pivot corner (bottom-right, at local-x = W) at viewport-x = L + W;
 * `scaleX(-1)` around the box's own centre maps local-x = W to viewport-x =
 * L — exactly the pad centre. The border-radius and conic-gradient inside
 * the box never need to know which side they are on.
 */
function wedgeContainerStyle({ mirrored, size }) {
  const half = PAD_PX / 2
  const style = {
    position: 'fixed',
    width: size,
    height: size,
    bottom: `calc(env(safe-area-inset-bottom) + ${BOTTOM_OFFSET_PX + half}px)`,
  }
  if (mirrored) {
    style.left = `${EDGE_OFFSET_PX + half}px`
    style.transform = 'scaleX(-1)'
  } else {
    style.right = `${EDGE_OFFSET_PX + half}px`
  }
  return style
}

/**
 * Fixed-viewport style for one bubble, from `fanGeometry.fanLayout`'s own
 * `offset` (already mirror-aware — see fanGeometry.js's `bubbleOffset`, which
 * this file does no trigonometry to duplicate). `offset.x` grows rightward
 * and `offset.y` grows downward (screen coords); converting that into a
 * `right`/`bottom` distance from the anchored edge is a sign flip either way,
 * verified against the cardinal cases (e.g. a 180 deg / "straight left"
 * outer bubble must land with `right` 150px LARGER than the pad centre's).
 */
function bubbleStyle({ offset, size, mirrored, colorToken }) {
  const half = PAD_PX / 2
  const bottomPx = BOTTOM_OFFSET_PX + half - size / 2 - offset.y
  const style = {
    position: 'fixed',
    width: size,
    height: size,
    bottom: `calc(env(safe-area-inset-bottom) + ${bottomPx}px)`,
    '--hub-bubble-color': colorToken ? `var(${colorToken})` : 'var(--hub-glass-tint-strong)',
  }
  if (mirrored) style.left = `${EDGE_OFFSET_PX + half - size / 2 + offset.x}px`
  else style.right = `${EDGE_OFFSET_PX + half - size / 2 - offset.x}px`
  return style
}

/**
 * @param {object} props
 * @param {import('./registry').HubAction[]} [props.actions] The current mode's full fan (both rings).
 * @param {boolean} [props.mirrored] Left-handed mode.
 * @param {boolean} [props.sticky] The fan is sticky-open, so bubbles are tap targets and
 *   get a >=44px hit box (WCAG 2.5.5) without changing their drawn size.
 * @param {boolean} [props.open] Visual open/closed state. Bubbles are always in the DOM — spec §5:
 *   "the fan still appears, instantly, every bubble at its final position" under reduced motion —
 *   `open` only toggles the wedge backdrop's opacity via CSS.
 * @param {string|null} [props.selectedId] The currently targeted action id (recolours its wedge + bubble).
 * @param {Set<string>|string[]} [props.disabledIds] Action ids whose `requires` is currently unmet.
 */
export default function HubFan({ actions = [], mirrored = false, open = false, sticky = false, selectedId = null, disabledIds }) {
  const layout = fanLayout(actions, { mirrored })

  const slices = [0, 1].flatMap((ring) => {
    const inRing = actions.filter((a) => a.ring === ring)
    if (inRing.length === 0) return []
    const angles = wedgeAngles(inRing.length)
    const half = selectWindowFor(inRing.length)
    return inRing.map((action, i) => {
      const a0 = angles[i] - half
      const a1 = angles[i] + half
      const on = action.id === selectedId
      return (
        <div
          key={`slice-${action.id}`}
          data-testid={`hub-fan-slice-${action.id}`}
          className={`${styles.fanSlice} ${on ? styles.fanSliceOn : ''}`.trim()}
          style={{
            '--hub-slice-a0': `${cssAngle(a0)}deg`,
            '--hub-slice-a1': `${cssAngle(a1)}deg`,
            '--hub-slice-color': `var(${action.color})`,
          }}
        />
      )
    })
  })

  return (
    <div className={`${styles.fan} ${open ? styles.fanOpen : ''}`.trim()} aria-hidden="true">
      <div className={styles.fanWedge} style={wedgeContainerStyle({ mirrored, size: FAN_RADIUS_OUTER + WEDGE_MARGIN_PX })}>
        {slices}
      </div>
      {layout.map(({ action, ring, offset }) => {
        const size = ring === 1 ? BUBBLE_INNER_PX : BUBBLE_OUTER_PX
        const on = action.id === selectedId
        const disabled = idsHas(disabledIds, action.id)
        return (
          <div
            key={action.id}
            data-testid={`hub-bubble-${action.id}`}
            data-action-id={action.id}
            data-icon={action.icon}
            // ⛔ aria-disabled, NEVER the native `disabled` attribute (spec C2): a natively
            // disabled control can be skipped entirely by VoiceOver's touch sweep, which would
            // hide the very action whose unmet requirement we want announced. Without this the
            // dimming was CSS-only — visible to sighted users, invisible to everyone else.
            aria-disabled={disabled || undefined}
            className={[
              styles.bubble,
              ring === 1 ? styles.bubbleInner : styles.bubbleOuter,
              on ? styles.bubbleOn : '',
              disabled ? styles.bubbleDisabled : '',
            ]
              .filter(Boolean)
              .join(' ')}
            style={{
              ...bubbleStyle({ offset, size, mirrored, colorToken: action.color }),
              // Grow the hit box only, never the drawing: the circle keeps `size` via
              // its own background/border, while the box reaches the tap floor.
              ...(sticky && size < STICKY_HIT_MIN_PX
                ? { minWidth: `${STICKY_HIT_MIN_PX}px`, minHeight: `${STICKY_HIT_MIN_PX}px` }
                : null),
            }}
          >
            <UIcon name={action.icon} size={ring === 1 ? 15 : 18} />
            <span className={styles.bubbleLabel}>{action.label}</span>
          </div>
        )
      })}
    </div>
  )
}
