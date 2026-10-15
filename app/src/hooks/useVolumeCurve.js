import useSWR from 'swr'

// The market-wide time-of-day volume curve + today's session window
// (GET /api/screener/volume-curve). One small payload shared by every chart; fetched only
// while a field that needs it is shown (pass enabled=false otherwise). A failed fetch
// throws, so SWR keeps `data` undefined and the header reads blank rather than a guess.
const fetchCurve = url => fetch(url).then(r => {
  if (!r.ok) throw new Error(`volume curve ${r.status}`)
  return r.json()
})

export default function useVolumeCurve(enabled = true) {
  const { data } = useSWR(enabled ? '/api/screener/volume-curve' : null, fetchCurve, {
    refreshInterval: 10 * 60 * 1000,
    dedupingInterval: 5 * 60 * 1000,
    revalidateOnFocus: false,
  })
  return data || null
}
