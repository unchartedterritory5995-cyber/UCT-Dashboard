import useMobileSWR from './useMobileSWR'

const fetcher = (url) => fetch(url).then((r) => (r.ok ? r.json() : []))

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
