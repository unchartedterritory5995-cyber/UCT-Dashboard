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
 * ⛔⛔ G3-15 — THE CHIP STOOD UNDER THE ACTIONS BUTTON ON EVERY MODE, AND LABEL LENGTH HAD
 * NOTHING TO DO WITH IT.
 *
 * Measured on an iPhone 15 Pro / iOS 17.6 against production, 2026-09-12
 * (`docs/plans/joystick/g0-1-live-device-run-2026-09-12.md`): the chip and the Actions button
 * overlapped by a **constant 40 x 28 px on every mode** — screener, wire, breadth, dashboard,
 * calendar all returned exactly 40. The glass row asked whether *a long label* reached the
 * button; it does not, because this chip is anchored by its RIGHT edge and grows LEFTWARD. Its
 * right edge sat at a fixed `EDGE_OFFSET_PX + PAD_PX + CHIP_GAP_PX` = 118 while the button owned
 * right-offsets [114, 158], so the last 40px of the chip were behind the button at every width,
 * with every label, forever. Both carry `z-index: 360` and the button is later in the DOM, so it
 * PAINTED and HIT-TESTED on top: `elementFromPoint` inside the band returned the button's `<svg>`.
 *
 * ⭐ THE CLEARANCE IS MEASURED, NEVER TYPED. The owner's ruling is that the chip moves inward by
 * the button's **measured** width plus this gap — `actionsWidthPx` is reported by
 * `HubActionsButton` from its own `getBoundingClientRect()`, because a second, hand-typed copy of
 * that width here is precisely the drift this repo keeps paying for. It also makes the geometry
 * self-correcting: the resulting gap between the chip's right edge and the button's left edge is
 * `CHIP_GAP_PX - INNER_GAP_PX + ACTIONS_CLEARANCE_PX` = 8px **whatever width the button reports**,
 * because the chip's own anchor already sits 4px inside the button's.
 *
 * ⚠️ `actionsWidthPx` of 0 means "no Actions button rendered", and the chip stays where it was.
 * That is not a fallback, it is the condition the ruling names — a chip with no button to clear
 * has nothing to move for, and several tests render this component on its own.
 */
const ACTIONS_CLEARANCE_PX = 4

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
 * @param {number} [props.actionsWidthPx] The Actions button's MEASURED width, reported by
 *   `HubActionsButton` (see `ACTIONS_CLEARANCE_PX` above). `0` means no button is rendered.
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
  actionsWidthPx = 0,
}) {
  // While selecting, the chip becomes the ring readout instead of disappearing.
  if (open && !ringName) return null

  const hint = open && ringName
    ? ringName
    : (scrubbing ? scrubReadout || 'Scrub' : tapHint)
  const verticalOffset = PAD_PX / 2 - CHIP_HEIGHT_PX / 2
  const clearance = actionsWidthPx > 0 ? actionsWidthPx + ACTIONS_CLEARANCE_PX : 0
  const inset = EDGE_OFFSET_PX + PAD_PX + CHIP_GAP_PX + clearance
  const sideStyle = mirrored ? { left: `${inset}px` } : { right: `${inset}px` }

  return (
    <div
      className={styles.chip}
      data-testid="hub-chip"
      role="status"
      aria-live="polite"
      style={{
        ...sideStyle,
        /* ⛔ THE CEILING MOVES WITH THE ANCHOR, WHICH IS THE HALF OF THE FIX THAT IS EASY TO MISS.
         *
         * This chip is `width: auto; white-space: nowrap` and grows leftward with nothing to stop
         * it, so moving the anchor 48px inward moves the point at which a long label runs off the
         * LEFT edge 48px sooner. Measured on the device: the widest shipped chip is the Screener's
         * at 229px, which at the old anchor left 46px of gutter on a 393px viewport and at the new
         * one would leave **-2px** — it would have clipped, and at 360px it would clip by 35.
         * So the chip gets a real ceiling, derived from the same `inset` rather than typed, with
         * `EDGE_OFFSET_PX` reused as the far gutter so no new spacing constant enters the file.
         * `.chipHint` ellipsises inside it and `.chipMode` does not shrink (`hub.module.css`) —
         * the mode name is the part that must survive, the tap hint is the part that may yield. */
        maxWidth: `calc(100vw - ${inset + EDGE_OFFSET_PX}px)`,
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
