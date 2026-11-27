// app/src/components/chart/engine/runtime/workerReady.js
//
// ⭐⭐ (Fred RS run half, 2026-11-26) — THE RUNTIME WORKER'S TWO LIFECYCLE WORDS, shared by the worker
// (`runtimeWorker.js`) and the page (`runtimeAsync.js`). Imports nothing: the worker's module graph and the page's
// both read it.
//
//   READY  posted once by the worker when its module has evaluated: the page posts a job only to a worker that has
//          said it (`runtimeAsync.js::pump`), so a job superseded while the worker is still loading is dropped on the
//          page and the loading worker is kept, instead of being terminated and loaded again.
//   WARM   a job kind: compute the document over stand-in bars and answer nothing but that it is done. It warms the
//          worker's compiler and VM (their first run pays the engine's compile-and-optimise cost) before the
//          chart's first real job arrives; nothing it computes is kept, drawn or counted.
export const RUNTIME_WORKER_READY = 'runtime-worker-ready'
export const RUNTIME_WORKER_WARM = 'runtime-worker-warm'
