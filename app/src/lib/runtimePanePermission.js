// ─── THE PER-MEMBER RUNTIME-PANE PERMISSION LATCH (GT, owner ruling D1) ──────
//
// ⛔ WHY THIS LIVES OUTSIDE `components/chart/engine/`. `AuthContext.jsx` feeds
// this latch on every auth payload, and AuthContext is on the ENTRY chunk's
// static closure (every route, including the Notebook and the Journal). The rail
// `src/__tests__/entryExcludesChartEngine.test.js` forbids ANY module under
// `components/chart/engine/` on that closure (measured on wave 16 @ 20ba63f668:
// JournalLayout / NotebookSurface / main.jsx -> AuthContext -> engine/
// runtimePaneGate.js, 3 reds). The latch has no imports and no engine
// knowledge, so it moves here; `engine/runtimePaneGate.js` re-exports it and
// remains the ONE reader (`runtimePaneEnabled`) that ANDs it with the build flag.
//
// ⛔ ONE MODULE INSTANCE: both the auth path (writer) and the gate (reader) import
// THIS file, so the latch they share is the same `_permitted`.
//
// ⛔ LATCHED PER TAB, like `notebookFlags.js`: the FIRST payload carrying the key
// decides this tab for its life, and a later poll that disagrees is counted, not
// applied. ⛔ NOTHING LATCHED = NOT PERMITTED.

let _permitted = null
let _latchedAt = null
let _ignored = 0

/** Feed an auth payload in. The first one carrying a boolean
 *  `pine_runtime_pane_enabled` latches it. ⛔ Never throws (it runs on the auth
 *  paths, and a flag read must never fail a sign-in). */
export function latchRuntimePanePermission(payload) {
  try {
    const v = payload ? payload.pine_runtime_pane_enabled : undefined
    if (typeof v !== 'boolean') return _permitted
    if (_permitted !== null) {
      if (v !== _permitted) _ignored += 1
      return _permitted
    }
    _permitted = v
    _latchedAt = Date.now()
    return _permitted
  } catch {
    return _permitted
  }
}

/** The latched per-member permission: `true` only when the server said so. */
export function runtimePanePermitted() {
  return _permitted === true
}

/** What an operator needs to tell a stale answer from a current one. */
export const runtimePanePermissionDebug = () => ({
  permitted: _permitted, latchedAt: _latchedAt, ignoredDisagreements: _ignored,
})

/** Rails only — the latch is module state. */
export function __resetRuntimePanePermission() {
  _permitted = null
  _latchedAt = null
  _ignored = 0
}

/** Rails only (`src/test-setup.js`): the suites that exercise the runtime LANE
 *  run as a permitted member, so they keep measuring the lane rather than this
 *  gate. The gate itself is railed with the latch reset
 *  (`engine/__tests__/runtimeSwitchOn.test.js`). Never called by product code. */
export function __permitRuntimePaneForTests() {
  _permitted = true
  _latchedAt = 0
  _ignored = 0
}
