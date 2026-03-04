// app/src/components/tiles/NewsFeed.jsx
import useSWR from 'swr'
import TileCard from '../TileCard'
import TickerPopup from '../TickerPopup'
import styles from './NewsFeed.module.css'

const fetcher = url => fetch(url).then(r => r.json())

function fmtTime(raw) {
  if (!raw) return ''
  // Finviz Date field is "YYYY-MM-DD HH:MM:SS" ET
  const dt = new Date(raw.replace(' ', 'T') + '-05:00')
  if (isNaN(dt)) return raw
  const now = Date.now()
  const diff = Math.floor((now - dt.getTime()) / 60000) // minutes ago
  if (diff < 1)   return 'just now'
  if (diff < 60)  return `${diff}m ago`
  if (diff < 1440) return `${Math.floor(diff / 60)}h ago`
  return `${Math.floor(diff / 1440)}d ago`
}

export default function NewsFeed({ data: propData }) {
  const { data: fetched } = useSWR(
    propData !== undefined ? null : '/api/news',
    fetcher,
    { refreshInterval: 120000 }
  )
  const data = propData !== undefined ? propData : fetched

  return (
    <TileCard title="News">
      {!data ? (
        <p className={styles.loading}>Loading…</p>
      ) : (
        <div className={styles.feed}>
          {data.slice(0, 20).map((item, i) => (
            <a
              key={i}
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.item}
            >
              <div className={styles.headline}>{item.headline}</div>
              <div className={styles.meta}>
                {item.ticker && (
                  <TickerPopup sym={item.ticker}>
                    <span className={styles.ticker}>${item.ticker}</span>
                  </TickerPopup>
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
