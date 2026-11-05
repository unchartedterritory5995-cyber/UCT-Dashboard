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
