import useSWR from 'swr'

const fetcher = url => fetch(url).then(r => r.json())

// Filter registry + views + categories. Changes ~nightly, so dedupe hard.
export default function useScreenerMeta() {
  const { data, isLoading } = useSWR('/api/screener/meta', fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 6 * 3600 * 1000,
  })
  return { meta: data, isLoading }
}
