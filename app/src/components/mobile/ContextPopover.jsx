import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useIsTouch } from '../../hooks/useBreakpoint'
import Sheet from './Sheet'
import useFocusTrap, { focusableWithin } from './useFocusTrap'
import styles from './ContextPopover.module.css'

/* ContextPopover — action menu that adapts to input.
 *
 * Touch: bottom-sheet (44px rows, easy to tap).
 * Desktop: floating menu anchored at {x,y}, clamped to viewport.
 *
 * Provide either `items` (declarative) or `children` (custom content).
 *
 *   <ContextPopover open={open} onClose={close} anchor={{x,y}} title="AAPL"
 *     items={[
 *       { label: 'Flag', icon: '⚑', onClick: ... },
 *       { label: 'Remove', danger: true, onClick: ... },
 *     ]} />
 *
 * An item may carry an optional `hint`: one sentence saying what the row does, for a label
 * too short to say it. It becomes the row's `title` (the pointer tooltip) and its
 * `aria-description` (read after the name). An item without one renders exactly as before.
 */
// Nothing at all when there is no hint, so a caller that never passes one is unchanged.
const hintProps = (it) => (it.hint ? { title: it.hint, 'aria-description': it.hint } : null)

export default function ContextPopover({
  /** A stable name for UCT Agent's product guide (agent/guide/targets.js): no behaviour. */
  guide,
  open,
  onClose,
  anchor,
  items,
  title,
  /** ⭐ DESKTOP DENSITY ONLY. Track B's on-chart popover carries four to seven
   *  short commands and floats over a live chart, where a settings-card-sized menu
   *  covers the candles the member is reading. `dense` compacts the ANCHORED menu
   *  — width, row height, padding, icon box, separator spacing.
   *
   *  ⛔ IT DOES NOT REACH THE TOUCH BRANCH, AND THAT IS THE WHOLE POINT OF PUTTING
   *  IT HERE RATHER THAN IN A STYLESHEET OVERRIDE. On touch this component renders
   *  a `Sheet` whose rows are pinned to the 44px tap-target floor
   *  (`ContextPopover.module.css`'s ≤1024px query, railed by
   *  `styles/tapFloor.test.js`); a class that shrank those would make the menu
   *  unusable with a thumb. The prop is read in the desktop branch only.
   *
   *  ⚠️ AND IT IS OPT-IN, so the drawing menu, the chart region menu and every
   *  other caller keep the comfortable density they shipped with. */
  dense = false,
  /** ⭐ AN OPTIONAL NON-INTERACTIVE HEADER, ABOVE THE ROWS, IN BOTH BRANCHES.
   *
   *  Added for Track B's on-chart popover, which has to answer *"what is this?"*
   *  — name, live value, what it reads — before it offers a verb. `title` cannot
   *  carry that: it is a single string and on touch it is the `Sheet`'s own
   *  heading. `children` cannot either, because passing children REPLACES the
   *  declarative `items` list and this menu needs both.
   *
   *  ⛔ IT IS NOT A ROW. `renderItems` emits `<button>`s and a focus trap walks
   *  them; a header that rendered as one would be a tab stop that does nothing.
   *  Ignored when `children` is given — that branch owns its own layout. */
  header,
  children,
  width = 220,
  // Theme class forwarded to the touch bottom-sheet — it portals to <body>,
  // escaping any scoped theme tokens (the chart's Sunrise), exactly like every
  // other Sheet. Desktop's anchored menu ignores it (menu-dark by design).
  sheetClassName = '',
  /** ⭐ OPT-IN, BOTH BRANCHES: a REF (`{ current }`) to the element focus returns
   *  to on close, used only while it is still connected; otherwise focus goes back
   *  to where it was on open. The touch branch hands it to `Sheet`'s own
   *  `returnFocusTo`. A menu the CHART opened on its own (the RS tour) has no
   *  opener in focus, so without it focus fell back to the chart region rather
   *  than the chip it is about (a11y gate §12.2, 2026-11-08).
   *
   *  ⭐ INITIAL FOCUS IS NOT A PROP: a child marked `data-autofocus` takes focus on
   *  open (desktop), else the first focusable one. The RS tour marks "Next", its
   *  primary action, not "Skip tour", first in reading order.
   *  ⛔ Both stay this small ON PURPOSE: this module ships in the Notebook's
   *  first-open JS (`tools/notebook_perf_budgets.py`), so a caller's own focus
   *  logic (which element, resolved how) lives with the caller, not here. */
  returnFocusTo,
}) {
  const isTouch = useIsTouch()
  const menuRef = useRef(null)
  const [pos, setPos] = useState(null)
  const focusedOnce = useRef(false)

  // Desktop: clamp the anchored menu inside the viewport after it mounts
  useEffect(() => {
    if (!open || isTouch || !anchor) return
    const vw = window.innerWidth
    const vh = window.innerHeight
    const el = menuRef.current
    const h = el?.offsetHeight ?? 200
    const w = el?.offsetWidth ?? width
    setPos({
      left: Math.min(anchor.x, vw - w - 8),
      top: Math.min(anchor.y, vh - h - 8),
    })
  }, [open, isTouch, anchor, width])

  // Desktop: keyboard containment. The touch branch is a `Sheet`, which
  // already traps, focuses its panel and restores — this is the OTHER branch,
  // an anchored `role="menu"` portalled to <body> with no focus management at
  // all: focus stayed on the trigger, so Tab walked the page BEHIND an open
  // menu and a screen-reader user was never told the menu existed.
  useFocusTrap(open && !isTouch, menuRef)

  // ⛔ LATCHED, AND GATED ON `pos`. The menu renders `visibility: hidden` until
  // it has been measured and clamped, and focusing a hidden node is a no-op
  // that silently leaves focus on the trigger. But `pos` settling is a RENDER,
  // so an unlatched effect would re-run, tear down, and hand focus back to the
  // trigger the instant the menu finished positioning — the bug this shape
  // exists to avoid.
  useEffect(() => {
    if (!open || isTouch) { focusedOnce.current = false; return undefined }
    if (!pos || focusedOnce.current) return undefined
    focusedOnce.current = true
    const restoreTo = document.activeElement
    // ⛔ ASK AGAIN ON THE NEXT FRAME UNTIL FOCUS IS INSIDE (measured in a real browser,
    // 2026-10-07). With "reduce motion" on, tokens.css gives every element a 0.01 ms
    // transition on every property, so the change from hidden to visible is a transition and
    // at the instant it starts the menu is STILL computed `hidden`. A browser silently refuses
    // to focus a hidden element. One attempt, made right here, was refused and never
    // repeated: the menu was on screen and every key went to the page behind it.
    let raf = 0
    let tries = 0
    const takeFocus = () => {
      const el = menuRef.current
      if (!el) return
      const first = el.querySelector('[data-autofocus]') || focusableWithin(el)[0]
      ;(first || el).focus?.()
      if (!el.contains(document.activeElement) && tries < 12) {
        tries += 1
        raf = requestAnimationFrame(takeFocus)
      }
    }
    takeFocus()
    // ⛔ NO `isConnected` CHECK, AND THAT IS MEASURED, NOT ASSUMED. The
    // trigger can genuinely be gone by now (a menu whose action deleted the row
    // it was opened from), and the obvious guard is to skip the restore for a
    // detached node. Deleting that guard changes NOTHING — focusing a detached
    // element is a silent no-op in jsdom and in browsers, not a throw — so the
    // test written for it could not fail, and a test that cannot fail reads as
    // coverage while providing none. Optional chaining is the whole guard: it
    // handles `restoreTo` being null, which IS distinguishable.
    // `returnFocusTo` is read from this closure on purpose (not a dep): it is a
    // ref, read at close, and a new ref identity must never re-run this latch.
    return () => {
      cancelAnimationFrame(raf)
      const to = returnFocusTo?.current
      ;(to?.isConnected ? to : restoreTo)?.focus?.()
    }
  }, [open, isTouch, pos]) // eslint-disable-line react-hooks/exhaustive-deps

  // Desktop: dismiss on outside click / Escape
  useEffect(() => {
    if (!open || isTouch) return
    const onDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) onClose?.()
    }
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open, isTouch, onClose])

  if (!open) return null

  // `asMenu` is the DESKTOP anchored branch, which is `role="menu"`: a menu must hold menu
  // items (axe: aria-required-children, critical), so its rows are `role="menuitem"` and its
  // separators `role="separator"`. The touch branch is a Sheet (a dialog), where the rows stay
  // plain buttons.
  const renderItems = (asMenu = false) =>
    items?.map((it, i) =>
      it.separator ? (
        <div key={`sep${i}`} className={styles.separator} role={asMenu ? 'separator' : undefined} />
      ) : it.href ? (
        // A real link (middle-click and cmd-click open a tab). Same row look, same close-on-pick;
        // a link cannot be `disabled`, so a caller that needs that passes no `href`.
        <a
          key={it.key ?? it.label ?? i}
          role={asMenu ? 'menuitem' : undefined}
          className={`${styles.item} ${it.danger ? styles.danger : ''}`}
          href={it.href}
          {...hintProps(it)}
          onClick={(e) => { it.onClick?.(e); if (!it.keepOpen) onClose?.() }}
        >
          {it.icon != null && <span className={styles.icon}>{it.icon}</span>}
          <span className={styles.label}>{it.label}</span>
        </a>
      ) : (
        <button
          key={it.key ?? it.label ?? i}
          data-menu-id={it.key}
          role={asMenu ? 'menuitem' : undefined}
          className={`${styles.item} ${it.danger ? styles.danger : ''}`}
          disabled={it.disabled}
          {...hintProps(it)}
          onClick={(e) => { it.onClick?.(e); if (!it.keepOpen) onClose?.() }}
        >
          {it.icon != null && <span className={styles.icon}>{it.icon}</span>}
          <span className={styles.label}>{it.label}</span>
        </button>
      ),
    )

  // Touch → bottom sheet
  if (isTouch) {
    return (
      // VIS-7 (audit 2026-11-05, axe aria-dialog-name): the sheet is a dialog and needs a name. The same rule as the
      // anchored menu below: the title when it is plain text (named BY the visible title), else Options / Actions.
      <Sheet open={open} onClose={onClose} variant="bottom-sheet" title={title} className={sheetClassName} returnFocusTo={returnFocusTo}
        labelledByTitle={typeof title === 'string' && Boolean(title)}
        ariaLabel={typeof title === 'string' && title ? undefined : (children != null ? 'Options' : 'Actions')}>
        <div className={styles.sheetList}>
          {children ?? <>{header}{renderItems()}</>}
        </div>
      </Sheet>
    )
  }

  // Desktop: the keys a menu needs. Arrow keys, Home and End move between the menu's own
  // items (enabled ones, wrapping). Only when focus is ON an item, so custom children with
  // their own fields (a textarea, a select) keep their keys. Escape is handled above.
  const ITEM = '[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]'
  const onMenuKeyDown = (e) => {
    const MOVES = { ArrowDown: 1, ArrowUp: -1, Home: 'first', End: 'last' }
    const move = MOVES[e.key]
    if (move == null) return
    const here = e.target?.closest?.(ITEM)
    if (!here || !menuRef.current?.contains(here)) return
    const rows = [...menuRef.current.querySelectorAll(ITEM)]
      .filter((el) => !el.disabled && el.getAttribute('aria-disabled') !== 'true')
    if (!rows.length) return
    const at = rows.indexOf(here)
    const next = move === 'first' ? 0 : move === 'last' ? rows.length - 1 : (at + move + rows.length) % rows.length
    e.preventDefault()
    rows[next].focus()
  }

  // Desktop → anchored floating menu
  return createPortal(
    <div
      ref={menuRef}
      className={`${styles.menu}${dense ? ' ' + styles.menuDense : ''}`}
      style={{
        left: pos?.left ?? anchor?.x ?? 0,
        top: pos?.top ?? anchor?.y ?? 0,
        width,
        visibility: pos ? 'visible' : 'hidden',
      }}
      // The role follows the content. An action list is a menu of menu items. Custom
      // children (a form, a picker) are not menu items, so that form is a named dialog.
      role={children != null ? 'dialog' : 'menu'}
      data-guide={guide}
      // Both need a name. The title when it is plain text.
      aria-label={typeof title === 'string' && title ? title : (children != null ? 'Options' : 'Actions')}
      tabIndex={-1}
      onKeyDown={onMenuKeyDown}
    >
      {title != null && <div className={styles.menuTitle}>{title}</div>}
      {children ?? <>{header}{renderItems(true)}</>}
    </div>,
    document.body,
  )
}
