// app/src/components/chart/useChartDrawings.js — localStorage persistence for chart drawings
import { useState, useCallback, useEffect, useRef } from 'react'

const STORAGE_KEY = 'uct-chart-drawings'
const MAX_HISTORY = 100   // undo/redo depth per symbol

function loadAll() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') }
  catch { return {} }
}

function saveAll(all) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(all)) }
  catch { /* quota exceeded */ }
}

export default function useChartDrawings(sym) {
  const [drawings, setDrawings] = useState([])
  // Always-current snapshot for history capture (the callbacks below are memoized
  // on [sym] only, so they must read the live array through a ref, not a closure).
  const drawingsRef = useRef([])
  drawingsRef.current = drawings
  // Undo/redo stacks — reset per symbol so you never undo across tickers.
  const pastRef = useRef([])
  const futureRef = useRef([])
  // Bumped on every history change so canUndo/canRedo re-render their consumers.
  const [, setHistTick] = useState(0)
  const bump = () => setHistTick(t => t + 1)

  useEffect(() => {
    pastRef.current = []
    futureRef.current = []
    if (!sym) { drawingsRef.current = []; setDrawings([]); bump(); return }
    const loaded = loadAll()[sym] || []
    drawingsRef.current = loaded
    setDrawings(loaded)
    bump()
  }, [sym])

  const writeLS = useCallback((updated) => {
    if (!sym) return
    const all = loadAll()
    if (updated.length) all[sym] = updated
    else delete all[sym]
    saveAll(all)
  }, [sym])

  // Apply a new drawings array. When `record` (default), the PREVIOUS state is
  // pushed onto the undo stack and the redo stack is cleared. A live drag passes
  // record:false for its per-move writes (it snapshots ONCE up front via
  // snapshotHistory) so the whole drag collapses into a single undo step.
  const commit = useCallback((updated, record = true) => {
    if (!sym) return
    if (record) {
      pastRef.current.push(drawingsRef.current)
      if (pastRef.current.length > MAX_HISTORY) pastRef.current.shift()
      futureRef.current = []
    }
    drawingsRef.current = updated
    setDrawings(updated)
    writeLS(updated)
    bump()
  }, [sym, writeLS])

  const addDrawing = useCallback((d) => {
    const id = crypto.randomUUID()
    commit([...drawingsRef.current, { ...d, id }])
    return id
  }, [commit])

  const removeDrawing = useCallback((id) => {
    commit(drawingsRef.current.filter(d => d.id !== id))
  }, [commit])

  const updateDrawing = useCallback((id, updates, opts) => {
    commit(
      drawingsRef.current.map(d => d.id === id ? { ...d, ...updates } : d),
      opts?.record !== false,
    )
  }, [commit])

  const clearAll = useCallback(() => commit([]), [commit])

  // Reorder a drawing in the z-stack. 'front' → end of the array (rendered last =
  // on top, and hit-tested first); 'back' → start. Recorded as one undo step.
  const reorderDrawing = useCallback((id, dir) => {
    const cur = drawingsRef.current
    const d = cur.find(x => x.id === id)
    if (!d) return
    const rest = cur.filter(x => x.id !== id)
    commit(dir === 'back' ? [d, ...rest] : [...rest, d])
  }, [commit])

  // Push the CURRENT state onto the undo stack without changing it — called once
  // at the start of a drag so the coalesced record:false writes are undoable as one.
  const snapshotHistory = useCallback(() => {
    if (!sym) return
    pastRef.current.push(drawingsRef.current.map(d => ({ ...d })))
    if (pastRef.current.length > MAX_HISTORY) pastRef.current.shift()
    futureRef.current = []
    bump()
  }, [sym])

  const undo = useCallback(() => {
    if (!pastRef.current.length) return
    futureRef.current.push(drawingsRef.current)
    const prev = pastRef.current.pop()
    drawingsRef.current = prev
    setDrawings(prev)
    writeLS(prev)
    bump()
  }, [writeLS])

  const redo = useCallback(() => {
    if (!futureRef.current.length) return
    pastRef.current.push(drawingsRef.current)
    const next = futureRef.current.pop()
    drawingsRef.current = next
    setDrawings(next)
    writeLS(next)
    bump()
  }, [writeLS])

  return {
    drawings, addDrawing, removeDrawing, updateDrawing, clearAll, reorderDrawing,
    undo, redo, snapshotHistory,
    canUndo: pastRef.current.length > 0,
    canRedo: futureRef.current.length > 0,
  }
}
