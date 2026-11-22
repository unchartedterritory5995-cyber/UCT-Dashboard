import useSWR from 'swr'
import jsonFetcher from '../../../../utils/jsonFetcher'
import { readingKey } from './readingModel'

// The reading for the open cell, fetched when the window opens and kept by SWR under the exact
// key `readingKey` writes (universe + metric + date, and the live value for today's cell). A
// stored session never changes, so it is not revalidated on focus.
export default function useReading(args) {
  const key = readingKey(args || {})
  const { data, error, isLoading } = useSWR(key, jsonFetcher, {
    revalidateOnFocus: false,
    revalidateIfStale: false,
    dedupingInterval: 5 * 60_000,
    shouldRetryOnError: false,
  })
  return { reading: data?.ok ? data : null, missing: data && !data.ok, error, loading: !!key && isLoading, key }
}
