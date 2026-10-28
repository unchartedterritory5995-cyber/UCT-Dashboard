/**
 * ChartContextMenu — generic, section-based right-click menu for charts.
 *
 * Promoted out of journal-2-0/ so every StockChart surface can share one
 * region-aware menu. The menu itself is a dumb renderer: callers build an
 * array of `sections`, each with `items`, and this component draws them.
 *
 * Section: { id?, title?, items: Item[] }
 * Item:    { id, label, kind?: 'action'|'toggle'|'submenu', checked?: bool,
 *            primary?: bool, danger?: bool, disabled?: bool,
 *            submenu?: Item[], onSelect: fn }
 *
 * Selecting an item fires onSelect() then onClose() (close-on-select).
 * A 'submenu' item expands its child items inline (does not close).
 * Closes on outside click or Esc. Position clamped to the viewport.
 *
 * On touch / coarse-pointer devices (≤1024px) the same sections render inside
 * a bottom-sheet (so the menu is reachable + tappable on phones/tablets);
 * desktop keeps the anchored fixed popover unchanged.
 *
 * Keyboard + screen reader (the ARIA menu pattern, measured WebKit + Chromium
 * + axe, 2026-10-28; before this the menu had no name, focus stayed on the
 * page behind it, and page-scope axe reported every row under `region`):
 *   · named: `ariaLabel` (the host passes "Chart actions for <SYM>");
 *   · focus moves to the first enabled item on open; ArrowUp/ArrowDown wrap,
 *     Home/End jump (element-level onKeyDown, never a document listener: the
 *     key-listener census in pages/command/keyListenerCensus.test.js);
 *   · Escape (still the ONE document listener below, so it still closes ONLY
 *     the menu and TickerPopup's layer check is unchanged) and picking an item
 *     hand focus back to the chart region the menu was opened from
 *     (`returnFocusTo`: the chart's element; its nearest focusable
 *     `role="region"` wins). An OUTSIDE click does not pull focus back: the
 *     member clicked somewhere else on purpose;
 *   · Tab closes the menu (APG) without preventDefault, so focus moves on
 *     naturally; an open-but-unfocused menu would otherwise keep its dialog
 *     wrapper in the DOM and isModalOpen() would hold every chart shortcut off;
 *   · the desktop popover sits inside a NON-MODAL `role="dialog"`, labelled BY
 *     the menu (aria-labelledby, so it is not a second, different name). The
 *     menu renders at the app root, outside every landmark, and a dialog is
 *     what axe's `region` rule accepts for a transient popup (its
 *     regionMatcher). That is the repo's own precedent for root-level
 *     non-modal popups (EarningsMarkerPopover, GlobalVideoLayer's "Next up"
 *     card), and exactly the shape the touch branch already has (a Sheet
 *     dialog holding the role="menu").
 */

import { useEffect, useId, useRef, useState } from 'react'
import { useIsTouch } from '../../hooks/useBreakpoint'
import Sheet from '../mobile/Sheet'
import UIcon from '../ui/UIcon'
import styles from './ChartContextMenu.module.css'

// Sheet's shared backdrop rung is --z-modal (1000, mobile/Sheet.module.css) —
// fine for every other Sheet caller, but this menu can open from inside
// TickerPopup on a coarse-pointer device too (iOS long-press on flow tapes
// uses TickerPopup's controlled mode), and TickerPopup's own overlay now sits
// at 8600. Without elevating THIS instance, the touch bottom-sheet render
// path re-introduces the exact bug the desktop `.menu` z-index (8700, see
// ChartContextMenu.module.css) was raised to fix — just through the other
// render branch. Kept in sync with that value by TickerPopup.zorder.test.js's
// rail, not by hand — if the two ever drift, the rail reds.
const TOUCH_SHEET_Z_INDEX = 8700

const ITEM = '[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]'

// Enabled items, in document order (submenu children included while expanded).
function itemsOf(root) {
  if (!root) return []
  return [...root.querySelectorAll(ITEM)]
    .filter((el) => !el.disabled && el.getAttribute('aria-disabled') !== 'true')
}

// Where focus goes back to when the menu closes by keyboard or by a pick: the
// chart region the menu was opened on (ChartPane's `role="region"` tab stop),
// else the nearest focusable ancestor of the chart element, else nothing.
export function returnTargetFor(origin) {
  const el = origin && typeof origin === 'object' && 'current' in origin ? origin.current : origin
  if (!el || !el.isConnected || typeof el.closest !== 'function') return null
  return el.closest('[role="region"][tabindex]') || el.closest('[tabindex]') || null
}

export default function ChartContextMenu({ open, x, y, sections = [], onClose, ariaLabel = 'Chart actions', returnFocusTo = null }) {
  const menuRef = useRef(null)
  const listRef = useRef(null)
  const menuId = useId()
  const [expanded, setExpanded] = useState(null)  // id of the open submenu
  const isTouch = useIsTouch()
  // Read at close through a ref, so a new element on a re-render never re-runs the effects.
  const returnRef = useRef(returnFocusTo)
  returnRef.current = returnFocusTo
  const giveFocusBack = () => {
    const back = returnTargetFor(returnRef.current)
    if (back && typeof back.focus === 'function') back.focus({ preventScroll: true })
  }

  useEffect(() => { if (!open) setExpanded(null) }, [open])

  // Desktop: focus INTO the menu on open (the first enabled item). Asked again
  // for a few frames: with "reduce motion" tokens.css gives every element a
  // 0.01 ms transition, and a browser refuses to focus a node that is still
  // mid-transition from hidden (the ContextPopover lesson, 2026-10-07).
  useEffect(() => {
    if (!open || isTouch) return undefined
    let raf = 0
    let tries = 0
    const take = () => {
      const list = listRef.current
      if (!list) return
      const first = itemsOf(list)[0]
      ;(first || list).focus?.({ preventScroll: true })
      if (!list.contains(document.activeElement) && tries < 12 && typeof requestAnimationFrame === 'function') {
        tries += 1
        raf = requestAnimationFrame(take)
      }
    }
    take()
    return () => { if (raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf) }
  }, [open, isTouch])

  useEffect(() => {
    // Desktop popover dismisses on outside click / Esc. On touch the Sheet
    // owns dismissal (backdrop + Esc), so skip this listener there.
    if (!open || isTouch) return
    const onClick = (e) => {
      if (menuRef.current?.contains(e.target)) return
      onClose?.()
    }
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      // Only when focus is in the menu (or nowhere): an Escape pressed in some
      // other field must not yank focus to the chart.
      const a = document.activeElement
      if (!a || a === document.body || menuRef.current?.contains(a)) giveFocusBack()
      onClose?.()
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose, isTouch])

  if (!open) return null

  // Drop empty sections so callers can pass conditional content freely.
  const visible = sections.filter((s) => s && Array.isArray(s.items) && s.items.length > 0)
  if (visible.length === 0) return null

  const select = (item) => {
    if (item.disabled) return
    // Focus goes back BEFORE the action runs: an action that opens a modal then
    // records the chart as its opener (the row it was picked from is about to
    // unmount), and the modal's own focus-in still wins.
    giveFocusBack()
    item.onSelect?.()
    onClose?.()
  }

  // ArrowUp/ArrowDown wrap, Home/End jump, between the menu's own enabled items.
  const onMenuKeyDown = (e) => {
    // Tab leaves the menu, so the menu goes (APG). No preventDefault: focus
    // moves to wherever Tab takes it (a popup's focus trap still applies).
    if (e.key === 'Tab') { onClose?.(); return }
    const MOVES = { ArrowDown: 1, ArrowUp: -1, Home: 'first', End: 'last' }
    const move = MOVES[e.key]
    if (move == null) return
    const rowsNow = itemsOf(listRef.current)
    if (!rowsNow.length) return
    const at = rowsNow.indexOf(e.target?.closest?.(ITEM))
    const next = move === 'first' ? 0
      : move === 'last' ? rowsNow.length - 1
        : at < 0 ? (move > 0 ? 0 : rowsNow.length - 1)
          : (at + move + rowsNow.length) % rowsNow.length
    e.preventDefault()
    rowsNow[next].focus()
  }

  const rows = renderSections({ visible, styles, expanded, setExpanded, select })

  // Touch: bottom-sheet with full-width, ≥44px tap targets.
  if (isTouch) {
    return (
      <Sheet
        open
        onClose={onClose}
        variant="bottom-sheet"
        ariaLabel="Chart actions"
        zIndex={TOUCH_SHEET_Z_INDEX}
        returnFocusTo={returnTargetFor(returnFocusTo) || undefined}
      >
        <div className={styles.sheetMenu} role="menu" aria-label={ariaLabel}>{rows}</div>
      </Sheet>
    )
  }

  // Estimate height so the clamp keeps the whole menu on-screen.
  const itemCount = visible.reduce((n, s) => n + s.items.length + (s.title ? 1 : 0), 0)
  const estHeight = itemCount * 32 + visible.length * 9 + 8
  const clampedX = Math.min(x, window.innerWidth - 220)
  const clampedY = Math.min(y, Math.max(8, window.innerHeight - estHeight))

  return (
    <div
      ref={menuRef}
      className={styles.menu}
      style={{ left: clampedX, top: clampedY }}
      role="dialog"
      aria-labelledby={menuId}
    >
      <div
        ref={listRef}
        id={menuId}
        role="menu"
        aria-label={ariaLabel}
        tabIndex={-1}
        data-escape-layer=""
        onKeyDown={onMenuKeyDown}
      >
        {rows}
      </div>
    </div>
  )
}

// Section/item renderer shared by the desktop popover and the touch sheet.
function renderSections({ visible, styles, expanded, setExpanded, select }) {
  return (
    <>
      {visible.map((section, si) => (
        <div key={section.id || si} className={styles.section}>
          {si > 0 && <div className={styles.separator} />}
          {section.title && <div className={styles.sectionTitle}>{section.title}</div>}
          {section.items.map((item) => {
            const cls = [
              styles.item,
              item.primary ? styles.itemPrimary : '',
              item.danger ? styles.itemDanger : '',
              item.disabled ? styles.itemDisabled : '',
            ].filter(Boolean).join(' ')

            if (item.kind === 'submenu') {
              const isOpen = expanded === (item.id || item.label)
              const subItems = (item.submenu || []).filter(Boolean)
              return (
                <div key={item.id || item.label} className={styles.submenuWrap}>
                  <button
                    type="button"
                    role="menuitem"
                    aria-haspopup="true"
                    aria-expanded={isOpen}
                    className={cls}
                    onClick={() => setExpanded(isOpen ? null : (item.id || item.label))}
                  >
                    <span className={styles.label}>{item.label}</span>
                    <span className={styles.caret} aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
                  </button>
                  {isOpen && (
                    <div className={styles.submenu}>
                      {subItems.length === 0 && <div className={styles.submenuEmpty}>Nothing here</div>}
                      {subItems.map((sub) => (
                        <button
                          key={sub.id || sub.label}
                          type="button"
                          role={sub.kind === 'toggle' ? 'menuitemcheckbox' : 'menuitem'}
                          aria-checked={sub.kind === 'toggle' ? !!sub.checked : undefined}
                          aria-disabled={sub.disabled || undefined}
                          className={[styles.item, sub.danger ? styles.itemDanger : '', sub.disabled ? styles.itemDisabled : ''].filter(Boolean).join(' ')}
                          onClick={() => select(sub)}
                        >
                          <span className={styles.check} aria-hidden="true">
                            {sub.swatch ? <span className={styles.swatchDot} style={{ background: sub.swatch }} /> : (sub.checked ? <UIcon name="check" size={13} /> : '')}
                          </span>
                          <span className={styles.label}>{sub.label}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )
            }

            return (
              <button
                key={item.id || item.label}
                type="button"
                role={item.kind === 'toggle' ? 'menuitemcheckbox' : 'menuitem'}
                aria-checked={item.kind === 'toggle' ? !!item.checked : undefined}
                aria-disabled={item.disabled || undefined}
                className={cls}
                onClick={() => select(item)}
              >
                {item.kind === 'toggle' && (
                  <span className={styles.check} aria-hidden="true">{item.checked ? <UIcon name="check" size={13} /> : ''}</span>
                )}
                <span className={styles.label}>{item.label}</span>
              </button>
            )
          })}
        </div>
      ))}
    </>
  )
}
