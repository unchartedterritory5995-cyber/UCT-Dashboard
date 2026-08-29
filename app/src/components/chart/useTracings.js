// app/src/components/chart/useTracings.js — React binding for the tracings layer of
// drawingsStore. Thin useSyncExternalStore adapter over the tracings snapshot +
// subscription, exposing the sheet list, the active/visible ids, and the meta/switch
// actions. The store functions are stable module-level exports, so they pass through
// as-is (no useCallback churn). Display names come from drawingsStore.tracingLabel.
import { useSyncExternalStore } from 'react'
import * as drawingsStore from './drawingsStore'

export default function useTracings() {
  const snap = useSyncExternalStore(drawingsStore.subscribeTracings, drawingsStore.getTracingsSnapshot)
  return {
    tracings: snap.tracings,
    activeId: snap.activeId,
    visibleIds: snap.visibleIds,
    // meta
    createTracing: drawingsStore.createTracing,
    renameTracing: drawingsStore.renameTracing,
    recolorTracing: drawingsStore.recolorTracing,
    reorderTracings: drawingsStore.reorderTracings,
    setTracingVisible: drawingsStore.setTracingVisible,
    // active + lifecycle
    setActiveTracing: drawingsStore.setActiveTracing,
    deleteTracing: drawingsStore.deleteTracing,
  }
}
