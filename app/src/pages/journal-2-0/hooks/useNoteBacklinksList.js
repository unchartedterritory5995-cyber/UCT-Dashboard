/** Wave D — "which of my other notes link TO this one?" for the note-scoped
 * backlinks footer section (distinct from `useNoteBacklinks.js`, which is
 * the older TICKER-scoped reverse index used elsewhere in the app). */
import useSWR from 'swr'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => (r.ok ? r.json() : { count: 0, notes: [] }))

export default function useNoteBacklinksList(noteId, { enabled = true } = {}) {
  const key = noteId && enabled ? `/api/j2/notes/${noteId}/backlinks` : null
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
