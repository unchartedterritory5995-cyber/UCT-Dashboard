// UCT Terminal — the one-line headline every one-stock panel carries under its title
// (wave 3, product list item #2): `NVDA 182.40 +3.1% · vol 2.4× avg · earnings Thu Nov 19`.
//
// Mounted ONCE by the shell's `Panel` frame (pages/terminal/TerminalShell.jsx) whenever the
// panel shows a security, so no panel draws its own copy. It reads SHARED data only:
//   * the price, % change and volume from the app-wide live-price pool (`useLivePrices` →
//     livePriceStore: one poll of the union of every subscriber's tickers);
//   * the next earnings date and 20-session average volume from `/api/research/snapshot-batch`
//     under the SWR key `['/api/research/snapshot-batch', [SYM]]` — so two panels on the same
//     ticker share ONE request (SWR dedupes by key), never one fetch per panel.
// Honest states: "loading quote", "no quote for XYZ" (an unknown ticker, never a crash), and
// "at last close" / "pre-market" / "after hours" whenever the regular session is not trading.
//
// Wave 4:
//   * a DEFINITE miss says the server's own words — "No data for ZZQXV — check the ticker" plus
//     its suggestions (the wave-2 `not_found` marker, drawn by the shared TickerNotFound). It is
//     asked of `/api/research/snapshot/{sym}` (the same SWR key the snapshot card uses) ONLY once
//     the batch has answered with no company and the pool has no price, so a real ticker never
//     pays for it. The frame mounts this line outside the panel's run context, so suggestions are
//     clickable when the caller passes `onRun`, plain names otherwise.
//   * a closed-market row names WHEN its price was set: "at the 4:00 PM ET close" (today) or
//     "at the Fri 4:00 PM ET close", from the row's `session_close_at` (live-prices, additive).
//     An extended-hours print carries its own ET time from `observed_at`.
import useSWR from 'swr'
import useLivePrices from '../../hooks/useLivePrices'
import useMarketOpen from '../../hooks/useMarketOpen'
import useFundamentalSnapshot from '../../hooks/useFundamentalSnapshot'
import TickerNotFound, { notFoundOf } from './TickerNotFound'
import styles from './SecurityHeadline.module.css'

export const HEADLINE_SNAPSHOT_URL = '/api/research/snapshot-batch'

/** The SWR key for one ticker's headline snapshot — exported so tests can prove the dedupe. */
export function headlineKey(sym) {
  const s = String(sym || '').trim().toUpperCase()
  return s ? [HEADLINE_SNAPSHOT_URL, [s]] : null
}

const snapshotFetcher = ([url, tickers]) => {
  const ac = typeof AbortController !== 'undefined' ? new AbortController() : null
  const t = ac ? setTimeout(() => ac.abort(), 10000) : null
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tickers }),
    signal: ac?.signal,
  })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .finally(() => { if (t) clearTimeout(t) })
}

const fin = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

export function fmtPrice(v) {
  const n = fin(v)
  if (n == null) return null
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function fmtPct(v) {
  const n = fin(v)
  if (n == null) return null
  const sign = n > 0 ? '+' : n < 0 ? '−' : ''
  return `${sign}${Math.abs(n).toFixed(2)}%`
}

/** Today's volume over the 20-session average, as `2.4×`; null when either side is missing. */
export function volRatio(volume, avg) {
  const v = fin(volume)
  const a = fin(avg)
  if (v == null || a == null || a <= 0) return null
  const r = v / a
  return `${r >= 10 ? r.toFixed(0) : r.toFixed(1)}×`
}

const ET = 'America/New_York'

function etYmd(d) {
  // en-CA formats as YYYY-MM-DD.
  return d.toLocaleDateString('en-CA', { timeZone: ET })
}

/**
 * The next earnings date in ET, e.g. `Thu Nov 19`. A calendar date (`2026-11-19`) is shown as
 * that day, never shifted by the viewer's own timezone; an instant is converted to ET. A date
 * already in the past (ET) is not "next" and returns null.
 */
export function fmtEarnings(raw, now = new Date()) {
  if (!raw) return null
  const s = String(raw)
  let ymd
  let d
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    ymd = s
    d = new Date(`${s}T12:00:00Z`)
    if (Number.isNaN(d.getTime())) return null
    const label = d.toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' })
    return ymd < etYmd(now) ? null : label.replace(',', '')
  }
  d = new Date(s)
  if (Number.isNaN(d.getTime())) return null
  ymd = etYmd(d)
  if (ymd < etYmd(now)) return null
  return d.toLocaleDateString('en-US', { timeZone: ET, weekday: 'short', month: 'short', day: 'numeric' }).replace(',', '')
}

/** Which clause the strip carries when the regular session is not trading (null while open). */
export function sessionClause(row, market) {
  if (row?.market_closed) return 'at last close'
  if (market?.isOpen) return null
  const ext = String(row?.ext_session || '').toLowerCase()
  if (ext.startsWith('pre') || (!ext && market?.isPremarket)) return 'pre-market'
  if (ext || market?.isExtended) return 'after hours'
  return 'at last close'
}

/** `h:mm AM ET` for an epoch (seconds or milliseconds); null when it is not a real instant. */
export function etClock(epoch) {
  const n = fin(epoch)
  if (n == null || n <= 0) return null
  const d = new Date(n < 1e12 ? n * 1000 : n)
  if (Number.isNaN(d.getTime())) return null
  return `${d.toLocaleTimeString('en-US', { timeZone: ET, hour: 'numeric', minute: '2-digit' })} ET`
}

/**
 * The closed-market clause with its time: "at the 4:00 PM ET close" when that close was today
 * (ET), "at the Fri 4:00 PM ET close" otherwise. Without a timestamp: "at last close".
 */
export function closeClause(row, now = new Date()) {
  const at = fin(row?.session_close_at)
  const clock = etClock(at)
  if (!clock) return 'at last close'
  const d = new Date(at * 1000)
  if (etYmd(d) === etYmd(now)) return `at the ${clock} close`
  const day = d.toLocaleDateString('en-US', { timeZone: ET, weekday: 'short' })
  return `at the ${day} ${clock} close`
}

export default function SecurityHeadline({ sym, onRun = null }) {
  const name = String(sym || '').trim().toUpperCase()
  const { prices } = useLivePrices(name ? [name] : [])
  const market = useMarketOpen()
  const { data: snap, error: snapErr } = useSWR(headlineKey(name), snapshotFetcher, {
    dedupingInterval: 5 * 60 * 1000,
    revalidateOnFocus: false,
  })
  const row = name ? prices[name] || null : null
  const meta = snap && typeof snap === 'object' ? snap[name] || null : null
  const price = fmtPrice(row?.price)
  // Ask the presence authority only for a name the batch could not identify and the pool
  // cannot price — never for a healthy ticker.
  const unknown = !!name && !price && !!snap && !(meta && meta.name)
  const { data: presence } = useFundamentalSnapshot(name, unknown)
  if (!name) return null

  if (!price) {
    // No quote yet. Unknown once the snapshot answered without a company for it; otherwise
    // still loading (the live pool polls every 2s, so a real ticker fills in shortly).
    const notFound = unknown ? notFoundOf(presence, name) : null
    const state = notFound ? 'not-found' : unknown ? 'unknown' : snapErr ? 'unavailable' : 'loading'
    return (
      <div className={`${styles.strip} ${styles.muted}`} role="status" aria-live="polite"
        data-testid="security-headline" data-state={state}>
        {state === 'not-found' && <TickerNotFound sym={name} payload={presence} onRun={onRun} variant="inline" />}
        {state === 'unknown' && <>No quote found for <b className={styles.sym}>{name}</b></>}
        {state === 'unavailable' && <>Quote for <b className={styles.sym}>{name}</b> is unavailable right now</>}
        {state === 'loading' && `Loading ${name} quote…`}
      </div>
    )
  }

  const pct = fmtPct(row?.change_pct)
  const dir = fin(row?.change_pct) > 0 ? 'up' : fin(row?.change_pct) < 0 ? 'down' : 'flat'
  const vol = volRatio(row?.volume, meta?.avg_vol_20d)
  const earn = fmtEarnings(meta?.next_earnings)
  const session = sessionClause(row, market)
  const extended = !row?.market_closed && session && session !== 'at last close'
  const clause = session === 'at last close' ? closeClause(row) : session
  const extPrice = extended ? fmtPrice(row?.ext_price) : null
  const extAt = extended && extPrice ? etClock(row?.observed_at) : null

  return (
    <div className={`${styles.strip} ${clause ? styles.closed : ''}`} role="group"
      aria-label={`${name} headline`} data-testid="security-headline" data-state={clause ? 'closed' : 'live'}>
      <b className={styles.sym}>{name}</b>
      <span className={styles.num} data-testid="security-headline-price">{price}</span>
      {pct && (
        <span className={`${styles.num} ${styles[dir]}`} data-testid="security-headline-pct">
          <span aria-hidden="true">{dir === 'up' ? '▲' : dir === 'down' ? '▼' : ''}</span>{pct}
        </span>
      )}
      {clause && <span className={styles.clause} data-testid="security-headline-session">{clause}{extPrice ? ` ${extPrice}` : ''}{extAt ? ` at ${extAt}` : ''}</span>}
      {vol && <span className={styles.part} data-testid="security-headline-vol" title="Today's volume vs the 20-session average">· vol {vol} avg</span>}
      {earn && <span className={styles.part} data-testid="security-headline-earn" title="Next earnings date (ET)">· earnings {earn}</span>}
    </div>
  )
}
