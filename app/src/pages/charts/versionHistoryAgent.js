// UCT Agent's reach into Layouts → Version history (agent/capabilities/layoutHistory.js, layoutHistory.list / .restore).
//
// ⭐ The SAME routes the Version history panel uses (versionHistoryApi.js) and, after a restore, the SAME re-seed:
// ChartsWorkspace's handleVersionRestored (re-read the preferences, put the restored layout / linked symbols / Watchlist
// columns back on the board, the workspace notice). The Agent never writes a preference or the layout itself.
//
// `get()` returns ChartsWorkspace's side through a ref (the host memo stays dependency-free):
//   { mobile, grid, onRestored(res) }
// ⛔ Where the member has no Version history (the phone shell, Multi Chart — the Layouts menu hides the item there),
//    `here` is false and nothing is requested.

import { listWorkspaceVersions, readWorkspaceVersion, restoreWorkspaceVersion } from './versionHistoryApi'

export function versionHistoryAgentSource(get) {
  const where = (r) => !!r && !r.mobile && !r.grid
  return {
    read: () => ({ here: where(get()) }),
    list: (limit) => (where(get()) ? listWorkspaceVersions(limit) : Promise.resolve({ status: 0, ok: false, body: null })),
    readVersion: (version) => (where(get()) ? readWorkspaceVersion(version) : Promise.resolve({ status: 0, ok: false, body: null })),
    // The panel's own Restore: POST, then on a 200 the workspace's own re-seed (awaited, so a read-back sees the board).
    restore: async (version, baseVersion) => {
      const r = get()
      if (!where(r)) return { status: 0, ok: false, body: null }
      const res = await restoreWorkspaceVersion(version, baseVersion)
      if (res.ok && res.body && typeof r.onRestored === 'function') {
        try { await r.onRestored(res.body) } catch { /* the restore itself landed; the read-back decides */ }
      }
      return res
    },
  }
}
