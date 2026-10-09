// useMyTickers — the member's OWN names, as one set (wave 3 lane 13, product item #6 "Mine").
//
// ⭐ ONE SET, NOT A SECOND DEFINITION. The calendar's "My Stocks" already answers "which names are
// mine": `/api/calendar/my-sets` (api/services/calendar_personalization.py) returns the member's
// watchlist, flagged, broker-position and UCT 20 names, and the member picks which of those count
// in the calendar's Filters (the `calendar_mystocks_sources` preference). This hook reads the SAME
// route under the SAME SWR key (`useCalendarMySets` in pages/calendar/useCalendarData.js), so a
// panel's "Mine" chip and the calendar's My Stocks never disagree, and two panels cost one request.
//
//   const mine = useMyTickers({ enabled: inPanel })
//   mine.has('NVDA')        // true / false (false while loading)
//   mine.syms               // Set of upper-case tickers, or null until it answers
//   mine.state              // 'off' | 'loading' | 'error' | 'empty' | 'ready'
//
// `enabled: false` reads nothing (a public page renders FREC to signed-out visitors: never ask a
// paid route there).
import { useMemo } from 'react'
import useMobileSWR from './useMobileSWR'
import usePreferences, { parsePref } from './usePreferences'
import jsonFetcher from '../utils/jsonFetcher'

export const MY_SETS_URL = '/api/calendar/my-sets'
/** The calendar's own default (Calendar.jsx `ALL_SOURCES`): every source counts until the member
 *  narrows it in the calendar's Filters. */
export const MY_SOURCES_DEFAULT = Object.freeze(['watchlist', 'flagged', 'positions', 'uct20'])

const SOURCE_WORDS = {
  watchlist: 'your watchlists',
  flagged: 'names you flagged',
  positions: 'your broker positions',
  uct20: 'the UCT 20',
}

/** Pure: the union of the chosen sources' tickers, upper-cased. */
export function mySymbols(sets, sources = MY_SOURCES_DEFAULT) {
  const out = new Set()
  if (!sets || typeof sets !== 'object') return out
  for (const src of sources || []) {
    for (const s of Array.isArray(sets[src]) ? sets[src] : []) {
      const t = String(s || '').trim().toUpperCase()
      if (t) out.add(t)
    }
  }
  return out
}

/** Pure: one plain sentence saying how "my names" is built, from the sources that count. */
export function myNamesExplainer(sources = MY_SOURCES_DEFAULT) {
  const words = (sources || []).map((s) => SOURCE_WORDS[s]).filter(Boolean)
  const list = words.length <= 1 ? (words[0] || 'nothing yet')
    : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`
  return `"Your names" are ${list} — the same set as the calendar's My Stocks (pick which count in the calendar's Filters). Add a name to a watchlist or flag it to see it here.`
}

export default function useMyTickers({ enabled = true } = {}) {
  const { data, error, isLoading } = useMobileSWR(enabled ? MY_SETS_URL : null, jsonFetcher, {
    refreshInterval: 5 * 60 * 1000, revalidateOnFocus: false,
  })
  const { prefs } = usePreferences()
  const sources = parsePref(prefs?.calendar_mystocks_sources, MY_SOURCES_DEFAULT)
  const key = Array.isArray(sources) ? sources.join(',') : ''
  return useMemo(() => {
    const srcs = Array.isArray(sources) ? sources : MY_SOURCES_DEFAULT
    const syms = data ? mySymbols(data, srcs) : null
    let state = 'ready'
    if (!enabled) state = 'off'
    else if (!data && error) state = 'error'
    else if (!data || isLoading) state = data ? 'ready' : 'loading'
    if (state === 'ready' && syms && syms.size === 0) state = 'empty'
    return {
      syms,
      state,
      sources: srcs,
      explainer: myNamesExplainer(srcs),
      has: (sym) => !!syms && syms.has(String(sym || '').trim().toUpperCase()),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, error, isLoading, enabled, key])
}
