import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import UIcon from '../../../components/ui/UIcon'
import { descFor, DESC_TRIGGER_W } from '../columnDefs'

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
 * ⛔ ACCESSIBILITY IS THE POINT, not a checkbox. This is the ARIA disclosure
 * pattern: a real <button> in tab order with a spoken name ("What Bull % means"),
 * `aria-expanded`, `aria-controls` pointing at the panel while it exists, Escape
 * to close with focus returned to the trigger. Do not turn it back into a
 * hover-only tooltip.
 */

const PANEL_W = 320

const BTN = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  flex: `0 0 ${DESC_TRIGGER_W}px`, width: DESC_TRIGGER_W,
  // `stretch` (not a fixed height) so the touch target grows with its row: the
  // results header is ~29px tall on desktop and 44px on phones, where
  // `.hbtn`'s own `--tap-min` rule already sets the row height.
  alignSelf: 'stretch', minHeight: DESC_TRIGGER_W,
  padding: 0, margin: 0,
  background: 'none', border: 'none', cursor: 'pointer', lineHeight: 0,
}

const PANEL = {
  position: 'fixed', width: PANEL_W, zIndex: 60,
  background: 'var(--bg-surface)', border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md, 6px)', padding: '9px 11px',
  color: 'var(--text)', fontSize: 11.5, lineHeight: 1.5,
  boxShadow: '0 8px 26px rgba(0,0,0,0.45)',
}

const PANEL_TITLE = {
  color: 'var(--ut-gold)', fontSize: 9.5, textTransform: 'uppercase',
  letterSpacing: '.5px', marginBottom: 5,
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

export default function ColumnDesc({ colKey, name }) {
  const desc = descFor(colKey)
  const [open, setOpen] = useState(null) // null = closed; otherwise the placement
  const btnRef = useRef(null)
  const panelRef = useRef(null)
  const panelId = `coldesc${useId()}${colKey}`

  useEffect(() => {
    if (!open) return
    const inside = t => btnRef.current?.contains(t) || panelRef.current?.contains(t)
    const onDown = e => { if (!inside(e.target)) setOpen(null) }
    const onKey = e => {
      if (e.key !== 'Escape') return
      setOpen(null)
      btnRef.current?.focus()
    }
    // A fixed panel does not ride a scrolling header or rail — close instead of
    // letting it drift away from the control it describes.
    const away = () => setOpen(null)
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('scroll', away, true)
    window.addEventListener('resize', away)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('scroll', away, true)
      window.removeEventListener('resize', away)
    }
  }, [open])

  if (!desc) return null

  return (
    <>
      <button ref={btnRef} type="button" style={BTN}
        aria-expanded={!!open}
        aria-controls={open ? panelId : undefined}
        aria-label={`What ${name} means`}
        data-coldesc={colKey}
        onClick={() => setOpen(o => o ? null : place(btnRef.current?.getBoundingClientRect()))}>
        <UIcon name="info" size={12} />
      </button>
      {open && createPortal(
        <div ref={panelRef} id={panelId} role="note" style={{ ...PANEL, ...open }}>
          <div style={PANEL_TITLE}>{name}</div>
          {desc}
        </div>,
        document.body)}
    </>
  )
}
