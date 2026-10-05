import useSWR from 'swr'
import { sectionFetcher } from '../../components/research/sections/sectionFetch'

// One read for one dark options-analytics surface. Every such route answers 404 until its own
// switch is set, and 402 for a free session; both mean "render nothing", never an error box.
// A real failure (503, network) is `failed` and the caller says so in words.
// `off` is the 404 half of `hidden` on its own: the route exists but its switch is not set. The
// terminal's standalone panels read it (via OffNotice) to say so instead of opening blank.
// No polling: these surfaces revalidate on mount and on a key change only.
export default function useDarkSection(url) {
  const { data, error } = useSWR(url || null, sectionFetcher, { revalidateOnFocus: false })
  const off = Boolean(url) && error?.status === 404
  const hidden = !url || off || Boolean(data?.paywalled)
  return { data: hidden ? undefined : data, hidden, off, failed: !hidden && Boolean(error), loading: !hidden && !error && !data }
}

/** Every one of `urls` answered 404 (each switch is off). Hook count is `urls.length`, so a call
 *  site must pass a fixed-length list. */
export function useAllOff(urls) {
  const reads = []
  // eslint-disable-next-line react-hooks/rules-of-hooks -- fixed-length list per call site
  for (const u of urls) reads.push(useDarkSection(u))
  return reads.length > 0 && reads.every((r) => r.off)
}
