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
  const unique = [...new Set((symbols || []).filter(Boolean).map((s) => String(s).toUpperCase()))].sort()
  const key = (thesisChipsEnabled() && unique.length) ? [THESIS_CHIPS_URL, unique] : null

  const { data, error, isLoading } = useSWR(key, postFetcher, {
    refreshInterval: 60_000,
    dedupingInterval: 15_000,
  })

  return { chips: data || {}, isLoading, error }
}
