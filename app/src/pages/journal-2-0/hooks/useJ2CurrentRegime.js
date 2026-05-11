/**
 * SWR hook: current UCT regime classification (Phase D).
 * 5-minute refresh — regime updates infrequently (engine push runs daily).
 */

import useSWR from 'swr'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json()
  })

export default function useJ2CurrentRegime() {
  const { data, error, isLoading } = useSWR('/api/j2/regime', fetcher, {
    refreshInterval: 300_000,
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  })
  return { regime: data, isLoading, error }
}
