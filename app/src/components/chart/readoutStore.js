// app/src/components/chart/readoutStore.js
//
// The store and the memo helper behind `ReadoutIsland.jsx` (read its header for why the chart's readout
// is a store). Kept apart from the component so the island file exports a component only.

/**
 * One chart's readout store: the legend payload and the end-tag chips shown while there is none.
 * The setters take a value or an updater, like `useState`'s, and skip a write that changes nothing.
 */
export function createReadoutStore(initialChips) {
  let snap = { crosshairData: null, offHoverEndTagChips: initialChips }
  const subs = new Set()
  const emit = () => { for (const fn of [...subs]) fn() }
  const setField = (field) => (next) => {
    const prev = snap[field]
    const v = typeof next === 'function' ? next(prev) : next
    if (Object.is(v, prev)) return
    snap = { ...snap, [field]: v }
    emit()
  }
  return {
    get: () => snap,
    subscribe: (fn) => { subs.add(fn); return () => { subs.delete(fn) } },
    setCrosshairData: setField('crosshairData'),
    setOffHoverEndTagChips: setField('offHoverEndTagChips'),
  }
}

/**
 * `useMemo` keyed on one argument, for a value derived from the readout inside an island. Built inside a
 * `useMemo` that carries the old memo's other dependencies (`useMemo(() => memoOnArg(fn), deps)`), the
 * result is recomputed exactly when the old `useMemo(() => fn(crosshairData), [crosshairData, ...deps])`
 * would have been.
 */
export function memoOnArg(fn) {
  let has = false
  let lastArg
  let lastOut
  return (arg) => {
    if (has && Object.is(arg, lastArg)) return lastOut
    has = true
    lastArg = arg
    lastOut = fn(arg)
    return lastOut
  }
}
