import useMobileSWR from '../../../hooks/useMobileSWR'

const fetcher = (url) => fetch(url).then(r => (r.ok ? r.json() : null)).catch(() => null)

// Packet H CP1: every curated Model Book appearance for this ticker, across
// all years -- keyed off the SETTLED symbol, same convention as every other
// tab's hook on this page.
export default function useModelBookAppearances(rawSym) {
  const sym = (rawSym || '').toUpperCase().trim()
  const { data, isLoading } = useMobileSWR(sym ? `/api/modelbook/appearances/${sym}` : null, fetcher)
  return { data: data || null, isLoading: isLoading && !data }
}
