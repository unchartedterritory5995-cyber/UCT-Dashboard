// app/src/hooks/useTranscript.js
// SWR hook: GET /api/earnings/transcript/{ticker}?quarter=
//
// Lazy by design — pass `enabled` to control whether the fetch fires.
// When enabled is false, no request is made (respects AV 25 req/day quota).
//
// Returns { data, isLoading, error } where data is:
//   {symbol, quarter, segments: [{speaker, title, content, sentiment}], resolved}
//   or null when unavailable.
import useSWR from 'swr'

const fetcher = url => fetch(url, { credentials: 'include' })
  .then(r => r.ok ? r.json() : null)
  .catch(() => null)

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
    fetcher,
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
