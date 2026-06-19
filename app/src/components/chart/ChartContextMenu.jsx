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
 */

import { useEffect, useRef, useState } from 'react'
import { useIsTouch } from '../../hooks/useBreakpoint'
import Sheet from '../mobile/Sheet'
import UIcon from '../ui/UIcon'
import styles from './ChartContextMenu.module.css'

export default function ChartContextMenu({ open, x, y, sections = [], onClose }) {
  const menuRef = useRef(null)
  const [expanded, setExpanded] = useState(null)  // id of the open submenu
  const isTouch = useIsTouch()

  useEffect(() => { if (!open) setExpanded(null) }, [open])

  useEffect(() => {
    // Desktop popover dismisses on outside click / Esc. On touch the Sheet
    // owns dismissal (backdrop + Esc), so skip this listener there.
    if (!open || isTouch) return
    const onClick = (e) => {
      if (menuRef.current?.contains(e.target)) return
      onClose?.()
    }
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
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
    item.onSelect?.()
    onClose?.()
  }

  const rows = renderSections({ visible, styles, expanded, setExpanded, select })

  // Touch: bottom-sheet with full-width, ≥44px tap targets.
  if (isTouch) {
    return (
      <Sheet open onClose={onClose} variant="bottom-sheet" ariaLabel="Chart actions">
        <div className={styles.sheetMenu} role="menu">{rows}</div>
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
      role="menu"
    >
      {rows}
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
