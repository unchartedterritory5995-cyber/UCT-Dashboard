import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import usePreferences from '../../../hooks/usePreferences'
import { WorkspaceContext } from '../../charts/WorkspaceContext'
import MultiChartGrid from '../../charts/grid/MultiChartGrid'
import MultiChartMenu from '../../charts/grid/MultiChartMenu'
import { LAYOUTS, parseLayoutId } from '../../charts/grid/gridLayouts'
import useDrillWorkspace from '../../breadth/drill/drillWorkspace'
import useScreenerGrid, { isGridLayout, DEFAULT_GRID_LAYOUT, PHONE_GRID_LAYOUT } from './useScreenerGrid'
import styles from './FocusScreener.module.css'

// The Charts view: the screen's results on the /charts Multi-Chart grid (Finviz's Charts view,
// TC2000's flip grid). The grid is the real MultiChartGrid, in a workspace host built like the
// breadth drill's, so every cell is a /charts grid cell: timeframes, styles, the shared settings
// gear, maximise, the theme. useScreenerGrid decides which results are on the board.
//
// The layout control IS the /charts Multi Chart menu (every preset, Custom N×M, the crosshair and
// time-range sync, Chart settings, Save grid as…), with the sections that would replace or leave
// the results hidden (MultiChartMenu `features`).
const LAYOUT_KEY = 'uct.screener.gridLayout'
const SYNC_KEY = 'uct.screener.gridSync'
const MENU_FEATURES = { templates: false, groups: false, workspace: false }
const readLS = (k, d) => { try { return localStorage.getItem(k) ?? d } catch { return d } }
const writeLS = (k, v) => { try { localStorage.setItem(k, v) } catch { /* private mode */ } }
const readSync = () => {
  try {
    const v = JSON.parse(readLS(SYNC_KEY, 'null'))
    return { crosshair: !!v?.crosshair, timeRange: !!v?.timeRange }
  } catch { return { crosshair: false, timeRange: false } }
}
const layoutLabel = id => LAYOUTS.find(l => l.id === id)?.label || parseLayoutId(id).id.replace('x', '×')
const fmtN = v => Number(v || 0).toLocaleString('en-US')

export default function ScreenerChartGrid({ rows, total, hasMore, onLoadMore, resetKey, phone = false }) {
  const { prefs } = usePreferences()
  const chartsTheme = prefs?.charts_theme || 'default'
  const [layoutId, setLayoutId] = useState(() => {
    const v = readLS(LAYOUT_KEY, DEFAULT_GRID_LAYOUT)
    return isGridLayout(v) ? v : DEFAULT_GRID_LAYOUT
  })
  const onLayout = useCallback(id => { if (!isGridLayout(id)) return; setLayoutId(id); writeLS(LAYOUT_KEY, id) }, [])
  const [sync, setSync] = useState(readSync)
  const onSync = useCallback(next => { setSync(next); writeLS(SYNC_KEY, JSON.stringify(next)) }, [])
  const grid = useScreenerGrid({ rows, hasMore, onLoadMore, resetKey, onLayout, sync, onSync, layoutId: phone ? PHONE_GRID_LAYOUT : layoutId })

  // The menu closes on a click outside it or Escape, as the /charts header menus do.
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)
  useEffect(() => {
    if (!menuOpen) return undefined
    const onDown = e => { if (!menuRef.current?.contains(e.target)) setMenuOpen(false) }
    const onKey = e => { if (e.key === 'Escape') setMenuOpen(false) }
    document.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown, true); window.removeEventListener('keydown', onKey) }
  }, [menuOpen])
  const workspace = useDrillWorkspace({ initialSym: rows[0]?.ticker || null, chartsTheme })

  // PageDown / PageUp turn the page from anywhere in the view, except while typing (a cell's
  // ticker search). The grid's own keys (timeframes, letters to search) are left alone.
  const { next, prev, canNext, canPrev } = grid
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'PageDown' && e.key !== 'PageUp') return
      const t = e.target
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      e.preventDefault()
      if (e.key === 'PageDown') { if (canNext) next() } else if (canPrev) prev()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [next, prev, canNext, canPrev])

  const count = useMemo(() => {
    if (!grid.range) return 'No results'
    const of = total != null ? ` of ${fmtN(total)}` : ''
    return `${fmtN(grid.range.from)}–${fmtN(grid.range.to)}${of}`
  }, [grid.range, total])

  return (
    <div className={styles.gridView} data-testid="focus-chart-grid">
      <div className={styles.gridBar}>
        <span className={styles.gridCount} aria-live="polite">{count}</span>
        <button type="button" className={styles.btn} onClick={prev} disabled={!canPrev} aria-label="Previous charts">‹ Prev</button>
        <button type="button" className={styles.btn} onClick={next} disabled={!canNext} aria-label="Next charts">Next ›</button>
        <span className={styles.spacer} />
        {!phone && (
          <div className={styles.gridMenu} ref={menuRef}>
            <button type="button" className={styles.btn} aria-haspopup="menu" aria-expanded={menuOpen}
              onClick={() => setMenuOpen(o => !o)}>{`▦ ${layoutLabel(layoutId)} ▾`}</button>
            {menuOpen && <MultiChartMenu mc={grid.mc} onClose={() => setMenuOpen(false)} features={MENU_FEATURES} alignRight />}
          </div>
        )}
      </div>
      <div className={styles.gridHost}>
        <WorkspaceContext.Provider value={workspace}>
          <MultiChartGrid mc={grid.mc} />
        </WorkspaceContext.Provider>
      </div>
    </div>
  )
}
