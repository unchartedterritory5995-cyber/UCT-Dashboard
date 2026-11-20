// NEWS: the market-wide news tape, every headline the server holds, newest first (wave 7, lane C).
//
// ⭐ NO NEW ROUTE. `GET /api/news` is the same read the Dashboard's News tile makes
// (components/tiles/NewsFeed.jsx). That tile is not embedded here on purpose: it caps the list at
// 20, wraps itself in a TileCard (a second header under the panel's), opens a ticker in a popup
// instead of the terminal, and draws the server's "News unavailable" placeholder row as if it were
// a headline. This panel shows every row, and a ticker opens DES beside it.
//
// ⛔ A failed read is an error with Retry, never "no news": an outage and a quiet tape differ.
//
// "Latest on the news wire" (2026-11-19): the newest UCT News headlines lead the panel as a short
// strip (WireStrip.jsx), with a numbered row that opens the whole wire (`UNEWS`). The strip is a
// different source from the tape and is drawn whatever the tape's state is; the tape's states
// below are unchanged, and the panel header still names the tape's source.
import { useMemo } from 'react'
import { PanelSkeleton, PanelState, PanelSymbol, useInTerminalPanel, usePanelFreshness } from '../../../components/terminal'
import { formatPercent, formatTimeEt } from '../../../lib/presentation/presentationPrimitives'
import { canRetry, etWallToIso, failureText, useMarketRead } from './marketRead'
import WireStrip from './WireStrip'
import styles from './marketPanels.module.css'

export const NEWS_URL = '/api/news'
const POLL_MS = 5 * 60 * 1000
const MAX_TICKERS = 3

/** Pure: the headlines worth showing, newest first. The server's "unavailable" placeholder (a row
 *  carrying `error`) and title-less rows are dropped, never drawn as news. */
export function newsRows(body) {
  const list = Array.isArray(body) ? body : []
  const rows = list
    .filter((it) => it && !it.error && String(it.headline || '').trim())
    .map((it, i) => {
      const tickers = (Array.isArray(it.tickers) ? it.tickers : it.ticker ? [it.ticker] : [])
        .map((s) => String(s || '').trim().toUpperCase()).filter(Boolean)
      return {
        key: it.url || `${i}-${it.headline}`,
        headline: String(it.headline).trim(),
        url: it.url || null,
        source: it.source || '',
        category: it.category || 'GENERAL',
        tickers: [...new Set(tickers)],
        at: etWallToIso(it.time),
        pct: Number.isFinite(Number(it.change_pct)) && it.change_pct !== null ? Number(it.change_pct) : null,
        order: i,
      }
    })
  return rows.sort((a, b) => (b.at || '').localeCompare(a.at || '') || a.order - b.order)
}

/** Whether the server said news is unavailable (it answers one placeholder row with `error`). */
export function newsUnavailable(body) {
  return Array.isArray(body) && body.length > 0 && body.every((it) => it && it.error)
}

export default function NewsPanel() {
  const inPanel = useInTerminalPanel()
  const read = useMarketRead(NEWS_URL, { refreshInterval: POLL_MS })
  const rows = useMemo(() => newsRows(read.body), [read.body])
  const newest = rows.find((r) => r.at)?.at || null
  usePanelFreshness(rows.length ? { source: 'UCT news feed (FMP and RSS)', asOf: newest || read.receivedAt, freshnessClass: 'real_time' } : null)

  // The tape's own state. The news wire strip stays above it, with one exception: a tape this
  // member's plan does not include (402) shows no strip either. The wire never opens a panel
  // whose own gate said no.
  let tapeState = null
  const planLocked = !!read.error && !read.body && read.error.status === 402
  if (read.loading) tapeState = <PanelSkeleton label="Loading market news" testId="terminal-news-loading" />
  else if (read.error && !read.body) {
    const locked = !canRetry(read.error)
    tapeState = (
      <PanelState kind={locked ? 'locked' : 'error'} title={failureText(read.error, 'Market news')} testId="terminal-news-error"
        action={locked ? null : <button type="button" className={styles.chip} onClick={read.retry}>Retry</button>}>
        {locked ? null : 'That is not the same as a quiet tape. Retry, or run NEWS again.'}
      </PanelState>
    )
  } else if (newsUnavailable(read.body)) {
    tapeState = (
      <PanelState kind="error" role="status" title="The news feed is not available on this server right now." testId="terminal-news-unavailable"
        action={<button type="button" className={styles.chip} onClick={read.retry}>Retry</button>} />
    )
  } else if (!rows.length) {
    tapeState = <PanelState kind="empty" title="No market headlines right now." testId="terminal-news-empty">The tape refreshes every 5 minutes.</PanelState>
  }
  if (planLocked) return tapeState
  if (tapeState) {
    return (
      <div className={`${styles.wrap} ${inPanel ? styles.inPanel : ''}`} data-testid="terminal-news">
        <WireStrip />
        {tapeState}
      </div>
    )
  }

  return (
    <div className={`${styles.wrap} ${inPanel ? styles.inPanel : ''}`} data-testid="terminal-news">
      <WireStrip />
      {read.error && <p className={styles.note} role="status">{failureText(read.error, 'Market news')} Showing the last read.</p>}
      <ol className={styles.newsList} aria-label="Market headlines, newest first" data-testid="terminal-news-list">
        {rows.map((r) => (
          <li key={r.key} className={styles.newsItem} data-testid="terminal-news-row">
            {r.url
              ? <a href={r.url} target="_blank" rel="noopener noreferrer" className={styles.newsHeadline}>{r.headline}</a>
              : <span className={styles.newsHeadline}>{r.headline}</span>}
            <span className={styles.newsMeta}>
              <span>{r.at ? formatTimeEt(r.at, { zoneSuffix: 'ET', absent: '' }) : 'time not given'}</span>
              {r.source ? <span>{r.source}</span> : null}
              <span>{r.category}</span>
              {r.tickers.slice(0, MAX_TICKERS).map((s) => (
                <PanelSymbol key={s} sym={s} className={styles.sym} />
              ))}
              {r.pct != null ? (
                <span className={r.pct > 0 ? styles.up : r.pct < 0 ? styles.down : undefined}>
                  {formatPercent(r.pct, { decimals: 2, signed: true })}
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ol>
      <p className={styles.muted} data-testid="terminal-news-method">
        {rows.length} headline{rows.length === 1 ? '' : 's'}, newest first. Click a ticker to open its DES beside this panel.
        {read.receivedAt ? ` Read at ${formatTimeEt(read.receivedAt, { zoneSuffix: 'ET', absent: '' })}.` : ''}
      </p>
    </div>
  )
}
