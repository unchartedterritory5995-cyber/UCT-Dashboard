/** Wave H — the Ticker Research Workspace's one aggregated read (checkpoint
 * decision 15). */
import useSWR from 'swr'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json()
  })

export default function useTickerResearch(symbol) {
  const url = symbol ? `/api/j2/notes/research/${encodeURIComponent(symbol)}/summary` : null
  const { data, error, isLoading, mutate } = useSWR(url, fetcher, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  })
  return {
    summary: data || null,
    isLoading,
    error,
    refresh: () => mutate(),
  }
}
