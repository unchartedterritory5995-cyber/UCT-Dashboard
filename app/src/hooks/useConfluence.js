import useSWR from 'swr'

const fetcher = url => fetch(url).then(r => (r.ok ? r.json() : { ok: false, rows: [] }))

// The Confluence board is server-cached per lookback window (default 30d is
// scheduler-warmed; other windows warm in the background on first request). A cold
// window returns {ok:false, status:'warming'} — poll faster until it lands, then
// settle to the light 2-min cadence.
export default function useConfluence(days = 30) {
  return useSWR(`/api/confluence?days=${days}`, fetcher, {
    refreshInterval: latest => (latest && latest.ok ? 120000 : 15000),
    revalidateOnFocus: false,
    keepPreviousData: true,
  })
}
