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

/** `what` as it reads mid-sentence: the first letter lowered, unless the first word is a code or a
 *  ticker ("RS rankings", "ETF exposure" keep their capitals; "Market news" becomes "market news"). */
export const midSentence = (what) => (/^[A-Z][A-Z0-9]/.test(what) ? what : what.charAt(0).toLowerCase() + what.slice(1))

/** Plain words for a failed read. `what` is the thing read, capitalised ("Market news"). A 404 is a
 *  route this server has not switched on (a dark flag), so it says that rather than "try again". */
export function failureText(err, what) {
  if (err?.status === 401) return `You are signed out, so ${midSentence(what)} cannot be read. Sign in again.`
  if (err?.status === 402) return `${what} needs a paid plan.`
  if (err?.status === 404) return `${what} is not switched on for this server yet.`
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

// ── A route that is switched off, a paywall, a cold cache ──────────────────────────────────
// Wave 9 lane 9 (states and copy, 2026-10-09).

/** A failed read Retry cannot fix: a paid-plan route (402), or a route this server has not
 *  switched on (a dark flag answers 404). A panel shows these as `locked`, with no Retry. */
export const canRetry = (err) => !(err?.status === 402 || err?.status === 404)

/** The PanelState kind for a failed read: `locked` when Retry cannot help, else `error`. */
export const failureKind = (err) => (canRetry(err) ? 'error' : 'locked')

const WARM_WORDS = new Set(['warming', 'computing', 'generating'])

/** A body that says "I have started building this, ask again shortly": `{"error":"warming"}`
 *  (the bar store), `{"warming":true}`, or `{"status":"warming"|"computing"|"generating"}`
 *  (RS rankings, theme performance, the modelbook and calendar AI routes). */
export function isWarmingBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false
  if (body.warming === true || body.error === 'warming') return true
  return WARM_WORDS.has(String(body.status || '').toLowerCase())
}

/** A failed read that is a warming answer: a 503 whose body says warming (jsonFetcher keeps the
 *  body of a 503 on `err.body`). A 503 WITHOUT that body is an outage, not a warm-up. */
export const isWarmingError = (err) => err?.status === 503 && isWarmingBody(err.body)

/** The one sentence a panel shows while the server prepares an answer. */
export const WARMING_TITLE = 'Loading, the server is preparing this.'
