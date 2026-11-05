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
} from './runtimeColumns.js'
export { SCRIPT_ENGINE_VERSION } from '../scriptEngineVersion.js'
export { RUNTIME_IR_VERSION } from './ir.js'
// The chart's timeframe set, so the service's door (services/pine_runtime/protocol.mjs, W5-T6)
// checks a job's `tf` against the product's own list, read from its declaring module, never retyped.
export { NATIVE_TFS } from '../../timeframes.js'
// The runtime's limits, so the door caps `bars.n` at the same `HISTORY` ceiling the run enforces.
export { DEFAULT_LIMITS } from './limits.js'
