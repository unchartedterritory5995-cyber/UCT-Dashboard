// The research snapshot's ONE key and ONE fetcher (the glanceable card, and the chart header's
// rating, market cap and next earnings). `useFundamentalSnapshot` asks under this key with this
// fetcher; the chart header also has the rows a member is about to reach asked for ahead under
// the same two (`components/chart/pane/useHeaderSnapshot.js`), so a warm can never land under a
// key, or in a shape, the hook would not have produced itself.
import { sectionFetcher } from '../components/research/sections/sectionFetch'

export const snapshotKey = (rawSym) => {
  const sym = (rawSym || '').toUpperCase().trim()
  return sym ? `/api/research/snapshot/${sym}` : null
}

// TERM-033: a failed read THROWS (sectionFetcher), so a failed 5-min refresh keeps the card
// on screen instead of replacing it with `null`. 402 stays absent, as before.
export const snapshotFetcher = (url) => sectionFetcher(url).then((d) => (d?.paywalled ? null : d))
