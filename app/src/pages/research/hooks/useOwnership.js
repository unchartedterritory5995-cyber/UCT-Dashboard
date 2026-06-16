import useMobileSWR from '../../../hooks/useMobileSWR'

const fetcher = (url) => fetch(url).then(r => (r.ok ? r.json() : null)).catch(() => null)

export default function useOwnership(rawSym) {
  const sym = (rawSym || '').toUpperCase().trim()
  const { data, isLoading } = useMobileSWR(sym ? `/api/research/ownership/${sym}` : null, fetcher)
  return { data: data || null, isLoading: isLoading && !data }
}
