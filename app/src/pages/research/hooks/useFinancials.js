import useMobileSWR from '../../../hooks/useMobileSWR'

const fetcher = (url) => fetch(url).then(r => (r.ok ? r.json() : null)).catch(() => null)

export default function useFinancials(rawSym) {
  const sym = (rawSym || '').toUpperCase().trim()
  const { data, error, isLoading } = useMobileSWR(sym ? `/api/research/financials/${sym}` : null, fetcher)
  return { data: data || null, error, isLoading: isLoading && !data }
}
