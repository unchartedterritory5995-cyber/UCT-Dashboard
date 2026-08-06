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
import { VOLUME_PANE_SURFACE_FIXED } from '../../../components/chart/indicatorRegistry'
import GridChartCell from './GridChartCell'
import useStaggeredMount from './useStaggeredMount'
import { parseLayoutId, LAYOUTS } from './gridLayouts'
import { createSpike, SPIKE_SYMS } from './gridSpike'
import { makePeerFiller } from './peerFill'
import { makeGridWarmer } from './gridWarm'
import { prefetchGridWarm } from '../../../utils/prefetchBars'
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
  // Transient action feedback — group actions must never fail silently
  // (mega-review: empty fills, dead chips, failed fetches gave zero feedback).
  const [notice, setNotice] = useState(null)
  useEffect(() => { if (!notice) return undefined; const t = setTimeout(() => setNotice(null), 3000); return () => clearTimeout(t) }, [notice])
  // ONE fill sequence shared by typed peer-fills AND the also-in group switcher,
  // so a slow response from either source can never clobber a newer fill.
  const fillSeqRef = useRef({ n: 0 })
  const peerFiller = useMemo(
    () => makePeerFiller({
      fetchPeers,
      fillCells: (syms, group) => { if (!spikeActive) mc.fillCells(syms, group) },
      updateCellAt: (i, cell) => { if (!spikeActive) mc.updateCellAt(i, cell) },
      clearGroup: () => { if (!spikeActive) mc.clearGroup() },
      onUndoAvailable: setUndo,
      onNotice: setNotice,
      seq: fillSeqRef.current,
    }),
    [mc.fillCells, mc.updateCellAt, mc.clearGroup, spikeActive],   // eslint-disable-line react-hooks/exhaustive-deps
  )
  useEffect(() => { if (!undo) return; const t = setTimeout(() => setUndo(null), 10000); return () => clearTimeout(t) }, [undo])

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
  // Escape restores a maximized cell (mega-review: maximize was mouse-only with
  // no keyboard exit). Ignore when typing in the symbol search / a field so a
  // ticker-search Escape still just closes the dropdown.
  useEffect(() => {
    if (!maxId) return undefined
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      const t = e.target
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      setMaxId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [maxId])

  // Alt+\ cycles through the grid layout presets (1×2 → 2×2 → …, wrapping).
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.code === 'Backslash')) return
      const t = e.target
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (typeof mc.enterGrid !== 'function') return
      e.preventDefault()
      const i = LAYOUTS.findIndex(l => l.id === state.layout)
      const next = LAYOUTS[(i + 1) % LAYOUTS.length]
      if (next) mc.enterGrid(next.id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [state.layout, mc])

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
          cellIndex: i,
          cellNext: next,
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

  // ── Chart-parity warming (herd-safe): once the grid is hydrated AND its
  // initial mount-queue paint has settled, warm every cell's every timeframe
  // into IDB through the bounded prefetch queue, so any cell's TF-switch paints
  // instantly. gridWarm dedupes by sym-set content, so a TF/Style/undo/layout
  // change that leaves the sym set unchanged never re-warms. Flag: default ON,
  // set VITE_GRID_WARM_ENABLED='0' to disable. ──
  const gridWarmEnabled = import.meta.env.VITE_GRID_WARM_ENABLED !== '0'
  const [gridWarmer] = useState(() => makeGridWarmer({ warm: prefetchGridWarm }))
  // First-paint settled = every non-empty cell's composite key has been admitted
  // by the mount queue (its cold paint is done / in its last ≤3 wave). Recomputes
  // as slots free (mountedIds is state), so this flips true when the grid drains.
  const firstPaintSettled = cells.every(c => !c.sym || mountedIds.has(`${c.id}::${c.sym}`))
  useEffect(() => {
    if (!gridWarmEnabled) return undefined
    gridWarmer.maybeWarm(gridSyms, hydrated && firstPaintSettled)
    // Re-warm periodically so a board left open past IDB's ~26h intraday-eviction
    // window (e.g. Fri close → Mon open) re-warms evicted TFs. reset() drops the
    // content-key so the same sym set warms again; the interval closure holds the
    // current gridSyms for an idle board (deps unchanged → effect never re-ran),
    // and downstream dedupe (idbGet skip + _idbSeen) makes it a near-noop unless
    // something actually evicted. Cleared/re-armed on any sym-set change.
    const id = setInterval(() => {
      gridWarmer.reset()
      gridWarmer.maybeWarm(gridSyms, hydrated && firstPaintSettled)
    }, 2 * 60 * 60 * 1000)
    return () => clearInterval(id)
  }, [gridWarmer, gridWarmEnabled, gridSyms, hydrated, firstPaintSettled])

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
    // Industry cohorts (orphan fallback, id "industry:<Finviz name>") are not
    // themes: /api/groups/{id}/top would 404 and there's no theme row to name.
    // Use the group's own carried name and skip the theme fetches entirely.
    if (String(g.id).startsWith('industry:')) {
      setGroupMeta({ name: g.name || String(g.id).slice('industry:'.length), total: null, metaBySym: {} })
      return undefined
    }
    let live = true
    fetchGroupTop(g.id, { n: 16, by: g.by || 'today' }).then(res => {
      if (!live) return
      const metaBySym = {}
      for (const r of (res.rows || [])) metaBySym[r.sym] = { tier: r.tier, rationale: r.rationale, source: r.source }
      setGroupMeta(prev => ({ ...prev, total: res.total, metaBySym }))
    }).catch(() => { /* header degrades to name-only; never an unhandled rejection */ })
    fetchGroups().then(list => {
      if (!live) return
      const name = list.find(x => x.id === g.id)?.name
      setGroupMeta(prev => ({ ...prev, name }))
    }).catch(() => { /* keep whatever name the group state carries */ })
    return () => { live = false }
  }, [state.group?.id, state.group?.by, state.group?.name])

  // Badge meta = fetchGroupTop's top-16 rows (tier/rationale/source), overlaid
  // with the peer-fill `sources` map carried on the group state. The peer
  // ranking floats the seed's sub-theme, so a peer-fill sym (especially the
  // typed seed) can rank below the top-16 in the plain ranking — the group-state
  // map is what keeps its engine dot correct. fetchGroupTop's source wins where
  // both exist (same authority, fresher fetch).
  const cellBadges = useMemo(() => {
    let meta = groupMeta.metaBySym || {}
    const src = state.group?.sources
    if (src && typeof src === 'object') {
      meta = { ...meta }
      for (const s of Object.keys(src)) {
        const cur = meta[s]
        if (!cur) meta[s] = { source: src[s] }
        else if (cur.source == null) meta[s] = { ...cur, source: src[s] }
      }
    }
    return buildCellBadges(cells, meta, livePrices)
  }, [cells, groupMeta.metaBySym, state.group?.sources, livePrices])

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
  // groups, swapping the current group INTO the switcher list so you can flip
  // back. Participates in the shared fill sequence (a stale switch response
  // must never clobber a newer typed fill) and never fails silently.
  const handleSwitchGroup = useCallback(async (groupId, groupName) => {
    if (spikeActive) return
    const mine = ++fillSeqRef.current.n
    const g = state.group
    const n = cells.length
    let res = null
    try {
      res = await fetchGroupTop(groupId, { n, by: 'today' })
    } catch { res = null }
    if (mine !== fillSeqRef.current.n) return    // superseded by a newer fill
    if (!res) { setNotice(`Couldn't load ${groupName} — kept your board`); return }
    const filled = pinEtf(res.syms, res.etf, n)
    if (!filled.length) { setNotice(`${groupName} has no chartable names right now`); return }
    const curName = (g && (g.name || groupMeta.name)) || (g && g.id) || null
    const others = (g?.alsoIn || []).filter(x => x.id !== groupId)
    const newAlsoIn = (g?.id && curName) ? [{ id: g.id, name: curName }, ...others] : others
    mc.fillCells(filled, { id: groupId, name: groupName, by: 'today', n, alsoIn: newAlsoIn, seed: g?.seed })
  }, [state.group, cells.length, groupMeta.name, mc, spikeActive])

  return (
    // Flex column: the grid takes exactly the space remaining under the heat
    // header at ANY header height (including wrapped also-in chips). With the
    // old height:100% gridBody, the header's height pushed the grid past the
    // container and clipped the bottom row (mega-review #9).
    <div className={styles.gridWrap}>
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
                deepWarm={gridWarmEnabled && maxId === cell.id}
              />
            </div>
          )
        })}
        {undo && (
          <div className={styles.undoToast} role="status">
            <span>{undo.label}</span>
            <button type="button" onClick={() => {
              // Verbatim restore: cells with their tf + chart styles + empty
              // positions, group exactly as it was (mega-review #12 — the old
              // sym-only refill silently reset every timeframe/style to Daily).
              mc.restoreCells(undo.snapshot.cells, undo.snapshot.group)
              setUndo(null)
            }}>Undo</button>
          </div>
        )}
        {notice && !undo && (
          <div className={styles.undoToast} role="status">
            <span>{notice}</span>
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
        /* Cells pass volumeSeparatePane + volumePaneHeightPct (GridChartCell), which
           win over the saved prefs — so the separate-pane toggle is inert here too. */
        volumePaneFixed={VOLUME_PANE_SURFACE_FIXED}
      />
    </div>
  )
}
