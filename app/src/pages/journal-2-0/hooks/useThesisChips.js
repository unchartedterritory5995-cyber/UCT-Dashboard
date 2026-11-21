/**
 * Wave 13 lane 13G-2 -- one batch read of thesis chips for every visible row's symbol.
 *
 * ONE request for the whole symbol set, however many rows are on screen -- SWR keys on
 * the deduped, sorted symbol list, so a reorder or a price tick (which never changes the
 * SYMBOL set) never refires it. Mirrors `useWatchlistPerformance.js`'s POST-batch idiom.
 *
 * Returns `{}` with no request at all when the flag is off or there are no symbols --
 * the caller renders no chips, never a loading chip.
 */
import { useMemo } from 'react'
import useSWR from 'swr'
import { THESIS_CHIPS_URL, thesisChipsEnabled } from '../lib/thesisChips'

const postFetcher = ([url, symbols]) =>
  fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbols }),
  }).then((r) => (r.ok ? r.json() : {}))

export default function useThesisChips(symbols = []) {
  // (2026-11-21, key-press CPU profile) KEYED ON THE CALLER'S ARRAY, NOT REDONE EVERY RENDER. A Watchlist
  // widget hands its whole list here (500 symbols for the S&P 500) and renders three times between an arrow
  // key and the chart's pixels: each render filtered, upper-cased, deduped and sorted all of them, and
  // handed SWR a NEW array, which it then hashed entry by entry to find the same key (0.6 to 1.2 ms a
  // switch). The same input array now gives the SAME deduped array, which SWR's key hash recognises by
  // identity. Every caller already memoises its list; one that passes a new array each render pays what it
  // paid before, and the key it gets is equal as before.
  const unique = useMemo(
    () => [...new Set((symbols || []).filter(Boolean).map((s) => String(s).toUpperCase()))].sort(),
    [symbols],
  )
  const key = (thesisChipsEnabled() && unique.length) ? [THESIS_CHIPS_URL, unique] : null

  const { data, error, isLoading } = useSWR(key, postFetcher, {
    refreshInterval: 60_000,
    dedupingInterval: 15_000,
  })

  return { chips: data || {}, isLoading, error }
}
