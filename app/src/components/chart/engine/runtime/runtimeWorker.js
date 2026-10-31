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
import { RUNTIME_OBJECTS_KEY, runtimeWarmupOf } from './runtimeObjects.js'

// ⭐ P3 WS-H (S8) — how long the run took, IN the worker (a stop's beacon reports
// it; the main thread's own clock would also count the queue and the bundle load).
const clock = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now())

self.onmessage = (event) => {
  const { id, def, rows, ctx } = event.data || {}
  const startedAt = clock()
  try {
    const columns = computeRuntimeColumns(def, rows || [], ctx || {}, { budgetMs: RUNTIME_PANE_TIME_BUDGET_MS })
    // ⭐ RT5 — the run's drawings are non-enumerable on the record, so a
    // structured clone would drop them; they cross beside it. ⭐ UIE PHASE 2 — the raw
    // payload, a WITHHELD one included (its sentence is the member's), and the warm-up
    // the run withheld off the listing, which the host object gate reads.
    self.postMessage({ id, ok: true, columns, objects: columns[RUNTIME_OBJECTS_KEY] || null,
      warmup: runtimeWarmupOf(columns) })
  } catch (err) {
    self.postMessage({
      id,
      ok: false,
      error: {
        name: (err && err.name) || 'Error',
        message: String((err && err.message) || err),
        guard: (err && err.guard) || null,
        bar: err && Number.isInteger(err.bar) ? err.bar : null,
        ms: Math.max(0, Math.round(clock() - startedAt)),
      },
    })
  }
}
