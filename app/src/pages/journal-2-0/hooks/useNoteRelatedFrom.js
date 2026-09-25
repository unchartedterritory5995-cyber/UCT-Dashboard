/**
 * Wave 6 (lane E, item 5) — "Related from": the member's notes whose RELATION
 * property holds this note (`GET /api/j2/notes/{id}/related-from`). The same
 * shape and failure rule as `useNoteBacklinksList`: a failure reads as nothing,
 * because this list is secondary and must never block the note.
 */
import useSWR from 'swr'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => (r.ok ? r.json() : { count: 0, notes: [] }))

export default function useNoteRelatedFrom(noteId, { enabled = true } = {}) {
  const key = noteId && enabled ? `/api/j2/notes/${encodeURIComponent(noteId)}/related-from` : null
  const { data, isLoading, error } = useSWR(key, fetcher, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  })
  return {
    count: data?.count ?? 0,
    notes: data?.notes ?? [],
    isLoading: !!key && isLoading,
    error,
  }
}
