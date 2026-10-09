// NEWS, REGM, INS, RSL, THMS (wave 7, lane C): the one read each market list makes.
//
// ⛔ A FAILED READ IS NEVER DRAWN AS EMPTY DATA. Every read goes through `jsonFetcher`, which throws
// on a non-2xx answer (`err.status`) and on the shared 30 s deadline (`err.timedOut`,
// utils/withDeadline.js), so a paywall, an outage and a hung pod each reach the panel as an error.
import useSWR from 'swr'
import jsonFetcher from '../../../utils/jsonFetcher'

/** The body plus the instant it arrived (shown as "read at", never as the data's own as-of). */
export const stampedRead = (url) => jsonFetcher(url).then((body) => ({ body, receivedAt: new Date().toISOString() }))

/** The SWR key. ⛔ Never the bare URL: SWR's cache is app-wide, and the dashboard tiles and the
 *  UCT 20 page cache the RAW body under these same URLs. A stamped `{ body, receivedAt }` stored
 *  there would hand them the wrong shape (and them, us), so the stamped read has its own key. */
export const stampedKey = (url) => (url ? [url, 'terminal-stamped'] : null)
const stampedFetcher = ([url]) => stampedRead(url)

/** One SWR read: `{ body, receivedAt, error, loading, retry }`. */
export function useMarketRead(url, { refreshInterval = 0 } = {}) {
  const r = useSWR(stampedKey(url), stampedFetcher, { refreshInterval, keepPreviousData: true, revalidateOnFocus: false })
  return {
    body: r.data?.body,
    receivedAt: r.data?.receivedAt || null,
    error: r.error || null,
    loading: !r.data && !r.error,
    retry: () => r.mutate(),
  }
}

/** Plain words for a failed read. `what` is the thing read, capitalised ("Market news"). */
export function failureText(err, what) {
  if (err?.status === 401) return `You are signed out, so ${what.toLowerCase()} cannot be read. Sign in again.`
  if (err?.status === 402) return `${what} needs a paid plan.`
  if (err?.timedOut) return `${what} did not answer within 30 seconds.`
  return `${what} could not be read just now.`
}

/** An ET wall-clock stamp (`2026-10-09 14:31:00`, what the news feed sends) as an ISO instant, or
 *  null. The New York offset is read for that day, so DST is never guessed. */
export function etWallToIso(raw) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(raw || '').trim())
  if (!m) return null
  const [, y, mo, d, h, mi, s = '00'] = m
  const asUtc = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s)
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(asUtc))
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]))
  const nyAsUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second)
  const offset = nyAsUtc - asUtc   // New York minus UTC at that instant (negative)
  const out = new Date(asUtc - offset)
  return Number.isNaN(out.getTime()) ? null : out.toISOString()
}
