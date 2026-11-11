// app/src/components/chart/engine/runtime/serverEntry.js
//
// The SERVER BUNDLE'S ENTRY (docs/pine/SERVER-RUNTIME-DESIGN.md, task T1).
// NO LOGIC: re-exports only. `scripts/build-pine-runtime.mjs` bundles this file into
// `dist-server/pine-runtime.mjs`, so the service runs the SAME `computeRuntimeColumns`
// the browser's worker runs (one semantic source, two hosts).
export {
  computeRuntimeColumns,
  runtimeVersionRefusal,
  resetRuntimeSessions,
  resetRuntimeLedgers,
  RUNTIME_FRONTEND_LANGUAGE,
  RUNTIME_FRONTEND_VERSION,
  // W5-T7: what the service's job adapter (services/pine_runtime/job.mjs) passes and reads, from
  // the module that declares each: the worker's wall budget (HP-7), the run's incremental record
  // (the H6 cold check) and the guards a pool-side stop is named by.
  RUNTIME_PANE_TIME_BUDGET_MS,
  RUNTIME_INCREMENTAL_KEY,
  RUNTIME_TIME_BUDGET_GUARD,
  RUNTIME_FAILED_GUARD,
  // W5-T7b: the run's own warm-up record (`computeOffListing`), which the service puts on the wire
  // as `warmup.withheldBars` beside the columns, read by the function the browser worker reads.
  runtimeWarmupOf,
} from './runtimeColumns.js'
// W5-T7b: the T3 canonical codec, so the supervisor (services/pine_runtime/protocol.mjs
// sealRunResults) decodes what a job sends and stamps the design 2.3 digest with the ONE
// implementation, carried inside the artifact (the image copies no source file).
// W5-INT: and the job adapter (services/pine_runtime/job.mjs) writes each column's wire bytes with
// the same codec's encoder, so the service holds no second copy of the design 2.3 encoding.
export { bytesToB64, columnDigest, decodeColumn, encodeColumn } from './columnDigest.js'
// W9-T14: the run's `strategy` record (W9 design 3.2) as the service serves it under `want: '#strategy'`:
// the reader the browser worker reads it by, and the ONE shape check every reader shares (T12, T13a,
// and the service's seal, services/pine_runtime/protocol.mjs). Re-exported, never copied.
export { runtimeStrategyOf, strategyRecordShapeErrors, STRATEGY_RECORD_SCHEMA } from './strategyRecord.js'
// W5-T7: drawings are not served by the server lanes in v1; the adapter names them by this key.
export { RUNTIME_OBJECTS_KEY } from './runtimeObjects.js'
export { SCRIPT_ENGINE_VERSION } from '../scriptEngineVersion.js'
export { RUNTIME_IR_VERSION } from './ir.js'
// The chart's timeframe set, so the service's door (services/pine_runtime/protocol.mjs, W5-T6)
// checks a job's `tf` against the product's own list, read from its declaring module, never retyped.
export { NATIVE_TFS } from '../../timeframes.js'
// The runtime's limits, so the door caps `bars.n` at the same `HISTORY` ceiling the run enforces.
export { DEFAULT_LIMITS } from './limits.js'
