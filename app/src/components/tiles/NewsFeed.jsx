// app/src/components/tiles/NewsFeed.jsx
import useSWR from 'swr'
import TileCard from '../TileCard'
import TickerPopup from '../TickerPopup'
import styles from './NewsFeed.module.css'

const fetcher = url => fetch(url).then(r => r.json())

function getETOffset(date) {
  // US DST: 2nd Sunday in March → 1st Sunday in November = EDT (-04:00)
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
  const diff = Math.floor((now.getTime() - dt.getTime()) / 60000)
  if (diff < 1)    return 'just now'
  if (diff < 60)   return `${diff}m ago`
  if (diff < 1440) return `${Math.floor(diff / 60)}h ago`
  return `${Math.floor(diff / 1440)}d ago`
}

export default function NewsFeed({ data: propData }) {
  const { data: fetched, error } = useSWR(
    propData !== undefined ? null : '/api/news',
    fetcher,
    { refreshInterval: 120000 }
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
          {data.slice(0, 20).map((item, i) => (
            <a
              key={item.url || i}
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.item}
            >
              <div className={styles.headline}>{item.headline}</div>
              <div className={styles.meta}>
                {item.ticker && (
                  <span onClick={e => e.stopPropagation()}>
                    <TickerPopup sym={item.ticker}>
                      <span className={styles.ticker}>${item.ticker}</span>
                    </TickerPopup>
                  </span>
                )}
                <span className={styles.source}>{item.source}</span>
                <span className={styles.time}>{fmtTime(item.time)}</span>
              </div>
            </a>
          ))}
        </div>
      )}
    </TileCard>
  )
}
