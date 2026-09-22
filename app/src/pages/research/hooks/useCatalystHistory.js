import useMobileSWR from '../../../hooks/useMobileSWR'

const fetcher = (url) => fetch(url).then(r => (r.ok ? r.json() : null)).catch(() => null)

// Packet G CP1: every catalyst entry UCT's engine has ever recorded for this
// ticker, across all dates -- keyed off the SETTLED symbol, same convention
// as every other tab's hook on this page.
export default function useCatalystHistory(rawSym) {
  const sym = (rawSym || '').toUpperCase().trim()
  const { data, isLoading } = useMobileSWR(sym ? `/api/catalysts/history/${sym}` : null, fetcher)
  return { data: data || null, isLoading: isLoading && !data }
}
