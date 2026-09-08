/** Wave I — page-aware PDF search. Deliberately a SEPARATE hook/query from
 * note search (useJ2Notes) -- never blended into one result list/score
 * (checkpoint decision, directive §39-42). */
import useSWR from 'swr'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json()
  })

export default function useDocumentSearch(query, { enabled = true } = {}) {
  const q = (query || '').trim()
  const url = enabled && q ? `/api/j2/notes/documents/search?q=${encodeURIComponent(q)}` : null
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
