// app/src/components/tiles/NewsFeed.jsx
import useSWR from 'swr'
import TileCard from '../TileCard'
import styles from './NewsFeed.module.css'

const fetcher = url => fetch(url).then(r => r.json())

export default function NewsFeed({ data: propData }) {
  const { data: fetched } = useSWR(
    propData !== undefined ? null : '/api/news',
    fetcher,
    { refreshInterval: 300000 }
  )
  const data = propData !== undefined ? propData : fetched

  return (
    <TileCard title="News">
      {!data ? (
        <p className={styles.loading}>Loading…</p>
      ) : (
        <div className={styles.feed}>
          {data.slice(0, 8).map((item, i) => (
            <a
              key={i}
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.item}
            >
              <div className={styles.headline}>{item.headline}</div>
              <div className={styles.meta}>
                <span className={styles.source}>{item.source}</span>
                <span className={styles.time}>{item.time}</span>
              </div>
            </a>
          ))}
        </div>
      )}
    </TileCard>
  )
}
