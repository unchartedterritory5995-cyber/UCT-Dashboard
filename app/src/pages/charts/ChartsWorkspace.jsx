import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Responsive, WidthProvider } from 'react-grid-layout'
import 'react-grid-layout/css/styles.css'
import usePreferences from '../../hooks/usePreferences'
import useMediaQuery from '../../hooks/useMediaQuery'
import useChartLayouts from '../../hooks/useChartLayouts'
import { useAuth } from '../../context/AuthContext'
import UIcon from '../../components/ui/UIcon'
import { WorkspaceContext } from './WorkspaceContext'
import WidgetHost from './WidgetHost'
import MobileWorkspace from './widgets/MobileWorkspace'
import { findPlacement } from './findOpenSlot'
import styles from './ChartsWorkspace.module.css'

const ResponsiveGridLayout = WidthProvider(Responsive)

// 24-col grid (doubled from the original 12) so widgets can size in half-of-the-
// old-column steps — e.g. the Theme widget now has a width between the old "1 col
// (too thin)" and "2 cols". Every breakpoint is doubled in lockstep so relative
// sizing is unchanged; legacy 12-col saved layouts are migrated in parseLayout().
const GRID_COLS = 24
const COLS = { lg: GRID_COLS, md: 20, sm: 12, xs: 8, xxs: 4 }
const BREAKPOINTS = { lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }
const FIXED_ROWS = 20            // workspace is viewport-locked to this many rows
const MARGIN_Y = 6                // px gap between widgets vertically
const BODY_PAD = 6                // px padding around the grid (matches .workspaceBody)

const DEFAULT_LAYOUT = {
  widgets: [
    { id: 'w-watchlist', type: 'watchlist', color: 'A', x: 0, y: 0, w: 4,  h: 7,  opts: {} },
    { id: 'w-chart',     type: 'chart',     color: 'A', x: 4, y: 0, w: 20, h: 20, opts: { tf: 'D' } },
    { id: 'w-themes',    type: 'themes',    color: 'B', x: 0, y: 7, w: 4,  h: 13, opts: {} },
  ],
  cols: GRID_COLS,
}

// Widths/minW are in 24-col units (2 units = one old column). themes minW is 2
// so the widget can still go narrow, but the reachable middle size (3 units = 1.5
// old cols) is the "in between" the too-thin and the good size.
const WIDGET_DEFAULTS = {
  chart:     { w: 12, h: 12, minW: 6, minH: 6 },
  watchlist: { w: 6,  h: 10, minW: 4, minH: 4 },
  themes:    { w: 6,  h: 10, minW: 2, minH: 4 },
  scanner:   { w: 8,  h: 10, minW: 6, minH: 4 },
  fundamentals: { w: 8, h: 6, minW: 6, minH: 2 },
}

function parseLayout(raw) {
  if (!raw) return null
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (parsed?.widgets && Array.isArray(parsed.widgets)) {
      // Migrate legacy 12-col layouts to the 24-col grid. Detected by the
      // absence of the cols:GRID_COLS marker (old saves have cols:12 or none).
      // Double x AND w so every widget keeps its exact on-screen position + size,
      // then stamp the new marker so this runs exactly once per user.
      let widgets = parsed.widgets
      let cols = parsed.cols
      if (cols !== GRID_COLS) {
        widgets = widgets.map(w => ({
          ...w,
          x: (w.x || 0) * 2,
          w: Math.max(2, (w.w || 2) * 2),
        }))
        cols = GRID_COLS
      }
      // Auto-fit legacy layouts (h values < ~5) saved before the viewport-lock
      // change so they don't appear tiny on resume. Detect by checking if max
      // y+h is well below FIXED_ROWS — scale all h values up uniformly.
      const maxBottom = widgets.reduce((m, w) => Math.max(m, (w.y || 0) + (w.h || 0)), 0)
      if (maxBottom > 0 && maxBottom <= FIXED_ROWS / 2) {
        const scale = Math.floor(FIXED_ROWS / maxBottom)
        if (scale > 1) {
          widgets = widgets.map(w => ({
            ...w,
            y: (w.y || 0) * scale,
            h: Math.max(4, (w.h || 4) * scale),
          }))
        }
      }
      return { ...parsed, widgets: clampWidgetsToRows(widgets), cols }
    }
  } catch {}
  return null
}

// Keep every widget within the viewport-locked grid: no widget's bottom (y+h)
// may exceed FIXED_ROWS, or it hangs off the bottom of the screen (the body is
// overflow:hidden, so the overhang just vanishes — the fundamentals-widget bug).
// Shrink h to fit the space below y; y is first clamped so at least minH fits.
// Applied on load, add, template-open, and every layout change before persist.
function clampWidgetsToRows(widgets) {
  return widgets.map(w => {
    const minH = WIDGET_DEFAULTS[w.type]?.minH || 3
    const y = Math.max(0, Math.min(w.y || 0, FIXED_ROWS - minH))
    let h = Math.max(minH, Math.min(w.h || minH, FIXED_ROWS))
    if (y + h > FIXED_ROWS) h = FIXED_ROWS - y  // y ≤ FIXED_ROWS-minH ⇒ h ≥ minH
    return { ...w, y, h }
  })
}

function nextColor(currentColors) {
  // Cycle A→B→C→D→A based on what's already in use.
  const order = ['A', 'B', 'C', 'D']
  for (const c of order) {
    if (!currentColors.includes(c)) return c
  }
  return 'A'
}

// Color to assign a NEWLY added widget. Prefer the group of an existing chart
// that already has a symbol (so the new widget lands on the ticker you're
// looking at — not an empty group showing a blank Fundamentals panel or a chart
// stuck on the SPY fallback). Fall back to the first populated group, then to
// the next free color for a genuinely empty board.
function pickWidgetColor(widgets, groupSyms) {
  const g = groupSyms || {}
  const chartW = widgets.find((w) => w.type === 'chart' && g[w.color])
  if (chartW) return chartW.color
  const anyW = widgets.find((w) => g[w.color])
  if (anyW) return anyW.color
  return nextColor(widgets.map((w) => w.color))
}

export default function ChartsWorkspace() {
  const isMobile = useMediaQuery('(max-width: 640px)')
  const { prefs, setPref } = usePreferences()

  // Viewport-locked sizing: measure the workspace body and divide its height
  // by FIXED_ROWS so the grid always fills the visible area exactly. The page
  // itself never scrolls — widget max size = visible chart area.
  const bodyRef = useRef(null)
  const [rowHeight, setRowHeight] = useState(34)
  useEffect(() => {
    const el = bodyRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const measure = () => {
      const h = el.clientHeight - BODY_PAD * 2
      const available = h - MARGIN_Y * (FIXED_ROWS - 1)
      const rh = Math.max(12, Math.floor(available / FIXED_ROWS))
      setRowHeight(rh)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Layout state — seed from prefs or default.
  const [layout, setLayout] = useState(() => parseLayout(prefs?.charts_workspace_layout) || DEFAULT_LAYOUT)

  // If prefs arrive AFTER initial render (async fetch), pick them up.
  const loadedFromPrefsRef = useRef(false)
  useEffect(() => {
    if (loadedFromPrefsRef.current) return
    const parsed = parseLayout(prefs?.charts_workspace_layout)
    if (parsed) {
      setLayout(parsed)
      loadedFromPrefsRef.current = true
    }
  }, [prefs?.charts_workspace_layout])

  // Color-group state — seed from prefs or empty.
  const [groupSyms, setGroupSymsState] = useState(() => {
    try {
      const raw = prefs?.charts_workspace_groups
      if (raw) {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
        if (parsed && typeof parsed === 'object') {
          return { A: null, B: null, C: null, D: null, ...parsed }
        }
      }
    } catch {}
    return { A: null, B: null, C: null, D: null }
  })

  const setGroupSym = useCallback((color, sym) => {
    setGroupSymsState(prev => {
      const next = { ...prev, [color]: sym }
      setPref('charts_workspace_groups', JSON.stringify(next))
      return next
    })
  }, [setPref])

  // Crosshair sync bus: a stable pub/sub so a hovered chart can broadcast its
  // crosshair to same-color-group siblings WITHOUT re-rendering the grid at
  // mouse-move rate (only the receiving widgets re-render via local state).
  const crosshairBusRef = useRef(null)
  if (!crosshairBusRef.current) {
    const listeners = new Set()
    crosshairBusRef.current = {
      emit: (color, sourceId, payload) => listeners.forEach((fn) => fn({ color, sourceId, payload })),
      subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn) },
    }
  }

  const workspaceValue = useMemo(
    () => ({ groupSyms, setGroupSym, crosshairBus: crosshairBusRef.current }),
    [groupSyms, setGroupSym],
  )

  // Debounced layout persist (500ms).
  const saveTimerRef = useRef(null)
  const scheduleSave = useCallback((nextLayout) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      setPref('charts_workspace_layout', JSON.stringify(nextLayout))
    }, 500)
  }, [setPref])

  // react-grid-layout fires onLayoutChange with the new x/y/w/h array.
  // Merge it back into our widget objects.
  const handleLayoutChange = useCallback((newGridLayout) => {
    setLayout(prev => {
      const byId = Object.fromEntries(newGridLayout.map(l => [l.i, l]))
      const widgets = prev.widgets.map(w => {
        const l = byId[w.id]
        if (!l) return w
        return { ...w, x: l.x, y: l.y, w: l.w, h: l.h }
      })
      const next = { ...prev, widgets: clampWidgetsToRows(widgets) }
      scheduleSave(next)
      return next
    })
  }, [scheduleSave])

  const handleRemoveWidget = useCallback((id) => {
    setLayout(prev => {
      const next = { ...prev, widgets: prev.widgets.filter(w => w.id !== id) }
      scheduleSave(next)
      return next
    })
  }, [scheduleSave])

  const handleColorChange = useCallback((id, color) => {
    setLayout(prev => {
      const next = { ...prev, widgets: prev.widgets.map(w => w.id === id ? { ...w, color } : w) }
      scheduleSave(next)
      return next
    })
  }, [scheduleSave])

  const handleOptsChange = useCallback((id, opts) => {
    setLayout(prev => {
      const next = { ...prev, widgets: prev.widgets.map(w => w.id === id ? { ...w, opts } : w) }
      scheduleSave(next)
      return next
    })
  }, [scheduleSave])

  const handleAddWidget = useCallback((type) => {
    setLayout(prev => {
      const color = pickWidgetColor(prev.widgets, groupSyms)
      const defaults = WIDGET_DEFAULTS[type]
      // Place into the first logical open spot (row-major scan), not column 0:
      // RGL vertical compaction preserves x, so a hardcoded x:0 stacks new
      // widgets below the left column and overflows. findPlacement shrinks the
      // widget toward its min size to squeeze into a smaller gap rather than
      // falling off-screen; it bottom-packs only when the grid is genuinely full.
      const { x, y, w, h } = findPlacement(prev.widgets, defaults, COLS.lg, FIXED_ROWS)
      const newWidget = {
        id: `w-${type}-${Date.now()}`,
        type, color,
        x, y, w, h,
        opts: {},
      }
      const next = { ...prev, widgets: clampWidgetsToRows([...prev.widgets, newWidget]) }
      scheduleSave(next)
      return next
    })
  }, [scheduleSave, groupSyms])

  const handleResetLayout = useCallback(() => {
    setLayout(DEFAULT_LAYOUT)
    scheduleSave(DEFAULT_LAYOUT)
  }, [scheduleSave])

  // Explicit "Save layout" — flushes the debounced auto-save and persists the
  // current arrangement (widgets + color-group tickers) immediately. The auto-save
  // is debounced 500ms, so a refresh within that window could lose the last change
  // (the "resets to default on refresh sometimes" report); this guarantees a save.
  const [savedFlash, setSavedFlash] = useState(false)
  const savedFlashTimerRef = useRef(null)
  const flashSaved = useCallback(() => {
    setSavedFlash(true)
    if (savedFlashTimerRef.current) clearTimeout(savedFlashTimerRef.current)
    savedFlashTimerRef.current = setTimeout(() => setSavedFlash(false), 1600)
  }, [])
  const handleSaveLayout = useCallback(() => {
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null }
    setPref('charts_workspace_layout', JSON.stringify(layout))
    setPref('charts_workspace_groups', JSON.stringify(groupSyms))
    flashSaved()
  }, [layout, groupSyms, setPref, flashSaved])

  // ── Named layout templates (prebuilt + personal) ──
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const { global: globalLayouts, mine: myLayouts, saveLayout, deleteLayout } = useChartLayouts()
  const [openMenuOpen, setOpenMenuOpen] = useState(false)
  const [saveMenuOpen, setSaveMenuOpen] = useState(false)
  const [saveAsName, setSaveAsName] = useState('')
  const [saveAsScope, setSaveAsScope] = useState('user')  // 'user' | 'global' (admin)
  const [saveErr, setSaveErr] = useState('')

  // Apply a saved/prebuilt layout: restore the arrangement (+ its color-group
  // tickers) and persist so it sticks across refreshes. Runs through parseLayout
  // so any older-shaped template is normalized to the current grid.
  const applyTemplate = useCallback((tpl) => {
    if (!tpl?.layout?.widgets) return
    const normalized = parseLayout(tpl.layout) || tpl.layout
    setLayout(normalized)
    setPref('charts_workspace_layout', JSON.stringify(normalized))
    if (tpl.groups && typeof tpl.groups === 'object') {
      const g = { A: null, B: null, C: null, D: null, ...tpl.groups }
      setGroupSymsState(g)
      setPref('charts_workspace_groups', JSON.stringify(g))
    }
    setOpenMenuOpen(false)
    flashSaved()
  }, [setPref, flashSaved])

  const handleSaveAsTemplate = useCallback(async () => {
    const nm = saveAsName.trim()
    if (!nm) { setSaveErr('Name required'); return }
    try {
      await saveLayout({ name: nm, layout, groups: groupSyms, scope: isAdmin ? saveAsScope : 'user' })
      setSaveAsName(''); setSaveErr(''); setSaveMenuOpen(false)
      flashSaved()
    } catch (e) {
      setSaveErr(e.message || 'Save failed')
    }
  }, [saveAsName, layout, groupSyms, isAdmin, saveAsScope, saveLayout, flashSaved])

  const handleDeleteTemplate = useCallback(async (id) => {
    try { await deleteLayout(id) } catch { /* surfaced by SWR revalidate */ }
  }, [deleteLayout])

  const [addMenuOpen, setAddMenuOpen] = useState(false)

  if (isMobile) {
    // Phone: tabbed widget stack (RGL drag/resize doesn't fit a phone). Rendered
    // inside the provider so widgets keep color-group ticker linking.
    return (
      <WorkspaceContext.Provider value={workspaceValue}>
        <MobileWorkspace
          widgets={layout.widgets}
          onRemove={handleRemoveWidget}
          onColorChange={handleColorChange}
          onOptsChange={handleOptsChange}
          onAddWidget={handleAddWidget}
        />
      </WorkspaceContext.Provider>
    )
  }

  const rglLayouts = {
    lg: layout.widgets.map(w => {
      const defaults = WIDGET_DEFAULTS[w.type] || {}
      return {
        i: w.id, x: w.x, y: w.y, w: w.w, h: w.h,
        minW: defaults.minW || 4, minH: defaults.minH || 3,
      }
    }),
  }

  return (
    <WorkspaceContext.Provider value={workspaceValue}>
      <div className={styles.workspace}>
        <header className={styles.workspaceHeader}>
          <span className={styles.workspaceTitle}><UIcon name="equity" size={14} style={{ verticalAlign: '-2px', marginRight: 5 }} />Charts</span>
          <div className={styles.toolbarBtnGroup} style={{ position: 'relative' }}>
            <button
              type="button"
              className={styles.toolbarBtn}
              onClick={() => { setAddMenuOpen(o => !o); setOpenMenuOpen(false); setSaveMenuOpen(false) }}
            >+ Add Widget</button>
            {addMenuOpen && (
              <div className={styles.addMenu} onMouseLeave={() => setAddMenuOpen(false)}>
                {['chart', 'watchlist', 'themes', 'scanner', 'fundamentals'].map(t => (
                  <button
                    key={t}
                    type="button"
                    className={styles.addMenuItem}
                    onClick={() => { handleAddWidget(t); setAddMenuOpen(false) }}
                  >{t[0].toUpperCase() + t.slice(1)}</button>
                ))}
              </div>
            )}
          </div>

          {/* Open a saved / prebuilt layout */}
          <div className={styles.toolbarBtnGroup} style={{ position: 'relative' }}>
            <button
              type="button"
              className={styles.toolbarBtn}
              onClick={() => { setOpenMenuOpen(o => !o); setAddMenuOpen(false); setSaveMenuOpen(false) }}
            >Open layout ▾</button>
            {openMenuOpen && (
              <div className={styles.addMenu} style={{ minWidth: 210 }} onMouseLeave={() => setOpenMenuOpen(false)}>
                {globalLayouts.length === 0 && myLayouts.length === 0 && (
                  <div className={styles.menuEmpty}>No saved layouts yet</div>
                )}
                {globalLayouts.length > 0 && <div className={styles.menuSection}>Prebuilt</div>}
                {globalLayouts.map(t => (
                  <div key={`g${t.id}`} className={styles.menuRow}>
                    <button type="button" className={styles.addMenuItem} style={{ flex: 1 }} onClick={() => applyTemplate(t)}>{t.name}</button>
                    {isAdmin && (
                      <button type="button" className={styles.menuDel} title="Delete prebuilt template" onClick={() => handleDeleteTemplate(t.id)}>✕</button>
                    )}
                  </div>
                ))}
                {myLayouts.length > 0 && <div className={styles.menuSection}>My layouts</div>}
                {myLayouts.map(t => (
                  <div key={`m${t.id}`} className={styles.menuRow}>
                    <button type="button" className={styles.addMenuItem} style={{ flex: 1 }} onClick={() => applyTemplate(t)}>{t.name}</button>
                    <button type="button" className={styles.menuDel} title="Delete" onClick={() => handleDeleteTemplate(t.id)}>✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Save current arrangement / save as a named template */}
          <div className={styles.toolbarBtnGroup} style={{ position: 'relative' }}>
            <button
              type="button"
              className={styles.toolbarBtn}
              onClick={() => { setSaveMenuOpen(o => !o); setAddMenuOpen(false); setOpenMenuOpen(false) }}
            >{savedFlash ? 'Saved ✓' : 'Save layout ▾'}</button>
            {saveMenuOpen && (
              <div className={styles.addMenu} style={{ minWidth: 230 }}>
                <button type="button" className={styles.addMenuItem} onClick={() => { handleSaveLayout(); setSaveMenuOpen(false) }}>
                  Save current arrangement
                </button>
                <div className={styles.menuDivider} />
                <div className={styles.menuForm}>
                  <div className={styles.menuSection} style={{ padding: 0 }}>Save as template</div>
                  <input
                    className={styles.menuInput}
                    placeholder="Template name"
                    value={saveAsName}
                    maxLength={60}
                    onChange={e => { setSaveAsName(e.target.value); setSaveErr('') }}
                    onKeyDown={e => { if (e.key === 'Enter') handleSaveAsTemplate() }}
                  />
                  {isAdmin && (
                    <label className={styles.menuCheck}>
                      <input
                        type="checkbox"
                        checked={saveAsScope === 'global'}
                        onChange={e => setSaveAsScope(e.target.checked ? 'global' : 'user')}
                      />
                      Prebuilt (available to all users)
                    </label>
                  )}
                  <button type="button" className={styles.toolbarBtn} style={{ alignSelf: 'flex-start' }} onClick={handleSaveAsTemplate}>
                    Save template
                  </button>
                  {saveErr && <div className={styles.menuErr}>{saveErr}</div>}
                </div>
              </div>
            )}
          </div>

          <button type="button" className={`${styles.toolbarBtn} ${styles.ghost}`} onClick={handleResetLayout}>
            Reset layout
          </button>
        </header>
        <main className={styles.workspaceBody} ref={bodyRef}>
          <ResponsiveGridLayout
            className="layout"
            layouts={rglLayouts}
            breakpoints={BREAKPOINTS}
            cols={COLS}
            rowHeight={rowHeight}
            maxRows={FIXED_ROWS}
            isBounded={true}
            onLayoutChange={handleLayoutChange}
            draggableHandle=".charts-widget-drag-handle"
            compactType="vertical"
            margin={[6, MARGIN_Y]}
            resizeHandles={['nw', 'ne', 'sw', 'se']}
            /* Position grid items with top/left, NOT transform: translate().
               RGL's default CSS-transform positioning composites each widget's
               chart <canvas> onto a GPU layer that, under fractional Windows
               display scaling, gets resampled at a non-integer device-pixel
               offset — blurring + desaturating the candles. top/left keeps the
               canvas on the root layer so it paints crisp (matches Setup Library). */
            useCSSTransforms={false}
          >
            {layout.widgets.map(w => (
              <div key={w.id}>
                <WidgetHost
                  widget={w}
                  onRemove={() => handleRemoveWidget(w.id)}
                  onColorChange={(c) => handleColorChange(w.id, c)}
                  onOptsChange={(opts) => handleOptsChange(w.id, opts)}
                />
              </div>
            ))}
          </ResponsiveGridLayout>
        </main>
      </div>
    </WorkspaceContext.Provider>
  )
}
