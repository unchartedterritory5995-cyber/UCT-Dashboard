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
import { fetchPeers, fetchGroupTop, fetchGroups, pinEtf } from './groupsApi'
import { chartKeys, admittedSym } from './symAdmission'
import { buildCellBadges } from './cellBadge'
import GroupHeatHeader from './GroupHeatHeader'
import { humanizeGroupId } from './groupLabel'
import useLivePrices from '../../../hooks/useLivePrices'
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
  const inGroupMode = state.groupsMode
  const onChangeFns = useMemo(
    () => cells.map((_, i) => (next) => {
      if (spikeActive) return
      const cur = cellsRef.current[i]
      // A real new-ticker commit changes the sym away from what's DISPLAYED
      // (loadSym). A TF/style change carries the displayed sym unchanged.
      const isNewSym = !!next?.sym && next.sym !== displayedSymRef.current[i]
      if (isNewSym && inGroupMode) {
        peerFiller.run(next.sym, {
          n: cellsRef.current.length,
          group: state.group,
          snapshot: { cells: cellsRef.current, group: state.group },
        })
      } else if (isNewSym) {
        mc.updateCellAt(i, next)                    // non-group manual ticker change
      } else {
        // TF / chart-Style change: merge the changed fields onto the REAL target
        // cell — never overwrite its (possibly still-loading) sym with loadSym.
        mc.updateCellAt(i, { ...cur, tf: next?.tf ?? cur?.tf, chartType: next?.chartType ?? cur?.chartType })
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

  // ── Time-range sync bus (mirrors the crosshair bus above) ──
  const rangeBusRef = useRef(null)
  if (!rangeBusRef.current) {
    const listeners = new Set()
    rangeBusRef.current = {
      emit: (sourceId, payload) => listeners.forEach((fn) => fn({ sourceId, payload })),
      subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn) },
    }
  }
  const rangeBus = spikeActive ? null : (state.syncTimeRange ? rangeBusRef.current : null)

  // ── Mount queue: composite `${id}::${sym}` keys, not bare cell ids. A group
  // switch reuses a cell's id (fillCells pools overlapping syms so the chart
  // instance doesn't remount), but its SYM still changes — keying the queue
  // on id alone would let that swap slip past the throttle and fire N
  // simultaneous cold /api/bars fetches (the 2026-05-24 fetch-herd incident
  // condition). Composite keys make a sym swap re-enter the throttle exactly
  // like a fresh mount, while the DOM cell key below stays `cell.id` so React
  // never tears down the chart instance. ──
  const keys = useMemo(() => chartKeys(cells), [cells])
  const { mountedIds, release } = useStaggeredMount(keys, { limit: 3, slotTimeoutMs: 5000 })

  // Remember the last admitted sym per cell id so a not-yet-admitted swap
  // keeps rendering the previous chart (no remount, no skeleton flash) until
  // its own composite key clears the throttle.
  // The sym each cell is currently DISPLAYING (loadSym) — distinct from the
  // cell's target sym in state during a mount-admission swap. onChangeFns uses
  // it to tell a real new-ticker commit (sym != displayed) from a TF/style
  // change (sym == displayed), so a TF click mid-swap can't trigger a peer-fill.
  const displayedSymRef = useRef({})
  const prevSymRef = useRef({})
  useEffect(() => {
    for (const c of cells) {
      if (c.sym && mountedIds.has(`${c.id}::${c.sym}`)) prevSymRef.current[c.id] = c.sym
    }
  }, [mountedIds, cells])

  const onBarsReadyFns = useMemo(
    () => cells.map((_, i) => () => {
      const c = cellsRef.current[i]
      if (c?.id && c?.sym) release(`${c.id}::${c.sym}`)
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
      if (c.sym && mountedIds.has(`${c.id}::${c.sym}`)) spike.reportCellMount(c.id, c.sym)
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

  // ── Heat header (Groups mode): reads the SAME shared live-price pool the
  // cells already poll via useLivePrices — no extra fetch. ──
  const gridSyms = useMemo(() => cells.map(c => c.sym).filter(Boolean), [cells])
  const { prices: livePrices } = useLivePrices(gridSyms)
  const heatHoldings = useMemo(
    () => gridSyms.map(s => ({ sym: s, changePct: livePrices?.[s]?.change_pct })),
    [gridSyms, livePrices],
  )

  // ── Group meta (Groups mode): the current group's display name + universe
  // total + per-sym {tier, rationale} for the cell badges. Fetched once
  // whenever the group changes (this also restores badges on reload). Two
  // fetches are fine — user-paced, not on any hot path. Both guarded by the
  // effect's `live` flag so a fast group switch can't let a stale response
  // land after a newer one. ──
  const [groupMeta, setGroupMeta] = useState({})   // {name, total, metaBySym}
  useEffect(() => {
    const g = state.group
    if (!g?.id) { setGroupMeta({}); return undefined }
    let live = true
    fetchGroupTop(g.id, { n: 16, by: g.by || 'today' }).then(res => {
      if (!live) return
      const metaBySym = {}
      for (const r of (res.rows || [])) metaBySym[r.sym] = { tier: r.tier, rationale: r.rationale }
      setGroupMeta(prev => ({ ...prev, total: res.total, metaBySym }))
    })
    fetchGroups().then(list => {
      if (!live) return
      const name = list.find(x => x.id === g.id)?.name
      setGroupMeta(prev => ({ ...prev, name }))
    })
    return () => { live = false }
  }, [state.group?.id, state.group?.by])

  const cellBadges = useMemo(
    () => buildCellBadges(cells, groupMeta.metaBySym || {}, livePrices),
    [cells, groupMeta.metaBySym, livePrices],
  )

  // Grid cells LOCK the volume pane low — these are mini-charts where a tall
  // volume pane eats the price action. Decoupled from the shared workspace
  // pref (which the primary chart honors up to 45%): grid is hard-capped at
  // 10% so no shared setting can make grid volume dominate the cell.
  const volPanePct = (() => {
    const v = Number(prefs?.charts_vol_pane_pct)
    return Number.isFinite(v) && v >= 5 ? Math.min(v, 10) : 9
  })()
  const dailyDefaultBars = cells.length > 9 ? 90 : 126
  const canvasTheme = chartsTheme === 'sunrise' ? 'sunrise' : null

  const gridStyle = {
    gridTemplateRows: `repeat(${layout.rows}, minmax(0, 1fr))`,
    gridTemplateColumns: `repeat(${layout.cols}, minmax(0, 1fr))`,
  }

  // Multi-membership switcher: re-fill the grid with one of the seed's other
  // groups, swapping the current group INTO the switcher list so you can flip back.
  const handleSwitchGroup = useCallback(async (groupId, groupName) => {
    if (spikeActive) return
    const g = state.group
    const n = cells.length
    const { syms, etf } = await fetchGroupTop(groupId, { n, by: 'today' })
    const filled = pinEtf(syms, etf, n)
    if (!filled.length) return
    const curName = (g && (g.name || groupMeta.name)) || (g && g.id) || null
    const others = (g?.alsoIn || []).filter(x => x.id !== groupId)
    const newAlsoIn = (g?.id && curName) ? [{ id: g.id, name: curName }, ...others] : others
    mc.fillCells(filled, { id: groupId, name: groupName, by: 'today', n, alsoIn: newAlsoIn, seed: g?.seed })
  }, [state.group, cells.length, groupMeta.name, mc, spikeActive])

  return (
    <>
      {state.group && (
        <GroupHeatHeader
          groupName={state.group.name || groupMeta.name || humanizeGroupId(state.group.id)}
          total={groupMeta.total}
          shown={gridSyms.length}
          holdings={heatHoldings}
          alsoIn={state.group.alsoIn}
          onSwitch={handleSwitchGroup}
        />
      )}
      <div className={styles.gridBody} style={gridStyle}>
        {cells.map((cell, i) => {
          // The sym to actually LOAD this render: the target once its own
          // composite key clears the throttle, else the last-admitted sym
          // (old chart keeps rendering, no remount), else null (first mount).
          const { sym: loadSym, admitted } = admittedSym(cell, mountedIds, prevSymRef.current)
          displayedSymRef.current[i] = loadSym
          const queued = hydrated && cell.sym && !admitted && !loadSym   // first mount, nothing to show yet
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
                cell={{ ...cell, sym: loadSym }}
                badge={state.group ? cellBadges[i] : null}
                rationale={state.group ? cellBadges[i]?.rationale : ''}
                scanning={state.groupsMode}
                onChange={onChangeFns[i]}
                crosshairBus={crosshairBus}
                rangeBus={rangeBus}
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
              if (!undo.snapshot.group) mc.clearGroup()   // fillCells coalesces a falsy group to prev; force-clear when the snapshot had no group
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
