// app/src/hooks/useSectorRead.js
// Peer read-through — one AI sentence on the selected sector's earnings setup.
// GET /api/calendar/sector-read?sector=&week= returns:
//   { status: 'ready', line, ... } | { status: 'generating' } | { status: 'unavailable' }
// Polls every 3s WHILE generating, then stops (the backend caches the result).
import useSWR from 'swr'

const fetcher = url =>
  fetch(url, { credentials: 'include' })
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

  const { data } = useSWR(url, fetcher, {
    revalidateOnFocus: false,
    // Poll only while the server is still generating; ready/unavailable stop.
    refreshInterval: d => (d?.status === 'generating' ? 3000 : 0),
  })

  return {
    line: data?.status === 'ready' ? (data.line || null) : null,
    generating: data?.status === 'generating',
  }
}
