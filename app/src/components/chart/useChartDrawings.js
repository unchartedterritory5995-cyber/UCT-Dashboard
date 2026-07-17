// app/src/components/chart/useChartDrawings.js — localStorage persistence for
// chart drawings. Thin useSyncExternalStore adapter over the shared per-symbol
// drawingsStore, so N charts mounted on the same sym share ONE drawings array +
// ONE undo/redo history (no last-writer-wins clobber, live cross-chart sync).
// The return surface is identical to the pre-store hook — StockChart and the
// overlay/toolbar wiring need zero changes.
import { useCallback, useSyncExternalStore } from 'react'
import * as drawingsStore from './drawingsStore'

const NOOP_UNSUBSCRIBE = () => {}

export default function useChartDrawings(sym) {
  const subscribe = useCallback(
    (cb) => (sym ? drawingsStore.subscribe(sym, cb) : NOOP_UNSUBSCRIBE),
    [sym],
  )
  // Falsy sym → the frozen empty snapshot (stable reference, no store entry).
  const getSnapshot = useCallback(
    () => (sym ? drawingsStore.getSnapshot(sym) : drawingsStore.EMPTY_SNAPSHOT),
    [sym],
  )
  const snap = useSyncExternalStore(subscribe, getSnapshot)

  // Mutations delegate to the store (all no-ops on falsy sym, store-side).
  const addDrawing = useCallback((d) => drawingsStore.addDrawing(sym, d), [sym])
  const removeDrawing = useCallback((id) => drawingsStore.removeDrawing(sym, id), [sym])
  const updateDrawing = useCallback(
    (id, updates, opts) => drawingsStore.updateDrawing(sym, id, updates, opts),
    [sym],
  )
  const clearAll = useCallback(() => drawingsStore.clearAll(sym), [sym])
  const reorderDrawing = useCallback((id, dir) => drawingsStore.reorderDrawing(sym, id, dir), [sym])
  const undo = useCallback(() => drawingsStore.undo(sym), [sym])
  const redo = useCallback(() => drawingsStore.redo(sym), [sym])
  const snapshotHistory = useCallback(() => drawingsStore.snapshotHistory(sym), [sym])

  return {
    drawings: snap.drawings,
    addDrawing, removeDrawing, updateDrawing, clearAll, reorderDrawing,
    undo, redo, snapshotHistory,
    canUndo: snap.canUndo,
    canRedo: snap.canRedo,
  }
}
