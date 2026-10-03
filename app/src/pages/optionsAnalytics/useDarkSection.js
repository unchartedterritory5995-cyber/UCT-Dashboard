import useSWR from 'swr'
import { sectionFetcher } from '../../components/research/sections/sectionFetch'

// One read for one dark options-analytics surface. Every such route answers 404 until its own
// switch is set, and 402 for a free session; both mean "render nothing", never an error box.
// A real failure (503, network) is `failed` and the caller says so in words.
// No polling: these surfaces revalidate on mount and on a key change only.
export default function useDarkSection(url) {
  const { data, error } = useSWR(url || null, sectionFetcher, { revalidateOnFocus: false })
  const hidden = !url || error?.status === 404 || Boolean(data?.paywalled)
  return { data: hidden ? undefined : data, hidden, failed: !hidden && Boolean(error), loading: !hidden && !error && !data }
}
