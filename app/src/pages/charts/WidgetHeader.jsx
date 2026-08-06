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
  onRenameTab,          // (tabId, name) => void — double-click a tab to rename it
  onAddTab,             // (type) => void — add a new tab of this widget type
  tabsOnly = false,     // merged mode: render ONLY the tab strip (no header chrome)
}) {
  const isNone = color === 'N'
  const [addOpen, setAddOpen] = useState(false)
  const [addPos, setAddPos] = useState(null)         // fixed-position anchor for the portaled menu
  const addBtnRef = useRef(null)
  const [confirmCloseId, setConfirmCloseId] = useState(null)
  const confirmTimer = useRef(null)
  useEffect(() => () => clearTimeout(confirmTimer.current), [])
  // Inline rename (double-click a tab).
  const [editingId, setEditingId] = useState(null)
  const [draft, setDraft] = useState('')
  const renameInputRef = useRef(null)
  useEffect(() => {
    if (editingId && renameInputRef.current) { renameInputRef.current.focus(); renameInputRef.current.select() }
  }, [editingId])
  const startRename = (tab) => { setConfirmCloseId(null); setEditingId(tab.id); setDraft(tab.label) }
  const commitRename = () => {
    if (editingId != null) onRenameTab?.(editingId, draft)
    setEditingId(null); setDraft('')
  }
  // Only render the tab strip once there's ≥1 EXTRA tab, so a plain single-widget
  // slot looks exactly as before (just the new "+" add-tab affordance appears).
  const showTabs = Array.isArray(tabs) && tabs.length > 1

  // Horizontal scroll state for the tab strip: when more tabs are open than fit,
  // chevrons appear on each side so every tab (incl. its close ×) stays reachable.
  const stripRef = useRef(null)
  const [scroll, setScroll] = useState({ over: false, atStart: true, atEnd: true })
  useLayoutEffect(() => {
    const el = stripRef.current
    if (!showTabs || !el) { setScroll({ over: false, atStart: true, atEnd: true }); return }
    const win = el.ownerDocument?.defaultView || window
    const update = () => {
      const over = el.scrollWidth > el.clientWidth + 1
      setScroll({
        over,
        atStart: el.scrollLeft <= 1,
        atEnd: el.scrollLeft + el.clientWidth >= el.scrollWidth - 1,
      })
    }
    update()
    el.addEventListener('scroll', update, { passive: true })
    win.addEventListener('resize', update)
    let ro
    try { ro = new win.ResizeObserver(update); ro.observe(el) } catch { /* no RO */ }
    return () => { el.removeEventListener('scroll', update); win.removeEventListener('resize', update); if (ro) ro.disconnect() }
  }, [showTabs, tabs, activeIndex])
  const scrollBy = (dir) => stripRef.current?.scrollBy({ left: dir * Math.max(80, stripRef.current.clientWidth * 0.6), behavior: 'smooth' })

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
      // Capture the portal target here (the button's own document) so the render
      // path never has to read a ref — works in popped-out windows too.
      setAddPos({ top: Math.round(r.bottom + 4), left: Math.round(left), target: doc.body })
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

  // Two-stage close so a stray click can't nuke a tab.
  const handleCloseClick = (tabId) => {
    if (confirmCloseId === tabId) { clearTimeout(confirmTimer.current); setConfirmCloseId(null); onCloseTab?.(tabId); return }
    clearTimeout(confirmTimer.current)
    setConfirmCloseId(tabId)
    confirmTimer.current = setTimeout(() => setConfirmCloseId(null), 3000)
  }

  // The scrollable tab strip (chips + overflow chevrons). Shared by the full
  // header and merged mode's tabs-only bar, so switching/renaming/closing tabs
  // works in both — merged mode just drops the surrounding header chrome.
  const tabRegion = showTabs ? (
        <div className={styles.wtabRegion}>
          {scroll.over && (
            <button
              type="button"
              className={styles.wtabScroll}
              onClick={() => scrollBy(-1)}
              disabled={scroll.atStart}
              aria-label="Scroll tabs left"
              title="Scroll tabs left"
            >‹</button>
          )}
          <div className={styles.wtabStrip} ref={stripRef} role="tablist" aria-label="Widget tabs">
            {tabs.map((tab, i) => {
              const active = i === activeIndex
              const editing = editingId === tab.id
              return (
                <div
                  key={tab.id}
                  role="tab"
                  aria-selected={active}
                  className={`${styles.wtabChip}${active ? ' ' + styles.wtabChipActive : ''}`}
                  onClick={() => { if (!editing) { setConfirmCloseId(null); onSelectTab?.(i) } }}
                  onDoubleClick={() => onRenameTab && startRename(tab)}
                  title={onRenameTab ? `${tab.label} tab — double-click to rename` : `${tab.label} tab`}
                >
                  {editing ? (
                    <input
                      ref={renameInputRef}
                      className={styles.wtabRename}
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); commitRename() }
                        else if (e.key === 'Escape') { e.preventDefault(); setEditingId(null); setDraft('') }
                      }}
                      onBlur={commitRename}
                      maxLength={24}
                      placeholder="Name"
                    />
                  ) : (
                    <span className={styles.wtabLabel}>{tab.label}</span>
                  )}
                  {!tab.isMain && active && !editing && (
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
          {scroll.over && (
            <button
              type="button"
              className={styles.wtabScroll}
              onClick={() => scrollBy(1)}
              disabled={scroll.atEnd}
              aria-label="Scroll tabs right"
              title="Scroll tabs right"
            >›</button>
          )}
        </div>
  ) : null

  const addControl = onAddTab ? (
    <>
      <button
        ref={addBtnRef}
        type="button"
        className={styles.wtabAdd}
        onClick={() => setAddOpen(o => !o)}
        aria-label="Add a tab to this widget"
        title="Add a tab — hold multiple widgets in this one slot"
      >+</button>
      {addOpen && addPos && createPortal(
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
        addPos.target,
      )}
    </>
  ) : null

  // Merged mode: no header chrome (drag grip / color dot / close), just the tab
  // strip floating at the top-left so multi-tab slots stay switchable without
  // breaking the seamless merged look. Nothing renders for a single-tab slot.
  if (tabsOnly) {
    if (!tabRegion) return null
    return <div className={styles.wtabMergedBar}>{tabRegion}</div>
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
      {tabRegion || (
        <>
          <span className={styles.widgetLabel}>{label}</span>
          <span className={styles.headerSpacer} />
        </>
      )}
      {addControl}
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
