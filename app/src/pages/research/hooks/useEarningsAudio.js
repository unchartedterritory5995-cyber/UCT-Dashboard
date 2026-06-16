import useMobileSWR from '../../../hooks/useMobileSWR'

const fetcher = (url) => fetch(url).then(r => (r.ok ? r.json() : null)).catch(() => null)

export default function useEarningsAudio(rawSym) {
  const sym = (rawSym || '').toUpperCase().trim()
  const { data } = useMobileSWR(sym ? `/api/earnings/audio/${sym}` : null, fetcher)
  return { data: data || null }
}
