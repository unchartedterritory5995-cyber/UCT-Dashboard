/**
 * Wave 13 lane 13G-2 -- the thesis chip: thesis status + distance to the note's stop,
 * with a preview of the note (title, levels, a link in).
 *
 * HOVER IS NOT THE ONLY DOOR. The chip is a real `<button>` (free focus ring, free
 * Enter/Space activation) so three equivalent openers reach the same preview:
 *   - hover (desktop, `pointer: fine`);
 *   - tap (the chip IS the button -- the touch tier is <=1024px, so this is the only
 *     door on a phone or tablet);
 *   - keyboard: on desktop, Tab to the chip opens it on FOCUS ALONE (mirroring hover, so
 *     a keyboard-only or switch-control member never needs a second keypress). Escape
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
 * open it either.
 *
 * LANE FIN-A11Y (review R4: I-1, I-2, I-3, M-9) -- TWO SURFACES, CHOSEN AT THE EVENT:
 *   - touch tier (<=1024px): a CLICK opens the shared `Sheet` (bottom sheet: focus moves
 *     in, Tab is trapped, Escape closes, focus returns here). Focus and hover open
 *     nothing there -- a sheet that opened on Tab would trap a member who was only
 *     passing through.
 *   - desktop: an anchored popover, `position: fixed` and placed from the chip's own
 *     rect, so a scrolling table wrapper (`overflow-x: auto` clips BOTH axes) can never
 *     cut it off. It stays IN the DOM right after the chip, so Tab reaches "Open note"
 *     next with no hand-built tab order. It closes on Escape, on focus leaving the chip
 *     and its preview, and on a `pointerdown` outside (not `mousedown`: iOS Safari sends
 *     no mouse events for a tap on a non-interactive area).
 * ⛔ The tier is read from the live media query INSIDE the handler, never from
 * `useIsTouch()` at render (that hook is stale on the first paint).
 * ⛔ The chip's clicks and its Enter/Space never reach the row it sits in: a host row
 * that opens on click must not also open because its chip did.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import Sheet from '../../../../components/mobile/Sheet'
import { MQ } from '../../../../styles/breakpoints'
import { STATUS_META, chipLabel, formatLevel } from '../../lib/thesisChips'
import styles from './ThesisChip.module.css'

/** The touch tier, asked of the browser at the moment of the event. */
const touchNow = () => typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && window.matchMedia(MQ.touchDown).matches

const GAP = 6
const EDGE = 8

export default function ThesisChip({ chip, currentPrice }) {
  // null (closed) | 'pop' (desktop popover) | 'sheet' (touch)
  const [mode, setMode] = useState(null)
  const [pos, setPos] = useState(null)
  const wrapRef = useRef(null)
  const btnRef = useRef(null)
  const popRef = useRef(null)
  // Returning focus to the chip must not read as "the member focused it": the focus
  // handler opens the popover, so a close that focuses the chip would reopen it.
  const quietFocusRef = useRef(false)
  const popId = useId()
  const pop = mode === 'pop'

  useEffect(() => {
    if (!pop) return undefined
    const onDocDown = (e) => {
      if (!wrapRef.current?.contains(e.target)) setMode(null)
    }
    document.addEventListener('pointerdown', onDocDown)
    return () => document.removeEventListener('pointerdown', onDocDown)
  }, [pop])

  // Place the popover from the chip's rect: below it, flipped above when it would run
  // off the bottom, and pulled back inside the viewport's right edge.
  useLayoutEffect(() => {
    if (!pop) {
      setPos(null)
      return undefined
    }
    const place = () => {
      const btn = btnRef.current
      const el = popRef.current
      if (!btn || !el) return
      const r = btn.getBoundingClientRect()
      const w = el.offsetWidth
      const h = el.offsetHeight
      const vw = window.innerWidth
      const vh = window.innerHeight
      let top = r.bottom + GAP
      if (h && top + h > vh - EDGE && r.top - GAP - h >= EDGE) top = r.top - GAP - h
      let left = r.left
      if (w && left + w > vw - EDGE) left = Math.max(EDGE, vw - EDGE - w)
      setPos((p) => (p && p.top === top && p.left === left ? p : { top, left }))
    }
    place()
    // Capture: the app scrolls an inner element, not the window.
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [pop])

  if (!chip) return null

  const meta = chip.thesisStatus ? STATUS_META[chip.thesisStatus] : null
  const toneClass = meta ? styles[`tone_${meta.color}`] : styles.toneNone
  const label = chipLabel(chip, currentPrice)
  const hasLevels = chip.entry != null || chip.stop != null || chip.target != null
  const title = chip.title || 'Untitled note'

  const focusChipQuietly = () => {
    const btn = btnRef.current
    if (!btn || document.activeElement === btn) return
    quietFocusRef.current = true
    btn.focus()
    quietFocusRef.current = false
  }

  const close = () => {
    setMode(null)
    focusChipQuietly()
  }

  const details = (
    <>
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
      <Link className={styles.popLink} to={chip.link} onClick={() => setMode(null)}>
        Open note
      </Link>
    </>
  )

  return (
    /* The handlers on this span are event FENCES, not controls: the button inside is the
       control. They keep the chip's own clicks and keys from reaching a host row. */
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <span
      className={styles.wrap}
      ref={wrapRef}
      /* a stable selector for the real-browser walk (tools/notebook_w13g2_walk.py) --
         the note this chip reads, never a styling hook. */
      data-thesis-chip={chip.noteId}
      onPointerEnter={(e) => {
        if (e.pointerType !== 'touch' && !touchNow()) setMode((m) => m || 'pop')
      }}
      onPointerLeave={(e) => {
        if (e.pointerType !== 'touch') setMode((m) => (m === 'pop' ? null : m))
      }}
      onBlur={(e) => {
        const next = e.relatedTarget
        if (next && wrapRef.current?.contains(next)) return
        setMode((m) => (m === 'pop' ? null : m))
      }}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') e.stopPropagation()
        if (e.key === 'Escape' && pop) {
          e.stopPropagation()
          close()
        }
      }}
    >
      <button
        type="button"
        ref={btnRef}
        className={`${styles.chip} ${toneClass}`}
        aria-expanded={mode != null}
        aria-describedby={pop ? popId : undefined}
        aria-label={`Thesis note: ${meta ? meta.label : 'no status set'}${
          chip.stop != null ? `, ${label}` : ''}. Open preview.`}
        onClick={() => setMode(touchNow() ? 'sheet' : 'pop')}
        onFocus={() => {
          if (quietFocusRef.current || touchNow()) return
          setMode((m) => m || 'pop')
        }}
      >
        <span className={styles.dot} aria-hidden="true" />
        {/* M-9: the status is a WORD beside the distance, never only the dot's colour. */}
        {meta && label !== meta.label && <span className={styles.status}>{meta.label}</span>}
        <span className={styles.label}>{label}</span>
      </button>
      {pop && (
        <div
          id={popId}
          ref={popRef}
          className={styles.popover}
          data-thesis-popover=""
          /* Fixed and placed from the chip's rect (see the layout effect). Hidden for the
             one frame before it is measured, so it never flashes at the wrong spot. */
          style={{
            position: 'fixed',
            top: pos ? pos.top : 0,
            left: pos ? pos.left : 0,
            visibility: pos ? 'visible' : 'hidden',
          }}
        >
          <div className={styles.popTitle}>{title}</div>
          {details}
        </div>
      )}
      <Sheet
        open={mode === 'sheet'}
        onClose={close}
        variant="bottom-sheet"
        title={title}
        labelledByTitle
      >
        <div className={styles.sheetBody}>{details}</div>
      </Sheet>
    </span>
  )
}
