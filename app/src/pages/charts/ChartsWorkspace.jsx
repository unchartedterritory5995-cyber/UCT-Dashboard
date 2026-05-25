import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Responsive, WidthProvider } from 'react-grid-layout'
import 'react-grid-layout/css/styles.css'
import usePreferences from '../../hooks/usePreferences'
import useMediaQuery from '../../hooks/useMediaQuery'
import { WorkspaceContext } from './WorkspaceContext'
import WidgetHost from './WidgetHost'
import MobileChartFallback from './widgets/MobileChartFallback'
import styles from './ChartsWorkspace.module.css'

const ResponsiveGridLayout = WidthProvider(Responsive)

const COLS = { lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 }
const BREAKPOINTS = { lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }
const ROW_HEIGHT = 40

const DEFAULT_LAYOUT = {
  widgets: [
    { id: 'w-watchlist', type: 'watchlist', color: 'A', x: 0, y: 0, w: 3, h: 6, opts: {} },
    { id: 'w-chart',     type: 'chart',     color: 'A', x: 3, y: 0, w: 9, h: 8, opts: { tf: 'D' } },
    { id: 'w-themes',    type: 'themes',    color: 'B', x: 0, y: 6, w: 3, h: 4, opts: {} },
  ],
  cols: 12,
  rowHeight: ROW_HEIGHT,
}

const WIDGET_DEFAULTS = {
  chart:     { w: 6, h: 8, minW: 3, minH: 4 },
  watchlist: { w: 3, h: 6, minW: 2, minH: 3 },
  themes:    { w: 3, h: 6, minW: 2, minH: 3 },
  scanner:   { w: 4, h: 6, minW: 3, minH: 3 },
}

function parseLayout(raw) {
  if (!raw) return null
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (parsed?.widgets && Array.isArray(parsed.widgets)) return parsed
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

  const workspaceValue = useMemo(() => ({ groupSyms, setGroupSym }), [groupSyms, setGroupSym])

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
    return <MobileChartFallback />
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
        <main className={styles.workspaceBody}>
          <ResponsiveGridLayout
            className="layout"
            layouts={rglLayouts}
            breakpoints={BREAKPOINTS}
            cols={COLS}
            rowHeight={ROW_HEIGHT}
            onLayoutChange={handleLayoutChange}
            draggableHandle=".charts-widget-drag-handle"
            compactType="vertical"
            margin={[6, 6]}
          >
            {layout.widgets.map(w => (
              <div key={w.id}>
                <WidgetHost
                  widget={w}
                  onRemove={() => handleRemoveWidget(w.id)}
                  onColorChange={(c) => handleColorChange(w.id, c)}
                />
              </div>
            ))}
          </ResponsiveGridLayout>
        </main>
      </div>
    </WorkspaceContext.Provider>
  )
}
