// app/src/components/chart/engine/runtime/runtimeWorker.js
//
// ─── ⭐⭐ RT1 — THE RUNTIME PANE'S RUN, OFF THE MAIN THREAD ──────────────────
//
// A runtime-lane pane executes the member's script once per bar: 94–144 ms on a
// 5,000-bar chart on the measuring box (`runtimeFallbackPerf.measure.test.js`),
// several frames' worth. Run on the main thread it would freeze the app for that
// long on every new fetch; here it costs no frame.
//
// ⛔ ONE COMPUTATION, NOT A SECOND: this file runs `computeRuntimeColumns`, the
// same function the synchronous door runs, with the same budget. What comes back
// is the columns, or the refusal / the script's own `runtime.error` as plain
// fields the main thread rebuilds (`runtimeAsync.js`).
import { computeRuntimeColumns, RUNTIME_PANE_TIME_BUDGET_MS } from './runtimeColumns.js'

self.onmessage = (event) => {
  const { id, def, rows, ctx } = event.data || {}
  try {
    const columns = computeRuntimeColumns(def, rows || [], ctx || {}, { budgetMs: RUNTIME_PANE_TIME_BUDGET_MS })
    self.postMessage({ id, ok: true, columns })
  } catch (err) {
    self.postMessage({
      id,
      ok: false,
      error: {
        name: (err && err.name) || 'Error',
        message: String((err && err.message) || err),
        guard: (err && err.guard) || null,
        bar: err && Number.isInteger(err.bar) ? err.bar : null,
      },
    })
  }
}
