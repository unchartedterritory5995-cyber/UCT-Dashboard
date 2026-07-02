import { useEffect, useRef } from 'react'

/**
 * Fire a single best-effort broker sync when Journal 2.0 mounts, so opening
 * the app reflects fresh broker trades. The server applies a per-account
 * cooldown (BROKER_SYNC_COOLDOWN_SEC) so this is cheap/no-op when recently
 * synced — and it 503s/403s harmlessly when broker sync is unconfigured or
 * the user isn't paid. `onSynced` (optional) is called after a sync that
 * actually ran, so the caller can refresh trade/position data.
 */
export default function useBrokerSync(onSynced) {
  const ran = useRef(false)
  useEffect(() => {
    if (ran.current) return
    ran.current = true
    let cancelled = false
    let refreshTimer = null
    ;(async () => {
      try {
        // background=1: the server kicks the SnapTrade sync off as a detached
        // task and returns immediately, so this open never waits on (or holds a
        // server worker for) the multi-second broker round-trip. The freshly
        // imported trades/positions land a few seconds later, so we schedule a
        // single refresh to pick them up. Explicit "Sync now" buttons stay
        // blocking (they surface the sync result directly).
        const r = await fetch('/api/j2/broker/sync?background=1', {
          method: 'POST', credentials: 'include',
        })
        if (!r.ok || cancelled) return
        if (onSynced) {
          refreshTimer = setTimeout(() => { if (!cancelled) onSynced() }, 8000)
        }
      } catch {
        /* best-effort */
      }
    })()
    return () => {
      cancelled = true
      if (refreshTimer) clearTimeout(refreshTimer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
