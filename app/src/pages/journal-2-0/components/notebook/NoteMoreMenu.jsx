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
 * `aria-modal` dialog never counts as a press outside this panel.
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import UIcon from '../../../../components/ui/UIcon'
import useDisclosureFocus from '../../lib/useDisclosureFocus'
import styles from './NoteMoreMenu.module.css'

export const MORE_NOTE_ACTIONS = 'More note actions'

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
      if (t?.closest?.('[aria-modal="true"]')) return   // an action's own dialog (Delete asks first)
      setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
    }
  }, [open])

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
