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
// decides this tab, and a later payload that would GRANT is counted, not
// applied. ⛔ NOTHING LATCHED = NOT PERMITTED.
//
// ⭐⭐ WS-I (2026-10-31, gap S6) — BUT A SWITCH-OFF REACHES AN OPEN TAB. The latch
// is ONE-WAY: a later payload saying `false` while this tab holds `true` is
// APPLIED (a revocation), never counted away. And a tab holding `true` re-asks
// the server by itself: `runtimePanePermitted()`, once its answer is older than
// `RUNTIME_PERMISSION_RECHECK_MS`, fires ONE background `GET /api/auth/me` (the
// payload that already carries the key, read per request on the server; no new
// endpoint, no timer) and feeds the answer back through the latch, so
// `PINE_RUNTIME_STAGE=off` (or a step down that drops this member) lands on the
// next consult after it. The direction that can only REMOVE drawing is the one
// that moves under an open tab; a grant still waits for a reload.
//
// ⛔ The re-check runs only for a latch a SERVER PAYLOAD set, only in a page (a
// worker has no session to ask with), and never throws: a failed or non-ok read
// leaves the latch as it was and waits another interval.

/** How stale a `true` may grow before the next consult re-asks the server. */
export const RUNTIME_PERMISSION_RECHECK_MS = 60000
/** The payload the re-check reads (`api/routers/auth.py::_access_payload`). */
export const RUNTIME_PERMISSION_RECHECK_PATH = '/api/auth/me'

let _permitted = null
let _latchedAt = null
let _ignored = 0
let _revoked = 0
let _fromServer = false
let _confirmedAt = 0
let _recheckInFlight = false

/** Feed an auth payload in. The first one carrying a boolean
 *  `pine_runtime_pane_enabled` latches it. ⛔ Never throws (it runs on the auth
 *  paths, and a flag read must never fail a sign-in). */
export function latchRuntimePanePermission(payload) {
  try {
    const v = payload ? payload.pine_runtime_pane_enabled : undefined
    if (typeof v !== 'boolean') return _permitted
    if (_permitted !== null) {
      if (v === _permitted) {
        _confirmedAt = Date.now()
      } else if (_permitted === true && v === false) {
        // ⭐ S6 — a revocation is APPLIED: the switch-off reaches this open tab.
        _permitted = false
        _revoked += 1
        _confirmedAt = Date.now()
      } else {
        _ignored += 1
      }
      return _permitted
    }
    _permitted = v
    _latchedAt = Date.now()
    _confirmedAt = _latchedAt
    _fromServer = true
    return _permitted
  } catch {
    return _permitted
  }
}

/** Re-ask the server for this member's answer (S6). Fire-and-forget; never throws. */
function recheckRuntimePanePermission() {
  if (_recheckInFlight) return
  if (typeof window === 'undefined' || typeof fetch !== 'function') return
  _recheckInFlight = true
  // Throttle failures too: a failed read waits a full interval before the next.
  _confirmedAt = Date.now()
  try {
    Promise.resolve(fetch(RUNTIME_PERMISSION_RECHECK_PATH, { credentials: 'include', cache: 'no-store' }))
      .then((r) => (r && r.ok ? r.json() : null))
      .then((d) => { if (d) latchRuntimePanePermission(d) })
      .catch(() => { /* the latch stays as it was */ })
      .finally(() => { _recheckInFlight = false })
  } catch {
    _recheckInFlight = false
  }
}

/** The latched per-member permission: `true` only when the server said so.
 *  ⭐ S6: a server-latched `true` older than `RUNTIME_PERMISSION_RECHECK_MS`
 *  triggers one background re-check; THIS call still answers the latch as it
 *  stands (a consult never waits on the network). */
export function runtimePanePermitted() {
  if (_permitted === true && _fromServer
      && Date.now() - _confirmedAt >= RUNTIME_PERMISSION_RECHECK_MS) {
    recheckRuntimePanePermission()
  }
  return _permitted === true
}

/** What an operator needs to tell a stale answer from a current one. */
export const runtimePanePermissionDebug = () => ({
  permitted: _permitted, latchedAt: _latchedAt, ignoredDisagreements: _ignored,
  revocations: _revoked, confirmedAt: _confirmedAt, recheckInFlight: _recheckInFlight,
})

/** Rails only — the latch is module state. */
export function __resetRuntimePanePermission() {
  _permitted = null
  _latchedAt = null
  _ignored = 0
  _revoked = 0
  _fromServer = false
  _confirmedAt = 0
  _recheckInFlight = false
}

/** Rails only (`src/test-setup.js`): the suites that exercise the runtime LANE
 *  run as a permitted member, so they keep measuring the lane rather than this
 *  gate. The gate itself is railed with the latch reset
 *  (`engine/__tests__/runtimeSwitchOn.test.js`). Never called by product code. */
export function __permitRuntimePaneForTests() {
  _permitted = true
  _latchedAt = 0
  _ignored = 0
  _revoked = 0
  // ⛔ NOT from a server: the test grant never re-checks (no stray fetch in a suite).
  _fromServer = false
  _confirmedAt = 0
  _recheckInFlight = false
}
