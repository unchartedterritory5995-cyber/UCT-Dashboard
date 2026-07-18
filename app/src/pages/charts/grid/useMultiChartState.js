// app/src/pages/charts/grid/useMultiChartState.js
//
// Owns the Multi-Chart grid mode's working state — {mode, layout, cells,
// syncCrosshair} — persisted to the `multichart_state` pref with the exact
// hydration discipline ChartsWorkspace uses for its own layout: never persist
// before server prefs settle (the V1 hydration-clobber race), 500ms debounced
// saves on discrete changes only, flush-on-unmount. Hoisted into a hook so
// ChartsWorkspace's header (the Multi Charts dropdown) and the grid body share
// one source of truth without bloating the workspace file.

import { useCallback, useEffect, useRef, useState } from 'react'
import usePreferences from '../../../hooks/usePreferences'
import {
  sanitizeState, makeDefaultState, parseLayoutId, reconcileCells, makeLayout,
} from './gridLayouts'

function parseRaw(raw) {
  if (!raw) return null
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!parsed || typeof parsed !== 'object') return null
    return { mode: parsed.mode === 'grid' ? 'grid' : 'workspace', ...sanitizeState(parsed) }
  } catch { return null }
}

export default function useMultiChartState() {
  const { prefs, setPref, loading: prefsLoading } = usePreferences()
  const [state, setState] = useState(
    () => parseRaw(prefs?.multichart_state) || { mode: 'workspace', ...makeDefaultState() },
  )
  const stateRef = useRef(state)
  stateRef.current = state

  // The grid's ONE shared ChartSettingsModal — opened from the Multi Charts
  // dropdown or any cell's right-click menu; rendered by MultiChartGrid.
  const [settingsOpen, setSettingsOpen] = useState(false)

  // Pick up prefs that arrive after initial render (async fetch), once.
  const loadedRef = useRef(false)
  useEffect(() => {
    if (loadedRef.current) return
    const parsed = parseRaw(prefs?.multichart_state)
    if (parsed) { setState(parsed); loadedRef.current = true }
  }, [prefs?.multichart_state])

  // Hydration gate — mirrors ChartsWorkspace's hydratedRef pattern.
  const hydratedRef = useRef(false)
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => {
    if (!prefsLoading) { hydratedRef.current = true; setHydrated(true) }
  }, [prefsLoading])

  const saveTimerRef = useRef(null)
  const scheduleSave = useCallback(() => {
    if (!hydratedRef.current) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null
      setPref('multichart_state', JSON.stringify(stateRef.current))
    }, 500)
  }, [setPref])

  // Flush a pending save on SPA nav / unmount so the last change always sticks.
  useEffect(() => {
    return () => {
      if (saveTimerRef.current && hydratedRef.current) {
        clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
        setPref('multichart_state', JSON.stringify(stateRef.current))
      }
    }
  }, [setPref])

  const apply = useCallback((updater) => {
    setState(prev => {
      const next = updater(prev)
      // scheduleSave reads stateRef, which this render pass updates — schedule
      // on the next microtask so the ref already holds `next` when it fires.
      queueMicrotask(scheduleSave)
      return next
    })
  }, [scheduleSave])

  const enterGrid = useCallback((layoutId) => {
    apply(prev => {
      const layout = parseLayoutId(layoutId || prev.layout)
      return { ...prev, mode: 'grid', layout: layout.id, cells: reconcileCells(prev.cells, layout.cellCount) }
    })
  }, [apply])

  const exitGrid = useCallback(() => {
    apply(prev => ({ ...prev, mode: 'workspace' }))
  }, [apply])

  const applyCustomLayout = useCallback((rows, cols) => {
    apply(prev => {
      const layout = makeLayout(rows, cols)
      return { ...prev, mode: 'grid', layout: layout.id, cells: reconcileCells(prev.cells, layout.cellCount) }
    })
  }, [apply])

  // Per-cell updates preserve the identity of every untouched cell so the
  // React.memo'd GridChartCells only re-render the edited one.
  const updateCellAt = useCallback((index, nextCell) => {
    apply(prev => ({ ...prev, cells: prev.cells.map((c, i) => (i === index ? nextCell : c)) }))
  }, [apply])

  // Bulk fill (Groups mode). ONE apply() — never a loop of updateCellAt (that
  // races the debounced save). Reuse a cell id when the target sym matches an
  // existing cell's sym so overlapping charts don't remount; mint fresh ids
  // only for genuinely-new syms. Fills the current grid size (layout.cellCount).
  const fillCells = useCallback((syms, group = null) => {
    apply(prev => {
      const want = (Array.isArray(syms) ? syms : [])
        .map(s => (typeof s === 'string' ? s.trim().toUpperCase() : null))
        .filter(Boolean)
      const layout = parseLayoutId(prev.layout)
      // Always fill the CURRENT grid size: under-fill -> trailing empty cells
      // (spec under-fill contract), over-fill -> extra syms dropped. Keeps
      // cells.length === cellCount like every other mutator.
      const count = layout.cellCount
      // Pool of reusable prior CELLS by sym (each used once), so a matched sym
      // keeps its id (no remount) AND its own tf + chart Style override.
      const pool = new Map()
      for (const c of prev.cells) {
        if (c.sym && !pool.has(c.sym)) pool.set(c.sym, c)
      }
      const used = new Set()
      const cells = []
      for (let i = 0; i < count; i++) {
        const sym = want[i] || null
        const match = sym ? pool.get(sym) : null
        if (match && !used.has(match.id)) {
          used.add(match.id)
          cells.push({ id: match.id, sym, tf: match.tf || 'D', chartType: match.chartType || null })
        } else {
          cells.push({ id: Math.random().toString(36).slice(2, 8), sym, tf: 'D', chartType: null })
        }
      }
      return { ...prev, mode: 'grid', cells, group: group || prev.group || null }
    })
  }, [apply])

  const setGroup = useCallback((group) => {
    apply(prev => ({ ...prev, group: group || null }))
  }, [apply])

  const clearGroup = useCallback(() => {
    apply(prev => ({ ...prev, group: null }))
  }, [apply])

  const setSyncCrosshair = useCallback((on) => {
    apply(prev => ({ ...prev, syncCrosshair: !!on }))
  }, [apply])

  const setSyncTimeRange = useCallback((on) => {
    apply(prev => ({ ...prev, syncTimeRange: !!on }))
  }, [apply])

  // Apply a saved multichart template ({kind:'multichart', layout, cells}).
  const applyGridTemplate = useCallback((tpl) => {
    const l = tpl?.layout
    if (!l || l.kind !== 'multichart') return
    apply(prev => {
      const s = sanitizeState({ layout: l.layout, cells: l.cells, syncCrosshair: prev.syncCrosshair, syncTimeRange: prev.syncTimeRange, group: l.group })
      return { mode: 'grid', ...s }
    })
  }, [apply])

  return {
    state, hydrated,
    settingsOpen, setSettingsOpen,
    enterGrid, exitGrid, applyCustomLayout, updateCellAt, setSyncCrosshair, setSyncTimeRange, applyGridTemplate,
    fillCells, setGroup, clearGroup,
  }
}
