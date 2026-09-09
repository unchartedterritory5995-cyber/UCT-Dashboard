/** Wave F — one note's resolved financial facts (batched: one request per
 * note-open, not one per fact — every `FinancialFactView` node in the same
 * note calls this same hook, and SWR's own cache-key dedup collapses them
 * into ONE network request, the same "batched via a shared cache key" idiom
 * this codebase already uses for live-price polling). */
import useSWR from 'swr'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json()
  })

export default function useNoteFacts(noteId) {
  const url = noteId ? `/api/j2/notes/${noteId}/facts` : null
  const { data, error, isLoading, mutate } = useSWR(url, fetcher, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  })
  return {
    facts: data?.facts ?? [],
    isLoading,
    error,
    refresh: () => mutate(),
  }
}
