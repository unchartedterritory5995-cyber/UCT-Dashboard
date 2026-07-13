import useSWR from 'swr'

const fetcher = url => fetch(url).then(r => (r.ok ? r.json() : { rows: [] }))

// `date` (YYYY-MM-DD) loads a past snapshot via /api/catalysts/by-date/{ymd}
// instead of the live /today feed. Historical loads don't poll or revalidate.
export default function useCatalysts({ refreshIntervalMs = 30000, date = null } = {}) {
  const live = !date
  const url = live ? '/api/catalysts/today' : `/api/catalysts/by-date/${date}`
  return useSWR(url, fetcher, {
    refreshInterval: live ? refreshIntervalMs : 0,
    revalidateOnFocus: live,
  })
}
