// The note's Export menu: PNG, Print and the four file formats (simplify pass 2, C3, moved out of
// NoteExportControls.jsx unchanged in what it draws and does). It is drawn only after Export is pressed, so it is a
// chunk of its own, fetched once the editor is idle (and at the press), never on the Notebook's first open;
// NoteExportControls holds it in a module slot (lib/heldModule.js) and draws it directly once it is there.
//
// In the More panel (`inPanel`) it is the panel's SECOND VIEW: "Back" first (named for the panel), then the formats,
// and Left goes back too. Alone it is the dropdown under the button. Either way:
// ⛔ A real menu: arrow keys walk the items, Home/End jump, Escape (or Back, or Left) closes it and hands focus BACK to
// the Export button (`onClose(true)`), a press outside closes it (`onClose(false)`). Items are 44px on the touch tier.
// ⛔ Wave 10 lane K2 (walk row S2-26): TAB STAYS INSIDE the open menu (`lib/useDisclosureFocus.js`, the editor's one
// disclosure contract), so the items are ordinary Tab stops inside it and the ONE trap wraps them.
// ⛔ KNOWN DEVIATION (K2 review M-6): a `role="menu"` whose Tab stays inside it -- the APG menu pattern closes on Tab;
// this follows the Notebook's one keep-Tab-inside contract.
import { useEffect, useRef } from 'react'
import UIcon from '../../../../../components/ui/UIcon'
import useDisclosureFocus from '../../../lib/useDisclosureFocus'
import { TOOLBAR_ICON } from '../../../lib/notebookIcons'
import { MORE_NOTE_ACTIONS } from '../NoteMoreMenu'
import { EXPORT_FORMATS } from './exportFormats'
import styles from '../NoteExportControls.module.css'

/** The two doors that read the note on screen, first in the menu (Notebook simplify, Task 4). */
const SCREEN_DOORS = Object.freeze([
  Object.freeze({ id: 'png', label: 'PNG', keeps: 'The note as it looks on screen, charts included, as one image.' }),
  Object.freeze({ id: 'print', label: 'Print', keeps: 'Print it, or save it as a PDF from the print dialog.' }),
])

/**
 * @param id          the menu's id (the Export button's aria-controls)
 * @param inPanel     drawn as the More panel's second view (with "Back")
 * @param triggerRef  the Export button (a press on it is not "outside")
 * @param onPick      `(id) => void`: 'png', 'print' or a file format's id
 * @param onClose     `(returnFocus) => void`
 */
export default function NoteExportMenu({ id, inPanel, triggerRef, onPick, onClose }) {
  const menuRef = useRef(null)
  const back = () => onClose(true)
  // The first item takes focus through the effect below, so the hook does not move it.
  const { disclosureProps } = useDisclosureFocus({ open: true, containerRef: menuRef, onClose: back, focusOnOpen: false })
  // Focus the first format when the menu opens (after "Back", in a panel).
  useEffect(() => { menuRef.current?.querySelector('[role="menuitem"]:not([data-back])')?.focus() }, [])
  // A press outside the menu closes it (the trigger toggles on its own).
  useEffect(() => {
    const onDown = (e) => {
      if (menuRef.current?.contains(e.target) || triggerRef.current?.contains(e.target)) return
      onClose(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
    }
  }, [onClose, triggerRef])

  const onKeyDown = (e) => {
    const items = [...menuRef.current.querySelectorAll('[role="menuitem"]')]
    const at = items.indexOf(document.activeElement)
    const go = { ArrowDown: at + 1, ArrowUp: at - 1 + items.length, Home: 0, End: items.length - 1 }[e.key]
    if (e.key === 'ArrowLeft' && inPanel) {
      e.preventDefault()
      back()
    } else if (go !== undefined) {
      e.preventDefault()
      items[go % items.length]?.focus()
    } else {
      disclosureProps.onKeyDown(e)   // Escape: close, focus back to the button
    }
  }

  return (
    <div ref={menuRef} id={id} role="menu" aria-label="Export this note as"
      className={inPanel ? styles.view : styles.menu} {...disclosureProps} onKeyDown={onKeyDown}>
      {inPanel && (
        <>
          <button type="button" role="menuitem" className={styles.item} data-back="" aria-label={`Back to ${MORE_NOTE_ACTIONS}`}
            onClick={back}>
            <span className={styles.itemLabel}><UIcon name="chevronLeft" {...TOOLBAR_ICON} /> Back</span>
          </button>
          <div role="separator" className={styles.sep} />
        </>
      )}
      {/* PNG rasterizes the note column (charts included); Print rides the browser's Save-as-PDF via
          the print stylesheet. Both read the note on screen, so neither waits on the server. */}
      {[...SCREEN_DOORS, null, ...EXPORT_FORMATS].map((d) => (d ? (
        <button
          key={d.id}
          type="button"
          role="menuitem"
          className={styles.item}
          aria-label={d.menuLabel || d.label}
          aria-describedby={`${id}-${d.id}`}
          onClick={() => onPick(d.id)}
        >
          <span className={styles.itemLabel}>{d.menuLabel || d.label}</span>
          <span id={`${id}-${d.id}`} className={styles.itemKeeps}>{d.keeps}</span>
        </button>
      ) : <div key="sep" role="separator" className={styles.sep} />))}
    </div>
  )
}
