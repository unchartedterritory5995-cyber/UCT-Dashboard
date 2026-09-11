// HubChip — the mode-label chip that sits left of the pad (right when mirrored).
// See docs/plans/joystick/00-master-spec-v1.4.md §5 (chip) and §C1/§C2 (scrub readout, live region).

import styles from './hub.module.css'
import { PAD_PX, EDGE_OFFSET_PX, BOTTOM_OFFSET_PX } from './constants'

// The reference prototype's chip height (prototype.html `.chip{height:28px}`)
// — used only to vertically centre the chip on the pad; the rendered chip's
// actual height is CSS-driven (`hub.module.css` `.chip{height:28px}` too, so
// this stays in sync by construction rather than by two separately-typed 28s
// silently drifting apart).
const CHIP_HEIGHT_PX = 28
const CHIP_GAP_PX = 10

/**
 * Presentational mode chip: label + tap hint (or, mid-scrub, a live readout).
 *
 * - `role="status" aria-live="polite"` (§C2).
 * - Hidden entirely while the fan is open (§5: "hidden while the fan is
 *   open") — returns `null` rather than an empty/aria-hidden node, since a
 *   hidden status region has nothing to announce anyway.
 * - During a scrub (`scrubbing`), shows `scrubReadout`, or the literal string
 *   "Scrub" when none is supplied yet — Phase 3 sections supply the real one
 *   (spec: "Scrub always shows a live readout in the mode chip").
 *
 * @param {object} props
 * @param {string} props.label Mode label, e.g. "Scan".
 * @param {string} props.tapHint What tap does in this mode, e.g. "tap: next result".
 * @param {boolean} [props.scrubbing] True while a hold+drag scrub is live.
 * @param {string|null} [props.scrubReadout] The live scrub value, e.g. "3/41" or a date.
 * @param {boolean} [props.open] Whether the fan is open. The chip hides — UNLESS `ringName`
 *   is set, in which case it stays up naming the ring under the thumb.
 * @param {string|null} [props.ringName] The ring currently being selected ("Actions" / "Tools").
 *   ⭐ This is the ONLY thing that teaches a user the fan has two rings. Reach mode makes both
 *   reachable; without a label, the inner ring is still folklore. Set only while selecting.
 * @param {boolean} [props.mirrored] Left-handed mode — sits right of the pad instead of left.
 * @param {string} [props.modeColor] A `--hub-mode-*` token name for the label's colour.
 */
export default function HubChip({
  label,
  tapHint,
  scrubbing = false,
  scrubReadout = null,
  open = false,
  ringName = null,
  mirrored = false,
  modeColor,
}) {
  // While selecting, the chip becomes the ring readout instead of disappearing.
  if (open && !ringName) return null

  const hint = open && ringName
    ? ringName
    : (scrubbing ? scrubReadout || 'Scrub' : tapHint)
  const verticalOffset = PAD_PX / 2 - CHIP_HEIGHT_PX / 2
  const sideStyle = mirrored
    ? { left: `${EDGE_OFFSET_PX + PAD_PX + CHIP_GAP_PX}px` }
    : { right: `${EDGE_OFFSET_PX + PAD_PX + CHIP_GAP_PX}px` }

  return (
    <div
      className={styles.chip}
      data-testid="hub-chip"
      role="status"
      aria-live="polite"
      style={{
        ...sideStyle,
        bottom: `calc(env(safe-area-inset-bottom) + ${BOTTOM_OFFSET_PX + verticalOffset}px)`,
      }}
    >
      <b className={styles.chipMode} style={{ color: modeColor ? `var(${modeColor})` : undefined }}>
        {label}
      </b>
      <span className={styles.chipHint}>{hint}</span>
    </div>
  )
}
