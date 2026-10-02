// app/src/components/chart/engine/lowerTfGate.js
//
// ─── ⛔⛔ THE GATE ON SERVING A READ BELOW THE CHART'S TIMEFRAME (C41) ────────────
//
// C41 proved the RULE of `request.security(syminfo.tickerid, "<5|15|60|240>", …)`
// on a daily or weekly chart — which intrabar, which session, when a chart bar
// is unknown — on TRADINGVIEW'S OWN intraday bars (`lowerTf.js`, committed
// captures). In the product the intraday bars come from OUR store
// (`/api/bars/{ticker}?tf=15`), and nobody has measured those against
// TradingView's. A value computed off bars that differ is a confident wrong
// number with a proven rule behind it — the worst kind.
//
// ⛔ SO IT ARRIVES OFF (integrator ruling, 2026-10-01). Off, a lower-timeframe
// request is refused by name — `lower-tf:store-unmeasured` — exactly where it was
// refused before C41: no `ltf` node is emitted, nothing is stamped, nothing is
// fetched. On, everything C41 built is served. What flips it is a measurement,
// not a decision: `engine/__tests__/storeIntradayAgreement.test.js` over a
// committed store payload.
//
// ⭐ THE CONVENTION IS `runtimePaneGate.js`'S: default OFF means `=== '1'`, the
// read happens INSIDE a function (a test can flip it), the source is a late-bound
// parameter (so the fail-closed branch is provable), and it is read HERE ONLY.

/** May a read below the chart's own timeframe be served?
 *
 *  ⛔ ONE READER, ON PURPOSE — `lowerTf.js`, whose `lowerTfRefusal` (the translate
 *  door and the bind) and `lowerTfWindowsOf` (the fetch) both ask it. A document
 *  stamped while it was on is therefore neither fetched for nor served once it is
 *  off: its `ltf` bars are unknown, never drawn.
 *
 *  @param {object} [env] injectable for tests; defaults to `import.meta.env`,
 *  bound LATE so a module-level stub is seen. */
export function lowerTfServingEnabled(env) {
  try {
    const source = env === undefined ? import.meta.env : env
    return !!source && source.VITE_PINE_LOWER_TF_ENABLED === '1'
  } catch {
    // A build with no `import.meta.env` may not quietly serve an unmeasured read.
    return false
  }
}
