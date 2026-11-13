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
 *
 * ⛔ PHONE ITEMS ARE RENDERED ON A PHONE ONLY, DECIDED WHEN THE PANEL OPENS (Notebook phone
 * pass, 2026-10-10). On a phone the note header keeps Star, Share and this door; Ask, Find,
 * Writing help, Outline and the folder move here (`phoneItems`, first in the panel). They
 * are NOT rendered-and-hidden-by-CSS on a desktop: the panel's keyboard contract
 * (useDisclosureFocus) puts focus on the FIRST focusable child and wraps Tab between the
 * first and last, and `focusableWithin` cannot see a stylesheet's `display: none` -- a hidden
 * first item would leave focus on the door and break the wrap. Opening is a CLICK, so this is
 * the sanctioned JS breakpoint read (CLAUDE.md: useMediaQuery is stale at first paint; a
 * click-triggered decision reads the query at the click). A width change while open re-reads.
 */
import { createContext, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import UIcon from '../../../../components/ui/UIcon'
import { MQ } from '../../../../styles/breakpoints'
import useDisclosureFocus from '../../lib/useDisclosureFocus'
import styles from './NoteMoreMenu.module.css'

export const MORE_NOTE_ACTIONS = 'More note actions'

/** Lane KEYS3: lets an action INSIDE the panel open the panel it lives in (the Export menu,
 *  asked for from the command palette): `open()`; `shown` says whether it is open. Simplify pass 2 (C3): and swap
 *  the panel's content for a SECOND VIEW of its own, the way the menu engine's rows do (NewNoteMenu.jsx MenuRows `children`): `sub` is the open view's
 *  key or null, `setSub` opens or closes it, and `slot` is the element it is drawn into (the panel's other content is
 *  hidden meanwhile, never unmounted: a Lock sentence or a half-typed template name survives). Null outside a panel. */
export const MoreMenuOpenContext = createContext(null)
export const PANEL_GUTTER = 16

/** How far to move a box spanning [left, right] so it sits inside [gutter, viewport - gutter]
 *  (the left edge wins when the box is wider than the room). */
export function onScreenShift(left, right, viewport, gutter = PANEL_GUTTER) {
  if (left < gutter) return gutter - left
  if (right > viewport - gutter) return Math.max(gutter - left, viewport - gutter - right)
  return 0
}

/** Is the viewport the phone tier right now? Read at a click, never at render. */
function readIsPhone() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return Boolean(window.matchMedia(MQ.phone)?.matches)
}

/**
 * @param phoneItems  `({ close }) => ReactNode` -- the actions the note header moves into this
 *   panel on a phone. Rendered first, then a separator, ONLY when the panel was opened on a
 *   phone (see the header comment). `close()` closes the panel, for an action that puts the
 *   member back on the note (Find) rather than opening a dialog of its own.
 */
/**
 * @param leadItems  `({ close, trigger }) => ReactNode` -- audit 2026-11-05, spec S10 (M4): the actions the header moved
 *   into this panel on EVERY width (Find, Outline). Rendered first, after any phone items, then a separator. `trigger`
 *   is this panel's own button, the one control that stays on screen, for an action that hands focus back later.
 */
export default function NoteMoreMenu({ children, buttonClassName = '', phoneItems = null, leadItems = null, phoneTail = null }) {
  const [open, setOpen] = useState(false)
  const [onPhone, setOnPhone] = useState(false)
  const panelId = useId()
  const triggerRef = useRef(null)
  const panelRef = useRef(null)
  const close = useCallback(() => setOpen(false), [])
  const openPanel = useCallback(() => { setOnPhone(readIsPhone()); setOpen(true) }, [])
  // Simplify pass 2 (C3): the panel's second view (Export's formats), and where it is drawn. A closed panel reopens on
  // its first view.
  const [sub, setSub] = useState(null)
  const [slot, setSlot] = useState(null)
  useEffect(() => { if (!open) setSub(null) }, [open])
  const more = useMemo(() => ({ open: openPanel, shown: open, sub, setSub, slot }), [openPanel, open, sub, slot])
  const { disclosureProps } = useDisclosureFocus({
    open, containerRef: panelRef, onClose: close, openerRef: triggerRef,
  })
  // A rotated phone or a resized window while the panel is open: the phone items follow.
  useEffect(() => {
    if (!open || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined
    const mq = window.matchMedia(MQ.phone)
    const onChange = (e) => setOnPhone(Boolean(e.matches))
    mq?.addEventListener?.('change', onChange)
    return () => mq?.removeEventListener?.('change', onChange)
  }, [open])

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
        data-more-trigger=""
        onClick={() => {
          if (!open) setOnPhone(readIsPhone())
          setOpen(!open)
        }}
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
        <div className={styles.view} hidden={Boolean(sub)}>
          {onPhone && phoneItems && (
            <>
              {phoneItems({ close })}
              {!leadItems && <div className={styles.sep} role="separator" />}
            </>
          )}
          {leadItems && (
            <>
              {leadItems({ close, trigger: triggerRef.current })}
              <div className={styles.sep} role="separator" />
            </>
          )}
          {/* Final polish: a phone-only item AFTER the lead group (the Journal tools door on a note), so Ask, Find and
              Outline stay first and Move to Trash stays last. */}
          {onPhone && phoneTail && phoneTail({ close })}
          <MoreMenuOpenContext.Provider value={more}>{children}</MoreMenuOpenContext.Provider>
        </div>
        <div ref={setSlot} className={styles.view} />
      </div>
    </span>
  )
}
