// app/src/pages/charts/grid/MultiChartGrid.jsx
//
// The Multi-Chart grid body: a fixed N×M CSS grid of GridChartCells rendered
// inside .workspaceBody (1fr tracks fill the viewport-locked area natively —
// no rowHeight math). Owns: active-cell hotkey tracking, the crosshair sync
// bus, the concurrency-limited mount queue, and the ONE shared
// ChartSettingsModal (chart_settings is a user-global blob — a per-cell gear
// would be a semantics lie).
//
// Memoization contract (load-bearing): cells are React.memo'd, and every prop
// handed to them is identity-stable across active-cell changes — isActive /
// onChange / onBarsReady are per-index functions memoized on cells.length that
// read live values through refs. The activeIdx className lives on the
// container-owned wrapper div ONLY, so a mouse sweep across a 4x4 grid
// re-renders zero StockCharts.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import usePreferences from '../../../hooks/usePreferences'
import { useWorkspace } from '../WorkspaceContext'
import { mergeChartSettings } from '../../../components/chart/chartDefaults'
import ChartSettingsModal from '../../../components/chart/ChartSettingsModal'
import GridChartCell from './GridChartCell'
import useStaggeredMount from './useStaggeredMount'
import { parseLayoutId } from './gridLayouts'
import styles from './MultiChartGrid.module.css'

export default function MultiChartGrid({ mc }) {
  const { chartsTheme } = useWorkspace()
  const { prefs, setPref } = usePreferences()
  const { state, hydrated } = mc
  const layout = parseLayoutId(state.layout)
  const cells = state.cells
  const cellsRef = useRef(cells)
  cellsRef.current = cells

  // ── Active-cell tracking (hover-sticky, seeded to cell 0, focus-aware) ──
  const activeCellRef = useRef(0)
  const [activeIdx, setActiveIdx] = useState(0)
  const setActive = useCallback((i) => {
    activeCellRef.current = i
    setActiveIdx(i)
  }, [])
  // Custom-N×M shrink while a high-index cell is active → clamp back to 0 or
  // no cell would answer true and hotkeys would go dead.
  useEffect(() => {
    if (activeCellRef.current >= cells.length) setActive(0)
  }, [cells.length, setActive])
  const isActiveFns = useMemo(
    () => cells.map((_, i) => () => activeCellRef.current === i),
    [cells.length],   // eslint-disable-line react-hooks/exhaustive-deps
  )
  const onChangeFns = useMemo(
    () => cells.map((_, i) => (next) => mc.updateCellAt(i, next)),
    [cells.length, mc.updateCellAt],   // eslint-disable-line react-hooks/exhaustive-deps
  )

  // ── Crosshair sync bus (ref-based; passed to cells only while Sync is on) ──
  const busRef = useRef(null)
  if (!busRef.current) {
    const listeners = new Set()
    busRef.current = {
      emit: (sourceId, payload) => listeners.forEach((fn) => fn({ sourceId, payload })),
      subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn) },
    }
  }
  const crosshairBus = state.syncCrosshair ? busRef.current : null

  // ── Mount queue: only cells WITH a symbol consume slots ──
  const chartIds = useMemo(() => cells.filter(c => c.sym).map(c => c.id), [cells])
  const { mountedIds, release } = useStaggeredMount(chartIds, { limit: 3, slotTimeoutMs: 5000 })
  const onBarsReadyFns = useMemo(
    () => cells.map((_, i) => () => {
      const id = cellsRef.current[i]?.id
      if (id) release(id)
    }),
    [cells.length, release],   // eslint-disable-line react-hooks/exhaustive-deps
  )

  // ── Shared chart settings modal (exact ChartWidget wiring) ──
  const gridCs = mergeChartSettings(prefs.chart_settings)
  const updateChartSettings = useCallback((next) => {
    setPref('chart_settings', JSON.stringify(next))
  }, [setPref])
  const savedColors = useMemo(() => {
    try {
      const raw = prefs.chart_saved_colors
      const arr = typeof raw === 'string' ? JSON.parse(raw) : raw
      return Array.isArray(arr) ? arr : []
    } catch { return [] }
  }, [prefs.chart_saved_colors])
  const saveColor = useCallback((hex) => {
    if (!hex) return
    const h = String(hex).toLowerCase()
    const next = [h, ...savedColors.filter(c => String(c).toLowerCase() !== h)].slice(0, 18)
    setPref('chart_saved_colors', JSON.stringify(next))
  }, [savedColors, setPref])
  const openSettings = useCallback(() => mc.setSettingsOpen(true), [mc.setSettingsOpen])   // eslint-disable-line react-hooks/exhaustive-deps

  // Shared volume-pane proportion (cells read it, never write it).
  const volPanePct = (() => {
    const v = Number(prefs?.charts_vol_pane_pct)
    return Number.isFinite(v) && v >= 5 && v <= 60 ? v : 12
  })()
  const dailyDefaultBars = cells.length > 9 ? 90 : 126
  const canvasTheme = chartsTheme === 'sunrise' ? 'sunrise' : null

  const gridStyle = {
    gridTemplateRows: `repeat(${layout.rows}, minmax(0, 1fr))`,
    gridTemplateColumns: `repeat(${layout.cols}, minmax(0, 1fr))`,
  }

  return (
    <>
      <div className={styles.gridBody} style={gridStyle}>
        {cells.map((cell, i) => {
          const queued = hydrated && cell.sym && !mountedIds.has(cell.id)
          // Pre-hydration: render skeleton frames only — never mount default
          // cells that a late-arriving saved pref would swap out (double herd).
          if (!hydrated || queued) {
            return (
              <div key={cell.id} className={styles.cellOuter}>
                <div className={styles.cell}>
                  <div className={styles.cellSkeleton}>
                    {cell.sym ? `Loading ${cell.sym}…` : ''}
                  </div>
                </div>
              </div>
            )
          }
          return (
            <div
              key={cell.id}
              className={`${styles.cellOuter} ${activeIdx === i ? styles.cellActive : ''}`}
              onPointerEnter={() => setActive(i)}
              onFocusCapture={() => setActive(i)}
            >
              <GridChartCell
                cell={cell}
                onChange={onChangeFns[i]}
                crosshairBus={crosshairBus}
                volPanePct={volPanePct}
                isActive={isActiveFns[i]}
                dailyDefaultBars={dailyDefaultBars}
                canvasTheme={canvasTheme}
                onOpenSettings={openSettings}
                onBarsReady={onBarsReadyFns[i]}
              />
            </div>
          )
        })}
      </div>
      <ChartSettingsModal
        open={mc.settingsOpen}
        onClose={() => mc.setSettingsOpen(false)}
        settings={gridCs}
        onChange={updateChartSettings}
        savedColors={savedColors}
        onSaveColor={saveColor}
      />
    </>
  )
}
