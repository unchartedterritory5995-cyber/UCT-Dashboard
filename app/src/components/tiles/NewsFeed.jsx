// app/src/components/tiles/NewsFeed.jsx
import useSWR from 'swr'
import TileCard from '../TileCard'
import TickerPopup from '../TickerPopup'
import styles from './NewsFeed.module.css'

const fetcher = url => fetch(url).then(r => r.json())

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
  const { data: fetched, error } = useSWR(
    propData !== undefined ? null : '/api/news',
    fetcher,
    { refreshInterval: 300000 }
  )
  const data = propData !== undefined ? propData : fetched

  return (
    <TileCard title="News">
      {error ? (
        <p className={styles.empty}>News unavailable</p>
      ) : !data ? (
        <p className={styles.loading}>Loading…</p>
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
              <a
                key={item.url || i}
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className={`${styles.item} ${sentimentClass}`}
              >
                <div className={styles.headline}>{item.headline}</div>
                <div className={styles.meta}>
                  <span className={`${styles.badge} ${badgeClass}`}>{category}</span>
                  {tickers.slice(0, 3).map(sym => (
                    <span key={sym} onClick={e => e.stopPropagation()}>
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
              </a>
            )
          })}
        </div>
      )}
    </TileCard>
  )
}
