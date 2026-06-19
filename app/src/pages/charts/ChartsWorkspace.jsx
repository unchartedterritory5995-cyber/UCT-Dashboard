import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Responsive, WidthProvider } from 'react-grid-layout'
import 'react-grid-layout/css/styles.css'
import usePreferences from '../../hooks/usePreferences'
import useMediaQuery from '../../hooks/useMediaQuery'
import UIcon from '../../components/ui/UIcon'
import { WorkspaceContext } from './WorkspaceContext'
import WidgetHost from './WidgetHost'
import MobileWorkspace from './widgets/MobileWorkspace'
import styles from './ChartsWorkspace.module.css'

const ResponsiveGridLayout = WidthProvider(Responsive)

const COLS = { lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 }
const BREAKPOINTS = { lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }
const FIXED_ROWS = 20            // workspace is viewport-locked to this many rows
const MARGIN_Y = 6                // px gap between widgets vertically
const BODY_PAD = 6                // px padding around the grid (matches .workspaceBody)

const DEFAULT_LAYOUT = {
  widgets: [
    { id: 'w-watchlist', type: 'watchlist', color: 'A', x: 0, y: 0,  w: 3, h: 10, opts: {} },
    { id: 'w-chart',     type: 'chart',     color: 'A', x: 3, y: 0,  w: 9, h: 20, opts: { tf: 'D' } },
    { id: 'w-themes',    type: 'themes',    color: 'B', x: 0, y: 10, w: 3, h: 10, opts: {} },
  ],
  cols: 12,
}

const WIDGET_DEFAULTS = {
  chart:     { w: 6, h: 12, minW: 3, minH: 6 },
  watchlist: { w: 3, h: 10, minW: 2, minH: 4 },
  themes:    { w: 3, h: 10, minW: 2, minH: 4 },
  scanner:   { w: 4, h: 10, minW: 3, minH: 4 },
}

function parseLayout(raw) {
  if (!raw) return null
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (parsed?.widgets && Array.isArray(parsed.widgets)) {
      // Auto-fit legacy layouts (h values < ~5) saved before the viewport-lock
      // change so they don't appear tiny on resume. Detect by checking if max
      // y+h is well below FIXED_ROWS — scale all h values up uniformly.
      const maxBottom = parsed.widgets.reduce((m, w) => Math.max(m, (w.y || 0) + (w.h || 0)), 0)
      if (maxBottom > 0 && maxBottom <= FIXED_ROWS / 2) {
        const scale = Math.floor(FIXED_ROWS / maxBottom)
        if (scale > 1) {
          return {
            ...parsed,
            widgets: parsed.widgets.map(w => ({
              ...w,
              y: (w.y || 0) * scale,
              h: Math.max(4, (w.h || 4) * scale),
            })),
          }
        }
      }
      return parsed
    }
  } catch {}
  return null
}

function nextColor(currentColors) {
  // Cycle A→B→C→D→A based on what's already in use.
  const order = ['A', 'B', 'C', 'D']
  for (const c of order) {
    if (!currentColors.includes(c)) return c
  }
  return 'A'
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
      const next = { ...prev, widgets }
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
      const usedColors = prev.widgets.map(w => w.color)
      const color = nextColor(usedColors)
      const defaults = WIDGET_DEFAULTS[type]
      const newWidget = {
        id: `w-${type}-${Date.now()}`,
        type, color,
        x: 0, y: Infinity,  // RGL bottom-packs
        w: defaults.w, h: defaults.h,
        opts: {},
      }
      const next = { ...prev, widgets: [...prev.widgets, newWidget] }
      scheduleSave(next)
      return next
    })
  }, [scheduleSave])

  const handleResetLayout = useCallback(() => {
    setLayout(DEFAULT_LAYOUT)
    scheduleSave(DEFAULT_LAYOUT)
  }, [scheduleSave])

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
        minW: defaults.minW || 2, minH: defaults.minH || 3,
      }
    }),
  }

  return (
    <WorkspaceContext.Provider value={workspaceValue}>
      <div className={styles.workspace}>
        <header className={styles.workspaceHeader}>
          <span className={styles.workspaceTitle}>📈 Charts</span>
          <div className={styles.toolbarBtnGroup} style={{ position: 'relative' }}>
            <button
              type="button"
              className={styles.toolbarBtn}
              onClick={() => setAddMenuOpen(o => !o)}
            >+ Add Widget</button>
            {addMenuOpen && (
              <div className={styles.addMenu} onMouseLeave={() => setAddMenuOpen(false)}>
                {['chart', 'watchlist', 'themes', 'scanner'].map(t => (
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
            onLayoutChange={handleLayoutChange}
            draggableHandle=".charts-widget-drag-handle"
            compactType="vertical"
            margin={[6, MARGIN_Y]}
            resizeHandles={['nw', 'ne', 'sw', 'se']}
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
