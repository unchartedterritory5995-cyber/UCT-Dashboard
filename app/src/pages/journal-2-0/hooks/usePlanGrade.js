/**
 * Wave 13 lane 13A — plan vs execution grading, the client's reads.
 *
 * The server owns every number (`api/services/journal_two/plan_grading.py`); this file only
 * fetches. ⛔ A failed read THROWS so SWR carries an error — a swallowed failure would render
 * as "no plan", which is a claim about the member's discipline the server never made.
 *
 * Dark behind `notebook_plan_grading_enabled` (latched per tab): with the gate off no key is
 * built, so nothing is fetched and every surface renders nothing.
 */
import { useCallback, useMemo } from 'react'
import useSWR from 'swr'
import { notebookFlag } from '../lib/offline/notebookFlags'

export const PLAN_GRADING_FLAG = 'notebook_plan_grading_enabled'
const BASE = '/api/j2/plan-grades'
/** The server's own cap (plan_grading.MAX_STATUS_IDS); a page is far below it. */
export const MAX_STATUS_IDS = 200

export function planGradingEnabled() {
  return notebookFlag(PLAN_GRADING_FLAG) === true
}

async function getJson(url) {
  const res = await fetch(url, { credentials: 'include' })
  if (!res.ok) {
    const err = new Error(`Plan grade request failed (${res.status})`)
    err.status = res.status
    throw err
  }
  return res.json()
}

const SWR_OPTS = { revalidateOnFocus: false, shouldRetryOnError: false }

/** The status read for more ids than one request may carry: one request per MAX_STATUS_IDS,
 *  merged. Any batch failing fails the read (a partial answer would read as "planned"). */
async function getStatusBatches(ids) {
  const batches = []
  for (let i = 0; i < ids.length; i += MAX_STATUS_IDS) batches.push(ids.slice(i, i + MAX_STATUS_IDS))
  const answers = await Promise.all(
    batches.map((b) => getJson(`${BASE}/status?ids=${b.map(encodeURIComponent).join(',')}`)),
  )
  return { statuses: Object.assign({}, ...answers.map((a) => a?.statuses || {})) }
}

/** One trade's plan and four checks. `relink(choice)` is the member's Re-link:
 *  `{noteId}` | `{verdictId}` | `{none: true}`. */
export default function usePlanGrade(tradeId) {
  const on = planGradingEnabled()
  const key = on && tradeId ? `${BASE}/trades/${encodeURIComponent(tradeId)}` : null
  const { data, error, isLoading, mutate } = useSWR(key, getJson, SWR_OPTS)

  const relink = useCallback(async (choice) => {
    if (!key) return null
    const res = await fetch(`${key}/relink`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(choice || {}),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.detail || `Re-link failed (${res.status})`)
    }
    const next = await res.json()
    await mutate(next, { revalidate: false })
    return next
  }, [key, mutate])

  return { enabled: on, grade: data || null, error: error || null, isLoading: Boolean(key) && isLoading, relink, mutate }
}

/** {tradeId: {tradeRef, status}} for the equity trades on one Trade Journal page. */
export function usePlanStatuses(tradeIds) {
  const on = planGradingEnabled()
  // Sorted so the key is stable whatever order the page lists them in; NEVER cut: a page with
  // more trades than the server takes at once is asked for in batches (cutting at the cap
  // dropped the "Unplanned" chip from whichever trades sorted last as strings).
  const ids = useMemo(
    () => Array.from(new Set((tradeIds || []).filter((x) => typeof x === 'string' && x))).sort(),
    [tradeIds],
  )
  const key = on && ids.length ? `${BASE}/status?ids=${ids.map(encodeURIComponent).join(',')}` : null
  const { data, error } = useSWR(key, ids.length > MAX_STATUS_IDS ? () => getStatusBatches(ids) : getJson, SWR_OPTS)
  return { enabled: on, statuses: data?.statuses || null, error: error || null }
}

/** The discipline record over the last 20 and 60 closed trades. */
export function useDisciplineRecord(accountId) {
  const on = planGradingEnabled()
  const key = on ? `${BASE}/discipline${accountId ? `?accountId=${encodeURIComponent(accountId)}` : ''}` : null
  const { data, error, isLoading, mutate } = useSWR(key, getJson, SWR_OPTS)
  return { enabled: on, record: data || null, error: error || null, isLoading: Boolean(key) && isLoading, retry: () => mutate() }
}
