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
