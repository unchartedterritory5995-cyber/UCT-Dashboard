/** Wave G — one note's thesis evidence + changelog, batched in ONE request
 * (checkpoint decision 37, same "shared cache key dedup" idiom as
 * useNoteFacts) rather than the evidence panel and the changelog panel each
 * firing their own fetch. */
import useSWR from 'swr'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json()
  })

export default function useThesisSummary(noteId) {
  const url = noteId ? `/api/j2/notes/${noteId}/thesis-summary` : null
  const { data, error, isLoading, mutate } = useSWR(url, fetcher, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  })
  return {
    evidence: data?.evidence ?? [],
    changelog: data?.changelog ?? [],
    isLoading,
    error,
    refresh: () => mutate(),
  }
}
