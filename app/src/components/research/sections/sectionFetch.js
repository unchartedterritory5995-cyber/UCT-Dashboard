// app/src/components/research/sections/sectionFetch.js
//
// The modal's section fetcher. Its ONE job is to keep "the request failed"
// distinguishable from "the server answered, and the answer is empty".
//
// Every section fetcher in this tree used to be:
//
//     fetch(u).then(r => (r.ok ? r.json() : null)).catch(() => null)
//
// which collapses a 502, a dropped connection, a redeploy and a genuinely
// quiet ticker into the same `null`. NewsSection reads that `null` and renders
// "No recent news for this ticker." — a confident, WRONG factual claim. It was
// reported against NVDA on 2026-08-23 while `/api/research/news/NVDA` was
// returning 15KB of headlines in 260ms; the pod had restarted mid-request, and
// the modal said the story was that there was no news.
//
// SWR already models this correctly: a fetcher that THROWS populates `error`
// and leaves `data` undefined. `EmptyState` has shipped an `onRetry` button
// for this exact case since the kit was written (§4.4 — "a failed section
// renders with a retry link rather than a blank canvas") and nothing could
// ever reach it, because no fetcher in this tree ever threw. This is the wire.
//
// 402 stays a STATE, not a failure: the paid-gated endpoints answer it to mean
// "requires a paid plan", which the section renders as copy. Sections whose
// endpoints never 402 are unaffected by carrying the branch.

export class SectionFetchError extends Error {
  constructor(message, { status = null, url = null } = {}) {
    super(message)
    this.name = 'SectionFetchError'
    this.status = status
    this.url = url
  }
}

// A request that never answers must END. Without a deadline SWR sits in its loading state for
// as long as the socket stays open, so a hung pod renders an endless "Loading..." with no way
// out (terminal quality pass 2026-10-05). The same 30 s as the house pattern
// (useResearchFlow.js FLOW_TIMEOUT_MS). Promise.race rather than an AbortSignal so the fetch
// call keeps its one-argument shape (tests across the tree assert `fetch(url)` exactly).
export const SECTION_TIMEOUT_MS = 30000

export class SectionTimeoutError extends Error {
  constructor(url, ms) {
    super(`Timed out after ${Math.round(ms / 1000)}s`)
    this.name = 'SectionTimeoutError'
    this.timedOut = true
    this.url = url
  }
}

/** Resolve `promise`, or reject with SectionTimeoutError once `ms` passes. The timer is
 *  always cleared, so nothing lingers after the answer. */
export function withDeadline(promise, url, ms = SECTION_TIMEOUT_MS) {
  let timer
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new SectionTimeoutError(url, ms)), ms)
  })
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer))
}

/** SWR fetcher: resolves with the payload, or THROWS so `error` is populated. */
export function sectionFetcher(url) {
  return withDeadline(sectionFetchOnce(url), url)
}

async function sectionFetchOnce(url) {
  let res
  try {
    res = await fetch(url)
  } catch (cause) {
    // Network-level: offline, DNS, connection reset, pod mid-restart.
    throw new SectionFetchError(`Network request failed: ${cause?.message || cause}`, { url })
  }
  // Paid gate — a state the section renders, not an error it retries.
  if (res.status === 402) return { paywalled: true }
  if (!res.ok) {
    throw new SectionFetchError(`Request failed (${res.status})`, { status: res.status, url })
  }
  try {
    return await res.json()
  } catch (cause) {
    // A 200 whose body is not JSON is a failure, never an empty result — this
    // is what an HTML error page or a truncated response looks like.
    throw new SectionFetchError(`Malformed response: ${cause?.message || cause}`, {
      status: res.status, url,
    })
  }
}

/** Copy for a failed section. Kept here so all three read identically. */
export const FETCH_FAILED = {
  icon: 'warning',
  title: 'Could not load this section',
  hint: 'The request failed — this is not a statement about the company.',
}
