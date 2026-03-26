// app/src/hooks/useSWRWithRetry.js
import useMobileSWR from './useMobileSWR'

const fetcher = url => fetch(url).then(r => r.json())

/**
 * Thin wrapper around useMobileSWR that exposes a `retry` function.
 * Wire `retry` directly to <ErrorState onRetry={retry} />.
 */
export default function useSWRWithRetry(key, options = {}) {
  const { data, error, isLoading, mutate } = useMobileSWR(key, fetcher, options)

  return {
    data,
    error,
    isLoading,
    retry: () => mutate(),
  }
}
