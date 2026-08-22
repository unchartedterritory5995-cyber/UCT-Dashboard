import useSWR from 'swr'

const fetcher = url => fetch(url).then(r => r.json())

// The single owner of this literal — other modules (useUserDefinitions'
// K3 revalidation, its rail test) import META_KEY from here rather than
// retyping the string, so a drift can't silently split invalidation from
// the key this hook actually reads.
export const META_KEY = '/api/screener/meta'

// Filter registry + views + categories. Changes ~nightly, so dedupe hard.
export default function useScreenerMeta() {
  const { data, isLoading } = useSWR(META_KEY, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 6 * 3600 * 1000,
  })
  return { meta: data, isLoading }
}
