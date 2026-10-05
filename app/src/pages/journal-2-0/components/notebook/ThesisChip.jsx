/**
 * Wave 13 lane 13G-2 -- the thesis chip: thesis status + distance to the note's stop,
 * with a preview of the note (title, levels, a link in).
 *
 * HOVER IS NOT THE ONLY DOOR. The chip is a real `<button>` (free focus ring, free
 * Enter/Space activation) so three equivalent openers reach the same preview:
 *   - hover (desktop, `pointer: fine`);
 *   - tap (the chip IS the button -- the touch tier is <=1024px, so this is the only
 *     door on a phone or tablet);
 *   - keyboard: Tab to the chip opens it on FOCUS ALONE (mirroring hover, so a
 *     keyboard-only or switch-control member never needs a second keypress). Escape
 *     closes it and returns focus to the chip.
 * A hover-only affordance would be invisible to a keyboard or switch-control member and
 * to every touch device at once -- the exact gap `feedback_browser_testing_core` and the
 * mobile system's `.hoverReveal` rule both exist to catch.
 *
 * ⛔⛔ CLICK ONLY OPENS -- IT NEVER TOGGLES CLOSED. Measured in the real-browser walk
 * (tools/notebook_w13g2_walk.py, W5): a tap on a touch device is not one event, it is a
 * W3C-specified COMPATIBILITY SEQUENCE -- touchstart, touchend, then synthetic mouseover
 * (which the browser also derives a mouseenter from) and mousedown (which moves FOCUS to
 * the tapped button) BEFORE mouseup and click. A chip that opened on hover/focus and
 * TOGGLED on click would therefore open and then immediately close again on every single
 * tap, on every real touch device -- invisible to jsdom, which fires none of that
 * sequence for a bare `fireEvent.click`. Pointer-enter/leave are also gated on
 * `pointerType !== 'touch'` so the synthetic pointer events in that same sequence cannot
 * open it either; closing is Escape, or the existing click-outside handler below.
 */
import { useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { STATUS_META, chipLabel, formatLevel } from '../../lib/thesisChips'
import styles from './ThesisChip.module.css'

export default function ThesisChip({ chip, currentPrice }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)
  const btnRef = useRef(null)
  const popId = useId()

  useEffect(() => {
    if (!open) return undefined
    const onDocDown = (e) => {
      if (!wrapRef.current?.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocDown)
    return () => document.removeEventListener('mousedown', onDocDown)
  }, [open])

  if (!chip) return null

  const meta = chip.thesisStatus ? STATUS_META[chip.thesisStatus] : null
  const toneClass = meta ? styles[`tone_${meta.color}`] : styles.toneNone
  const label = chipLabel(chip, currentPrice)
  const hasLevels = chip.entry != null || chip.stop != null || chip.target != null

  const close = () => {
    setOpen(false)
    btnRef.current?.focus()
  }

  return (
    <span
      className={styles.wrap}
      ref={wrapRef}
      /* a stable selector for the real-browser walk (tools/notebook_w13g2_walk.py) --
         the note this chip reads, never a styling hook. */
      data-thesis-chip={chip.noteId}
      onPointerEnter={(e) => { if (e.pointerType !== 'touch') setOpen(true) }}
      onPointerLeave={(e) => { if (e.pointerType !== 'touch') setOpen(false) }}
    >
      <button
        type="button"
        ref={btnRef}
        className={`${styles.chip} ${toneClass}`}
        aria-expanded={open}
        aria-describedby={open ? popId : undefined}
        aria-label={`Thesis note: ${meta ? meta.label : 'no status set'}${
          chip.stop != null ? `, ${label}` : ''}. Open preview.`}
        onClick={() => setOpen(true)}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && open) {
            e.stopPropagation()
            close()
          }
        }}
      >
        <span className={styles.dot} aria-hidden="true" />
        <span className={styles.label}>{label}</span>
      </button>
      {open && (
        <div
          id={popId}
          className={styles.popover}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation()
              close()
            }
          }}
        >
          <div className={styles.popTitle}>{chip.title || 'Untitled note'}</div>
          {meta && <div className={`${styles.popStatus} ${toneClass}`}>{meta.label}</div>}
          {hasLevels ? (
            <dl className={styles.popLevels}>
              {chip.entry != null && (<><dt>Entry</dt><dd>{formatLevel(chip.entry)}</dd></>)}
              {chip.stop != null && (<><dt>Stop</dt><dd>{formatLevel(chip.stop)}</dd></>)}
              {chip.target != null && (<><dt>Target</dt><dd>{formatLevel(chip.target)}</dd></>)}
            </dl>
          ) : (
            <p className={styles.popHint}>No stop in this note.</p>
          )}
          <Link className={styles.popLink} to={chip.link} onClick={() => setOpen(false)}>
            Open note
          </Link>
        </div>
      )}
    </span>
  )
}
