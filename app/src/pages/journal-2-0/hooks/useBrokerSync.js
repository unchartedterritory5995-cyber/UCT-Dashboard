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
    ;(async () => {
      try {
        const r = await fetch('/api/j2/broker/sync', { method: 'POST', credentials: 'include' })
        if (!r.ok || cancelled) return
        const data = await r.json().catch(() => null)
        // Only notify if at least one account actually synced (not all cooldown-skipped).
        const results = data?.results || {}
        const didSync = Object.values(results).some(
          (x) => x && typeof x === 'object' && x.skipped == null && x.error == null,
        )
        if (didSync && onSynced) onSynced()
      } catch {
        /* best-effort */
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
