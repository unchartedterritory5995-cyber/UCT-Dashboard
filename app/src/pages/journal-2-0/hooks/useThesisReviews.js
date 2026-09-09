/** Wave O — one thesis's review history AND the deterministic what-changed
 * block, in ONE request.
 *
 * ⛔ BATCHED ON PURPOSE. Two round trips would let the history and the diff
 * disagree about which review is the anchor — the panel would show "since your
 * last review" measured from one review while listing another as the latest.
 * Same shape `useThesisSummary` already uses for evidence + changelog. */
import useSWR from 'swr'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json()
  })

export default function useThesisReviews(noteId) {
  const url = noteId ? `/api/j2/notes/${noteId}/reviews` : null
  const { data, error, isLoading, mutate } = useSWR(url, fetcher, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  })
  const reviews = data?.reviews ?? []
  return {
    reviews,
    // The one OPEN draft, if the member has work in progress.
    draft: reviews.find((r) => r.status === 'draft') || null,
    completed: reviews.filter((r) => r.status === 'completed'),
    attention: data?.attention ?? null,
    isLoading,
    error,
    refresh: () => mutate(),
  }
}
