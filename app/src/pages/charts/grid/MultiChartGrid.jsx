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
import { useSearchParams } from 'react-router-dom'
import usePreferences from '../../../hooks/usePreferences'
import { useAuth } from '../../../context/AuthContext'
import { useWorkspace } from '../WorkspaceContext'
import { mergeChartSettings } from '../../../components/chart/chartDefaults'
import ChartSettingsModal from '../../../components/chart/ChartSettingsModal'
import GridChartCell from './GridChartCell'
import useStaggeredMount from './useStaggeredMount'
import { parseLayoutId } from './gridLayouts'
import { createSpike, SPIKE_SYMS } from './gridSpike'
import { makePeerFiller } from './peerFill'
import { fetchPeers } from './groupsApi'
import styles from './MultiChartGrid.module.css'

export default function MultiChartGrid({ mc }) {
  const { chartsTheme } = useWorkspace()
  const { prefs, setPref } = usePreferences()
  const { user } = useAuth()
  const [searchParams] = useSearchParams()

  // ── Perf-spike harness (admin-only, ?gridspike=N&tf=D|5) ──
  // Forces a synthetic N-cell grid of distinct liquid tickers through the REAL
  // grid path (mount queue, lite profile, theme) with persistence disabled —
  // a spike run must never write a 16-cell board into the user's saved state.
  const spikeN = Math.max(0, Math.min(16, Number(searchParams.get('gridspike')) || 0))
  const spikeActive = spikeN > 0 && user?.role === 'admin'
  const spikeTf = searchParams.get('tf') === '5' ? '5' : 'D'
  const spikeRef = useRef(null)
  if (spikeActive && !spikeRef.current) spikeRef.current = createSpike({ n: spikeN, tf: spikeTf })
  const spikeState = useMemo(() => {
    if (!spikeActive) return null
    const cols = Math.ceil(Math.sqrt(spikeN))
    const rows = Math.ceil(spikeN / cols)
    return {
      mode: 'grid',
      layout: `${rows}x${cols}`,
      cells: SPIKE_SYMS.slice(0, spikeN).map((sym, i) => ({ id: `spike${i}`, sym, tf: spikeTf })),
      syncCrosshair: false,
    }
  }, [spikeActive, spikeN, spikeTf])

  const state = spikeState || mc.state
  const hydrated = spikeActive || mc.hydrated
  const layout = parseLayoutId(state.layout)
  const cells = state.cells
  const cellsRef = useRef(cells)
  cellsRef.current = cells

  // ── Peer auto-fill (Groups mode): committing a ticker in any cell reseeds
  // the whole grid with [seed, ...peers]. makePeerFiller's monotonic request
  // id discards a stale response (fast second commit beats a slow first) and
  // hands back an undo snapshot of the pre-fill board. ──
  const [undo, setUndo] = useState(null)   // {label, snapshot} | null
  const peerFiller = useMemo(
    () => makePeerFiller({
      fetchPeers,
      fillCells: (syms, group) => { if (!spikeActive) mc.fillCells(syms, group) },
      onUndoAvailable: setUndo,
    }),
    [mc.fillCells, spikeActive],   // eslint-disable-line react-hooks/exhaustive-deps
  )
  useEffect(() => { if (!undo) return; const t = setTimeout(() => setUndo(null), 6000); return () => clearTimeout(t) }, [undo])

  // ── Maximize: one cell expands to cover the whole grid body (no remount —
  // the cell stays mounted and its wrapper is CSS-promoted over the grid, so
  // the chart just autoSizes up and back). ──
  const [maxId, setMaxId] = useState(null)
  const onToggleMaxFns = useMemo(
    () => cells.map((_, i) => () => {
      const id = cellsRef.current[i]?.id
      setMaxId(cur => (cur === id ? null : id))
    }),
    [cells.length],   // eslint-disable-line react-hooks/exhaustive-deps
  )
  // A maximized id that no longer exists (layout change / cell cleared) restores.
  useEffect(() => {
    if (maxId && !cells.some(c => c.id === maxId)) setMaxId(null)
  }, [cells, maxId])

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
  const inGroupMode = !!state.group
  const onChangeFns = useMemo(
    () => cells.map((_, i) => (next) => {
      if (spikeActive) return
      if (inGroupMode && next?.sym && next.sym !== cellsRef.current[i]?.sym) {
        const n = cellsRef.current.length
        peerFiller.run(next.sym, {
          n,
          group: state.group,
          snapshot: { cells: cellsRef.current, group: state.group },
        })
      } else {
        mc.updateCellAt(i, next)
      }
    }),
    [cells.length, mc.updateCellAt, spikeActive, inGroupMode, peerFiller, state.group],   // eslint-disable-line react-hooks/exhaustive-deps
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
  // Spike mode wires the counting bus (validity guard for the sweep — emit()
  // counts, subscribe is a no-op so cells never fan out = sync-OFF numbers).
  const crosshairBus = spikeActive
    ? spikeRef.current.bus
    : (state.syncCrosshair ? busRef.current : null)

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

  // Spike instrumentation: stamp mountAt when the queue actually admits a
  // cell's chart (post-commit, so the cell's DOM node exists for the
  // first-canvas MutationObserver).
  useEffect(() => {
    const spike = spikeRef.current
    if (!spike) return
    for (const c of cells) {
      if (c.sym && mountedIds.has(c.id)) spike.reportCellMount(c.id, c.sym)
    }
  }, [mountedIds, cells])

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
              className={`${styles.cellOuter} ${activeIdx === i ? styles.cellActive : ''} ${maxId === cell.id ? styles.cellMaximized : ''} ${maxId && maxId !== cell.id ? styles.cellHiddenBehindMax : ''}`}
              onPointerEnter={() => setActive(i)}
              onFocusCapture={() => setActive(i)}
            >
              <GridChartCell
                cell={cell}
                onChange={onChangeFns[i]}
                crosshairBus={crosshairBus}
                volPanePct={volPanePct}
                isActive={isActiveFns[i]}
                dailyDefaultBars={maxId === cell.id ? 126 : dailyDefaultBars}
                canvasTheme={canvasTheme}
                onOpenSettings={openSettings}
                onBarsReady={onBarsReadyFns[i]}
                isMaximized={maxId === cell.id}
                onToggleMaximize={onToggleMaxFns[i]}
              />
            </div>
          )
        })}
        {undo && (
          <div className={styles.undoToast} role="status">
            <span>{undo.label}</span>
            <button type="button" onClick={() => {
              // Restore the pre-fill board: re-fill with the snapshot's syms + group.
              mc.fillCells(undo.snapshot.cells.map(c => c.sym).filter(Boolean), undo.snapshot.group)
              setUndo(null)
            }}>Undo</button>
          </div>
        )}
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
