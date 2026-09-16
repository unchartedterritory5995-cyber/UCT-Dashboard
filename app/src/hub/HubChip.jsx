// HubChip — the mode-label chip that sits left of the pad (right when mirrored).
// See docs/plans/joystick/00-master-spec-v1.4.md §5 (chip) and §C1/§C2 (scrub readout, live region).

import { useCallback, useLayoutEffect, useRef, useState } from 'react'

import styles from './hub.module.css'
import { PAD_PX, EDGE_OFFSET_PX, BOTTOM_OFFSET_PX } from './constants'
import {
  clearedCeiling, floorWidth, geometryKey, isOccluder, probePoints,
} from './chipClearance'

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
  const chipRef = useRef(null)
  const modeRef = useRef(null)
  const hintRef = useRef(null)
  // `null` = nothing is in the chip's way; a number = the ceiling that clears it (D-39).
  const [clampPx, setClampPx] = useState(null)
  // The layout identity the current clamp was decided for. See `chipClearance.js` — RELEASE is
  // driven by this changing, never by observing that the chip now looks clear.
  const clampedForRef = useRef(null)

  const verticalOffset = PAD_PX / 2 - CHIP_HEIGHT_PX / 2
  const clearance = actionsWidthPx > 0 ? actionsWidthPx + ACTIONS_CLEARANCE_PX : 0
  const inset = EDGE_OFFSET_PX + PAD_PX + CHIP_GAP_PX + clearance

  /**
   * D-39 — does page-level fixed furniture stand where this chip wants to be?
   *
   * ⛔⛔ TWO GUARDS AGAINST THE SAME FAILURE, AND THIS COMPONENT HAS EARNED BOTH. A passive-effect
   * loop in hub code froze navigation app-wide for ~4.5h on 2026-09-10, found by a member.
   *   1. **Release is INPUT-driven.** Once a clamp is decided for a geometry, it is kept until that
   *      geometry changes. Re-probing a clamped chip would find it clear and release it, which is
   *      the oscillation this cannot have. `chipClearance.js`'s header has the full reasoning.
   *   2. **`setClampPx` bails out.** The updater returns the PREVIOUS value when nothing changed,
   *      so React skips the re-render entirely (Object.is) and a settled page costs zero renders.
   *
   * ⚠️ jsdom performs no layout: `elementFromPoint` is absent and every rect is zero. The guards
   * below make this a no-op there, which is correct and is why the rails exercise the pure module
   * plus a stubbed-geometry wiring test rather than pretending jsdom can answer a layout question.
   */
  const measure = useCallback(() => {
    const chipEl = chipRef.current
    const modeEl = modeRef.current
    if (!chipEl || !modeEl) return
    if (typeof document === 'undefined' || typeof document.elementFromPoint !== 'function') return

    const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 0
    if (!(viewportWidth > 0)) return

    // ⛔ GUARD 1 — the clamp already answered for THIS layout. Do not re-probe: the chip is now
    // clear precisely because the clamp worked, and reading that as "no furniture" is the loop.
    const key = geometryKey({ viewportWidth, inset, mirrored })
    if (clampedForRef.current === key) return

    const chipRect = chipEl.getBoundingClientRect()
    if (!(chipRect.width > 0) || !(chipRect.height > 0)) return

    const floorPx = floorWidth({
      chipRect,
      modeRect: modeEl.getBoundingClientRect(),
      hintRect: hintRef.current ? hintRef.current.getBoundingClientRect() : null,
    })

    const y = chipRect.top + chipRect.height / 2
    let next = null
    for (const x of probePoints({ chipRect, mirrored })) {
      const el = document.elementFromPoint(x, y)
      if (!isOccluder(el, chipEl)) continue
      const cleared = clearedCeiling({
        chipRect, coverRect: el.getBoundingClientRect(), mirrored, floorPx,
      })
      // The tightest demand wins — a sample further in may need more clearance than the first.
      if (cleared !== null && (next === null || cleared < next)) next = cleared
    }

    clampedForRef.current = key
    // ⛔ GUARD 2 — bail out of the render when the answer has not moved.
    setClampPx((prev) => (prev === next ? prev : next))
  }, [inset, mirrored])

  useLayoutEffect(() => {
    // Handedness or the Actions button's width changed: the previous answer was for a layout that
    // no longer exists, so drop it and let `measure` decide again from the natural state.
    clampedForRef.current = null
    setClampPx(null)
  }, [inset, mirrored])

  useLayoutEffect(() => {
    measure()
    if (typeof ResizeObserver !== 'function') return undefined
    // ⛔ `document.body` is observed, not just the chip: the chip's own box does not change when a
    // page's furniture appears, and that is the event this needs to hear about. A viewport change
    // resizes the body too, which is what invalidates the key above.
    const ro = new ResizeObserver(() => {
      clampedForRef.current = null
      measure()
    })
    if (typeof document !== 'undefined' && document.body) ro.observe(document.body)
    return () => ro.disconnect()
  }, [measure])

  // While selecting, the chip becomes the ring readout instead of disappearing.
  // ⛔ AFTER the hooks, never before — an early return above them would change the hook order
  // between renders, which React forbids and which no rail in this directory would catch.
  if (open && !ringName) return null

  const hint = open && ringName
    ? ringName
    : (scrubbing ? scrubReadout || 'Scrub' : tapHint)
  const sideStyle = mirrored ? { left: `${inset}px` } : { right: `${inset}px` }

  return (
    <div
      ref={chipRef}
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
        /* D-39: the clamp is a FLOOR-PROTECTED override of the ceiling above, applied only when
         * something is actually standing in the chip's way. `null` keeps the CSS calc, so a build
         * with no layout engine (SSR, jsdom) renders exactly what it rendered before. */
        maxWidth: clampPx === null
          ? `calc(100vw - ${inset + EDGE_OFFSET_PX}px)`
          : `${clampPx}px`,
        bottom: `calc(env(safe-area-inset-bottom) + ${BOTTOM_OFFSET_PX + verticalOffset}px)`,
      }}
    >
      <b
        ref={modeRef}
        className={styles.chipMode}
        style={{ color: modeColor ? `var(${modeColor})` : undefined }}
      >
        {label}
      </b>
      <span ref={hintRef} className={styles.chipHint}>{hint}</span>
    </div>
  )
}
