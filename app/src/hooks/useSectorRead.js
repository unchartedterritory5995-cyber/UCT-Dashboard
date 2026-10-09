// app/src/hooks/useSectorRead.js
// Peer read-through — one AI sentence on the selected sector's earnings setup.
// GET /api/calendar/sector-read?sector=&week= returns:
//   { status: 'ready', line, ... } | { status: 'generating' } | { status: 'unavailable' }
// Polls every 3s WHILE generating, then stops (the backend caches the result).
import { useRef } from 'react'
import useSWR from 'swr'
import { withDeadline } from '../utils/withDeadline'

/** How long a 'generating' answer is re-asked before the line says it is not available (wave 9:
 *  the poll had no cap, and an unavailable answer left "Reading the tape…" up forever). */
export const SECTOR_READ_POLL_CAP_MS = 2 * 60 * 1000

const fetcher = url =>
  withDeadline(fetch(url, { credentials: 'include' }), url)
    .then(r => (r.ok ? r.json() : { status: 'unavailable' }))
    .catch(() => ({ status: 'unavailable' }))

/**
 * useSectorRead(sector, weekMonday)
 * @param {string|null} sector — GICS sector, or null when nothing is scoped
 * @param {string|null} weekMonday — ISO Monday of the viewed week
 * @returns {{ line: string|null, generating: boolean }}
 */
export default function useSectorRead(sector, weekMonday) {
  const url = sector
    ? `/api/calendar/sector-read?sector=${encodeURIComponent(sector)}${weekMonday ? `&week=${weekMonday}` : ''}`
    : null

  // When this url was first asked: the poll stops SECTOR_READ_POLL_CAP_MS later.
  const since = useRef({ url: null, at: 0 })
  if (since.current.url !== url) since.current = { url, at: Date.now() }
  const expired = () => Date.now() - since.current.at > SECTOR_READ_POLL_CAP_MS

  const { data } = useSWR(url, fetcher, {
    revalidateOnFocus: false,
    // Poll only while the server is still generating, and not past the cap; ready/unavailable stop.
    refreshInterval: d => (d?.status === 'generating' && !expired() ? 3000 : 0),
  })

  const generating = data?.status === 'generating'
  return {
    line: data?.status === 'ready' ? (data.line || null) : null,
    generating,
    // Nothing more is coming: the server said unavailable (or failed), or it is still generating
    // past the cap. The header says so instead of "Reading…" forever.
    unavailable: data?.status === 'unavailable' || (data?.status === 'ready' && !data.line) || (generating && expired()),
  }
}
