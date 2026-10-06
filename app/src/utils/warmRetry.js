// app/src/utils/warmRetry.js
//
// A cold server is not a failed read. Seen live twice on 2026-10-06: right after every `web`
// deploy, the first open of the terminal's `TSM EE` panel rendered "Could not load this
// section". The pod was cold (the request needed past the 30 s deadline at boot, or the pod was
// mid-swap and answered 502); a minute later the same request answered in 0.6 s. The failure
// copy was a wrong statement about something that was about to work.
//
// So a TRANSIENT failure on the first attempt is asked again, once, after a short pause, and
// while that happens the panel can say "the server is warming up" (useWarming) instead of
// showing a failure that is about to disappear. Only when the retry fails too does the caller
// see the failure, and the panel's existing failure state with Retry renders as before.
//
// Transient = the request timed out (SectionTimeoutError), never reached the server (network),
// or the server answered 408 / 429 / 502 / 503 / 504. Every other answer is final at once: a 404
// is a 404 on every retry, a 402 is a state the panel renders, and a 500 is a real failure.

import { useCallback, useSyncExternalStore } from 'react'
import { withDeadline } from './withDeadline'

/** Pause before the automatic retry. One retry: bounded, so a dead server still ends in the
 *  failure state (worst case: deadline + pause + deadline). */
export const WARM_RETRY_DELAYS_MS = [4000]

export const TRANSIENT_STATUS = new Set([408, 429, 502, 503, 504])

export const isTransientStatus = (status) => TRANSIENT_STATUS.has(status)

/** True for a failure worth one more try: a deadline, a dropped connection, a cold/swapping pod. */
export function isTransientError(err) {
  if (!err) return false
  if (err.timedOut === true || err.network === true) return true
  return isTransientStatus(err.status)
}

// ── which URLs are being re-asked right now ───────────────────────────────────────────────────
// A count per URL (SWR dedupes, but two fetchers can still race on one key), and a version the
// React hook subscribes to.
const warming = new Map()
const listeners = new Set()

function setWarming(url, on) {
  const n = (warming.get(url) || 0) + (on ? 1 : -1)
  if (n > 0) warming.set(url, n)
  else warming.delete(url)
  listeners.forEach((fn) => fn())
}

export function isWarming(url) {
  return Boolean(url) && warming.has(url)
}

function subscribe(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** True while `url`'s first attempt failed transiently and the automatic retry is pending. */
export function useWarming(url) {
  const get = useCallback(() => isWarming(url), [url])
  return useSyncExternalStore(subscribe, get, get)
}

const pause = (ms) => new Promise((resolve) => { setTimeout(resolve, ms) })

// ⛔ TEST SEAM ONLY. src/test-setup.js sets `[]` before every test, so the suites written before
// this module keep pinning ONE attempt per read (a failure is a failure, a hung read ends at the
// deadline) without each learning about the pause. sectionFetch.warmRetry.test.jsx turns the
// production delays back on and pins the retry itself, end to end through a real panel.
// `null` = the production delays. Never called outside tests.
let testDelays = null
export function __setWarmRetryDelaysForTests(delays) {
  testDelays = delays
}

/**
 * Run `attempt()`; on a transient failure, wait and run it again, up to
 * `delays.length` more times. A non-transient failure, or the last attempt's failure, is thrown
 * unchanged. `url` names the request for useWarming.
 */
export async function withWarmRetry(attempt, url, { delays: given, sleep = pause } = {}) {
  const delays = given ?? testDelays ?? WARM_RETRY_DELAYS_MS
  let marked = false
  try {
    for (let i = 0; ; i += 1) {
      try {
        return await attempt()
      } catch (err) {
        if (i >= delays.length || !isTransientError(err)) throw err
        if (!marked) { marked = true; setWarming(url, true) }
        await sleep(delays[i])
      }
    }
  } finally {
    if (marked) setWarming(url, false)
  }
}

/** Copy for a panel whose first read is being re-asked. */
export const WARMING_UP = 'Still loading — the server is warming up. Trying again…'

/**
 * fetch + deadline + one transient retry, for the fetchers that read the Response themselves
 * (the research hooks' {ok, httpStatus, body} shape). Resolves with the Response; when the
 * retry also answers a transient status, resolves with THAT response so the caller's own
 * `!r.ok` branch reports it. Rejects on a final timeout or network failure.
 */
export async function fetchWithWarmRetry(url, init) {
  let lastTransient = null
  try {
    return await withWarmRetry(async () => {
      let r
      try {
        r = await withDeadline(init === undefined ? fetch(url) : fetch(url, init), url)
      } catch (cause) {
        if (cause?.timedOut) throw cause
        const e = new Error(`Network request failed: ${cause?.message || cause}`)
        e.network = true
        e.cause = cause
        throw e
      }
      if (isTransientStatus(r.status)) {
        lastTransient = r
        const e = new Error(`Request failed (${r.status})`)
        e.status = r.status
        throw e
      }
      return r
    }, url)
  } catch (err) {
    if (lastTransient && err?.status === lastTransient.status) return lastTransient
    throw err
  }
}
