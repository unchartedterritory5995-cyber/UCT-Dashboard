import { useState, useRef, useEffect, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import UIcon from '../../components/ui/UIcon'
import { WIDGET_TAB_TYPES, WIDGET_TAB_MENU_LABEL } from './widgetTabs'
import { catalogMeta } from '../../widgets/registry'
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
  addMenuTheme = null,  // --menu-* bag so the "+" add menu wears THIS widget's canvas color
  tabsOnly = false,     // merged mode: render ONLY the tab strip (no header chrome)
  // In-canvas float: pop a widget off the grid to float on top of another widget.
  onFloat,              // (grid mode) => pop this widget out to a floating panel
  floating = false,     // true while this header is inside a floating panel
  onDock,               // (floating) => dock back into the grid as its own widget
  floatTabTargets = [], // (floating) [{id,label}] widgets it can be moved into as a tab
  onFloatToTab,         // (floating) (targetId) => move this widget into that widget's tabs
  onHeaderDragStart,    // (floating) pointerdown on the grip → the panel begins dragging
}) {
  const isNone = color === 'N'
  const [addOpen, setAddOpen] = useState(false)
  const [addPos, setAddPos] = useState(null)         // fixed-position anchor for the portaled menu
  const addBtnRef = useRef(null)
  // Move-into-another-widget's-tabs menu (floating mode) — portaled + fixed like addControl.
  const [floatTabOpen, setFloatTabOpen] = useState(false)
  const [floatTabPos, setFloatTabPos] = useState(null)
  const floatTabBtnRef = useRef(null)
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

  // Position + outside-close for the "move into another widget's tabs" menu
  // (floating mode) — same portaled/fixed approach as the add-tab menu so it can't
  // be clipped by the floating panel's overflow:hidden.
  useLayoutEffect(() => {
    const btn = floatTabBtnRef.current
    if (!floatTabOpen || !btn) { setFloatTabPos(null); return }
    const doc = btn.ownerDocument
    const win = doc.defaultView || window
    const place = () => {
      const r = btn.getBoundingClientRect()
      const W = 180
      const left = Math.max(6, Math.min(r.right - W, win.innerWidth - W - 6))
      setFloatTabPos({ top: Math.round(r.bottom + 4), left: Math.round(left), target: doc.body })
    }
    place()
    win.addEventListener('resize', place)
    win.addEventListener('scroll', place, true)
    return () => { win.removeEventListener('resize', place); win.removeEventListener('scroll', place, true) }
  }, [floatTabOpen])
  useEffect(() => {
    if (!floatTabOpen) return
    const doc = floatTabBtnRef.current?.ownerDocument || document
    const onDown = (e) => {
      if (floatTabBtnRef.current?.contains(e.target)) return
      if (e.target.closest?.('[data-float-tab-menu]')) return
      setFloatTabOpen(false)
    }
    const onKey = (e) => { if (e.key === 'Escape') setFloatTabOpen(false) }
    doc.addEventListener('mousedown', onDown, true)
    doc.addEventListener('keydown', onKey)
    return () => { doc.removeEventListener('mousedown', onDown, true); doc.removeEventListener('keydown', onKey) }
  }, [floatTabOpen])

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
          style={{ top: addPos.top, left: addPos.left, ...(addMenuTheme || {}) }}
        >
          {WIDGET_TAB_TYPES.map(t => (
            <button
              key={t}
              type="button"
              className={styles.addMenuItem}
              onClick={() => { onAddTab(t); setAddOpen(false) }}
            >
              <UIcon name={catalogMeta(t).icon} size={14} className={styles.addMenuIcon} />
              {WIDGET_TAB_MENU_LABEL[t] || t}
            </button>
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
    // The ENTIRE header is the drag handle — grab anywhere in the top border to move
    // the widget (grid mode via RGL's `charts-widget-drag-handle`; floating mode via
    // onHeaderDragStart). The old ⋮⋮ grip dots are gone; the color dot sits top-left
    // where they were. Interactive controls carry `charts-no-drag` (+ RGL's
    // draggableCancel exempts every <button>) so a click on them acts, never drags.
    <div
      className={`${styles.widgetHeader}${atBottom ? ' ' + styles.widgetHeaderBottom : ''}${!floating ? ' charts-widget-drag-handle' : ''}`}
      style={{ ...(style || {}), cursor: 'grab' }}
      onPointerDown={floating ? (e) => {
        if (e.target.closest('button, input, textarea, a, select, [role="tab"]')) return
        onHeaderDragStart?.(e)
      } : undefined}
    >
      <button
        type="button"
        className={`${styles.colorDot} ${styles[`colorDot${color}`]} charts-no-drag`}
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
      {/* Grid mode: pop this widget out to float on top of another widget. */}
      {!floating && onFloat && (
        <button
          type="button"
          className={styles.popOutBtn}
          onClick={onFloat}
          aria-label="Float widget on top of another"
          title="Pop out to float on top of another widget (e.g. onto a chart)"
        >▣</button>
      )}
      {!floating && onPopOut && (
        <button
          type="button"
          className={styles.popOutBtn}
          onClick={onPopOut}
          aria-label="Pop out widget"
          title="Open this widget in its own window you can drag to another monitor"
        >⧉</button>
      )}
      {/* Floating: dock back to the grid. */}
      {floating && onDock && (
        <button
          type="button"
          className={styles.popOutBtn}
          onClick={onDock}
          aria-label="Dock widget into the grid"
          title="Dock back into the grid as its own widget"
        >⊞</button>
      )}
      {/* Floating: move this widget into another widget's tab group. */}
      {floating && onFloatToTab && floatTabTargets.length > 0 && (
        <>
          <button
            ref={floatTabBtnRef}
            type="button"
            className={styles.popOutBtn}
            onClick={() => setFloatTabOpen(o => !o)}
            aria-label="Move into another widget's tabs"
            title="Move into another widget's tabs"
          >⧉</button>
          {floatTabOpen && floatTabPos && createPortal(
            <div
              data-float-tab-menu
              className={styles.wtabAddMenu}
              style={{ top: floatTabPos.top, left: floatTabPos.left, minWidth: 180 }}
            >
              {floatTabTargets.map(t => (
                <button
                  key={t.id}
                  type="button"
                  className={styles.addMenuItem}
                  onClick={() => { onFloatToTab(t.id); setFloatTabOpen(false) }}
                >{t.label}</button>
              ))}
            </div>,
            floatTabPos.target,
          )}
        </>
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
