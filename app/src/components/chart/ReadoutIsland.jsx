// app/src/components/chart/ReadoutIsland.jsx
//
// ⭐ THE CHART'S READOUT, WITHOUT RE-RENDERING THE CHART (switch render cuts, 2026-11-20).
//
// The legend payload (`crosshairData`) and the off-hover end-tag chips used to be StockChart STATE. The
// switch applier computes the new symbol's readout in a LAYOUT effect, right after `updateChart` stamps the
// new bars, so the candles and the numbers land in one frame; a state write there re-ran the whole
// StockChart render (13-17 ms on a production board, per chart, per symbol switch) only to change the few
// elements that print the readout. A hover did the same on every crosshair frame.
//
// Now the two values live in a small per-chart store (`readoutStore.js`), and each element that prints
// them is a `<ReadoutIsland>`: it subscribes to the store and calls a render function StockChart hands it.
// A readout write re-renders the islands and nothing else, still synchronously inside the same commit (a
// `useSyncExternalStore` update scheduled in a layout effect renders before the browser paints, exactly
// like the state write it replaces), so the readout lands in the same frame as before.
//
// ⛔ WHAT KEEPS AN ISLAND IDENTICAL TO THE RENDER IT REPLACES. The render function is a closure from
// StockChart's latest render, so everything it reads besides the store is what that render would have
// read: StockChart re-renders the islands every time it renders (a new `render` prop each time), and a
// store write between StockChart renders changes only the store's two values. Refs are read when the
// island renders, as they were when StockChart rendered. `StockChart.readoutIsland.test.jsx` proves the
// fixed point: after a store-only update, a full StockChart render changes nothing in the readout.

import { useLayoutEffect, useSyncExternalStore } from 'react'

/**
 * Prints part of the readout. `render(crosshairData, offHoverEndTagChips)` returns what StockChart used
 * to render inline at this spot; `afterCommit`, when given, runs after each commit of this island (a
 * StockChart effect that measured the readout's DOM after every StockChart render now also has to run
 * after the island's own renders, which StockChart no longer sees).
 */
export default function ReadoutIsland({ store, render, afterCommit }) {
  const snap = useSyncExternalStore(store.subscribe, store.get, store.get)
  useLayoutEffect(() => { if (afterCommit) afterCommit() })
  const out = render(snap.crosshairData, snap.offHoverEndTagChips)
  return out === undefined || out === false || out === true || out === '' ? null : out
}
