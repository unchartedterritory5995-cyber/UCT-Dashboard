// ─── THE PER-MEMBER PINE EDITOR PERMISSION LATCH (A2, owner ruling O3) ──────
//
// The exact shape of `runtimePanePermission.js`, for `PINE_AUTHORING_STAGE`
// (off / admins / all, read per request server-side in
// `api/services/pine_authoring.py::permitted`, delivered on the auth payload as
// `pine_authoring_enabled`). `engine/pineAuthoringGate.js::pineAuthoringEnabled`
// ANDs it with the build flag `VITE_PINE_AUTHORING_ENABLED`.
//
// ⛔ WHY THIS LIVES OUTSIDE `components/chart/engine/`: AuthContext feeds it, and
// AuthContext is on the entry chunk, which may not reach the chart engine
// (`src/__tests__/entryExcludesChartEngine.test.js`).
//
// ⛔ LATCHED PER TAB: the FIRST payload carrying the key decides this tab for its
// life; a later poll that disagrees is counted, not applied (an editor must not
// vanish under a member mid-script). ⛔ NOTHING LATCHED = NOT PERMITTED.

let _permitted = null
let _latchedAt = null
let _ignored = 0

/** Feed an auth payload in. ⛔ Never throws (it runs on the auth paths). */
export function latchPineAuthoringPermission(payload) {
  try {
    const v = payload ? payload.pine_authoring_enabled : undefined
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
export function pineAuthoringPermitted() {
  return _permitted === true
}

export const pineAuthoringPermissionDebug = () => ({
  permitted: _permitted, latchedAt: _latchedAt, ignoredDisagreements: _ignored,
})

/** Rails only — the latch is module state. */
export function __resetPineAuthoringPermission() {
  _permitted = null
  _latchedAt = null
  _ignored = 0
}

/** Rails only (`src/test-setup.js`): the editor's own suites run as a permitted
 *  member so they keep measuring the editor; the gate itself is railed with the
 *  latch reset (`engine/__tests__/pineAuthoringGate.test.js`). */
export function __permitPineAuthoringForTests() {
  _permitted = true
  _latchedAt = 0
  _ignored = 0
}
