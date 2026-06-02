// app/src/hooks/useSeen.js
// SWR hook for GET /api/calendar/seen?item_type=<type>
// + helper to POST /api/calendar/seen to mark an item seen.
//
// Usage:
//   const { seen, markSeen } = useSeen('earnings')
//   seen.has('AAPL:2026-06-02')   // true/false
//   markSeen('AAPL:2026-06-02')   // optimistic update + POST
import useSWR, { useSWRConfig } from 'swr'

const fetcher = url =>
  fetch(url).then(r => (r.ok ? r.json() : { seen: [] })).catch(() => ({ seen: [] }))

/**
 * useSeen(itemType)
 *
 * @param {string} itemType — earnings | filing | ipo | recap | insight | news
 * @returns {{ seen: Set<string>, markSeen: (key: string) => void }}
 */
export default function useSeen(itemType) {
  const url = itemType ? `/api/calendar/seen?item_type=${encodeURIComponent(itemType)}` : null
  const { data, mutate } = useSWR(url, fetcher, {
    refreshInterval: 5 * 60 * 1000,
    revalidateOnFocus: false,
  })

  const seen = new Set(data?.seen ?? [])

  async function markSeen(key) {
    if (!itemType || !key || seen.has(key)) return
    // Optimistic update — immediately reflect in UI
    mutate({ seen: [...seen, key] }, false)
    try {
      await fetch('/api/calendar/seen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_type: itemType, item_key: key }),
      })
    } catch {
      // revalidate on error to restore server truth
      mutate()
    }
  }

  return { seen, markSeen }
}
