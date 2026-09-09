/** Wave O6 — lexical search over the member's completed thesis reviews.
 *
 * ⚰️ Search could find everything the member had READ and nothing they had
 * CONCLUDED. This is the fourth hook alongside note search (useJ2Notes), page
 * search (useDocumentSearch) and excerpt search (useExcerptSearch), and it is
 * deliberately NOT blended into any of them — the backend keeps reviews in
 * their own query for the same reason (see review_search.py), and a caller
 * wanting "search everything" runs them all and SECTIONS the results rather
 * than inventing a score that can rank a member's conclusion against a PDF
 * page it was drawn from. */
import useSWR from 'swr'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json()
  })

export default function useReviewSearch(query, { enabled = true } = {}) {
  const q = (query || '').trim()
  const url = enabled && q ? `/api/j2/reviews/search?q=${encodeURIComponent(q)}` : null
  const { data, error, isLoading } = useSWR(url, fetcher, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  })
  return {
    results: data?.results || [],
    isLoading: enabled && Boolean(q) && isLoading,
    error,
  }
}
