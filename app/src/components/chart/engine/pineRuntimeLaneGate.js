// ─── ⛔⛔ THE GATE ON THE RUNTIME LANE REACHING A MEMBER ─────────────────────
//
// Ruling D2 put the member pane on the HOST lane's saved definition, and until
// 2026-09-27 the runtime lane (`ast/pineRuntimeFrontend.js` → `runtime/lowerIr.js`
// → `runtime/vm.js`) had no live importer at all. The owner's goal of that day —
// "fully import every and any TradingView Pine script indicator so it shows on
// UCT charts exactly as on TradingView" — supersedes D2 for ONE path only: when
// the host lane refuses a script for a limit of its own value model (`var`
// state, `:=`, a block as a value…), the member door may try the runtime lane
// instead. `engine/pineRuntimeLane.js` is that fallback.
//
// ⛔ SO IT ARRIVES OFF. Default OFF means `=== '1'`: absent, empty, `'0'` and
// `'true'` are all off, and the first deploy carrying the fallback changes
// nothing a member sees. Rollback is the variable, not a revert.
//
// ⭐ THE CONVENTION IS `objectsOnlyPaneGate.js`'s, READ OFF THE CODE: one flag,
// one module, the source a late-bound parameter so the fail-closed branch is
// provable by a test, and the read inside a function, never at module scope.

/** May the member door fall back to the runtime lane, and may a runtime-lane
 *  definition compute?
 *
 *  ⛔ TWO READERS, BOTH IN `pineRuntimeLane.js`'s CONTRACT: the door
 *  (`memberPaneDefinition.js`) asks before it builds one, and the install door
 *  (`nativeRegistry.validateUserDefinitions`) asks before it will run one. A
 *  document minted on a build with the flag ON is therefore inert — refused by
 *  name, never computed — on a build with it OFF.
 */
export function pineRuntimeLaneEnabled(env) {
  try {
    const source = env === undefined ? import.meta.env : env
    return source.VITE_PINE_RUNTIME_LANE_ENABLED === '1'
  } catch {
    // A build with no readable env is not a build that may run a second engine
    // on a member's chart. Fail CLOSED.
    return false
  }
}

// ─── ⭐⭐ THE LANE IS A LAZY CHUNK, AND THIS IS ITS EAGER HALF (2026-09-27) ────────
//
// ⚰️ The first cut of the door imported `pineRuntimeLane.js` STATICALLY from
// `memberPaneDefinition.js` and `nativeRegistry.js`. `nativeRegistry` is the
// chart engine every page loads, so the whole runtime — front end, lowering, VM —
// shipped in the eager bundle to every member with the flag OFF: CI's Notebook
// first-open budget measured +328 KB (2,539,592 B against 2,260,793). A flag that
// hides a feature does not hide its bytes.
//
// ⭐ So the lane is loaded only when a member's script needs it. What must be
// known BEFORE it loads lives here, because this module is already eager and tiny:
// the compute kind, the refusals the lane may answer, and a SLOT the lane fills
// when it arrives. `pineRuntimeLane.js` re-exports the constants so its existing
// importers keep one spelling.

/** The compute kind a runtime-lane document declares (`defSchema.COMPUTE_KINDS`). */
export const RUNTIME_LANE_KIND = 'pine'

/** ⭐⭐ THE HOST REFUSALS THE RUNTIME LANE IS BUILT TO SERVE — and only those.
 *
 *  Each is a limit of the host lane's VALUE MODEL (one canonical expression per
 *  column), which the runtime lane's bytecode answers by design: persistent
 *  slots, reassignment, blocks and loops as statements, arrays, tuples, records,
 *  user functions with frames, per-bar memory, history rings. `runtimeLaneGuards
 *  .test.js` proves every member with a script the host refuses by exactly that
 *  guard and this lane builds — a member with no such proof is not in the set.
 *
 *  ⛔⛔ NEVER A VOCABULARY OR RULING GUARD. `pine:function`, `pine:builtin`,
 *  `pine:arity`, `pine:role-order`, `pine:window`, `pine:input-kind`,
 *  `pine:request`, `pine:text-value`, … each record that nobody has RULED what a
 *  name means here. The runtime lane reuses the host resolver for pure
 *  sub-expressions, so it usually refuses the same name again — but where it has
 *  a path of its own, falling back would route AROUND a ruling. Measured
 *  2026-09-27: `support-and-resistance__UgNPprOr8h` (host `pine:role-order`)
 *  BUILDS in this lane; it is refused anyway, and the rail pins that. */
//
//  ⚠️ MEASURED OUT, 2026-09-27: `pine:tuple` and `pine:na` read like value-model
//  limits and are NOT in the set, because no fixture exists where the host refuses
//  them and this lane builds — `[k, d] = ta.stoch(…)` refuses here too
//  (`runtime:tuple`), and `fixnan` refuses in both lanes (`pine:na`). A member
//  earns a place by a script the lane actually serves, never by its sentence.
export const RUNTIME_FALLBACK_GUARDS = Object.freeze(new Set([
  'pine:state',
  'pine:reassign',
  'pine:block',
  'pine:collection',
  'pine:type',
  'pine:function-def',
]))

/** Is this host refusal one the runtime lane may answer instead? */
export function isRuntimeFallbackGuard(guard) {
  return typeof guard === 'string' && RUNTIME_FALLBACK_GUARDS.has(guard)
}

/** The lane's compute API once its module has evaluated, else `null`. */
let laneApi = null
let laneLoading = null

/** Called by `pineRuntimeLane.js` as it evaluates, however it was reached — a
 *  lazy load, the door's chunk, or a test's static import. */
export function providePineRuntimeLane(api) {
  laneApi = api && typeof api.runtimeLaneColumns === 'function' ? api : null
}

/** The loaded lane, or `null` while it has not arrived. ⛔ NEVER a stand-in:
 *  a caller that finds `null` reports it by name, it does not guess columns. */
export function loadedPineRuntimeLane() {
  return laneApi
}

/** Load the lane's chunk. Resolves to its API (the slot is filled by the module
 *  itself). A failed load clears the in-flight promise so the next ask retries,
 *  instead of caching the failure for the life of the tab. */
export function loadPineRuntimeLane() {
  if (laneApi) return Promise.resolve(laneApi)
  // ⛔ FAIL CLOSED AT THE ONE EDGE THAT CARRIES THE IMPORT. Every caller already
  // asks the flag first; asking here too means the lazy `import()` below cannot
  // be reached on a build with the lane OFF, whoever calls it next. The
  // member-pane gate rail reads this call as the consult on the path
  // `nativeRegistry` → here → the lane.
  if (!pineRuntimeLaneEnabled()) {
    return Promise.reject(new Error('runtime-door:off — the runtime lane is off on this build'))
  }
  if (!laneLoading) {
    laneLoading = import('./pineRuntimeLane').then(() => laneApi, (err) => {
      laneLoading = null
      throw err
    })
  }
  return laneLoading
}
