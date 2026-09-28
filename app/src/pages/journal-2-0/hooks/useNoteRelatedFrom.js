/**
 * Wave 6 (lane E, item 5) — "Related from": the member's notes whose RELATION
 * property holds this note (`GET /api/j2/notes/{id}/related-from`). The same
 * shape and failure rule as `useNoteBacklinksList`: a failure reads as nothing,
 * because this list is secondary and must never block the note.
 */
import useSWR from 'swr'

// ⛔ Wave 10 F7 (Part A, 5d): a failed read THROWS. It used to answer an empty list on any
// non-OK status, so a 500 read as "nothing links here" -- a statement, not a failure.
const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(String(r.status))
    return r.json()
  })

export default function useNoteRelatedFrom(noteId, { enabled = true } = {}) {
  const key = noteId && enabled ? `/api/j2/notes/${encodeURIComponent(noteId)}/related-from` : null
  const { data, isLoading, error, mutate } = useSWR(key, fetcher, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  })
  return {
    count: data?.count ?? 0,
    notes: data?.notes ?? [],
    isLoading: !!key && isLoading,
    error,
    refresh: () => mutate(),
  }
}
