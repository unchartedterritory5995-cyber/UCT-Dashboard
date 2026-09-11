// Newest values of custom Info Row formulas, published by a mounted chart and
// read by the header ABOVE it.
//
// ⭐⭐ WHY A STORE AND NOT A PROP. `ChartPane` renders the header and mounts
// `StockChart` beneath it, so the values flow the WRONG WAY for props: the maths
// happens in the child (it owns the bars, the engine and the memo) and the
// display happens in the parent. `StockChart` already publishes an imperative
// API into a host-supplied ref for exactly this reason — but a ref cannot make
// the header re-render when a number changes, and re-rendering is the whole
// point here.
//
// ⛔ KEYED PER CHART, NOT PER SYMBOL — which is where this differs from
// `chartReadoutStore`, whose whole job is "one symbol, one truth, mirrored into
// the watchlist". Two widgets on AAPL may carry different formulas, and keying
// on the symbol would have each overwrite the other's ADR with its own.
//
// ⛔ AND NO STALENESS WINDOW. `chartReadoutStore` expires after 6 s because a
// live price that stopped arriving is WRONG. A formula's value is not a tick: it
// is correct until its inputs change, and expiring it would blank the header
// every time the chart went quiet. It is cleared on unmount instead, which is
// the only moment it stops being true.
//
// A module singleton (like `livePriceStore` / `chartReadoutStore`) so it works
// across widgets, popped-out windows and standalone pages with no context.

/** chartKey → { values: Map<fieldId, number>, errors: Map<fieldId, string>, generation } */
const _byChart = new Map()
const _subs = new Set()

const EMPTY = Object.freeze({ values: new Map(), errors: new Map(), generation: 0 })

export function publishInfoValues(chartKey, payload) {
  if (!chartKey) return
  const prev = _byChart.get(chartKey)
  // ⚠️ THE GENERATION IS THE CHANGE SIGNAL, and re-notifying on an unchanged one
  // would wake every header on the page on every repaint. The binder bumps it
  // only when a value actually moved.
  if (prev && prev.generation === payload.generation) return
  _byChart.set(chartKey, {
    values: payload.values instanceof Map ? payload.values : new Map(),
    errors: payload.errors instanceof Map ? payload.errors : new Map(),
    generation: payload.generation || 0,
  })
  _subs.forEach((cb) => { try { cb() } catch { /* subscriber threw */ } })
}

/** What this chart published, or a STABLE empty.
 *
 *  ⛔ THE EMPTY IS A FROZEN SINGLETON because `useSyncExternalStore` compares the
 *  snapshot by identity: a fresh `{}` here would report a change on every render
 *  and loop the header forever. */
export function getInfoValues(chartKey) {
  if (!chartKey) return EMPTY
  return _byChart.get(chartKey) || EMPTY
}

export function subscribeInfoValues(cb) {
  _subs.add(cb)
  return () => { _subs.delete(cb) }
}

/** A chart that unmounts stops answering — its values are gone, not stale. */
export function clearInfoValues(chartKey) {
  if (!chartKey || !_byChart.has(chartKey)) return
  _byChart.delete(chartKey)
  _subs.forEach((cb) => { try { cb() } catch { /* subscriber threw */ } })
}

/** Test-only: so specs do not leak into each other. */
export function _resetForTests() {
  _byChart.clear()
  _subs.clear()
}
