import useSWR from 'swr'

const fetcher = url => fetch(url).then(r => (r.ok ? r.json() : { rows: [] }))

export default function useCatalysts({ refreshIntervalMs = 30000 } = {}) {
  return useSWR('/api/catalysts/today', fetcher, {
    refreshInterval: refreshIntervalMs,
    revalidateOnFocus: true,
  })
}
