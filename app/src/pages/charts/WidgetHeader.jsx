import { useState, useRef, useEffect, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import UIcon from '../../components/ui/UIcon'
import { WIDGET_TAB_PICKER_TYPES, WIDGET_TAB_MENU_LABEL } from './widgetTabs'
import { catalogMeta } from '../../widgets/registry'
import styles from './ChartsWorkspace.module.css'
import Input from '../../components/ui/Input'
import { nextGroup, isSuspendedGroup } from './colorGroups'
import useExtraGroupsEnabled from './useExtraGroupsEnabled'

// 'N' = grey "not linked": the widget syncs its ticker with nothing. The cycle
// (A B C D [E F G H] N) comes from colorGroups.js — E-H only while
// CHARTS_EXTRA_GROUPS_ENABLED is on (COV-10 remainder).
// ⚰️ COV-10: the OFF cycle used to be retyped here as `COLORS` so the terminal rail could
// read it; that rail now reads colorGroups.js itself, and the literal is gone.

export default function WidgetHeader({
  label, color, onColorChange, onRemove, onPopOut, atBottom = false, style,
  // Widget-level tabs: one slot can hold several widgets of different types.
  tabs = null,          // widgetTabList() — [{id, isMain, type, label}] (base first)
  activeIndex = 0,      // 0 = base tab, 1..N = extra tabs
  onSelectTab,          // (index) => void
  onCloseTab,           // (tabId) => void
  onRenameTab,          // (tabId, name) => void — double-click a tab to rename it
  onMoveTab,            // (tabId, dir) => void — right-click a tab → Move left / right (owner 11-14)
  onAddTab,             // (type) => void — add a new tab of this widget type
  tabsOnly = false,     // merged mode: render ONLY the tab strip (no header chrome)
  // Chart widget's integrated header (/charts board): the chart has NO header bar of its
  // own — its identity row hosts the chrome. 'dot' renders ONLY the link-colour button,
  // 'controls' ONLY the window controls (add tab · float · pop out · close). null (default)
  // = the full header bar, unchanged for every other widget.
  part = null,
  // 'uct' = the /charts board's header (chart-widget style); null = the classic bar.
  look = null,
  icon = null,          // (look='uct') the widget's catalog icon name
  slotRef = null,       // (look='uct') callback ref for the one-row slot (uctHeaderSlot.js)
  ctrlSlotRef = null,   // (look='uct') callback ref for the gear slot at the start of the controls
  iconOnly = false,     // (look='uct') show the icon alone — the name stays for screen readers
  // In-canvas float: pop a widget off the grid to float on top of another widget.
  onFloat,              // (grid mode) => pop this widget out to a floating panel
  floating = false,     // true while this header is inside a floating panel
  onDock,               // (floating) => dock back into the grid as its own widget
  floatTabTargets = [], // (floating) [{id,label}] widgets it can be moved into as a tab
  onFloatToTab,         // (floating) (targetId) => move this widget into that widget's tabs
  onHeaderDragStart,    // (floating) pointerdown on the grip → the panel begins dragging
}) {
  const extraGroupsOn = useExtraGroupsEnabled()
  // A stored E-H while the flag is off: kept, shown grey, and SAID — never a silent
  // fifth group (colorGroups.effectiveGroup).
  const suspended = isSuspendedGroup(color, extraGroupsOn)
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
      const W = 210  // the new board-menu width (owner 11-14)
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

  // Right-click a tab (owner 11-14): a small menu — Rename · Move left · Move right · Close tab.
  // Portaled to the tab's own document (popped-out windows too), fixed at the pointer.
  const [tabMenu, setTabMenu] = useState(null)   // { id, x, y, target }
  const tabMenuRef = useRef(null)
  useEffect(() => {
    if (!tabMenu) return undefined
    const doc = tabMenu.target.ownerDocument
    const onDown = (e) => { if (!tabMenuRef.current?.contains(e.target)) setTabMenu(null) }
    const onKey = (e) => { if (e.key === 'Escape') setTabMenu(null) }
    const onAway = () => setTabMenu(null)
    doc.addEventListener('mousedown', onDown, true)
    doc.addEventListener('keydown', onKey)
    doc.defaultView?.addEventListener('blur', onAway)
    doc.defaultView?.addEventListener('resize', onAway)
    return () => {
      doc.removeEventListener('mousedown', onDown, true)
      doc.removeEventListener('keydown', onKey)
      doc.defaultView?.removeEventListener('blur', onAway)
      doc.defaultView?.removeEventListener('resize', onAway)
    }
  }, [tabMenu])
  const openTabMenu = (e, tab) => {
    e.preventDefault()
    e.stopPropagation()
    const win = e.currentTarget.ownerDocument.defaultView || window
    const W = 176, H = 150
    setTabMenu({
      id: tab.id,
      x: Math.max(6, Math.min(e.clientX, win.innerWidth - W - 6)),
      y: Math.max(6, Math.min(e.clientY + 2, win.innerHeight - H - 6)),
      target: e.currentTarget.ownerDocument.body,
    })
  }

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
  const menuTab = tabMenu ? tabs?.find(t => t.id === tabMenu.id) : null
  const menuPos = menuTab ? tabs.indexOf(menuTab) : -1
  const tabMenuEl = menuTab ? createPortal(
    <div ref={tabMenuRef} className={styles.wtabCtxMenu} style={{ left: tabMenu.x, top: tabMenu.y }} role="menu" aria-label={`${menuTab.label} tab`}
      onContextMenu={(e) => e.preventDefault()}>
      {onRenameTab && (
        <button type="button" role="menuitem" className={styles.wtabCtxItem}
          onClick={() => { setTabMenu(null); startRename(menuTab) }}>
          <UIcon name="edit" size={13} gold={false} aria-hidden="true" /><span>Rename</span>
        </button>
      )}
      {onMoveTab && (<>
        <button type="button" role="menuitem" className={styles.wtabCtxItem} disabled={menuPos <= 0}
          onClick={() => { setTabMenu(null); onMoveTab(menuTab.id, -1) }}>
          <UIcon name="chevronLeft" size={13} gold={false} aria-hidden="true" /><span>Move left</span>
        </button>
        <button type="button" role="menuitem" className={styles.wtabCtxItem} disabled={menuPos >= tabs.length - 1}
          onClick={() => { setTabMenu(null); onMoveTab(menuTab.id, 1) }}>
          <UIcon name="chevronRight" size={13} gold={false} aria-hidden="true" /><span>Move right</span>
        </button>
      </>)}
      {!menuTab.isMain && onCloseTab && (<>
        <div className={styles.wtabCtxDivider} role="separator" />
        <button type="button" role="menuitem" className={styles.wtabCtxItem}
          onClick={() => { setTabMenu(null); onCloseTab(menuTab.id) }}>
          <UIcon name="x" size={13} gold={false} aria-hidden="true" /><span>Close tab</span>
        </button>
      </>)}
    </div>,
    tabMenu.target,
  ) : null

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
          <div className={styles.wtabStrip} ref={stripRef} role="tablist" aria-label="Widget tabs" data-guide="workspace.widgetTabs">
            {tabs.map((tab, i) => {
              const si = Number.isInteger(tab.index) ? tab.index : i   // storage index (strip order may differ)
              const active = si === activeIndex
              const editing = editingId === tab.id
              return (
                <div
                  key={tab.id}
                  role="tab"
                  aria-selected={active}
                  className={`${styles.wtabChip}${active ? ' ' + styles.wtabChipActive : ''}`}
                  onClick={() => { if (!editing) { setConfirmCloseId(null); onSelectTab?.(si) } }}
                  onContextMenu={(e) => openTabMenu(e, tab)}
                  onDoubleClick={() => onRenameTab && startRename(tab)}
                  title={`${tab.label} tab — right-click for options`}
                >
                  {editing ? (
                    <Input aria-label="Rename tab"
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
                    // data-label: the bold width is reserved (CSS), so selecting a tab never shifts the strip
                    <span className={styles.wtabLabel} data-label={tab.label}>{tab.label}</span>
                  )}
                  {/* uct look (owner 11-14): no × on the tabs — Close tab is in the right-click
                      menu, so it can never be hit by accident. Old look: the active tab's ×. */}
                  {!tab.isMain && active && look !== 'uct' && !editing && (
                    <span
                      data-guide="workspace.widgetTabClose"
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
          {tabMenuEl}
        </div>
  ) : null

  const addControl = onAddTab ? (
    <>
      <button
        ref={addBtnRef}
        type="button"
        className={styles.wtabAdd}
        onClick={() => setAddOpen(o => !o)}
        data-guide="widget.addTab"
        aria-label="Add a tab to this widget"
        title="Add a tab — hold multiple widgets in this one slot"
      >{part || look === 'uct' ? <UIcon name="plus" size={16} strokeWidth={1.9} gold={false} /> : '+'}</button>
      {addOpen && addPos && createPortal(
        <div
          data-wtab-add-menu
          // Owner 11-14: the board's menu style (the Widgets / Layouts / Tools look) — always
          // dark like every other board menu, so it no longer takes the widget's canvas colour.
          className={`${styles.wtabAddMenu} ${styles.tbMenu}`}
          style={{ top: addPos.top, left: addPos.left }}
        >
          <div className={styles.addMenuGroupLabel}>Add a tab</div>
          {WIDGET_TAB_PICKER_TYPES.map(t => (
            <button
              key={t}
              type="button"
              className={styles.addMenuItem}
              onClick={() => { onAddTab(t); setAddOpen(false) }}
            >
              <span className={styles.tbGlyph} aria-hidden="true"><UIcon name={catalogMeta(t).icon} size={15} /></span>
              <span className={styles.tbLbl}>{WIDGET_TAB_MENU_LABEL[t] || t}</span>
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
  // ── Chart widget integrated header pieces (see the `part` prop) ──
  if (part === 'dot') {
    return (
        <button
          type="button"
          className={`${styles.colorDot} ${styles[`colorDot${suspended ? 'N' : color}`]} charts-no-drag`}
          onClick={() => onColorChange(nextGroup(color, extraGroupsOn))}
          data-group-suspended={suspended ? color : undefined}
          data-guide="widget.link"
          aria-label={suspended
            ? `Group ${color} is switched off: not linked — click to pick a color group`
            : isNone ? 'Not linked (grey) — click to link to a color group' : `Color group ${color} (click to cycle)`}
          title={suspended
            ? `Group ${color} is switched off: not linked. This widget keeps group ${color} in the saved layout and links again when extra groups are on. Click to pick a color group.`
            : isNone
            ? 'Not linked — this widget’s ticker syncs with nothing. Click to cycle to a color group.'
            : `Color group ${color} — click to cycle (grey = not linked)`}
        />
    )
  }
  if (part === 'controls') {
    // Grid mode only (WidgetHost never integrates a floating widget). The group is
    // charts-no-drag, so the gaps between buttons can't start a widget drag.
    return (
      <span className={`${styles.ctrlGroup} charts-no-drag`} data-guide="widget.controls">
        {addControl}
        {onFloat && (
          <button
            type="button"
            className={styles.popOutBtn}
            onClick={onFloat}
            data-guide="widget.float"
            aria-label="Float widget on top of another"
            title="Pop out to float on top of another widget (e.g. onto a chart)"
          ><UIcon name="copy" size={15} strokeWidth={1.9} gold={false} /></button>
        )}
        {onPopOut && (
          <button
            type="button"
            className={styles.popOutBtn}
            onClick={onPopOut}
            data-guide="widget.popOut"
            aria-label="Pop out widget"
            title="Open this widget in its own window you can drag to another monitor"
          ><UIcon name="popOut" size={15} strokeWidth={1.9} gold={false} /></button>
        )}
        {onRemove && (
          <button
            type="button"
            className={styles.closeBtn}
            onClick={onRemove}
            data-guide="widget.close"
            aria-label="Close widget"
            title="Remove this widget"
          ><UIcon name="x" size={15} strokeWidth={1.9} gold={false} /></button>
        )}
      </span>
    )
  }

  // The full header's window controls (+ · float · pop out · dock · move-to-tab · close).
  // iconic=false renders the classic glyphs exactly as before; true = the UCT header's icons.
  const ico = (name) => <UIcon name={name} size={15} strokeWidth={1.9} gold={false} />
  const windowButtons = (iconic) => (
    <>
      {addControl}
      {/* Grid mode: pop this widget out to float on top of another widget. */}
      {!floating && onFloat && (
        <button
          type="button"
          className={styles.popOutBtn}
          onClick={onFloat}
          data-guide="widget.float"
          aria-label="Float widget on top of another"
          title="Pop out to float on top of another widget (e.g. onto a chart)"
        >{iconic ? ico('copy') : '▣'}</button>
      )}
      {!floating && onPopOut && (
        <button
          type="button"
          className={styles.popOutBtn}
          onClick={onPopOut}
          data-guide="widget.popOut"
          aria-label="Pop out widget"
          title="Open this widget in its own window you can drag to another monitor"
        >{iconic ? ico('popOut') : '⧉'}</button>
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
      {/* Close only when there IS somewhere to close TO — same idiom as the float /
          pop-out / dock controls above, and as Watchlists' back button. A host that
          owns exactly two widgets (the breadth drill modal, which closes as a unit)
          passes no onRemove and gets no dead ✕. Every /charts + mobile call site
          passes one, so nothing on the board loses its close button. */}
      {onRemove && (
        <button
          type="button"
          className={styles.closeBtn}
          onClick={onRemove}
          data-guide="widget.close"
          aria-label="Close widget"
          title="Remove this widget"
        >{iconic ? ico('x') : <UIcon name="x" size={13} />}</button>
      )}
    </>
  )

  const linkDot = (
    <button
      type="button"
      className={`${styles.colorDot} ${styles[`colorDot${suspended ? 'N' : color}`]} charts-no-drag`}
      onClick={() => onColorChange(nextGroup(color, extraGroupsOn))}
      data-group-suspended={suspended ? color : undefined}
      data-guide="widget.link"
      aria-label={suspended
        ? `Group ${color} is switched off: not linked — click to pick a color group`
        : isNone ? 'Not linked (grey) — click to link to a color group' : `Color group ${color} (click to cycle)`}
      title={suspended
        ? `Group ${color} is switched off: not linked. This widget keeps group ${color} in the saved layout and links again when extra groups are on. Click to pick a color group.`
        : isNone
        ? 'Not linked — this widget’s ticker syncs with nothing. Click to cycle to a color group.'
        : `Color group ${color} — click to cycle (grey = not linked)`}
    />
  )

  // ── UCT header (look='uct', the /charts board — owner 11-13): the chart widget's
  // "one surface" style for every widget. [icon + link badge] Title (or the tab strip)
  // · · · [+ float pop-out close]. Same drag handle, same controls, same handlers. ──
  if (look === 'uct') {
    return (
      <div
        className={`${styles.widgetHeader} ${styles.uctHeader}${atBottom ? ' ' + styles.widgetHeaderBottom : ''}${!floating ? ' charts-widget-drag-handle' : ''}`}
        style={{ ...(style || {}), cursor: 'grab' }}
        data-guide="widget.headerBar"
        data-uct-header=""
        onPointerDown={floating ? (e) => {
          if (e.target.closest('button, input, textarea, a, select, [role="tab"]')) return
          onHeaderDragStart?.(e)
        } : undefined}
      >
        <span className={styles.uctIdent}>
          {icon && <UIcon name={icon} size={17} strokeWidth={1.8} gold={false} />}
          {linkDot}
        </span>
        {/* Icon-only header: the hairline after the icon stays at every width (owner 11-13). */}
        {/* the hairline after the icon stays with tabs too (owner 11-14) */}
        {(iconOnly || tabRegion) && <span className={styles.uctIdentSep} aria-hidden="true" />}
        {tabRegion || (
          <>
            <span className={iconOnly ? styles.widgetLabel : styles.uctTitle} data-uct-title="">{label}</span>
            {slotRef && <span className={styles.uctSlot} ref={slotRef} data-uct-slot="" />}
            <span className={styles.headerSpacer} />
          </>
        )}
        <span className={`${styles.ctrlGroup} ${styles.uctCtrl} charts-no-drag`} data-guide="widget.controls">
          {ctrlSlotRef && <span className={styles.uctCtrlSlot} ref={ctrlSlotRef} data-uct-ctrl-slot="" />}
          {windowButtons(true)}
        </span>
      </div>
    )
  }

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
      data-guide="widget.headerBar"
      onPointerDown={floating ? (e) => {
        if (e.target.closest('button, input, textarea, a, select, [role="tab"]')) return
        onHeaderDragStart?.(e)
      } : undefined}
    >
      <button
        type="button"
        className={`${styles.colorDot} ${styles[`colorDot${suspended ? 'N' : color}`]} charts-no-drag`}
        onClick={() => onColorChange(nextGroup(color, extraGroupsOn))}
        data-group-suspended={suspended ? color : undefined}
        data-guide="widget.link"
        aria-label={suspended
          ? `Group ${color} is switched off: not linked — click to pick a color group`
          : isNone ? 'Not linked (grey) — click to link to a color group' : `Color group ${color} (click to cycle)`}
        title={suspended
          ? `Group ${color} is switched off: not linked. This widget keeps group ${color} in the saved layout and links again when extra groups are on. Click to pick a color group.`
          : isNone
          ? 'Not linked — this widget’s ticker syncs with nothing. Click to cycle to a color group.'
          : `Color group ${color} — click to cycle (grey = not linked)`}
      />
      {tabRegion || (
        <>
          <span className={styles.widgetLabel}>{label}</span>
          <span className={styles.headerSpacer} />
        </>
      )}
      {windowButtons(false)}
    </div>
  )
}
