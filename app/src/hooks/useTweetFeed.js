import useMobileSWR from './useMobileSWR'
import { withDeadline } from '../utils/withDeadline'

// THROWS on a failed request (quality pass 2026-10-05). It mapped a failure to `[]`, so every
// surface read a 5xx as "No tweets on the tape yet". SWR keeps the last good list on an error,
// so a blip never empties a populated feed; a surface with nothing yet reads `error`.
// Consumers (all four distinguish it): MorningWire OnTheTape, MoversSidebar, tiles/TapeFeed,
// desk/PostsSection.
const fetcher = (url) => withDeadline(fetch(url), url).then((r) => {
  if (!r.ok) throw new Error(`tweet feed ${r.status}`)
  return r.json()
})

/**
 * Chronological live tweet feed (newest first) from the curated accounts.
 * Powers the Morning Wire "ON THE TAPE" feed. Polls every 30s; cadence stays
 * fast through pre-market (marketHoursOnly only slows it when fully closed).
 */
export default function useTweetFeed({ hours = 12, limit = 50, official = false } = {}) {
  const officialParam = official ? '&official=1' : ''
  return useMobileSWR(
    `/api/tweets/feed?hours=${hours}&limit=${limit}${officialParam}`,
    fetcher,
    { refreshInterval: 30000, marketHoursOnly: true },
  )
}
