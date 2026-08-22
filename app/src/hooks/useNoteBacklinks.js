/** "Which of my journal entries reference this ticker?"
 *
 * Reads the j2_note_embeds sidecar through `GET /api/j2/notes/backlinks`.
 * The sidecar has been written on every note save since Journal Widgets v1
 * and, until this hook, was read by exactly one consumer (the notes-list
 * filter) — so the app could not see its own journal.
 *
 * ⛔ `enabled` is not a nicety: the biggest consumer is TickerPopup, which
 * HOVERS constantly across the app. Fetching on hover would fire a request
 * per mouse-over of every ticker chip on screen. Callers pass enabled=true
 * only once a surface is actually OPEN.
 */
import useSWR from 'swr'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => (r.ok ? r.json() : { count: 0, notes: [] }))

export default function useNoteBacklinks(symbol, enabled = false) {
  const sym = String(symbol || '').trim().toUpperCase()
  const key = enabled && sym ? `/api/j2/notes/backlinks?symbol=${encodeURIComponent(sym)}` : null
  const { data, isLoading } = useSWR(key, fetcher, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
    dedupingInterval: 30000,
  })
  return {
    count: data?.count ?? 0,
    notes: data?.notes ?? [],
    isLoading: !!key && isLoading,
  }
}

/** Deep link to one entry — the MODERN notebook route (Notebook is its own
 *  top-level Journal tab; the legacy `?j2tab=notebook` and `/journal/journal`
 *  forms only survive through redirect shims). */
export function notePath(noteId) {
  return `/journal/notebook?note=${encodeURIComponent(noteId)}`
}
