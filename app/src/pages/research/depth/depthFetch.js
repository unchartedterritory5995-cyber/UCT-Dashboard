// Fetcher for the Depth panels. Same contract as sectionFetcher (a failed
// request THROWS, so "could not read" never renders as "nothing there"), plus
// two answers that are states rather than failures:
//   402 -> { paywalled: true }
//   400 -> { badRequest: <the server's sentence> }  (a query the language cannot express)

import { useCallback, useEffect, useRef, useState } from 'react'
import { withDeadline } from '../../../components/research/sections/sectionFetch'

// Live sweep 2026-10-05: BRKE, ERX and EVTS answer `pending` on a cold read (their data is
// fetched behind the request) and the server's sentence told the member to "reopen in a
// minute". A panel now asks again by itself while the answer is pending, every
// PENDING_REASK_MS, at most PENDING_REASK_MAX times per symbol. A timer, not SWR's
// refreshInterval, so nothing polls once the answer is in (and the polling census is unchanged).
export const PENDING_REASK_MS = 10000
export const PENDING_REASK_MAX = 9

// Returns { exhausted, retry }: once the cap is spent while the answer is still pending, the
// panel must stop promising "this fills in by itself" and offer a manual check instead
// (quality pass 2026-10-05). `retry` re-arms the re-ask and asks once now.
export function usePendingReask(isPending, mutate, key) {
  const n = useRef(0)
  const [spent, setSpent] = useState(false)
  const [round, setRound] = useState(0)
  // `tick` advances after every re-ask settles. Without it the chain stopped after ONE re-ask
  // whenever the server answered the same pending payload again: SWR keeps the old data
  // reference for an equal answer, nothing re-rendered, and this effect never ran again.
  const [tick, setTick] = useState(0)
  useEffect(() => { n.current = 0; setSpent(false) }, [key])
  useEffect(() => {
    if (!isPending) return undefined
    if (n.current >= PENDING_REASK_MAX) { setSpent(true); return undefined }
    let live = true
    const t = setTimeout(() => {
      n.current += 1
      Promise.resolve(mutate()).catch(() => {}).finally(() => { if (live) setTick((x) => x + 1) })
    }, PENDING_REASK_MS)
    return () => { live = false; clearTimeout(t) }
  }, [isPending, mutate, key, round, tick])
  const retry = useCallback(() => {
    n.current = 0; setSpent(false); setRound((r) => r + 1); mutate()
  }, [mutate])
  return { exhausted: spent && Boolean(isPending), retry }
}

export class DepthFetchError extends Error {
  constructor(message, status = null) {
    super(message)
    this.name = 'DepthFetchError'
    this.status = status
  }
}

// Same deadline as sectionFetcher: a request that never answers ends as a failure, not an
// endless loading line.
export function depthFetcher(url) {
  return withDeadline(depthFetchOnce(url), url)
}

async function depthFetchOnce(url) {
  let res
  try {
    res = await fetch(url)
  } catch (e) {
    throw new DepthFetchError(`network: ${e?.message || e}`)
  }
  if (res.status === 402) return { paywalled: true }
  if (res.status === 400) {
    let detail = 'That request could not be read.'
    try { detail = (await res.json())?.detail || detail } catch { /* keep the default */ }
    return { badRequest: String(detail) }
  }
  if (!res.ok) throw new DepthFetchError(`HTTP ${res.status}`, res.status)
  return res.json()
}
