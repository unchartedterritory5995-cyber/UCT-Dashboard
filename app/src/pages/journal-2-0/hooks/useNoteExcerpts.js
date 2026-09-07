/** Wave J — one note's saved document excerpts (batched: one request per
 * note-open, not one per excerpt -- mirrors useNoteFacts.js exactly, same
 * SWR cache-key dedup collapsing every `documentExcerpt` node's lookup into
 * ONE network request). */
import useSWR from 'swr'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json()
  })

export default function useNoteExcerpts(noteId) {
  const url = noteId ? `/api/j2/notes/${noteId}/excerpts` : null
  const { data, error, isLoading, mutate } = useSWR(url, fetcher, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  })
  return {
    excerpts: data?.excerpts ?? [],
    isLoading,
    error,
    refresh: () => mutate(),
  }
}
