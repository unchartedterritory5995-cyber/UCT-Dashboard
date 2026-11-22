// IPO and DVD: the one read each makes of a calendar events route.
//
// Why these two do not read through marketRead.js: `/api/calendar/ipos` and
// `/api/calendar/dividends` answer a bare list with HTTP 200 even when their vendors failed, and
// say so only in a response header (`X-Calendar-Read: failed` or `partial`, api/routers/calendar.py).
// `jsonFetcher` hands back the parsed body alone, so through it an empty list from a failed read
// would be drawn as "nothing on the calendar". This reader keeps the header beside the body.
//
// A non-2xx answer throws with `err.status`, and the shared 30 s deadline throws with
// `err.timedOut`, exactly as `jsonFetcher` does, so marketRead.js's `failureText`, `failureKind`
// and `canRetry` read these errors unchanged.
//
// It reads once when the panel opens and again on Retry or when the command is run again. It does
// not poll: the server keeps an IPO range for six hours and a dividend answer for twelve.
import useSWR from 'swr'
import { withDeadline } from '../../../utils/withDeadline'

export const CALENDAR_READ_HEADER = 'X-Calendar-Read'

/** The body, the server's own label for the read ('failed' | 'partial' | null) and the instant it arrived. */
export async function calendarEventsRead(url) {
  const r = await withDeadline(fetch(url), url)
  if (!r.ok) {
    const err = new Error(`${url} answered ${r.status}`)
    err.status = r.status
    throw err
  }
  const label = r.headers?.get?.(CALENDAR_READ_HEADER) || null
  const body = await r.json()
  return { body, readStatus: label === 'failed' || label === 'partial' ? label : null, receivedAt: new Date().toISOString() }
}

/** The SWR key. Never the bare URL: the Calendar page caches its own shape under these URLs. */
export const calendarEventsKey = (url) => (url ? [url, 'terminal-calendar-events'] : null)
const keyedRead = ([url]) => calendarEventsRead(url)

/** One SWR read: `{ body, readStatus, receivedAt, error, loading, retry }`. */
export function useCalendarEventsRead(url) {
  const r = useSWR(calendarEventsKey(url), keyedRead, { keepPreviousData: true, revalidateOnFocus: false })
  return {
    body: r.data?.body,
    readStatus: r.data?.readStatus || null,
    receivedAt: r.data?.receivedAt || null,
    error: r.error || null,
    loading: !r.data && !r.error,
    retry: () => r.mutate(),
  }
}
