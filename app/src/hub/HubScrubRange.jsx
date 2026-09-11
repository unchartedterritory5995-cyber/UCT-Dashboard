// §C2 — Scrub, reachable without a drag.
//
//   "Scrub is exposed as a native `<input type="range">` with `aria-valuetext` carrying a
//    human-readable string (the `BreadthScrubber.jsx:95-102` precedent) — both screen readers give
//    a focused range control a one-finger swipe-up/down adjust, which is a free no-drag path for
//    Scrub specifically."
//
// ── WHY THIS IS NOT DECORATION ─────────────────────────────────────────────────────────────────
// Every ACTION already has a no-drag door: the Actions button opens Peek with one tap, and §C2 is
// explicit that the button — not the two-finger gesture — is what satisfies WCAG 2.5.1. But SCRUB
// is not an action in that list. It is a continuous value, and until this control existed the only
// way to move it was to put a finger on the pad and drag a precise distance. For the tremor and
// limited-reach population §C2's motor paragraph exists for, that is the one interaction with no
// alternative at all.
//
// ⭐ A NATIVE `<input type="range">` IS THE POINT, not a styled div with ARIA. VoiceOver and
// TalkBack both give a FOCUSED range control a one-finger swipe adjust for free, and that behaviour
// belongs to the real element — `role="slider"` on a div gets the semantics and not the gesture.
//
// ── ONE SCRUB AUTHORITY ────────────────────────────────────────────────────────────────────────
// This does NOT reimplement scrubbing. It calls the section's own `onScrub(ctx, {delta, axis})` and
// `onScrubCommit(ctx)` — the same two functions the pad drives — so a section cannot behave one way
// under a thumb and another under the slider. `aria-valuetext` is the section's own `readout()`,
// which is also what the chip renders, so the sentence a screen reader speaks and the sentence a
// sighted member reads are the same string from the same function.
//
// ⛔ `delta` IS A PER-MOVE STEP, NOT A POSITION. `useJoystick` emits `raw / travelPx` — the distance
// since the LAST move — and sections accumulate it (`pos = clamp(from.pos + delta, 0, 1)`). A range
// input reports an ABSOLUTE value, so this converts: the delta emitted is the change since the last
// value this control sent, normalised by the track. Sending the absolute value as a delta would make
// every step compound and slam the cursor to an end — the same class of bug `wireSection.js` records
// against `scrubTo`.
import { useCallback, useRef, useState } from 'react'

import styles from './hub.module.css'

/** Steps across the track. 100 makes each arrow-key press 1% of travel, which matches the pad's
 *  own resolution closely enough that the two feel like one control. */
const STEPS = 100

/** The axis a section scrubs on, defaulting the way `contracts.js` documents. */
export const scrubAxisOf = (config) => (config?.scrubAxis === 'x' ? 'x' : 'y')

/**
 * Read a section's readout as a plain string for `aria-valuetext`.
 *
 * `readout()` may return a string OR `{label, value}` (the ChipReadout shape), and a screen reader
 * needs one sentence either way. ⛔ It is called defensively: a section computes this per step, and
 * a throw here would take down the whole sheet — the member's only no-drag door — over a cosmetic
 * string. A missing readout degrades to "Scrub", never to a crash.
 */
export function readoutText(config, ctx) {
  try {
    const r = config?.readout?.(ctx)
    if (typeof r === 'string' && r.trim()) return r
    if (r && typeof r === 'object') {
      const parts = [r.label, r.value].filter((s) => typeof s === 'string' && s.trim())
      if (parts.length) return parts.join(' ')
    }
  } catch {
    // fall through — see above
  }
  return 'Scrub'
}

/**
 * @param {Object} props
 * @param {Object} props.config  The mounted section config (must declare `onScrub`).
 * @param {Object} props.ctx     The same ctx object HubRoot hands every mode callback.
 * @param {string} [props.label] Mode label, for the control's accessible name.
 */
export default function HubScrubRange({ config, ctx, label }) {
  // Nothing to drive. Rendering an inert slider would be worse than rendering none: it announces a
  // capability the section does not have.
  const hasScrub = typeof config?.onScrub === 'function'

  const [value, setValue] = useState(0)
  // The last value we EMITTED from, so the delta is the change since our own last message rather
  // than since whatever the section last saw from the pad.
  const lastRef = useRef(0)
  const [text, setText] = useState(() => (hasScrub ? readoutText(config, ctx) : 'Scrub'))

  const axis = scrubAxisOf(config)

  const handleChange = useCallback((e) => {
    const next = Number(e.target.value)
    if (!Number.isFinite(next)) return
    const delta = (next - lastRef.current) / STEPS
    lastRef.current = next
    setValue(next)
    if (delta !== 0) config?.onScrub?.(ctx, { delta, axis })
    setText(readoutText(config, ctx))
  }, [config, ctx, axis])

  // ⭐ COMMIT ON RELEASE, exactly like the pad. Sections that PREVIEW during a scrub and APPLY on
  // release (breadth mounts two chart libraries per tab) must not apply on every intermediate step
  // — that is the whole reason `onScrubCommit` exists, and driving `onScrub` without ever firing it
  // would leave the previewed value held and never committed.
  const commit = useCallback(() => {
    if (!hasScrub) return
    config?.onScrubCommit?.(ctx)
    setText(readoutText(config, ctx))
  }, [config, ctx, hasScrub])

  if (!hasScrub) return null

  return (
    <div className={styles.scrubRangeRow} data-testid="hub-scrub-range-row">
      <label className={styles.scrubRangeLabel} htmlFor="hub-scrub-range">Scrub</label>
      <input
        id="hub-scrub-range"
        data-testid="hub-scrub-range"
        className={styles.scrubRange}
        type="range"
        min={0}
        max={STEPS}
        step={1}
        value={value}
        // The mode gives the control its name; the readout gives it its value. A screen reader then
        // says e.g. "Breadth scrub, Data Charts" rather than "slider, 43".
        aria-label={label ? `${label} scrub` : 'Scrub'}
        aria-valuetext={text}
        onChange={handleChange}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
      {/* The same sentence, visible. `aria-hidden` because the input already announces it via
          aria-valuetext, and a screen reader reading both says it twice. */}
      <span className={styles.scrubRangeValue} aria-hidden="true">{text}</span>
    </div>
  )
}
