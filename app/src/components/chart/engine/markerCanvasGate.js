// app/src/components/chart/engine/markerCanvasGate.js
//
// ─── e99 — THE GATE ON DRAWING PINE MARKERS ON CANVAS ────────────────────────
//
// `markerCanvas.js` draws every `plotshape` / `plotchar` style TradingView draws
// (twelve shapes and a character, at the pane's top / bottom, the bar's high /
// low, or the plotted value) where lightweight-charts' series markers draw four
// shapes at the bar. Its geometry (glyph sizes, offsets) is pinned from FRED RS's
// measurement of TradingView (run markers-2026-11-26) except a marker's text, a
// `plotchar`'s character size and a triangle's anchor at `location.absolute`; it
// arrives OFF until a real-browser check against TradingView.
// Off, every marker is drawn by the LWC series markers exactly as before.
//
// ⭐ THE CONVENTION IS `runtimePaneGate.js`'S: default OFF means `=== '1'`, the
// read happens INSIDE a function (a test can flip it), the source is a late-bound
// parameter, and it is read HERE ONLY.

/** May a Pine marker be drawn by the canvas marker primitive?
 *
 *  @param {object} [env] injectable for tests; defaults to `import.meta.env`,
 *  bound LATE so a module-level stub is seen. */
export function markerCanvasEnabled(env) {
  try {
    const source = env === undefined ? import.meta.env : env
    return !!source && source.VITE_PINE_MARKER_CANVAS_ENABLED === '1'
  } catch {
    // A build with no `import.meta.env` draws the markers it always drew.
    return false
  }
}
