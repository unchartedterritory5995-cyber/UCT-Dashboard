// app/src/pages/charts/versionHistoryApi.js
//
// The workspace version-history ROUTES and their member-facing words, in one module with no React in it, so the
// two callers share ONE implementation: the Layouts → Version history panel (VersionHistory.jsx) and UCT Agent's
// layoutHistory.* (agent/capabilities/layoutHistory.js, reached through versionHistoryAgent.js). Moved verbatim out
// of VersionHistory.jsx, which re-exports every name it used to export.
//
// The server half is TERM-021 (api/routers/workspace_doc.py): every save of the Charts board is a version, and a
// restore APPENDS a copy of the chosen version, compare-and-set on the head the caller read (`base_version`; a stale
// base is 409 and nothing is written). Every route answers 404 while WORKSPACE_DOC_STORE_ENABLED is unset.

export const WORKSPACE_DOC_URL = '/api/workspace/doc'
export const BOARD = 'charts'
export const LIST_LIMIT = 50

/** Member-facing names for the board's stored keys (`WORKSPACE_PREF_KEYS`).
 *  A key missing here is shown by its raw name rather than hidden. */
// Member-facing names for the board's persisted keys. The WORDS are written here; the
// KEY SET is not ours to choose -- `VersionHistory.keyLabels.test.js` holds it equal to
// `WORKSPACE_PREF_KEYS` in api/services/workspace_doc_store.py, both directions.
export const KEY_LABELS = {
  charts_workspace_layout: 'Board layout',
  charts_workspace_groups: 'Linked symbols',
  chart_settings: 'Chart settings',
  charts_theme: 'Charts theme',
  charts_merged: 'Merged widgets',
  charts_vol_pane_pct: 'Volume pane size',
  charts_active_template: 'Open layout name',
  watchlist_settings: 'Watchlist settings',
  watchlist_columns: 'Watchlist columns',
  theme_tracker_settings: 'Theme Tracker settings',
  fundamentals_settings: 'Fundamentals settings',
  breadth_widget_settings: 'Breadth settings',
  aisearch_settings: 'AI Search settings',
}

export function keyLabel(key) {
  return KEY_LABELS[key] || key
}

/** How a version came to exist, in the member's words. */
export function sourceLabel(v) {
  switch (v?.source) {
    case 'migration': return 'First saved copy of your board'
    case 'mirror': return 'Board saved'
    case 'write': return 'Board saved'
    case 'restore': return v.restored_from != null ? `Restored from version ${v.restored_from}` : 'Restored'
    case 'delete': return 'Board history cleared'
    default: return 'Saved'
  }
}

export function formatVersionTime(epochSeconds) {
  const d = new Date(Number(epochSeconds) * 1000)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

/** Which stored keys a restore of `target` would change, against `head`.
 *
 *  `changes` — keys the version holds with a value different from the head's.
 *  `kept`    — keys the head holds that the version does not; the restore route
 *              leaves those exactly as they are (it never deletes a key). */
export function diffPrefs(targetPrefs, headPrefs) {
  const t = targetPrefs || {}
  const h = headPrefs || {}
  const changes = Object.keys(t).sort().filter(k => h[k] !== t[k])
  const kept = Object.keys(h).sort().filter(k => !(k in t))
  return { changes, kept }
}

export async function requestJson(url, init) {
  if (typeof fetch !== 'function') return { status: 0, ok: false, body: null }
  try {
    const res = await fetch(url, { credentials: 'include', ...(init || {}) })
    if (!res) return { status: 0, ok: false, body: null }
    let body = null
    try { body = await res.json() } catch { body = null }
    return { status: res.status, ok: !!res.ok, body }
  } catch {
    return { status: 0, ok: false, body: null }
  }
}

/** GET the board's versions, newest first → `{ status, ok, body }` (`body.versions` on a 200). */
export function listWorkspaceVersions(limit = LIST_LIMIT) {
  return requestJson(`${WORKSPACE_DOC_URL}/versions?board=${BOARD}&limit=${limit}`)
}

/** GET one version (its `doc`, or `tombstone`) → `{ status, ok, body }`. */
export function readWorkspaceVersion(version) {
  return requestJson(`${WORKSPACE_DOC_URL}/versions/${version}?board=${BOARD}`)
}

/** POST a restore of `version`, compare-and-set on `baseVersion` (the head the caller read) → `{ status, ok, body }`. */
export function restoreWorkspaceVersion(version, baseVersion) {
  return requestJson(`${WORKSPACE_DOC_URL}/restore`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ version, base_version: baseVersion, board: BOARD }),
  })
}
