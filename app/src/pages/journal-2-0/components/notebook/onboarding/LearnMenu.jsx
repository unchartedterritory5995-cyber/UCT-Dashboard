// Research Home's "Learn" button (Notebook UX pass, 2026-10-10) -- THE EAGER HALF (residual round,
// ruling R25: the spec says the Notebook's first-open budget must not move).
//
// This file is the button and nothing else: its words and the "is the menu offered" rule come from
// learnMenuCopy.js. The MENU behind it -- the tour list and its groups, the sample item, the
// "What your Notebook can do" Sheet, learnTours.js, capabilityList.js -- is LearnMenuPanel.jsx, a chunk
// fetched on the FIRST press. The first press may therefore wait one small chunk; the button itself
// is drawn at first paint, and the panel, once loaded, stays mounted (the catalog Sheet outlives the
// menu). What the menu lists, what a choice does and the focus rules are documented in the panel.
//
// ⛔ A real menu button, the Notebook's one contract for it (NoteExportControls.jsx):
// `aria-haspopup="menu"` + `aria-expanded`, and ArrowDown on the closed button opens it. Whether an
// opening is the anchored popover or the phone sheet is decided when the button is pressed
// (`useIsPhone()` read at click time, never at first paint).
import { Suspense, useId, useRef, useState } from 'react'
import UIcon from '../../../../../components/ui/UIcon'
import { useIsPhone } from '../../../../../hooks/useBreakpoint'
import { notebookFlag } from '../../../lib/offline/notebookFlags'
import lazyChunk from '../../../lib/lazyChunk'
import { LEARN_COPY, learnMenuEnabled } from './learnMenuCopy'
import styles from './LearnMenu.module.css'

const LearnMenuPanel = lazyChunk(() => import('./LearnMenuPanel'))

export default function LearnMenu({ className = '', hasAnyNotes = true }) {
  const [open, setOpen] = useState(false)
  // Whether THIS opening is the phone sheet. Decided when the button is pressed (see the header).
  const [asSheet, setAsSheet] = useState(false)
  // Mounted from the first press on, and kept: the catalog Sheet outlives the menu.
  const [wanted, setWanted] = useState(false)
  const menuId = useId()
  const triggerRef = useRef(null)
  const phone = useIsPhone()

  if (!learnMenuEnabled(notebookFlag)) return null

  const openMenu = () => {
    setAsSheet(phone)
    setWanted(true)
    setOpen(true)
  }

  return (
    <span className={`${styles.wrap} ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        className={`btn btn-ghost ${styles.trigger}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title={LEARN_COPY.buttonTitle}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault()
            openMenu()
          }
        }}
      >
        <UIcon name="education" size={14} gold={false} /> {LEARN_COPY.button}
        <UIcon name="chevronDown" size={12} gold={false} />
      </button>
      {wanted && (
        <Suspense fallback={null}>
          <LearnMenuPanel
            open={open}
            asSheet={asSheet}
            menuId={menuId}
            triggerRef={triggerRef}
            onOpenChange={setOpen}
            hasAnyNotes={hasAnyNotes}
          />
        </Suspense>
      )}
    </span>
  )
}
