import useSWR from 'swr'

const fetcher = url => fetch(url).then(r => (r.ok ? r.json() : { ok: false, rows: [] }))

// The Confluence board is server-cached (30-min recompute + boot warm), so the
// client just polls it lightly. A cold cache returns {ok:false, status:'warming'}.
export default function useConfluence() {
  return useSWR('/api/confluence', fetcher, {
    refreshInterval: 120000,
    revalidateOnFocus: false,
    keepPreviousData: true,
  })
}
