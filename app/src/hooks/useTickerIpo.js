import { useMemo } from 'react'
import useSWR, { preload } from 'swr'

// Per-symbol IPO / first-listing date for the chart's first-bar "IPO" badge.
// The listing date is immutable, so we persist it to localStorage and seed SWR's
// fallbackData from it — the badge decision can be made on the very first frame
// for any previously-seen ticker instead of waiting on the network.

const NULL_IPO = Object.freeze({ list_date: null })
const LS_PREFIX = 'tipo:'
const LS_TTL = 30 * 24 * 60 * 60 * 1000 // 30 days (list_date never changes)

function lsGet(sym) {
  try {
    const raw = localStorage.getItem(LS_PREFIX + sym)
    if (!raw) return undefined
    const { t, d } = JSON.parse(raw)
    if (!t || Date.now() - t > LS_TTL || !d) return undefined
    return d
  } catch {
    return undefined
  }
}

function lsPut(sym, data) {
  // Only persist a REAL listing date — never cache a null miss (a cold/renamed
  // ticker that resolves later must not be pinned to "no IPO date").
  if (!sym || !data || !data.list_date) return
  try {
    localStorage.setItem(LS_PREFIX + sym, JSON.stringify({ t: Date.now(), d: data }))
  } catch {
    /* quota / private mode — non-fatal, badge just isn't pre-warmed */
  }
}

// A failure must be an ERROR (not cached null), so a transient backend miss
// self-heals on retry rather than sticking as "no IPO date" all session — same
// lesson as useTickerMeta.
export async function fetcher(url) {
  const r = await fetch(url, { credentials: 'include' })
  if (!r.ok) throw new Error(`ticker-ipo ${r.status}`)
  const j = await r.json()
  return { list_date: j?.list_date ?? null }
}

// Warm before a chart mounts (hover/selection), mirroring prefetchTickerMeta.
export function prefetchTickerIpo(sym) {
  if (!sym || lsGet(sym)) return
  preload(`/api/ticker-ipo/${encodeURIComponent(sym)}`, async (url) => {
    const d = await fetcher(url)
    lsPut(sym, d)
    return d
  })
}

export default function useTickerIpo(sym) {
  const fallbackData = useMemo(() => (sym ? lsGet(sym) : undefined), [sym])
  const { data } = useSWR(
    sym ? `/api/ticker-ipo/${encodeURIComponent(sym)}` : null,
    fetcher,
    {
      fallbackData,
      revalidateOnFocus: false,
      revalidateIfStale: true,     // a transient null-miss re-resolves on next view
      dedupingInterval: 60000,
      errorRetryCount: 4,
      errorRetryInterval: 4000,
      onSuccess: (d) => lsPut(sym, d),
    },
  )
  return data || NULL_IPO
}
