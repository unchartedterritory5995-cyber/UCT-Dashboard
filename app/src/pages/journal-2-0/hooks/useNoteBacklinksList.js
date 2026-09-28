/** Wave D — "which of my other notes link TO this one?" for the note-scoped
 * backlinks footer section (distinct from `useNoteBacklinks.js`, which is
 * the older TICKER-scoped reverse index used elsewhere in the app). */
import useSWR from 'swr'

// ⛔ Wave 10 F7 (Part A, 5d): a failed read THROWS. It used to answer an empty list on any
// non-OK status, so a 500 read as "nothing links here" -- a statement, not a failure.
const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(String(r.status))
    return r.json()
  })

export default function useNoteBacklinksList(noteId, { enabled = true } = {}) {
  const key = noteId && enabled ? `/api/j2/notes/${noteId}/backlinks` : null
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
