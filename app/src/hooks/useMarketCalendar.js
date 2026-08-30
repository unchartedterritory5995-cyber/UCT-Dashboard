// app/src/hooks/useMarketCalendar.js
//
// The NYSE full-closure dates, read from the server — never restated here.
//
// 🔴 WHY IT IS A FETCH AND NOT A CONSTANT. This repo maintains exactly ONE
// closure list, `api/services/bars_fetch.py::_NYSE_HOLIDAYS_YYYYMMDD`, with an
// explicit "refresh annually from nyse.com" contract and five backend readers.
// Typing those dates into a frontend array would be a second authority over
// one value — this repo's most repeated defect — and the copies would diverge
// in whichever year somebody updated only one. `GET /api/market-calendar`
// derives its answer from that frozenset; this hook reads it.
//
// ⛔ NO `refreshInterval`. The set changes about once a year, by hand, in a
// deploy — a polling site here would be a census row nobody could justify
// (`hooks/pollingSites.rail.test.js`). SWR's own mount/reconnect revalidation
// is more than the data can ever need.
//
// ⛔ `jsonFetcher`, so a non-ok answer THROWS and leaves `data` undefined.
// `known` then reads false and the consumer suppresses rather than guessing —
// the whole point. A `.catch(() => [])` here would hand back "no holidays",
// which is a confident wrong answer with the same shape as the right one.
import { useMemo } from 'react'
import useSWR from 'swr'
import jsonFetcher from '../utils/jsonFetcher'

/**
 * @returns {{holidays: Set<string>|null, coversThrough: string|null, known: boolean}}
 *   `holidays` — ET calendar dates as 'YYYY-MM-DD', or null when unknown.
 *   `coversThrough` — the last ET date the table is authoritative about.
 *   `known` — false while loading AND on any failure. Deliberately one flag:
 *   a consumer must not draw a verified answer in either case, and a hook that
 *   distinguished them would invite one that did.
 */
export default function useMarketCalendar() {
  const { data } = useSWR('/api/market-calendar', jsonFetcher)
  const holidays = useMemo(
    () => (Array.isArray(data?.holidays) ? new Set(data.holidays) : null),
    [data],
  )
  const coversThrough = typeof data?.covers_through === 'string' ? data.covers_through : null
  return { holidays, coversThrough, known: holidays != null && coversThrough != null }
}
