/**
 * Journal 2.0 — `useSyncTrust`: the Sync Trust Center data layer (P3 Task B8).
 *
 * SWR over the three read endpoints the trust panel consumes, plus a
 * `reattachOrphan` POST that revalidates the affected reads on success:
 *   - GET  /api/j2/broker/trust        → { anyBroker, accounts:[…health+counts] }
 *   - GET  /api/j2/broker/sync-log      → { rows:[…audit rows] }
 *   - GET  /api/j2/trust/orphans        → { orphans:[…] }
 *   - POST /api/j2/trust/orphans/reattach { tradeRef, targetTradeId }
 *
 * All three are user-scoped + read-only server-side; empty/`anyBroker:false`
 * when the caller isn't broker-connected, so the hook is always safe to mount
 * (the component self-hides for manual accounts).
 *
 * ── Querystring (encode-once) ────────────────────────────────────────────────
 * The sync-log key is built with `URLSearchParams`, which encodes each value
 * EXACTLY ONCE — never hand-concatenate. `accountId` (a BROKER account id) is
 * optional; when omitted the log spans all the caller's broker connections
 * (the panel shows recent sync activity across the account).
 *
 * @param {string} [accountId] optional broker-account filter for the audit log.
 * @returns {{trust: object|null, syncLog: Array, orphans: Array,
 *   reattach: (tradeRef:string, targetTradeId:string)=>Promise<object>,
 *   isLoading: boolean}}
 */

import { useCallback, useMemo } from 'react'
import useSWR from 'swr'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json()
  })

const SWR_OPTS = { revalidateOnFocus: false, shouldRetryOnError: false }

export default function useSyncTrust(accountId) {
  const logKey = useMemo(() => {
    const params = new URLSearchParams()
    if (accountId) params.set('account_id', accountId)
    params.set('limit', '25')
    return `/api/j2/broker/sync-log?${params.toString()}`
  }, [accountId])

  const {
    data: trustData, isLoading: trustLoading, mutate: mutateTrust,
  } = useSWR('/api/j2/broker/trust', fetcher, SWR_OPTS)
  const {
    data: logData, isLoading: logLoading,
  } = useSWR(logKey, fetcher, SWR_OPTS)
  const {
    data: orphanData, isLoading: orphanLoading, mutate: mutateOrphans,
  } = useSWR('/api/j2/trust/orphans', fetcher, SWR_OPTS)

  const reattach = useCallback(async (tradeRef, targetTradeId) => {
    const res = await fetch('/api/j2/trust/orphans/reattach', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tradeRef, targetTradeId }),
    })
    if (!res.ok) {
      let msg = `${res.status}`
      try {
        const d = await res.json()
        if (d?.detail) msg = d.detail
      } catch {
        /* non-JSON error body — keep the status code */
      }
      throw new Error(msg)
    }
    const data = await res.json().catch(() => ({}))
    // Reattaching moves annotations off the orphan (and can shift the counts),
    // so revalidate the orphan queue + the per-account trust summary.
    await Promise.all([mutateOrphans(), mutateTrust()])
    return data
  }, [mutateOrphans, mutateTrust])

  return {
    trust: trustData || null,
    syncLog: logData?.rows || [],
    orphans: orphanData?.orphans || [],
    reattach,
    isLoading: trustLoading || logLoading || orphanLoading,
  }
}
