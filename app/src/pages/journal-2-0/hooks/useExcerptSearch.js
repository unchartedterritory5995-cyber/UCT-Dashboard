/** Wave J — lexical search over saved document excerpts (captured passage +
 * the member's own annotation). A THIRD hook alongside note search
 * (useJ2Notes) and page search (useDocumentSearch), deliberately NOT blended
 * into either: the backend keeps three separate FTS tables for the same
 * reason (see excerpt_search.py), and Wave I already established that a
 * caller wanting "search everything" runs them all and SECTIONS the results
 * rather than inventing a score that can rank a page against a passage. */
import useSWR from 'swr'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json()
  })

export default function useExcerptSearch(query, { enabled = true } = {}) {
  const q = (query || '').trim()
  const url = enabled && q ? `/api/j2/notes/excerpts/search?q=${encodeURIComponent(q)}` : null
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
