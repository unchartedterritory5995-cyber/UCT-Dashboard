// UCT Terminal — closes for a SET of securities, for the comparison panels (RRG, REL, CORR).
//
// ⭐ NO NEW ROUTE. Each symbol is read from `/api/bars/{sym}`, the same edge-cached endpoint the
// chart draws from, at ONE depth per timeframe, so two panels (or a panel and the chart warm
// path) asking for the same name share one response. Fetches are memoised for the session
// (successes only: a failure is retried on the next open, never cached as "no data"), and at
// most MAX_IN_FLIGHT run at once so a 12-name RRG can never herd the bars tier.
//
// A symbol that fails is NAMED in `failed`, never silently dropped — "XYZ could not be read"
// and "XYZ is flat" are different facts.
import { useEffect, useState } from 'react'
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
    const series = closesFromBars(payload)
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
 * `{ phase: 'idle'|'loading'|'ready', series: { SYM: [{d,c}] }, failed: [SYM], fetchedAt }`.
 * `syms` is compared by value, so a new array with the same names does not refetch.
 */
const IDLE = Object.freeze({ phase: 'idle', series: {}, failed: [], fetchedAt: null })
const LOADING = Object.freeze({ phase: 'loading', series: {}, failed: [], fetchedAt: null })

export default function useCloses(syms, tf = 'D') {
  const list = syms || []
  const key = `${tf}:${list.join(',')}`
  // The settled read is stored WITH the key it answers, so a new set of names reads as loading
  // at once (derived, not a second setState) and a late answer for an old set is never shown.
  const [state, setState] = useState({ key: null })
  useEffect(() => {
    const names = key.slice(key.indexOf(':') + 1).split(',').filter(Boolean)
    if (!names.length) return undefined
    let live = true
    settleLimited(names.map((s) => () => fetchCloses(s, tf))).then((res) => {
      if (!live) return
      const series = {}
      const failed = []
      res.forEach((r, i) => { if (r.ok) series[names[i]] = r.value; else failed.push(names[i]) })
      setState({ key, phase: 'ready', series, failed, fetchedAt: Date.now() })
    })
    return () => { live = false }
  }, [key, tf])
  if (!list.length) return IDLE
  return state.key === key ? state : LOADING
}
