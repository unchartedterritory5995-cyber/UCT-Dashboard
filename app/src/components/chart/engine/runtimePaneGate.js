// ─── ⛔⛔ THE GATE ON A MEMBER'S SCRIPT BEING DRAWN BY THE RUNTIME LANE ──────
//
// Owner principle (PR #241, 2026-09-28): our chart draws exactly what TradingView
// draws for the same script at its defaults, and what the columnar lane cannot
// represent routes to the per-bar runtime lane. This is the switch on that route.
//
// ⛔ IT ARRIVES OFF. Ruling D2 keeps every member pane on the HOST lane's saved
// definition (`ast/paneGate.js::PANE_LANE`), and the runtime lane has had no live
// importer in production since it was built. Routing a script there is a D2
// revisit, and like `VITE_PINE_OBJECTS_ONLY_PANE_ENABLED` before it, it ships dark
// so the first deploy carrying it changes nothing a member sees.
//
// ⭐ WHAT IT ADMITS WHEN ON — deliberately narrow: a script the host lane refuses
// ONLY for structural reasons the runtime lane exists for (every refusal carries
// `route: 'runtime'` — today, two `var`s whose previous bars are coupled), and
// only when the runtime lane builds it and its repaint behaviour can be stated.
// See `builder/memberPane/runtimePaneDefinition.js`.
//
// ⭐ THE CONVENTION IS READ OFF THE CODE (`docs/frontend_feature_flags.json`):
// default OFF means `=== '1'`, read INSIDE a function so a test can flip it, and
// a build with no `import.meta.env` fails CLOSED.
//
// ⭐⭐ GT (2026-10-02, owner ruling D1) — AND A PER-MEMBER PERMISSION. The build
// flag above is ONE bundle for every member, so turning it on used to turn the
// runtime pane on for everybody at once. The owner ruled admins first, then
// everyone: the pane now needs BOTH the build flag AND the server's answer for
// THIS member, `pine_runtime_pane_enabled` on the auth payload
// (`api/routers/auth.py::_access_payload`, driven by `PINE_RUNTIME_STAGE`
// = off / admins / all, read per request, default off). The client never
// re-derives it from a role; it is told yes or no.
//
// ⛔ LATCHED PER TAB, like `notebookFlags.js`: the FIRST payload carrying the key
// decides this tab for its life, and a later poll that disagrees is counted, not
// applied. A runtime pane must not start or stop drawing under a member while a
// worker run is in flight; the flip reaches a new tab, a reload, and every other
// member on their next authenticated request. ⛔ NOTHING LATCHED = NOT PERMITTED:
// a tab that has not heard from the server (or a backend too old to send the key)
// never draws through the runtime lane.

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

/** Is the build flag on? (`VITE_PINE_RUNTIME_PANE_ENABLED === '1'`).
 *  @param {object} [env] injectable for tests; defaults to `import.meta.env`. */
export function runtimePaneBuilt(env) {
  try {
    const source = env === undefined ? import.meta.env : env
    return !!source && source.VITE_PINE_RUNTIME_PANE_ENABLED === '1'
  } catch {
    return false
  }
}

/** May a member pane draw a script through the per-bar runtime lane?
 *
 *  ⛔ ONE READER, ON PURPOSE: `memberPaneDefinition` (the door that routes) and
 *  `nativeRegistry.validateUserDefinitions` (the install door that must refuse a
 *  runtime document on a build that may not draw one) both ask this function.
 *
 *  ⭐ GT: BOTH the build flag AND the latched per-member permission.
 *
 *  @param {object} [env] injectable for tests; defaults to `import.meta.env`,
 *  bound LATE so a module-level stub is seen. */
export function runtimePaneEnabled(env) {
  return runtimePaneBuilt(env) && runtimePanePermitted()
}
