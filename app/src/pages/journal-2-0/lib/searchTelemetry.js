/**
 * `search_used` for the notebook search panel (wave 10, lane 10D, ruling R-16, study
 * task T4). Declared in wave 6 and fired from no door until now — and it is the
 * FIELD reading behind the search-latency SLO (`api/services/journal_two/notebook_slo.py`
 * reads `search_used.ms` p95 into its daily, never-paging digest).
 *
 * ONE reading per search (a query plus its filters), timed from the moment the
 * DEBOUNCED search is asked for — the fetch going out, not the keystroke — to the
 * moment its first page settles. A search answered from cache reads ~0 ms, which is
 * true: the member waited for nothing.
 *
 * ⛔ NEVER CONTENT. `searchKey` (which holds the query) lives in this hook's ref and
 * is never sent; what leaves is a result COUNT, a filter COUNT, a mode word and a
 * duration — the schema in notebookTelemetry.js drops anything else anyway.
 */
import { useEffect, useRef } from 'react'
import { NOTEBOOK_EVENTS, trackNotebookEvent } from './notebookTelemetry'

const defaultClock = () => (globalThis.performance?.now ? globalThis.performance.now() : Date.now())

export function useSearchUsedTelemetry({
  enabled, searchKey, settled, results, filters, textQuery, now = defaultClock,
}) {
  const startRef = useRef(null)
  useEffect(() => {
    if (!enabled || !searchKey) {
      startRef.current = null
      return
    }
    if (startRef.current?.key !== searchKey) {
      startRef.current = { key: searchKey, t0: now(), reported: false }
    }
  }, [enabled, searchKey, now])
  useEffect(() => {
    const s = startRef.current
    if (!enabled || !s || s.reported || s.key !== searchKey || !settled) return
    s.reported = true
    trackNotebookEvent(NOTEBOOK_EVENTS.SEARCH_USED, {
      results, filters, mode: textQuery ? 'text' : 'filter', ms: now() - s.t0,
    })
  }, [enabled, searchKey, settled, results, filters, textQuery, now])
}
