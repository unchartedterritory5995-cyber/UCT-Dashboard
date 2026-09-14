/**
 * `useBreadthSeries(keys, from, to)` — the V2 read of the dark columnar endpoint.
 *
 * Talks to `GET /api/breadth-monitor/series` (B1, D-035). That endpoint is DARK:
 * `BREADTH_SERIES_ENDPOINT_ENABLED` is set on no service, so it answers 404 for every
 * caller class. This hook is therefore behind the V2 build flag and, today, reaches a
 * 404 by design — which is exactly why `error` is surfaced rather than smoothed into
 * an empty chart.
 *
 * ⛔ THE SPAN REFUSAL IS A PRODUCT DECISION, NOT AN ERROR PATH. A cold deep read of the
 * breadth history costs ~55 s on the single web process (D-042), so `/series` is capped
 * at `BREADTH_SERIES_MAX_SESSIONS` (365) sessions server-side. This hook declines to ASK
 * for a wider span rather than discovering the cap from a 400: a member should see
 * "range not yet available", not an error for a range the app already knows it cannot
 * serve. Two enforcement points, one rule — and they are allowed to disagree only in the
 * direction of the client being stricter (D-043).
 *
 * ⭐ `MAX_SESSIONS` is the ONE constant, and the refusal compares CALENDAR days to it
 * directly. That is deliberately tighter than the server (which allows 365 × 1.6 = 584
 * calendar days, since a year holds ~252 sessions): a second ratio on this side would be
 * a second authority over one bound, and the two would drift the first time either moved.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react'
import useSWR from 'swr'
import jsonFetcher from '../../../utils/jsonFetcher'

/** The server's own session cap (`_SERIES_DEFAULT_SESSIONS`), mirrored as the client bound. */
export const MAX_SESSIONS = 365

/** The server's `_SERIES_MAX_KEYS`. A 9th key is a 400 there; here it is simply not asked for. */
export const MAX_KEYS = 8

const DAY_MS = 24 * 60 * 60 * 1000

/** Calendar days INCLUSIVE of both ends, matching the server's `span_days`. */
export function spanDays(from, to) {
  if (!from || !to) return null
  const a = Date.parse(`${from}T00:00:00Z`)
  const b = Date.parse(`${to}T00:00:00Z`)
  if (Number.isNaN(a) || Number.isNaN(b)) return null
  return Math.floor((b - a) / DAY_MS) + 1
}

/**
 * Normalise a request: sort, dedupe and cap the keys; decide whether the span is askable.
 *
 * Pure, and exported, because the SWR key is derived from it — a cache key built from
 * the caller's array identity would refetch on every render, and one built from the
 * caller's ORDER would fetch the same window twice under two spellings.
 */
export function seriesRequest(keys, from, to) {
  const sorted = [...new Set((keys || []).filter(Boolean))].sort()
  const asked = sorted.slice(0, MAX_KEYS)
  const dropped = sorted.slice(MAX_KEYS)
  const span = spanDays(from, to)
  const tooWide = span !== null && span > MAX_SESSIONS
  const inverted = span !== null && span < 1
  const askable = asked.length > 0 && !!from && !!to && !tooWide && !inverted
  const query = new URLSearchParams({ keys: asked.join(','), from: from || '', to: to || '' })
  return {
    keys: asked,
    dropped,
    span,
    tooWide,
    inverted,
    askable,
    // The SWR key IS the url: same sorted keys + same window ⇒ same string ⇒ one fetch.
    url: askable ? `/api/breadth-monitor/series?${query.toString()}` : null,
  }
}

const EMPTY = Object.freeze([])

export default function useBreadthSeries(keys, from, to) {
  const req = useMemo(
    () => seriesRequest(keys, from, to),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the derived url IS the identity
    [Array.isArray(keys) ? [...new Set(keys)].sort().join(',') : '', from, to],
  )

  // ⛔ One in-flight request per hook instance. Changing the window while a deep read is
  // still running would otherwise leave the old one running to completion on a pod where
  // that read is the most expensive thing in the app.
  const abortRef = useRef(null)
  const fetcher = useCallback(async (url) => {
    abortRef.current?.abort()
    const ctl = new AbortController()
    abortRef.current = ctl
    return jsonFetcher(url, { signal: ctl.signal })
  }, [])
  useEffect(() => () => abortRef.current?.abort(), [])

  const { data, error, isLoading } = useSWR(req.url, fetcher, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,     // a dark endpoint 404s; retrying it is noise
  })

  // An abort is this hook cancelling itself, not a failure to report.
  const realError = error && error.name !== 'AbortError' ? error : null

  return {
    // ⭐ `missing` and `reconstructed` are PASSED THROUGH, never filtered out. A key the
    // row schema does not hold is a visible "not held" state; a reconstructed row is a
    // real reading with a provenance caveat. Dropping either would render an absence as
    // an ordinary gap, which is the one thing a breadth chart must not do.
    dates: data?.dates || EMPTY,
    series: data?.series || null,
    missing: data?.missing || EMPTY,
    reconstructed: data?.reconstructed || EMPTY,
    sessions: data?.sessions ?? null,
    keys: req.keys,
    dropped: req.dropped,
    span: req.span,
    tooWide: req.tooWide,
    maxSessions: MAX_SESSIONS,
    error: realError,
    isLoading: !!req.url && isLoading && !realError,
  }
}
