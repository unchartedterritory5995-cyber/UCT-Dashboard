import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import UIcon from '../../../components/ui/UIcon'
import { descFor, DESC_TRIGGER_W } from '../columnDefs'
import styles from './ColumnDesc.module.css'

/* ColumnDesc — the one surface that puts a column's honesty text on screen.
 *
 * WHY THIS EXISTS. `columnDefs.js` carries hand-written `desc` strings for the
 * columns where a number is easy to misread — the $4M dark-pool block floor,
 * the pattern-ENGINE vs cheap-heuristic scale split, the three-way-ambiguous
 * blank, the classified-only denominator on options bull %, the ANALYST
 * ESTIMATE disclosure on 5-year forward EPS. Until this component they were
 * rendered by nothing but a native `title` on the results header: hover-only,
 * unreachable by keyboard, unread by a screen reader, truncated by the OS on
 * the longest ones, and absent entirely from the filter rail — which is where
 * the misreading actually happens, because a threshold is set before a cell is
 * ever read.
 *
 * ⛔ IT NEVER WRITES COPY. `descFor` reads `COLUMN_DEFS[key].desc` and returns
 * null when there is none. A column with no `desc` renders NOTHING — an info
 * affordance that opens onto an empty box promises an explanation and delivers
 * a blank, which is worse than no affordance at all. The gap is real (139 of
 * 157 columns carry no `desc` at 2026-08-23) and closing it means writing the
 * text in `columnDefs.js`, not softening the guard here.
 *
 * ⛔ THE PANEL IS PORTALED TO `document.body`, deliberately. Both hosts clip:
 * `.gridScroll` is `overflow:auto` and `.rail` is `overflow-y:auto`, and the
 * results header is a `position:sticky` z-index-4 layer that ScannerShell's own
 * module comment already warns about. An absolutely-positioned panel inside
 * either one is cut off at the container edge. Fixed positioning measured off
 * the trigger sidesteps the whole stacking argument; the trade is that the
 * panel must close when anything scrolls, which it does.
 *
 * ⛔⛔ THE PANEL MUST OUTRANK `--z-modal`, AND A JSDOM TEST CANNOT SEE IT.
 * Below 1024px `.railSlot` is `display:none` (and the same happens inside the
 * /charts widget below a 900px container), so the ONLY way a member reaches a
 * filter on touch is `FiltersSheet` — a `Sheet` whose backdrop is `--z-modal`
 * = 1000. Both that sheet and this panel portal to `document.body`, so at the
 * `z-index: 60` this shipped with, the opaque sheet painted straight over the
 * disclosure: tapping the icon on a phone changed nothing on screen. 179 green
 * tests were blind to it because vitest stubs CSS-module z-indexes. The rung
 * now lives in `ColumnDesc.module.css` as `calc(var(--z-modal) + 10)` and is
 * verified by measuring `elementFromPoint` in a real browser at 390x780.
 *
 * ⛔⛔ AN IMPLICIT DISMISSAL MUST NOT MOVE THE VIEWPORT. Focus is MOVED INTO
 * the panel on open (see below), so on every close `document.activeElement` is
 * inside a node that is about to be removed — and restoring it to the trigger
 * with a bare `focus()` scrolls that trigger back into view, which inside an
 * `overflow:auto` container means DISCARDING the member's scroll position.
 * `9d76cb410` shipped exactly that: the scroll-away handler went from
 * `setOpen(null)` to a focus-restoring dismiss in the same round that made the
 * focus move unconditional, so every flick threw the member back to the filter
 * they had opened. Measured in Chromium at 390x780 against the real
 * `FiltersSheet` (scrollHeight 15072 / clientHeight 574): a 600px flick with a
 * description open landed 5px BEHIND where it started.
 *
 * So the two kinds of close are not the same close:
 *   • EXPLICIT — Escape, the dismiss button, Tab. The member asked to come
 *     back, so `focus()` normally; scrolling the trigger into view is right.
 *   • IMPLICIT — scroll, resize, an outside click. Focus still returns to the
 *     trigger (dropping it on `document.body` would dump a keyboard user to the
 *     top of the document), but with `{ preventScroll: true }` — the one option
 *     that keeps a keyboard user oriented WITHOUT moving what a reader is
 *     reading. That is the whole distinction `dismiss`'s second argument
 *     carries; do not collapse it back into one call.
 * ⚠️ `resize` is not a rare case on a phone: hiding the URL bar IS a resize,
 * and scrolling is what hides it, so the two implicit paths fire together.
 *
 * ⛔ ACCESSIBILITY IS THE POINT, not a checkbox. This is the ARIA disclosure
 * pattern: a real <button> in tab order with a spoken name ("What Bull % means"),
 * `aria-expanded`, `aria-controls`/`aria-describedby` pointing at the panel
 * while it exists, focus MOVED into the panel on open (the content is portaled
 * to the end of <body>, which no screen reader follows from `aria-controls`
 * alone — announcing the trigger's name is not announcing the text), a labelled
 * dismiss, and Escape returning focus to the trigger. Do not turn it back into
 * a hover-only tooltip, and do not drop the focus move for `aria-controls`.
 */

const PANEL_W = 320

// Inline styles carry only what no media query has to decide; the trigger's
// box, the panel's z-index and the touch tap target live in the CSS module
// beside this file (see its header for why they cannot be inline).
const TRIGGER_VARS = { '--desc-trigger-w': `${DESC_TRIGGER_W}px` }

const PANEL = {
  position: 'fixed', width: PANEL_W,
  background: 'var(--bg-surface)', border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md, 6px)', padding: '9px 11px',
  color: 'var(--text)', fontSize: 11.5, lineHeight: 1.5,
  boxShadow: '0 8px 26px rgba(0,0,0,0.45)',
  outline: 'none',
}

const PANEL_HEAD = {
  display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5,
}

const PANEL_TITLE = {
  color: 'var(--ut-gold)', fontSize: 9.5, textTransform: 'uppercase',
  letterSpacing: '.5px',
}

// Measured at click time, never in an effect — the trigger's rect is already
// final by then, and an effect that setStates on open/close is the cascading
// render the lint rule (and React) warn about.
const place = r => {
  const vw = window.innerWidth || PANEL_W + 16
  const vh = window.innerHeight || 600
  const left = Math.max(8, Math.min((r?.left ?? 8) - 8, vw - PANEL_W - 8))
  const below = (r?.bottom ?? 0) + 6
  // Flip above only when there is genuinely no room below AND room above —
  // otherwise a panel opened near the bottom of a tall grid lands off-screen.
  return vh - below < 150 && (r?.top ?? 0) > 160
    ? { left, bottom: vh - (r?.top ?? 0) + 6 }
    : { left, top: below }
}

export default function ColumnDesc({ colKey, name, tapTarget = false }) {
  const desc = descFor(colKey)
  const [open, setOpen] = useState(null) // null = closed; otherwise the placement
  const btnRef = useRef(null)
  const panelRef = useRef(null)
  const panelId = `coldesc${useId()}${colKey}`

  useEffect(() => {
    if (!open) return
    const inside = t => btnRef.current?.contains(t) || panelRef.current?.contains(t)
    const focusInPanel = () => !!panelRef.current?.contains(document.activeElement)
    // `implicit` = the member did not ask to come back (scroll, resize, an
    // outside click). Focus still returns to the trigger — losing it to
    // `document.body` restarts a keyboard user at the top of the document —
    // but `preventScroll` stops that restoration from also hauling the
    // scroller back to the trigger and discarding the scroll they just made.
    // See the ⛔⛔ block at the top of this file for the measurement.
    const dismiss = (restore, implicit = false) => {
      setOpen(null)
      if (restore) btnRef.current?.focus(implicit ? { preventScroll: true } : undefined)
    }

    // The content is at the END of <body> and linked only by id. A screen
    // reader is told the trigger expanded, not what it says — so move focus to
    // the panel, which has no competing accessible name of its own, and let it
    // read its own text. Escape and the dismiss both hand focus back.
    panelRef.current?.focus()

    const onDown = e => { if (!inside(e.target)) dismiss(focusInPanel(), true) }
    const onKey = e => {
      if (e.key === 'Escape') {
        // ⛔ ESCAPE IS ANSWERED ON `window`, IN CAPTURE, ON PURPOSE.
        // `Sheet.jsx` registers ITS Escape on `document` in capture the moment
        // the filter sheet opens — before this one — and two listeners on the
        // same node fire in registration order, so `stopImmediatePropagation`
        // from here would run second and arrive too late. The member would be
        // dumped out of the whole filter sheet by the key they pressed to
        // close a tooltip. `window` is one node EARLIER in the capture path,
        // so this runs first and `stopPropagation` keeps the event from ever
        // reaching document. (User memory: "Escape = document-CAPTURE +
        // stopPropagation (host Escape is a window listener)" — same trap, one
        // level up.)
        e.stopPropagation()
        e.preventDefault()
        dismiss(true)
        return
      }
      // Tab out of a panel portaled to the end of <body> would land in browser
      // chrome, not on the next control on screen. Hand focus back to the
      // trigger first; the browser's own default Tab then runs from there.
      if (e.key === 'Tab' && panelRef.current?.contains(e.target)) dismiss(true)
    }
    // A fixed panel does not ride a scrolling header or rail — close instead of
    // letting it drift away from the control it describes. ⛔ IMPLICIT: the
    // member is scrolling (or the phone's URL bar just resized the viewport
    // BECAUSE they scrolled). Restoring focus with a bare `focus()` here is the
    // regression this file's second ⛔⛔ block records.
    const away = () => dismiss(focusInPanel(), true)
    document.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('scroll', away, true)
    window.addEventListener('resize', away)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('scroll', away, true)
      window.removeEventListener('resize', away)
    }
  }, [open])

  if (!desc) return null

  return (
    <>
      <button ref={btnRef} type="button"
        className={`${styles.trigger}${tapTarget ? ` ${styles.tap}` : ''}`}
        style={TRIGGER_VARS}
        aria-expanded={!!open}
        aria-controls={open ? panelId : undefined}
        aria-describedby={open ? panelId : undefined}
        aria-label={`What ${name} means`}
        data-coldesc={colKey}
        onClick={() => setOpen(o => o ? null : place(btnRef.current?.getBoundingClientRect()))}>
        <UIcon name="info" size={12} />
      </button>
      {open && createPortal(
        <div ref={panelRef} id={panelId} role="note" tabIndex={-1}
          className={styles.panel} style={{ ...PANEL, ...open }}>
          <div style={PANEL_HEAD}>
            <div style={PANEL_TITLE}>{name}</div>
            <button type="button" className={styles.dismiss}
              aria-label="Close description"
              onClick={() => { setOpen(null); btnRef.current?.focus() }}>×</button>
          </div>
          {desc}
        </div>,
        document.body)}
    </>
  )
}
