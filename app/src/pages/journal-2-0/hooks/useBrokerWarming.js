import { useEffect, useRef } from 'react'
import useSWR, { useSWRConfig } from 'swr'

const fetcher = (u) => fetch(u, { credentials: 'include' }).then((r) => (r.ok ? r.json() : null))

/**
 * Polls broker status while any account is warming (post-connect backfill).
 * Returns { warming, broker, refresh }. On warming true→false, revalidates the
 * trades/positions/performance SWR keys so the journal fills in automatically.
 */
export default function useBrokerWarming() {
  const { mutate } = useSWRConfig()
  const wasWarming = useRef(false)
  const { data } = useSWR('/api/j2/broker/status', fetcher, { refreshInterval: 25000 })

  const accounts = data?.accounts || []
  const warmingAcct = accounts.find((a) => a.warming)
  const warming = Boolean(warmingAcct)
  const broker = warmingAcct?.brokerageName

  useEffect(() => {
    if (wasWarming.current && !warming) {
      // Backfill just settled — refresh everything the import populates.
      mutate((key) => typeof key === 'string' && (
        key.includes('/api/j2/positions') ||
        key.includes('/api/j2/trades') ||
        key.includes('/api/j2/broker/performance') ||
        key.includes('/api/j2/broker/equity-curve')
      ), undefined, { revalidate: true })
    }
    wasWarming.current = warming
  }, [warming, mutate])

  return { warming, broker, refresh: () => mutate('/api/j2/broker/status') }
}
