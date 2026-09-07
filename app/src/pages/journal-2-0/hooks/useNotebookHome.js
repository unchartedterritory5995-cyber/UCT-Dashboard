/** Wave H — Research Home's one aggregated read (checkpoint decision 14). */
import useSWR from 'swr'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json()
  })

const EMPTY = { continueWorking: [], favorites: [], activeTheses: [], openPositionResearch: [], needsReview: [] }

export default function useNotebookHome() {
  const { data, error, isLoading, mutate } = useSWR('/api/j2/notebook/home', fetcher, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  })
  return {
    home: data || EMPTY,
    isLoading,
    error,
    refresh: () => mutate(),
  }
}
