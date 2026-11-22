// COT's board read: every market's weekly rows, for the one-row-per-market board.
//
// ⭐ NO NEW ROUTE. The server has no all-markets answer, so each market is read from the route the
// COT Data page already uses (GET /api/cot/{code}?weeks=N), at the ONE depth a single market is
// read at. The pattern is useCloses.js: at most MAX_IN_FLIGHT requests at once (its own
// `settleLimited`), successes memoised (a failure is asked again on the next open, never kept as
// "no data"), and a market that fails is NAMED in `failed`, never dropped.
//
// There is no timer here. The report changes once a week, so the board is read when it opens and
// again only when a memoised answer is older than COT_BOARD_TTL_MS at the next open, or on Retry.
import { useCallback, useEffect, useMemo, useState } from 'react'
import jsonFetcher from '../../../utils/jsonFetcher'
import { MAX_IN_FLIGHT, settleLimited } from './useCloses'
import { cotUrl } from './cotModel'

/** A memoised market answer is kept this long (the report is weekly; this only bounds a tab left open). */
export const COT_BOARD_TTL_MS = 30 * 60_000

const memo = new Map()   // code -> { at, p: Promise<body> }

/** For tests: forget every memoised read. */
export function clearCotBoardCache() { memo.clear() }

export function fetchCotMarket(code, now = Date.now()) {
  const hit = memo.get(code)
  if (hit && now - hit.at < COT_BOARD_TTL_MS) return hit.p
  const p = jsonFetcher(cotUrl(code), { credentials: 'include' })
  const entry = { at: now, p }
  memo.set(code, entry)
  p.catch(() => { if (memo.get(code) === entry) memo.delete(code) })
  return p
}

const IDLE = Object.freeze({ phase: 'idle', bodies: {}, failed: [], errors: {} })
const LOADING = Object.freeze({ phase: 'loading', bodies: {}, failed: [], errors: {} })

/**
 * `{ phase: 'idle'|'loading'|'ready', bodies: { CODE: body }, failed: [CODE], errors: { CODE: err }, retry }`.
 * `codes` is compared by value, so a new array with the same codes does not refetch.
 */
export default function useCotBoard(codes) {
  const names = (codes || []).join(',')
  // A Retry is a new attempt of the same codes: part of the key, so the board reads as loading at
  // once and a late answer from the failed attempt is never shown.
  const [attempt, setAttempt] = useState(0)
  const key = `${names}#${attempt}`
  const [state, setState] = useState({ key: null })
  useEffect(() => {
    const want = names.split(',').filter(Boolean)
    if (!want.length) return undefined
    let live = true
    settleLimited(want.map((c) => () => fetchCotMarket(c)), MAX_IN_FLIGHT).then((res) => {
      if (!live) return
      const bodies = {}
      const failed = []
      const errors = {}
      res.forEach((r, i) => {
        if (r.ok) bodies[want[i]] = r.value
        else { failed.push(want[i]); errors[want[i]] = r.error }
      })
      setState({ key, phase: 'ready', bodies, failed, errors })
    })
    return () => { live = false }
  }, [key, names])
  const retry = useCallback(() => setAttempt((n) => n + 1), [])
  const base = !names ? IDLE : state.key === key ? state : LOADING
  return useMemo(() => ({ ...base, retry }), [base, retry])
}
