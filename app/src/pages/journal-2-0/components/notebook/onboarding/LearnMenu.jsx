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
//   * GROUPED (P0.12) -- the tours sit under four headings (`groupLearnTours`, learnTours.js),
//     each a `role="group"` with a visible heading, so ~20 tours are not one wall. On a PHONE
//     the same menu opens as a bottom Sheet (the Notebook's one primitive for this) instead of
//     an anchored popover; which one is decided when the button is pressed (`useIsPhone()`
//     read at click time -- a press is the moment CLAUDE.md allows it), never at first paint.
//   * THE SAMPLE (P0.15) -- "Add the sample notebook", for a paid member with the onboarding
//     switch on. Research Home stops offering the sample once a note exists, so Learn is where
//     a member with notes can still add it (and where the chart walkthroughs point them).
//     It goes through `addSampleNotebook` (sampleNotebook.js), the one authority, and refreshes
//     the notebook lists with the same `isNotebookKey` predicate Research Home uses.
//
// ⛔ A real menu button, the Notebook's one contract for it (NoteExportControls.jsx):
// `aria-haspopup="menu"` + `aria-expanded`, the first item takes focus on open, Arrow keys
// walk the items, Home/End jump, Escape closes and hands focus BACK to the button
// (`useDisclosureFocus`), a press outside closes it. A choice also hands focus back to the
// button before the tour starts, so focus is never dropped on <body> if the tour cannot open
// here; a tour that does open takes focus itself.
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useSWRConfig } from 'swr'
import UIcon from '../../../../../components/ui/UIcon'
import Sheet from '../../../../../components/mobile/Sheet'
import { useIsPhone } from '../../../../../hooks/useBreakpoint'
import { useIsPaid } from '../../../../../context/AuthContext'
import { notebookFlag } from '../../../lib/offline/notebookFlags'
import useDisclosureFocus from '../../../lib/useDisclosureFocus'
import {
  HELP_WALKTHROUGHS_HREF, LEARN_COPY, groupLearnTours, learnMenuEnabled, learnMenuTours, startTour,
} from './learnTours'
import { SAMPLE_COPY, addSampleNotebook, isNotebookKey } from './sampleNotebook'
import { NOTEBOOK_ROOT } from './tourRegistry'
import styles from './LearnMenu.module.css'

export default function LearnMenu({ className = '' }) {
  const [open, setOpen] = useState(false)
  // Whether THIS opening is the phone sheet. Decided when the button is pressed (see the header).
  const [asSheet, setAsSheet] = useState(false)
  const [adding, setAdding] = useState(false)
  const [sampleMsg, setSampleMsg] = useState('')
  const menuId = useId()
  const triggerRef = useRef(null)
  // The popover (or the sheet's body): the menu AND the status line under it. The status is a
  // live region, which a `role="menu"` may not own (axe aria-required-children), so it sits beside
  // the menu, inside this wrapper.
  const popoverRef = useRef(null)
  const menuRef = useRef(null)
  const itemRefs = useRef([])
  const navigate = useNavigate()
  const { mutate } = useSWRConfig()
  const phone = useIsPhone()
  const isPaid = useIsPaid()

  const enabled = learnMenuEnabled(notebookFlag)
  const tours = enabled ? learnMenuTours({ flag: notebookFlag }) : []
  const groups = groupLearnTours(tours)
  // The same gate as every other wave-14 surface (`enabled` already needs the onboarding flag;
  // it is named again so this line reads as its own rule), and a paid member only: the sample
  // is a paid-member door on the server too.
  const canAddSample = enabled && notebookFlag('notebook_onboarding_enabled') === true && isPaid

  const openMenu = () => {
    setAsSheet(phone)
    setSampleMsg('')
    setOpen(true)
  }
  const closeOnly = useCallback(() => setOpen(false), [])
  // The sheet's own close: Sheet handles Escape, the backdrop and the drag; focus goes back to
  // the button (Sheet restores it too, this makes it independent of what had focus on open).
  const closeSheet = useCallback(() => {
    setOpen(false)
    triggerRef.current?.focus()
  }, [])
  // Escape closes and hands focus back to the button; Tab stays inside while focus is inside.
  // (Off in the sheet: Sheet is the layer that answers Escape and traps Tab there.)
  const { disclosureProps } = useDisclosureFocus({
    open, containerRef: popoverRef, onClose: closeOnly, openerRef: triggerRef, focusOnOpen: false, enabled: !asSheet,
  })

  // Keep the open menu on screen. It hangs from the button's right edge, and on a phone the
  // button can sit centred (the welcome) or at the right (Home's search row), so no one CSS
  // anchor fits: measured at 390 px it started 30 px off the left edge. Shift it back inside a
  // 16 px gutter after layout, before paint.
  useLayoutEffect(() => {
    const el = popoverRef.current
    if (!open || asSheet || !el) return
    el.style.transform = ''
    const r = el.getBoundingClientRect()
    const vw = window.innerWidth || document.documentElement.clientWidth || 0
    const gutter = 16
    let dx = 0
    if (r.left < gutter) dx = gutter - r.left
    else if (vw && r.right > vw - gutter) dx = (vw - gutter) - r.right
    if (dx) el.style.transform = `translateX(${Math.round(dx)}px)`
  }, [open, asSheet])

  // The first item takes focus when the menu opens.
  useEffect(() => {
    if (open) itemRefs.current.find(Boolean)?.focus()
  }, [open])

  // A press outside the menu closes it (the button toggles on its own).
  useEffect(() => {
    if (!open || asSheet) return undefined   // the sheet's backdrop answers a press outside it
    const onDown = (e) => {
      if (popoverRef.current?.contains(e.target) || triggerRef.current?.contains(e.target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
    }
  }, [open, asSheet])

  if (!enabled) return null

  const choose = (tourId) => {
    setOpen(false)
    triggerRef.current?.focus()
    startTour(tourId)
  }

  // P0.15. Adds the sample through the one authority; on success the notebook lists refresh
  // (Research Home's own predicate), the menu closes and the welcome note opens. Refused (the
  // member already has notes, or any other refusal), it says so IN the menu and creates nothing.
  // A second press while the first is still adding is ignored (aria-disabled, not `disabled`,
  // so focus is not dropped from the item the member is on).
  const addSample = async () => {
    if (adding) return
    setAdding(true)
    setSampleMsg('')
    const out = await addSampleNotebook()
    setAdding(false)
    if (!out.ok) {
      setSampleMsg(out.message)
      return
    }
    mutate(isNotebookKey)
    setOpen(false)
    triggerRef.current?.focus()
    if (out.welcomeNoteId) navigate(`${NOTEBOOK_ROOT}?note=${encodeURIComponent(out.welcomeNoteId)}`)
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

  // One flat run of focusable items, in the order they are drawn: the tours (group by group),
  // then the sample, then the Help link. `at` hands each its slot in itemRefs.
  let at = 0
  const slot = () => {
    const mine = at
    at += 1
    return (el) => { itemRefs.current[mine] = el }
  }
  itemRefs.current.length = 0

  const menu = (
    // ⛔ KNOWN DEVIATION, the same one NoteExportControls.jsx records (K2 review M-6): Tab
    // stays inside an open menu -- the Notebook's one keep-Tab-inside contract.
    <div ref={popoverRef} className={asSheet ? styles.sheetMenu : styles.menu} data-learn-popover=""
      {...(asSheet ? {} : disclosureProps)}>
      <div ref={menuRef} id={menuId} role="menu" aria-label={LEARN_COPY.menuLabel}
        className={styles.list} onKeyDown={onMenuKeyDown}>
        {groups.map((g) => (
          <div key={g.name} role="group" aria-label={g.name} className={styles.group}>
            <p className={styles.groupHeading} aria-hidden="true">{g.name}</p>
            {g.tours.map((t) => (
              <button
                key={t.id}
                ref={slot()}
                type="button"
                role="menuitem"
                className={styles.item}
                data-learn-tour={t.id}
                onClick={() => choose(t.id)}
              >
                {LEARN_COPY.tour(t.title)}
              </button>
            ))}
          </div>
        ))}
        {canAddSample && (
          <button
            ref={slot()}
            type="button"
            role="menuitem"
            className={`${styles.item} ${styles.sampleItem}`}
            aria-disabled={adding || undefined}
            data-learn-sample=""
            onClick={addSample}
          >
            {adding ? SAMPLE_COPY.adding : LEARN_COPY.sample}
          </button>
        )}
        <Link
          ref={slot()}
          role="menuitem"
          className={`${styles.item} ${styles.helpItem}`}
          to={HELP_WALKTHROUGHS_HREF}
          onClick={() => setOpen(false)}
        >
          {LEARN_COPY.help}
        </Link>
      </div>
      {sampleMsg && <p role="status" className={styles.status}>{sampleMsg}</p>}
    </div>
  )

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
      {open && (asSheet ? (
        <Sheet open onClose={closeSheet} variant="bottom-sheet" title={LEARN_COPY.menuLabel} labelledByTitle>
          {menu}
        </Sheet>
      ) : menu)}
    </span>
  )
}
