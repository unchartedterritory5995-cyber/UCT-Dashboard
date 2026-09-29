/**
 * Wave 10 lane K2 (design finding D-3) — the note's "More note actions" door.
 *
 * Lane 10E-2's design review measured up to five rows of controls above a note's title at
 * 1200 px, with a red Delete among the first things on every note. Notion keeps page-level
 * actions in a "…" menu beside Share, and Evernote in a "More actions" menu; this is that door.
 * The editor passes the actions as children (Duplicate, Lock, Archive, Save as template, Open a
 * note beside, the file doors, the word count, and Delete LAST, apart from the rest).
 *
 * ⛔ A DISCLOSURE, NOT A `role="menu"`. Two of its actions open an inline form in place (naming a
 * template; the Open-beside search), and a menu's items cannot hold a text field. So: a button
 * with `aria-expanded` + `aria-controls`, and a named group. It keeps the editor's ONE keyboard
 * contract for a disclosure (`lib/useDisclosureFocus.js`): focus moves in on open, Tab stays
 * inside while focus is inside, Escape closes it and hands focus back to this button.
 *
 * ⛔ ALWAYS MOUNTED, HIDDEN WHEN CLOSED. Lock and Archive say what happened in a sentence that
 * their component renders and keeps (NoteMenuActions); unmounting the panel on close would drop
 * that sentence and any half-typed template name. `hidden` also takes every control out of the
 * Tab order and the accessibility tree while it is closed.
 *
 * ⛔ IT STAYS OPEN WHILE AN ACTION'S OWN DIALOG IS UP. Delete asks first (ConfirmModal), and the
 * confirmation hands focus back to the Delete that opened it; a panel that had closed underneath
 * would leave that button hidden and focus on <body> (F7 part C's rule). So a press inside an
 * `aria-modal` dialog never counts as a press outside this panel -- nor does a press on that
 * dialog's BACKDROP (K2 fix round 1, review M-3): the backdrop is the modal's parent, not inside
 * it, so a tap outside the "Delete this note?" card closed the panel first and the question then
 * handed focus back to a Delete that was hidden -- <body>. While any modal is up, this panel is
 * not the thing a press outside it is about.
 *
 * ⛔ IT STAYS ON SCREEN (K2 fix round 1, review I-1). It hangs from the door's right edge; at
 * 390 px on a LOCKED note (no Writing help in the header, so the door sits further left) it was
 * measured at x -75..185, and pressing Lock inside the open panel made it jump there. After every
 * render while open (a reflow moves the door) and on a resize, the panel is measured and shifted
 * so it sits wholly inside a 16 px gutter (`onScreenShift`). Measured before/after:
 * docs/notebook/evidence/d3-controls-2026-09-28/more-panel-*.json.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import UIcon from '../../../../components/ui/UIcon'
import useDisclosureFocus from '../../lib/useDisclosureFocus'
import styles from './NoteMoreMenu.module.css'

export const MORE_NOTE_ACTIONS = 'More note actions'
export const PANEL_GUTTER = 16

/** How far to move a box spanning [left, right] so it sits inside [gutter, viewport - gutter]
 *  (the left edge wins when the box is wider than the room). */
export function onScreenShift(left, right, viewport, gutter = PANEL_GUTTER) {
  if (left < gutter) return gutter - left
  if (right > viewport - gutter) return Math.max(gutter - left, viewport - gutter - right)
  return 0
}

export default function NoteMoreMenu({ children, buttonClassName = '' }) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const triggerRef = useRef(null)
  const panelRef = useRef(null)
  const close = useCallback(() => setOpen(false), [])
  const { disclosureProps } = useDisclosureFocus({
    open, containerRef: panelRef, onClose: close, openerRef: triggerRef,
  })

  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => {
      const t = e.target
      if (panelRef.current?.contains(t) || triggerRef.current?.contains(t)) return
      // An action's own dialog is up (Delete asks first): a press in it OR on its backdrop is
      // about the dialog, never about this panel (M-3).
      if (document.querySelector('[aria-modal="true"]')) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
    }
  }, [open])

  const place = useCallback(() => {
    const el = panelRef.current
    if (!el) return
    el.style.transform = ''
    if (el.hidden) return
    const r = el.getBoundingClientRect()
    const dx = onScreenShift(r.left, r.right, window.innerWidth)
    if (dx) el.style.transform = `translateX(${Math.round(dx)}px)`
  }, [])
  // After EVERY render while open: Lock unmounts Writing help and the door moves under the panel.
  useLayoutEffect(() => { if (open) place() })
  useEffect(() => {
    if (!open) return undefined
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [open, place])

  return (
    <span className={styles.anchor}>
      <button
        ref={triggerRef}
        type="button"
        className={`${buttonClassName} ${styles.trigger}`}
        aria-label={MORE_NOTE_ACTIONS}
        aria-expanded={open}
        aria-controls={panelId}
        title={MORE_NOTE_ACTIONS}
        onClick={() => setOpen((v) => !v)}
      >
        <UIcon name="more" size={15} gold={false} />
      </button>
      <div
        ref={panelRef}
        id={panelId}
        role="group"
        aria-label={MORE_NOTE_ACTIONS}
        className={styles.panel}
        hidden={!open}
        data-export-exclude
        {...disclosureProps}
      >
        {children}
      </div>
    </span>
  )
}
