import { useCallback, useEffect, useMemo, useState } from 'react'
import usePreferences from '../../../hooks/usePreferences'
import { WorkspaceContext } from '../../charts/WorkspaceContext'
import MultiChartGrid from '../../charts/grid/MultiChartGrid'
import useDrillWorkspace from '../../breadth/drill/drillWorkspace'
import useScreenerGrid, { SCREENER_GRID_LAYOUTS, DEFAULT_GRID_LAYOUT, PHONE_GRID_LAYOUT } from './useScreenerGrid'
import styles from './FocusScreener.module.css'

// The Charts view: the screen's results on the /charts Multi-Chart grid (Finviz's Charts view,
// TC2000's flip grid). The grid is the real MultiChartGrid, in a workspace host built like the
// breadth drill's, so every cell is a /charts grid cell: timeframes, styles, the shared settings
// gear, maximise, the theme. useScreenerGrid decides which results are on the board.
const LAYOUT_KEY = 'uct.screener.gridLayout'
const readLS = (k, d) => { try { return localStorage.getItem(k) ?? d } catch { return d } }
const writeLS = (k, v) => { try { localStorage.setItem(k, v) } catch { /* private mode */ } }
const offered = id => SCREENER_GRID_LAYOUTS.some(l => l.id === id)
const fmtN = v => Number(v || 0).toLocaleString('en-US')

export default function ScreenerChartGrid({ rows, total, hasMore, onLoadMore, resetKey, phone = false }) {
  const { prefs } = usePreferences()
  const chartsTheme = prefs?.charts_theme || 'default'
  const [layoutId, setLayoutId] = useState(() => {
    const v = readLS(LAYOUT_KEY, DEFAULT_GRID_LAYOUT)
    return offered(v) ? v : DEFAULT_GRID_LAYOUT
  })
  const onLayout = useCallback(id => { if (!offered(id)) return; setLayoutId(id); writeLS(LAYOUT_KEY, id) }, [])
  const grid = useScreenerGrid({ rows, hasMore, onLoadMore, resetKey, onLayout, layoutId: phone ? PHONE_GRID_LAYOUT : layoutId })
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
          <div role="group" aria-label="Charts per page" className={styles.seg}>
            {SCREENER_GRID_LAYOUTS.map(l => (
              <button key={l.id} type="button" aria-pressed={layoutId === l.id} className={layoutId === l.id ? styles.segOn : styles.segOff}
                onClick={() => onLayout(l.id)}>{l.label}</button>
            ))}
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
