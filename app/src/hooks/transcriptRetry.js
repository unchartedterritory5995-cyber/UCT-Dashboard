// app/src/hooks/transcriptRetry.js
//
// Kept out of useTranscript.js on purpose: several suites vi.mock('hooks/useTranscript') with a
// default export only, and a named export there would be missing from those mocks.
/**
 * Wave 4: the transcript route answers 503 + `Retry-After` while its bounded provider fetch is
 * still running server-side (api/services/bounded_flight.py; wave 2, fb5641e7a). That is "still
 * fetching", not a failure: true for an error the panel should word as pending.
 */
export function isTranscriptPending(err) {
  return Boolean(err) && err.status === 503 && err.retryAfter != null
}

/** Re-asks honour the server's `Retry-After` (1-60 s), up to this many times. */
export const PENDING_MAX_RETRIES = 15

/**
 * SWR error retry: a pending 503 is re-asked after `Retry-After`; any other failure keeps a
 * bounded exponential backoff (5 s, 10 s, ... capped at 60 s, five tries), as before.
 */
export function transcriptOnErrorRetry(err, _key, _config, revalidate, { retryCount }) {
  if (err?.status === 402 || err?.status === 404) return
  if (isTranscriptPending(err)) {
    if (retryCount > PENDING_MAX_RETRIES) return
    const secs = Math.min(Math.max(Number(err.retryAfter) || 0, 1), 60)
    setTimeout(() => revalidate({ retryCount }), secs * 1000)
    return
  }
  if (retryCount > 5) return
  setTimeout(() => revalidate({ retryCount }), Math.min(5000 * 2 ** (retryCount - 1), 60000))
}
