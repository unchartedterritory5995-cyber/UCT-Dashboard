// Research Home's "Learn" button (Notebook UX pass, 2026-10-10): ONE door to every live,
// replayable walkthrough, plus the Help page that lists them. It replaces the ~20 "Take the X
// tour" steps the get-started list used to carry, so the list can be five steps a new member
// can finish and the tours stay one click away for everyone.
//
//   * WHAT IT LISTS -- derived, never typed: `learnMenuTours` (learnTours.js), the same
//     registry derivation Help > Walkthroughs makes. Plus a link to that Help section.
//   * WHAT A CHOICE DOES -- starts the tour through its existing door (`startTour`: the base
//     tour's own, or `openRegistryTour`). No new tour machinery.
//   * WHEN IT SHOWS -- only while the wave-14 onboarding switch is on (`learnMenuEnabled`),
//     and only when there is something to list.
//
// ⛔ A real menu button, the Notebook's one contract for it (NoteExportControls.jsx):
// `aria-haspopup="menu"` + `aria-expanded`, the first item takes focus on open, Arrow keys
// walk the items, Home/End jump, Escape closes and hands focus BACK to the button
// (`useDisclosureFocus`), a press outside closes it. A choice also hands focus back to the
// button before the tour starts, so focus is never dropped on <body> if the tour cannot open
// here; a tour that does open takes focus itself.
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import UIcon from '../../../../../components/ui/UIcon'
import { notebookFlag } from '../../../lib/offline/notebookFlags'
import useDisclosureFocus from '../../../lib/useDisclosureFocus'
import {
  HELP_WALKTHROUGHS_HREF, LEARN_COPY, learnMenuEnabled, learnMenuTours, startTour,
} from './learnTours'
import styles from './LearnMenu.module.css'

export default function LearnMenu({ className = '' }) {
  const [open, setOpen] = useState(false)
  const menuId = useId()
  const triggerRef = useRef(null)
  const menuRef = useRef(null)
  const itemRefs = useRef([])

  const enabled = learnMenuEnabled(notebookFlag)
  const tours = enabled ? learnMenuTours({ flag: notebookFlag }) : []

  const closeOnly = useCallback(() => setOpen(false), [])
  // Escape closes and hands focus back to the button; Tab stays inside while focus is inside.
  const { disclosureProps } = useDisclosureFocus({
    open, containerRef: menuRef, onClose: closeOnly, openerRef: triggerRef, focusOnOpen: false,
  })

  // Keep the open menu on screen. It hangs from the button's right edge, and on a phone the
  // button can sit centred (the welcome) or at the right (Home's search row), so no one CSS
  // anchor fits: measured at 390 px it started 30 px off the left edge. Shift it back inside a
  // 16 px gutter after layout, before paint.
  useLayoutEffect(() => {
    const el = menuRef.current
    if (!open || !el) return
    el.style.transform = ''
    const r = el.getBoundingClientRect()
    const vw = window.innerWidth || document.documentElement.clientWidth || 0
    const gutter = 16
    let dx = 0
    if (r.left < gutter) dx = gutter - r.left
    else if (vw && r.right > vw - gutter) dx = (vw - gutter) - r.right
    if (dx) el.style.transform = `translateX(${Math.round(dx)}px)`
  }, [open])

  // The first item takes focus when the menu opens.
  useEffect(() => {
    if (open) itemRefs.current.find(Boolean)?.focus()
  }, [open])

  // A press outside the menu closes it (the button toggles on its own).
  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => {
      if (menuRef.current?.contains(e.target) || triggerRef.current?.contains(e.target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
    }
  }, [open])

  if (!enabled) return null

  const choose = (tourId) => {
    setOpen(false)
    triggerRef.current?.focus()
    startTour(tourId)
  }

  const onMenuKeyDown = (e) => {
    const items = itemRefs.current.filter(Boolean)
    const at = items.indexOf(document.activeElement)
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      items[(at + 1) % items.length]?.focus()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      items[(at - 1 + items.length) % items.length]?.focus()
    } else if (e.key === 'Home') {
      e.preventDefault()
      items[0]?.focus()
    } else if (e.key === 'End') {
      e.preventDefault()
      items[items.length - 1]?.focus()
    } else {
      disclosureProps.onKeyDown(e)
    }
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
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault()
            setOpen(true)
          }
        }}
      >
        <UIcon name="education" size={14} gold={false} /> {LEARN_COPY.button}
        <UIcon name="chevronDown" size={12} gold={false} />
      </button>
      {open && (
        // ⛔ KNOWN DEVIATION, the same one NoteExportControls.jsx records (K2 review M-6): Tab
        // stays inside an open menu -- the Notebook's one keep-Tab-inside contract.
        <div ref={menuRef} id={menuId} role="menu" aria-label={LEARN_COPY.menuLabel}
          className={styles.menu} {...disclosureProps} onKeyDown={onMenuKeyDown}>
          {tours.map((t, i) => (
            <button
              key={t.id}
              ref={(el) => { itemRefs.current[i] = el }}
              type="button"
              role="menuitem"
              className={styles.item}
              data-learn-tour={t.id}
              onClick={() => choose(t.id)}
            >
              {LEARN_COPY.tour(t.title)}
            </button>
          ))}
          <Link
            ref={(el) => { itemRefs.current[tours.length] = el }}
            role="menuitem"
            className={`${styles.item} ${styles.helpItem}`}
            to={HELP_WALKTHROUGHS_HREF}
            onClick={() => setOpen(false)}
          >
            {LEARN_COPY.help}
          </Link>
        </div>
      )}
    </span>
  )
}
