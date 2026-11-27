// app/src/components/chart/engine/runtime/workerReady.js
//
// ⭐⭐ (Fred RS run half, 2026-11-26) — THE RUNTIME WORKER'S TWO LIFECYCLE WORDS, shared by the worker
// (`runtimeWorker.js`) and the page (`runtimeAsync.js`). Imports nothing: the worker's module graph and the page's
// both read it.
//
//   READY_ASK / READY  the page asks as it spawns the worker; the worker can read the ask only once its module has
//          evaluated, and answers READY then. The page posts a job only to a worker that has answered
//          (`runtimeAsync.js::pump`), so a job superseded while the worker is still loading is dropped on the page and the
//          loading worker is kept, instead of being terminated and loaded again. ⛔ ASKED, never volunteered: a harness
//          that drives the worker directly reads its first message as the answer to its own first job
//          (`tools/pine_runtime_host_parity.py`, `runtime_pane_smoke.py`), and an unasked READY would shift every answer.
//   WARM   a job kind: compute the document over stand-in bars and answer nothing but that it is done. It warms the
//          worker's compiler and VM (their first run pays the engine's compile-and-optimise cost) before the
//          chart's first real job arrives; nothing it computes is kept, drawn or counted.
export const RUNTIME_WORKER_READY = 'runtime-worker-ready'
export const RUNTIME_WORKER_READY_ASK = 'runtime-worker-ready-ask'
export const RUNTIME_WORKER_WARM = 'runtime-worker-warm'
