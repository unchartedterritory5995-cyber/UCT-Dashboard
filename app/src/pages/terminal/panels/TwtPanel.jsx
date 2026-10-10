// TWT: what the curated X (Twitter) feed is saying about one ticker (wave 7, lane D).
//
// ⭐ NO NEW ROUTE. `GET /api/tweets/ticker/{sym}?hours=168` (api/routers/tweets.py, any member) is the
// read the movers sidebar and the phone ticker sheet make through hooks/useTickerTweets.js, here
// over the route's full 7-day window. That hook is not reused because its fetcher turns a failed
// read into `[]`, and a terminal panel must not draw an outage as "no posts".
//
// ⛔ THE KILL SWITCH IS THE APP'S OWN. `VITE_TWITTER_UI_ENABLED="0"` hides every tweet surface
// (MoversSidebar, TapeFeed, MorningWire read it the same way); with it off this panel says so and
// reads nothing.
import { useMemo } from 'react'
import useSWR from 'swr'
import jsonFetcher from '../../../utils/jsonFetcher'
import { PanelSkeleton, PanelState, useInTerminalPanel, usePanelFreshness, panelAsOf } from '../../../components/terminal'
import { formatDateTimeEt, formatNumber, formatTimeEt } from '../../../lib/presentation/presentationPrimitives'
import styles from './myNamesPanel.module.css'

/** The route's own maximum window (hours, le=168): 7 days. */
export const TWT_HOURS = 168
/** Posts drawn; the rest are counted, never silently dropped. */
export const TWT_SHOWN = 50
export const tweetsUrl = (sym) => `/api/tweets/ticker/${encodeURIComponent(sym)}?hours=${TWT_HOURS}`

/** Same rule as MoversSidebar / TapeFeed / MorningWire: default ON, "0" hides tweet surfaces. */
export function twitterUiEnabled() {
  return (import.meta.env.VITE_TWITTER_UI_ENABLED ?? '1') !== '0'
}

const stamped = (url) => jsonFetcher(url).then((d) => ({ body: d, receivedAt: new Date().toISOString() }))

/** Pure: the posts as rows, newest first, without duplicates or blank text. */
export function tweetRows(list) {
  const seen = new Set()
  return (Array.isArray(list) ? list : [])
    .filter((t) => t && t.id && t.text && !seen.has(t.id) && seen.add(t.id))
    .sort((a, b) => Number(b.created_at || 0) - Number(a.created_at || 0))
}

function failureTitle(err, sym) {
  if (err?.status === 401) return 'You are signed out, so posts cannot be read. Sign in again.'
  if (err?.status === 400) return `${sym} is not a ticker TWT can read.`
  if (err?.timedOut) return `Posts about ${sym} did not answer within 30 seconds.`
  return `Could not read posts about ${sym} just now.`
}

/** "1 like", "0 likes", "1,204 reposts": the count with its noun in the right number. */
export function countText(value, noun) {
  const n = Number(value) || 0
  return `${formatNumber(n, { decimals: 0 })} ${noun}${n === 1 ? '' : 's'}`
}

export default function TwtPanel({ sym }) {
  const s = String(sym || '').trim().toUpperCase()
  const enabled = twitterUiEnabled()
  const inPanel = useInTerminalPanel()
  const q = useSWR(enabled && s ? tweetsUrl(s) : null, stamped, { revalidateOnFocus: false, refreshInterval: 5 * 60 * 1000 })
  const rows = useMemo(() => tweetRows(q.data?.body), [q.data])
  const asOf = q.data?.receivedAt || null
  usePanelFreshness(asOf ? panelAsOf('Curated X accounts (TwitterAPI.io)', asOf) : null)

  if (!enabled) {
    return (
      <PanelState kind="locked" role="status" testId="terminal-twt-off" title="Social posts are switched off on this build.">
        TWT reads nothing while they are off.
      </PanelState>
    )
  }
  if (!s) {
    return (
      <PanelState kind="input" title="TWT needs a ticker.">
        Type one first, e.g. <kbd>NVDA TWT</kbd>
      </PanelState>
    )
  }
  if (!q.data && !q.error) return <PanelSkeleton label={`Reading posts about ${s}`} testId="terminal-twt-loading" />
  if (q.error && !q.data) {
    if (q.error?.status === 402 || q.error?.status === 404) {
      return (
        <PanelState kind="locked" role="status" testId="terminal-twt-error"
          title={q.error.status === 402 ? 'Social posts are part of the paid plan.' : 'Social posts are not switched on for this server yet.'} />
      )
    }
    return (
      <PanelState kind="error" testId="terminal-twt-error" title={failureTitle(q.error, s)}
        action={<button type="button" className={styles.chip} onClick={() => q.mutate()}>Retry</button>}>
        That is not the same as no posts. Retry, or run {s} TWT again.
      </PanelState>
    )
  }
  if (!rows.length) {
    return (
      <PanelState kind="empty" role="status" testId="terminal-twt-empty" title={`No posts about ${s} were found in the last 7 days.`}>
        This feed follows a short list of news accounts, so a quiet name is normal.
      </PanelState>
    )
  }

  const shown = rows.slice(0, TWT_SHOWN)
  return (
    <div className={`${styles.wrap} ${inPanel ? styles.inPanel : ''}`} data-testid="terminal-twt">
      <p className={styles.lede} data-testid="terminal-twt-count">
        {rows.length} post{rows.length === 1 ? '' : 's'} mentioning ${s} in the last 7 days, newest first.
      </p>
      <ol className={styles.wrap} style={{ listStyle: 'none', margin: 0, padding: 0 }} data-testid="terminal-twt-list" aria-label={`Posts about ${s}`}>
        {shown.map((t) => (
          <li key={t.id} data-testid={`terminal-twt-post-${t.id}`} style={{ borderBottom: '1px solid var(--border)', paddingBottom: 'var(--space-xs)' }}>
            <div className={styles.head}>
              <strong>@{t.author_handle}</strong>
              {t.author_name ? <span className={styles.lede}>{t.author_name}</span> : null}
              <span className={styles.lede}>{formatDateTimeEt(Number(t.created_at), { absent: '' })}</span>
            </div>
            <p style={{ margin: 'var(--space-xs) 0', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{t.text}</p>
            <div className={styles.head}>
              <span className={styles.lede}>
                {countText(t.like_count, 'like')}, {countText(t.retweet_count, 'repost')}
              </span>
              {t.url ? (
                <a className={styles.linkBtn} href={t.url} target="_blank" rel="noopener noreferrer"
                  aria-label={`Open on X: post by @${t.author_handle}, opens in a new tab`}>Open on X</a>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
      {rows.length > TWT_SHOWN ? (
        <p className={styles.muted} data-testid="terminal-twt-more">Showing the newest {TWT_SHOWN} of {rows.length}.</p>
      ) : null}
      <p className={styles.muted} data-testid="terminal-twt-method">
        Posts from the curated news accounts the app follows, not all of X. Read at {formatTimeEt(asOf, { zoneSuffix: 'ET', absent: '' })}.
      </p>
    </div>
  )
}
