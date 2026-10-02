// app/src/components/tiles/NewsFeed.jsx
import useMobileSWR from '../../hooks/useMobileSWR'
import TileCard from '../TileCard'
import TickerPopup from '../TickerPopup'
import ErrorState from '../ErrorState'
import { SkeletonTileContent } from '../Skeleton'
import styles from './NewsFeed.module.css'

// ⛔ NOT `fetch(url).then(r => r.json())` — a 402 answers JSON too, and
// its `{detail}` body is truthy, so every `!data` loading guard below is
// skipped and the consumer throws on an error object. See utils/jsonFetcher.js.
import fetcher from '../../utils/jsonFetcher'

function getETOffset(date) {
  const y = date.getFullYear()
  const marchSecondSun = new Date(y, 2, 8)
  marchSecondSun.setDate(8 + (7 - marchSecondSun.getDay()) % 7)
  const novFirstSun = new Date(y, 10, 1)
  novFirstSun.setDate(1 + (7 - novFirstSun.getDay()) % 7)
  return date >= marchSecondSun && date < novFirstSun ? '-04:00' : '-05:00'
}

function fmtTime(raw) {
  if (!raw) return ''
  const now = new Date()
  const dt = new Date(raw.replace(' ', 'T') + getETOffset(now))
  if (isNaN(dt)) return raw
  const diff = Math.floor((now - dt) / 60000)
  if (diff < 1)    return 'just now'
  if (diff < 60)   return `${diff}m ago`
  if (diff < 1440) return `${Math.floor(diff / 60)}h ago`
  return `${Math.floor(diff / 1440)}d ago`
}

function isNew(raw) {
  if (!raw) return false
  const now = new Date()
  const dt = new Date(raw.replace(' ', 'T') + getETOffset(now))
  return !isNaN(dt) && (now - dt) < 15 * 60 * 1000
}

const BADGE_CLASS = {
  EARN:      styles.badgeEARN,
  'M&A':     styles.badgeMA,
  UPGRADE:   styles.badgeUPGRADE,
  DOWNGRADE: styles.badgeDOWNGRADE,
  BIO:       styles.badgeBIO,
  IPO:       styles.badgeIPO,
  MACRO:     styles.badgeMACRO,
  GENERAL:   styles.badgeGENERAL,
}

function fmtChg(pct) {
  if (pct == null) return null
  const sign = pct >= 0 ? '+' : ''
  const cls = Math.abs(pct) < 0.1 ? styles.chgFlat : pct > 0 ? styles.chgPos : styles.chgNeg
  return <span className={cls}>{sign}{pct.toFixed(2)}%</span>
}

export default function NewsFeed({ data: propData }) {
  const { data: fetched, error, mutate } = useMobileSWR(
    propData !== undefined ? null : '/api/news',
    fetcher,
    { refreshInterval: 300000 }
  )
  const data = propData !== undefined ? propData : fetched

  return (
    <TileCard icon="wire" title="News">
      {error ? (
        <ErrorState compact message="Failed to load news" onRetry={() => mutate()} />
      ) : !data ? (
        <SkeletonTileContent lines={5} />
      ) : data.length === 0 ? (
        <p className={styles.empty}>No stock news at this time</p>
      ) : (
        <div className={styles.feed}>
          {data.slice(0, 20).map((item, i) => {
            const tickers = Array.isArray(item.tickers) ? item.tickers
              : item.ticker ? [item.ticker] : []
            const sentimentClass = item.sentiment === 'bullish' ? styles.sentimentBullish
              : item.sentiment === 'bearish' ? styles.sentimentBearish : ''
            const badgeClass = BADGE_CLASS[item.category] || styles.badgeGENERAL
            const category = item.category || 'GENERAL'
            return (
              // A2R-05 (a11y second review, 2026-10-01) nesting fix: the card
              // used to be the <a> itself, so nesting TickerPopup's focusable
              // trigger inside it would put one focus stop inside another
              // (invalid — an anchor cannot contain a second interactive
              // descendant). The anchor now wraps ONLY the headline text; the
              // ticker chips are SIBLINGS of it, each its own tab stop. The
              // card is still clickable anywhere for the mouse — the div's
              // onClick opens the link unless the click originated on the
              // anchor itself (which already navigates on its own) or on a
              // ticker chip (`[data-ticker-chip]`, which opens its own popup).
              <div
                key={item.url || i}
                className={`${styles.item} ${sentimentClass}`}
                onClick={e => {
                  if (e.target.closest('a,[data-ticker-chip]')) return
                  if (item.url) window.open(item.url, '_blank', 'noopener,noreferrer')
                }}
              >
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.headline}
                >
                  {item.headline}
                </a>
                <div className={styles.meta}>
                  <span className={`${styles.badge} ${badgeClass}`}>{category}</span>
                  {tickers.slice(0, 3).map(sym => (
                    <span key={sym} data-ticker-chip onClick={e => e.stopPropagation()}>
                      <TickerPopup sym={sym}>
                        <span className={styles.ticker}>${sym}</span>
                      </TickerPopup>
                    </span>
                  ))}
                  {fmtChg(item.change_pct)}
                  <span className={styles.source}>{item.source}</span>
                  {isNew(item.time) && <span className={styles.newDot} title="New" />}
                  <span className={styles.time}>{fmtTime(item.time)}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </TileCard>
  )
}
