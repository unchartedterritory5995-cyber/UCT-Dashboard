import { useState, useRef, useEffect, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import UIcon from '../../components/ui/UIcon'
import { WIDGET_TAB_TYPES, WIDGET_TAB_MENU_LABEL } from './widgetTabs'
import styles from './ChartsWorkspace.module.css'

// 'N' = grey "not linked": the widget syncs its ticker with nothing.
const COLORS = ['A', 'B', 'C', 'D', 'N']

function nextColor(c) {
  const i = COLORS.indexOf(c)
  return COLORS[(i + 1) % COLORS.length]
}

export default function WidgetHeader({
  label, color, onColorChange, onRemove, onPopOut, atBottom = false, style,
  // Widget-level tabs: one slot can hold several widgets of different types.
  tabs = null,          // widgetTabList() — [{id, isMain, type, label}] (base first)
  activeIndex = 0,      // 0 = base tab, 1..N = extra tabs
  onSelectTab,          // (index) => void
  onCloseTab,           // (tabId) => void
  onAddTab,             // (type) => void — add a new tab of this widget type
}) {
  const isNone = color === 'N'
  const [addOpen, setAddOpen] = useState(false)
  const [addPos, setAddPos] = useState(null)         // fixed-position anchor for the portaled menu
  const addBtnRef = useRef(null)
  const [confirmCloseId, setConfirmCloseId] = useState(null)
  const confirmTimer = useRef(null)
  useEffect(() => () => clearTimeout(confirmTimer.current), [])

  // The add-tab menu is portaled to the button's OWN document (so it works inside a
  // popped-out window too) and positioned `fixed`, because the widget itself is
  // overflow:hidden and would otherwise clip a dropdown on a short widget.
  useLayoutEffect(() => {
    const btn = addBtnRef.current
    if (!addOpen || !btn) { setAddPos(null); return }
    const doc = btn.ownerDocument
    const win = doc.defaultView || window
    const place = () => {
      const r = btn.getBoundingClientRect()
      const W = 156
      const left = Math.max(6, Math.min(r.right - W, win.innerWidth - W - 6))
      setAddPos({ top: Math.round(r.bottom + 4), left: Math.round(left) })
    }
    place()
    win.addEventListener('resize', place)
    win.addEventListener('scroll', place, true)
    return () => { win.removeEventListener('resize', place); win.removeEventListener('scroll', place, true) }
  }, [addOpen])

  // Close on any outside click / Escape.
  useEffect(() => {
    if (!addOpen) return
    const doc = addBtnRef.current?.ownerDocument || document
    const onDown = (e) => {
      if (addBtnRef.current?.contains(e.target)) return
      if (e.target.closest?.('[data-wtab-add-menu]')) return
      setAddOpen(false)
    }
    const onKey = (e) => { if (e.key === 'Escape') setAddOpen(false) }
    doc.addEventListener('mousedown', onDown, true)
    doc.addEventListener('keydown', onKey)
    return () => { doc.removeEventListener('mousedown', onDown, true); doc.removeEventListener('keydown', onKey) }
  }, [addOpen])
  // Only render the tab strip once there's ≥1 EXTRA tab, so a plain single-widget
  // slot looks exactly as before (just the new "+" add-tab affordance appears).
  const showTabs = Array.isArray(tabs) && tabs.length > 1

  // Two-stage close so a stray click can't nuke a tab.
  const handleCloseClick = (tabId) => {
    if (confirmCloseId === tabId) { clearTimeout(confirmTimer.current); setConfirmCloseId(null); onCloseTab?.(tabId); return }
    clearTimeout(confirmTimer.current)
    setConfirmCloseId(tabId)
    confirmTimer.current = setTimeout(() => setConfirmCloseId(null), 3000)
  }

  return (
    <div className={`${styles.widgetHeader}${atBottom ? ' ' + styles.widgetHeaderBottom : ''}`} style={style}>
      <span className={`${styles.dragGrip} charts-widget-drag-handle`} aria-hidden="true">⋮⋮</span>
      <button
        type="button"
        className={`${styles.colorDot} ${styles[`colorDot${color}`]}`}
        onClick={() => onColorChange(nextColor(color))}
        aria-label={isNone ? 'Not linked (grey) — click to link to a color group' : `Color group ${color} (click to cycle)`}
        title={isNone
          ? 'Not linked — this widget’s ticker syncs with nothing. Click to cycle to a color group.'
          : `Color group ${color} — click to cycle (grey = not linked)`}
      />
      {showTabs ? (
        <div className={styles.wtabStrip} role="tablist" aria-label="Widget tabs">
          {tabs.map((tab, i) => {
            const active = i === activeIndex
            return (
              <div
                key={tab.id}
                role="tab"
                aria-selected={active}
                className={`${styles.wtabChip}${active ? ' ' + styles.wtabChipActive : ''}`}
                onClick={() => { setConfirmCloseId(null); onSelectTab?.(i) }}
                title={`${tab.label} tab`}
              >
                <span className={styles.wtabLabel}>{tab.label}</span>
                {!tab.isMain && (
                  <span
                    className={`${styles.wtabClose}${confirmCloseId === tab.id ? ' ' + styles.wtabCloseConfirm : ''}`}
                    role="button"
                    aria-label={confirmCloseId === tab.id ? `Confirm close ${tab.label} tab` : `Close ${tab.label} tab`}
                    title={confirmCloseId === tab.id ? 'Click again to close tab' : 'Close tab'}
                    onClick={(e) => { e.stopPropagation(); handleCloseClick(tab.id) }}
                  >{confirmCloseId === tab.id ? '✓' : '×'}</span>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <span className={styles.widgetLabel}>{label}</span>
      )}
      <span className={styles.headerSpacer} />
      {onAddTab && (
        <button
          ref={addBtnRef}
          type="button"
          className={styles.wtabAdd}
          onClick={() => setAddOpen(o => !o)}
          aria-label="Add a tab to this widget"
          title="Add a tab — hold multiple widgets in this one slot"
        >+</button>
      )}
      {onAddTab && addOpen && addPos && addBtnRef.current && createPortal(
        <div
          data-wtab-add-menu
          className={styles.wtabAddMenu}
          style={{ top: addPos.top, left: addPos.left }}
        >
          {WIDGET_TAB_TYPES.map(t => (
            <button
              key={t}
              type="button"
              className={styles.addMenuItem}
              onClick={() => { onAddTab(t); setAddOpen(false) }}
            >{WIDGET_TAB_MENU_LABEL[t] || t}</button>
          ))}
        </div>,
        addBtnRef.current.ownerDocument.body,
      )}
      {onPopOut && (
        <button
          type="button"
          className={styles.popOutBtn}
          onClick={onPopOut}
          aria-label="Pop out widget"
          title="Open this widget in its own window you can drag to another monitor"
        >⧉</button>
      )}
      <button
        type="button"
        className={styles.closeBtn}
        onClick={onRemove}
        aria-label="Close widget"
        title="Remove this widget"
      ><UIcon name="x" size={13} /></button>
    </div>
  )
}
