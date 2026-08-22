// app/src/components/research/sections/paidFetcher.js
//
// Shared by the Profile and Catalysts sections, whose endpoints are paid-gated
// server-side. A 402 is a STATE here, not a failure: the section must say
// "requires a paid plan" rather than "unavailable right now".
export const paidFetcher = (url) => fetch(url).then((r) => {
  if (r.status === 402) return { paywalled: true }
  return r.ok ? r.json() : null
}).catch(() => null)

// Both endpoints answer `status: "generating"` while their generate-once AI
// text is being written in the background (~half a minute for an uncovered
// name). The poll is driven by a NUMERIC interval flipped from state in an
// effect (the ProfileWidget pattern) — SWR's function-form refreshInterval is
// read once in its mount effect, when a cold key has no data yet, so a poll
// that has to START from a settled payload never starts.
export const GENERATING_POLL_MS = 3000
