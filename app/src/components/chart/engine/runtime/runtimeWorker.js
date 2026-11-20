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
import { errorImageOf } from './errorImage.js'
import { RUNTIME_OBJECTS_KEY, runtimeWarmupOf } from './runtimeObjects.js'
// ⭐⭐ W9-T11 — the run's `strategy` record crosses beside the columns, like the drawings.
import { runtimeStrategyOf } from './strategyRecord.js'
import { calcBarsWindowReport } from '../calcBarsWindow.js'
import { runtimeOvernightOf } from './overnightTail.js'
// ⭐⭐ W9-T11 (T1 review N1a) — THE WORKER IS ITS OWN MODULE GRAPH: the member door's
// registration (`memberPaneDefinition.js`) never runs here, so without this the worker's
// front end would read the registry's default (off) while the main thread's probe read the
// flag. The SAME reader is registered (`strategyBrokerGate.js`, default off, `=== '1'`); this
// file is browser transport, outside the server compute closure (`pine_runtime_closure.mjs`).
import { strategyBrokerEnabled } from '../strategyBrokerGate.js'
import { registerStrategyBrokerGate } from '../strategyBrokerGateRegistry.js'
registerStrategyBrokerGate(strategyBrokerEnabled)

// ⭐ P3 WS-H (S8) — how long the run took, IN the worker (a stop's beacon reports
// it; the main thread's own clock would also count the queue and the bundle load).
const clock = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now())

self.onmessage = (event) => {
  const { id, def, rows, ctx: plainCtx } = event.data || {}
  const startedAt = clock()
  try {
    // ⭐ RS RATING L5 — the other-symbol cache crosses as plain entries (`runtimeAsync.js::messageOf`)
    const ctx = plainCtx && Array.isArray(plainCtx.secondaryEntries)
      ? (() => {
        const { secondaryEntries, ...rest } = plainCtx
        const secondary = new Map(secondaryEntries)
        return { ...rest, secondary, exchangeOf: (k) => { const e = secondary.get(k); return (e && e.exchange) || null } }
      })()
      : plainCtx
    // ⭐⭐ (coordinator ruling 2026-11-19) off the main thread the budget scales with the bars the run covers
    // (`runtimeColumns.js::runtimePaneBudgetFor`); every main-thread door keeps 1,000 ms. ⭐⭐ (engine 86, A2) and
    // here alone the VM's `WALL_TIME` follows that budget (`runLimitsOf`): every other caller keeps 5,000
    const columns = computeRuntimeColumns(def, rows || [], ctx || {}, { budgetMs: RUNTIME_PANE_TIME_BUDGET_MS, budgetScales: true })
    // ⭐ RT5 — the run's drawings are non-enumerable on the record, so a
    // structured clone would drop them; they cross beside it. ⭐ UIE PHASE 2 — the raw
    // payload, a WITHHELD one included (its sentence is the member's), and the warm-up
    // the run withheld off the listing, which the host object gate reads.
    self.postMessage({ id, ok: true, columns, objects: columns[RUNTIME_OBJECTS_KEY] || null,
      warmup: runtimeWarmupOf(columns), strategy: runtimeStrategyOf(columns),
      // ⭐⭐ CBC-FMT — the `calc_bars_count` window record crosses beside the columns too
      calcBars: calcBarsWindowReport(columns),
      // ⭐⭐ (2026-11-20) and the overnight tail's record (`overnightTail.js`), which the strip reads too
      overnight: runtimeOvernightOf(columns) })
  } catch (err) {
    self.postMessage({
      id,
      ok: false,
      // ⛔⛔ EVERY FIELD THE MAIN THREAD READS CROSSES (`errorImage.js`): a hand-picked list here dropped
      // `pending`, and a run waiting for another symbol's bars came back as a refusal (RS Rating L10b)
      error: { ...errorImageOf(err), ms: Math.max(0, Math.round(clock() - startedAt)) },
    })
  }
}
