import useMobileSWR from '../../../hooks/useMobileSWR'

const fetcher = (url) => fetch(url).then(r => (r.ok ? r.json() : null)).catch(() => null)

export default function useCallRecap(rawSym) {
  const sym = (rawSym || '').toUpperCase().trim()
  const { data, isLoading } = useMobileSWR(sym ? `/api/earnings/call-recap/${sym}` : null, fetcher)
  return { data: data || null, isLoading: isLoading && !data }
}
