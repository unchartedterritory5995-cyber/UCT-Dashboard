import useSWR from 'swr'
import { sectionFetcher } from '../../components/research/sections/sectionFetch'

// One read for one dark options-analytics surface. Every such route answers 404 until its own
// switch is set, and 402 for a free session; both mean "render nothing", never an error box.
// A real failure (503, network) is `failed` and the caller says so in words.
// `off` is the 404 half of `hidden` on its own: the route exists but its switch is not set. The
// terminal's standalone panels read it (via OffNotice) to say so instead of opening blank.
// No polling: these surfaces revalidate on mount and on a key change only.
// `retry` re-asks the same read (SWR's mutate): every `failed` branch offers it as a Retry, so a
// member is never left with "unavailable right now" and no way to ask again.
export default function useDarkSection(url) {
  const { data, error, mutate } = useSWR(url || null, sectionFetcher, { revalidateOnFocus: false })
  const off = Boolean(url) && error?.status === 404
  const hidden = !url || off || Boolean(data?.paywalled)
  const paywalled = Boolean(data?.paywalled)
  return { data: hidden ? undefined : data, hidden, off, paywalled, failed: !hidden && Boolean(error), loading: !hidden && !error && !data, retry: () => mutate() }
}

/** Every one of `urls` answered 404 (each switch is off). Hook count is `urls.length`, so a call
 *  site must pass a fixed-length list. */
export function useAllOff(urls) {
  return useSectionsState(urls).allOff
}

/** The whole-panel state of a standalone options panel's reads: every one switched off, every
 *  one still loading (the panel would otherwise be a titled box with an empty body while its
 *  reads are in flight), or every one answering the paid gate (each section renders nothing on
 *  402, so the panel was blank). Same fixed-length rule as useAllOff. */
export function useSectionsState(urls) {
  const reads = []
  // eslint-disable-next-line react-hooks/rules-of-hooks -- fixed-length list per call site
  for (const u of urls) reads.push(useDarkSection(u))
  const any = reads.length > 0
  return {
    allOff: any && reads.every((r) => r.off),
    allLoading: any && reads.every((r) => r.loading),
    allPaywalled: any && reads.every((r) => r.paywalled),
  }
}
