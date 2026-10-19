import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { LAYOUTS, makeLayout, parseLayoutId } from '../../charts/grid/gridLayouts'

// ⭐ The screener's Charts view IS the /charts Multi-Chart grid (owner, 2026-10-18: the screener is
// "just a tool to access the same stuff in the same format"). MultiChartGrid takes its whole board
// from one `mc` object; /charts builds it from the multichart_state pref (useMultiChartState), and
// this builds it from the screen's results instead: page N of the rows, N×M at a time.
//
// What the grid owns is untouched: the cells, the ≤3-at-once mount queue (the fetch-herd guard),
// the warm, maximise, crosshair/range sync and the one shared settings modal. What this owns is
// which results are on the board: the page, and a slot's own timeframe / style / typed ticker.

// Every /charts preset, and any custom N×M /charts accepts: its LAYOUTS and its own parser, never
// a second list.
export const SCREENER_GRID_LAYOUTS = LAYOUTS
/** A layout id /charts would produce itself (parseLayoutId clamps, so a clamped id is not one). */
export const isGridLayout = id => /^\d+x\d+$/.test(String(id || '')) && parseLayoutId(id).id === id
export const DEFAULT_GRID_LAYOUT = '3x3'
// One column of two on a phone: /charts' own "Stacked" preset.
export const PHONE_GRID_LAYOUT = '2x1'

const EMPTY = []
const NO_SYNC = { crosshair: false, timeRange: false }
const noop = () => {}

export default function useScreenerGrid({
  rows = EMPTY, hasMore = false, onLoadMore, layoutId = DEFAULT_GRID_LAYOUT, onLayout, resetKey,
  sync = NO_SYNC, onSync,
} = {}) {
  const layout = parseLayoutId(layoutId)
  const n = layout.cellCount
  const loaded = rows.length

  // The page is held as the index of its FIRST result, so a layout change keeps that result on
  // screen rather than jumping to "page 3" of a different-sized grid.
  const [start, setStart] = useState(0)
  // A new screen starts at its first result ("adjust state while rendering" on a key change).
  const [heldKey, setHeldKey] = useState(resetKey)
  if (heldKey !== resetKey) { setHeldKey(resetKey); setStart(0) }
  const page = Math.floor(Math.min(start, Math.max(0, loaded - 1)) / n)
  const first = page * n

  // Per-slot overrides, positional like /charts' fillCells: a slot's timeframe and style stay with
  // the slot as the pages turn; a ticker typed into a slot holds only for the page it was typed on.
  const [slots, setSlots] = useState({})
  const [settingsOpen, setSettingsOpen] = useState(false)

  const cells = useMemo(() => Array.from({ length: n }, (_, i) => {
    const ov = slots[i]
    const sym = ov?.sym && ov.symAt === first ? ov.sym : (rows[first + i]?.ticker ?? null)
    // Slot ids, not ticker ids: a page turn swaps each chart's symbol in place (setData on the
    // live instance) instead of tearing every chart down and mounting a fresh one.
    return { id: `slot${i}`, sym, tf: ov?.tf || 'D', chartType: ov?.chartType || null }
  }), [n, slots, rows, first])
  const cellsRef = useRef(cells)
  cellsRef.current = cells
  const firstRef = useRef(first)
  firstRef.current = first
  const rowsRef = useRef(rows)
  rowsRef.current = rows

  const updateCellAt = useCallback((i, next) => {
    const rowSym = rowsRef.current[firstRef.current + i]?.ticker ?? null
    const typed = next?.sym && next.sym !== rowSym ? next.sym : null
    setSlots(s => ({
      ...s,
      [i]: { tf: next?.tf || 'D', chartType: next?.chartType || null, ...(typed ? { sym: typed, symAt: firstRef.current } : {}) },
    }))
  }, [])

  // Next past the loaded rows asks for more ONCE and steps onto the new page when it lands.
  const wanted = useRef(null)
  useEffect(() => {
    if (wanted.current != null && loaded > wanted.current) {
      const to = wanted.current
      wanted.current = null
      // The rows arriving from the page request are the external event this follows.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStart(to)
    }
  }, [loaded])
  const canNext = loaded > first + n || (hasMore && !!onLoadMore)
  const next = useCallback(() => {
    const to = first + n
    if (loaded > to) {
      setStart(to)
      // A short next page fills in as the rest of it loads.
      if (loaded < to + n && hasMore) onLoadMore?.()
    } else if (hasMore && wanted.current == null) {
      wanted.current = to
      onLoadMore?.()
    }
  }, [first, n, loaded, hasMore, onLoadMore])
  const prev = useCallback(() => { wanted.current = null; setStart(Math.max(0, first - n)) }, [first, n])

  // The grid's own layout cycle (Alt+\) and the Multi Chart menu's presets and Custom N×M land
  // here, through /charts' own layout parser.
  const enterGrid = useCallback((id) => onLayout?.(parseLayoutId(id).id), [onLayout])
  const applyCustomLayout = useCallback((r, c) => onLayout?.(makeLayout(r, c).id), [onLayout])
  const setSyncCrosshair = useCallback(on => onSync?.({ ...sync, crosshair: !!on }), [sync, onSync])
  const setSyncTimeRange = useCallback(on => onSync?.({ ...sync, timeRange: !!on }), [sync, onSync])

  const mc = useMemo(() => ({
    state: { mode: 'grid', layout: layout.id, cells, syncCrosshair: !!sync.crosshair, syncTimeRange: !!sync.timeRange, groupsMode: false, group: null },
    hydrated: true,
    settingsOpen, setSettingsOpen,
    enterGrid, applyCustomLayout, updateCellAt, setSyncCrosshair, setSyncTimeRange,
    // Groups mode (peer fill, its undo), opening a saved grid and leaving the grid are /charts
    // board features: a screen's results are the board (the menu hides them, MultiChartMenu
    // `features`).
    fillCells: noop, restoreCells: noop, clearGroup: noop, setGroupsMode: noop, applyGridTemplate: noop, exitGrid: noop,
  }), [layout.id, cells, settingsOpen, sync.crosshair, sync.timeRange, enterGrid, applyCustomLayout, updateCellAt, setSyncCrosshair, setSyncTimeRange])

  const shown = Math.max(0, Math.min(n, loaded - first))
  return {
    mc, page, next, prev, canNext, canPrev: first > 0,
    range: shown ? { from: first + 1, to: first + shown } : null,
  }
}
