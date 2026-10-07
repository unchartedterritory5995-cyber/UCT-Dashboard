/** Wave H — the Ticker Research Workspace's one aggregated read (checkpoint
 * decision 15). */
import useSWR from 'swr'
import { withDeadline } from '../../../utils/withDeadline'

// tq-panels (RSCH): the read had no deadline, so a request that never answered left the
// workspace (and the terminal's RSCH panel) on its skeleton forever. It now ends as a
// failed read (SectionTimeoutError, 30 s house rule), which the workspace already renders
// as LoadFailed with a Retry.
export const fetchTickerResearch = (url) =>
  withDeadline(fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json()
  }), url)

export default function useTickerResearch(symbol) {
  const url = symbol ? `/api/j2/notes/research/${encodeURIComponent(symbol)}/summary` : null
  const { data, error, isLoading, mutate } = useSWR(url, fetchTickerResearch, {
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
