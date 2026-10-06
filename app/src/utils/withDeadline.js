// app/src/utils/withDeadline.js
//
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

