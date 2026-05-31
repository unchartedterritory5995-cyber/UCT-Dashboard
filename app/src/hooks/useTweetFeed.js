import useMobileSWR from './useMobileSWR'

const fetcher = (url) => fetch(url).then((r) => (r.ok ? r.json() : []))

/**
 * Chronological live tweet feed (newest first) from the curated accounts.
 * Powers the Morning Wire "ON THE TAPE" feed. Polls every 30s; cadence stays
 * fast through pre-market (marketHoursOnly only slows it when fully closed).
 */
export default function useTweetFeed({ hours = 12, limit = 50 } = {}) {
  return useMobileSWR(
    `/api/tweets/feed?hours=${hours}&limit=${limit}`,
    fetcher,
    { refreshInterval: 30000, marketHoursOnly: true },
  )
}
