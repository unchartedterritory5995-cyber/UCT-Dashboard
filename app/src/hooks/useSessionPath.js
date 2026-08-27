import useSWR from 'swr'

// ⛔ `r.ok` FIRST. `jsonFetcher.test.js` sweeps every shipped surface for
// exactly this shape and named this file: a 4xx/5xx body parsed and handed to
// the consumer reads as DATA, so an error page becomes a session path and the
// chart draws it. SWR needs the THROW to mark the key errored — returning
// null would make a failed read indistinguishable from a quiet day.
const fetcher = url => fetch(url).then((r) => {
  if (!r.ok) throw new Error(`session-path ${r.status}`)
  return r.json()
})

/**
 * A finished session's intraday shape.
 *
 * `/api/breadth-monitor/live` carries today's path only while the day is still
 * provisional — once the 4:15 collector writes the row, the live payload
 * withholds everything, path included. The path is history though, not an
 * estimate, so this asks the store for it directly (7-day retention).
 *
 * Pass `date: null` to fetch nothing (the live payload already has the path).
 */
export default function useSessionPath(date) {
  const { data } = useSWR(
    date ? `/api/breadth-monitor/session-path/${date}` : null,
    fetcher,
    {
      // A finished session never changes; a missing one stays missing.
      revalidateOnFocus: false,
      revalidateIfStale: false,
      shouldRetryOnError: false,
    },
  )
  return {
    ok: !!data?.ok,
    path: data?.path ?? {},
    open: data?.open ?? {},
    loaded: data !== undefined,
  }
}
