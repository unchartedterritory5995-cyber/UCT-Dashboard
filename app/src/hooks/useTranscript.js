// app/src/hooks/useTranscript.js
// SWR hook: GET /api/earnings/transcript/{ticker}?quarter=
//
// Lazy by design — pass `enabled` to control whether the fetch fires.
// When enabled is false, no request is made (respects AV 25 req/day quota).
//
// Returns { data, isLoading, error } where data is:
//   {symbol, quarter, segments: [{speaker, title, content, sentiment}], resolved}
//   or null when the provider genuinely has none (the endpoint answers 200 null),
//   or { paywalled: true } on a 402.
// A FAILED request populates `error` and never arrives as `null` (TERM-033):
// this fetcher used to swallow it, and TranscriptPanel then told the member
// "Transcript not available." about a call that has one. Same-origin fetch
// already sends the session cookie, so dropping `credentials: 'include'` for
// the shared fetcher changes nothing on the wire.
import useSWR from 'swr'
import { sectionFetcher } from '../components/research/sections/sectionFetch'

/**
 * @param {string|null} ticker
 * @param {object} opts
 * @param {boolean} [opts.enabled=false]  Must be true to trigger a fetch.
 * @param {string|null} [opts.quarter]    e.g. "2025Q1"; omit for auto-resolve.
 */
export default function useTranscript(ticker, { enabled = false, quarter = null } = {}) {
  const sym = (ticker || '').toUpperCase().trim()
  const qs  = quarter ? `?quarter=${encodeURIComponent(quarter)}` : ''

  return useSWR(
    // Only fetch when enabled=true and ticker is non-empty
    enabled && sym ? `/api/earnings/transcript/${sym}${qs}` : null,
    sectionFetcher,
    {
      // Transcripts are static — no need to revalidate aggressively
      refreshInterval:   0,
      revalidateOnFocus: false,
      // Dedupe for the 24h cache window; avoids a second fetch if user
      // toggles the transcript panel open/close within the same session.
      dedupingInterval:  24 * 60 * 60 * 1000,
    },
  )
}
