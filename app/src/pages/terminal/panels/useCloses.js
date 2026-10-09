// UCT Terminal — closes for a SET of securities, for the comparison panels (RRG, REL, CORR).
//
// ⭐ NO NEW ROUTE. Each symbol is read from `/api/bars/{sym}`, the same edge-cached endpoint the
// chart draws from, at ONE depth per timeframe, so two panels (or a panel and the chart warm
// path) asking for the same name share one response. Fetches are memoised for the session
// (successes only: a failure is retried on the next open, never cached as "no data"), and at
// most MAX_IN_FLIGHT run at once so a 12-name RRG can never herd the bars tier.
//
// A symbol that fails is NAMED in `failed`, never silently dropped — "XYZ could not be read"
// and "XYZ is flat" are different facts. The subset that answered 404 (no bars at all for that
// symbol — a mistyped or unknown ticker) is ALSO named in `notFound`, so a panel can say "check
// the ticker" instead of the "just now" a transient failure earns. `retry()` re-reads (a failed
// read is never memoised, so it asks the network again); a panel offers it as its Retry, since
// re-running the same command keeps the same component and would read nothing.
import { useCallback, useEffect, useMemo, useState } from 'react'
import jsonFetcher from '../../../utils/jsonFetcher'
import { closesFromBars } from './relativeMath'

/** Bars requested per timeframe — deep enough for a 2Y window plus a 50-session average (D)
 *  and a 10+5-period RRG with an 8-point tail (W). One depth per tf keeps the cache shared. */
export const BARS_FOR_TF = { D: 600, W: 120 }
export const MAX_IN_FLIGHT = 4

const memo = new Map()   // `${sym}|${tf}` → Promise<[{d,c}]>

/** For tests: forget every memoised read. */
export function clearClosesCache() { memo.clear() }

export function fetchCloses(sym, tf = 'D') {
  const key = `${sym}|${tf}`
  if (memo.has(key)) return memo.get(key)
  const url = `/api/bars/${encodeURIComponent(sym)}?tf=${tf}&bars=${BARS_FOR_TF[tf] ?? BARS_FOR_TF.D}`
  const p = jsonFetcher(url, { credentials: 'include' }).then((payload) => {
    const series = closesFromBars(payload, { weekly: tf === 'W' })
    if (series.length < 2) throw Object.assign(new Error(`${sym}: no bars`), { status: 404 })
    return series
  })
  memo.set(key, p)
  p.catch(() => memo.delete(key))
  return p
}

/** Run `tasks` (functions returning promises) with at most `limit` in flight. Settles all. */
export async function settleLimited(tasks, limit = MAX_IN_FLIGHT) {
  const out = new Array(tasks.length)
  let next = 0
  async function lane() {
    while (next < tasks.length) {
      const i = next++
      try { out[i] = { ok: true, value: await tasks[i]() } } catch (error) { out[i] = { ok: false, error } }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, lane))
  return out
}

/**
 * `{ phase: 'idle'|'loading'|'ready', series: { SYM: [{d,c}] }, failed: [SYM], notFound: [SYM],
 *   fetchedAt, retry }`. `notFound` ⊆ `failed`.
 * `syms` is compared by value, so a new array with the same names does not refetch.
 */
const IDLE = Object.freeze({ phase: 'idle', series: {}, failed: [], notFound: [], fetchedAt: null })
const LOADING = Object.freeze({ phase: 'loading', series: {}, failed: [], notFound: [], fetchedAt: null })

export default function useCloses(syms, tf = 'D') {
  const list = syms || []
  const names = `${tf}:${list.join(',')}`
  // A Retry is a new attempt of the same names: part of the key, so the panel reads as loading
  // again at once and a late answer from the failed attempt is never shown.
  const [attempt, setAttempt] = useState(0)
  const key = `${names}#${attempt}`
  // The settled read is stored WITH the key it answers, so a new set of names reads as loading
  // at once (derived, not a second setState) and a late answer for an old set is never shown.
  const [state, setState] = useState({ key: null })
  useEffect(() => {
    const want = names.slice(names.indexOf(':') + 1).split(',').filter(Boolean)
    if (!want.length) return undefined
    let live = true
    settleLimited(want.map((s) => () => fetchCloses(s, tf))).then((res) => {
      if (!live) return
      const series = {}
      const failed = []
      const notFound = []
      res.forEach((r, i) => {
        if (r.ok) { series[want[i]] = r.value; return }
        failed.push(want[i])
        if (r.error?.status === 404) notFound.push(want[i])
      })
      setState({ key, phase: 'ready', series, failed, notFound, fetchedAt: Date.now() })
    })
    return () => { live = false }
  }, [key, names, tf])
  const retry = useCallback(() => setAttempt((n) => n + 1), [])
  const base = !list.length ? IDLE : state.key === key ? state : LOADING
  return useMemo(() => ({ ...base, retry }), [base, retry])
}

/** Pure: the sentence for the names a settled read could not use. A 404 (no bars held for the
 *  symbol) says "check the ticker"; anything else is a transient "could not read … just now".
 *  Empty string when nothing failed. */
export function failedText(state) {
  const failed = state?.failed || []
  const notFound = (state?.notFound || []).filter((s) => failed.includes(s))
  const transient = failed.filter((s) => !notFound.includes(s))
  const parts = []
  if (notFound.length) {
    parts.push(`No price history for ${notFound.join(', ')}: check the ${notFound.length === 1 ? 'ticker' : 'tickers'}.`)
  }
  if (transient.length) parts.push(`Could not read ${transient.join(', ')} just now.`)
  return parts.join(' ')
}

/** Where the comparison panels' closes come from, in the words the panel header shows. */
export const CLOSES_SOURCE = 'UCT bar store (daily closes)'

/**
 * TERM-019 — the panel-header report for a settled `useCloses` read: the source, and the newest
 * close any series reached (a calendar date, rendered as given — never parsed). `null` while
 * loading, so no header claims an age for numbers that are not on screen yet.
 */
export function closesProvenance(state, tf = 'D') {
  if (!state || state.phase !== 'ready') return null
  let through = null
  for (const series of Object.values(state.series || {})) {
    const d = series?.[series.length - 1]?.d
    if (d && (!through || d > through)) through = d
  }
  return {
    source: CLOSES_SOURCE,
    age: { dataClass: tf === 'W' ? 'weekly' : 'end_of_day', asOfDate: through },
  }
}
