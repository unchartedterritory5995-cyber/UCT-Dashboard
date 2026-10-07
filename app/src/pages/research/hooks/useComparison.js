import useMobileSWR from '../../../hooks/useMobileSWR'
import { sectionFetcher } from '../../../components/research/sections/sectionFetch'

// TERM-033: a failed read THROWS (sectionFetcher: non-2xx, network, deadline, one warm retry)
// and comes back as `error`. It used to resolve `null`, and the compare page then drew both
// columns as dashes: a failed request dressed up as two companies with no data.
export default function useComparison(rawSymA, rawSymB) {
  const symA = (rawSymA || '').toUpperCase().trim()
  const symB = (rawSymB || '').toUpperCase().trim()
  const key = (symA && symB) ? `/api/research/compare/${symA}/${symB}` : null
  const { data, error, isLoading, mutate } = useMobileSWR(key, sectionFetcher)
  return {
    data: data || null,
    isLoading: Boolean(isLoading && !data && !error),
    error: data ? null : (error || null),
    retry: () => mutate(),
  }
}
