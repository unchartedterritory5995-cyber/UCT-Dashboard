import useMobileSWR from '../../../hooks/useMobileSWR'

const fetcher = (url) => fetch(url).then(r => (r.ok ? r.json() : null)).catch(() => null)

export default function useComparison(rawSymA, rawSymB) {
  const symA = (rawSymA || '').toUpperCase().trim()
  const symB = (rawSymB || '').toUpperCase().trim()
  const key = (symA && symB) ? `/api/research/compare/${symA}/${symB}` : null
  const { data, isLoading } = useMobileSWR(key, fetcher)
  return { data: data || null, isLoading: isLoading && !data }
}
