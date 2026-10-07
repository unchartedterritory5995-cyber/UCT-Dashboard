import useSWR from 'swr'
import { withDeadline } from '../../../utils/withDeadline'

// THROWS on a failed request (quality pass 2026-10-05). It used to `r.json()` whatever came
// back, so a 500's `{detail}` body became `meta`, the filter rail rendered with no filters, and
// nothing said the registry had failed to load.
const fetcher = (url) => withDeadline(fetch(url), url).then((r) => {
  if (!r.ok) throw new Error(`screener meta ${r.status}`)
  return r.json()
})

// The single owner of this literal — other modules (useUserDefinitions'
// K3 revalidation, its rail test) import META_KEY from here rather than
// retyping the string, so a drift can't silently split invalidation from
// the key this hook actually reads.
export const META_KEY = '/api/screener/meta'

// Filter registry + views + categories. Changes ~nightly, so dedupe hard.
export default function useScreenerMeta() {
  const { data, isLoading, error, mutate } = useSWR(META_KEY, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 6 * 3600 * 1000,
  })
  return { meta: data, isLoading, error, retry: () => mutate() }
}
