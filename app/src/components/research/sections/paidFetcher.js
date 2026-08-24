// app/src/components/research/sections/paidFetcher.js
//
// Shared by the Profile and Catalysts sections, whose endpoints are paid-gated
// server-side. A 402 is a STATE here, not a failure: the section must say
// "requires a paid plan" rather than "unavailable right now".
//
// Delegates to `sectionFetch.sectionFetcher` rather than keeping its own copy
// of the 402 rule — a second authority over one value is this repo's most
// repeated defect. That fetcher throws on a real failure so SWR populates
// `error`; this file used to `.catch(() => null)`, which left a failed request
// indistinguishable from a payload with no content, and both sections then sat
// on their loading skeleton forever.
export { sectionFetcher as paidFetcher, SectionFetchError, FETCH_FAILED } from './sectionFetch'

// Both endpoints answer `status: "generating"` while their generate-once AI
// text is being written in the background. The poll is driven by a NUMERIC
// interval flipped from state in an effect (the ProfileWidget pattern) —
// SWR's function-form refreshInterval is read once in its mount effect, when a
// cold key has no data yet, so a poll that has to START from a settled payload
// never starts.
//
// This used to be "~half a minute for an uncovered name". Since 2026-08-23 the
// warm covers every reporter on the visible board and the two 5000-bar fetches
// that dominated these endpoints are right-sized, so `generating` should be
// rare and short — see api/services/earnings_preview_warm.py.
export const GENERATING_POLL_MS = 3000
