// app/src/hooks/useTimedTranscript.js
// GET /api/earnings/timed-transcript/{ticker}
//
// Returns speaker turns whose words carry start times, plus the URL of OUR
// audio proxy. Most symbols are not covered and answer {available:false} — the
// caller renders the plain transcript in that case, so this is purely additive.
import useSWR from 'swr'

const fetcher = url => fetch(url).then(r => (r.ok ? r.json() : null)).catch(() => null)

export default function useTimedTranscript(ticker) {
  return useSWR(
    ticker ? `/api/earnings/timed-transcript/${ticker}` : null,
    fetcher,
    {
      // A published call is immutable and coverage does not change while the
      // tab is open, so never re-poll this.
      revalidateOnFocus: false,
      revalidateIfStale: false,
      shouldRetryOnError: false,
    },
  )
}

/**
 * Index of every word's absolute start time, flattened across turns.
 *
 * Built once per transcript so the player can binary-search it on each
 * timeupdate rather than scanning ~6,000 words 4x a second.
 */
export function buildWordIndex(segments) {
  const starts = []
  const keys = []
  ;(segments || []).forEach((seg, si) => {
    ;(seg.starts || []).forEach((t, wi) => {
      starts.push(t)
      keys.push(`${si}:${wi}`)
    })
  })
  return { starts, keys }
}

/** Index of the last word starting at or before `t`, or -1. Binary search. */
export function wordAt(starts, t) {
  if (!starts || !starts.length || !(t >= starts[0])) return -1
  let lo = 0
  let hi = starts.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (starts[mid] <= t) {
      ans = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return ans
}
