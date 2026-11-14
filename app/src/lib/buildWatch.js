// One build watcher for the page, shared by every mount of the update toast.
//
// RouteErrorBoundary keys on pathname when no pop-out is open, which remounts Layout (and the toast
// leaf) on every navigation. A watcher owned by the leaf was therefore recreated each time, its
// 5-minute interval and 2-poll streak reset, and a member who keeps moving between pages might never
// see the toast. The watcher lives here; the leaf only holds a reference count. The stop on the last
// release is delayed so a remount (release then acquire in the same commit) keeps the same watcher.
import { getClientBuildId, createBuildWatcher, fetchBuildSafe } from './buildVersion'
import { announceNewBuild, clearNewBuild } from './reloadGuard'

const STOP_GRACE_MS = 2000
let refs = 0
let watcher = null
let stopTimer = null

// The default source is the frontend's own identity (/build.json), with /api/health as its fallback.
export function acquireBuildWatch({ fetchHealth = fetchBuildSafe, intervalMs } = {}) {
  refs += 1
  if (stopTimer) { clearTimeout(stopTimer); stopTimer = null }
  if (!watcher) {
    watcher = createBuildWatcher({
      fetchHealth,
      clientId: getClientBuildId(document),
      onNewBuild: announceNewBuild,
      onBuildCleared: clearNewBuild,
      ...(intervalMs ? { intervalMs } : {}),
    })
  }
  let released = false
  return () => {
    if (released) return
    released = true
    refs -= 1
    if (refs > 0 || stopTimer) return
    stopTimer = setTimeout(() => {
      stopTimer = null
      if (refs === 0 && watcher) { watcher.stop(); watcher = null }
    }, STOP_GRACE_MS)
  }
}

/** Tests only. */
export function __resetBuildWatchForTests() {
  if (stopTimer) clearTimeout(stopTimer)
  stopTimer = null
  if (watcher) watcher.stop()
  watcher = null
  refs = 0
}
