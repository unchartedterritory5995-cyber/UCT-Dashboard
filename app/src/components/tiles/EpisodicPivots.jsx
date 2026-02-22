// app/src/components/tiles/EpisodicPivots.jsx
import useSWR from 'swr'
import TileCard from '../TileCard'
import styles from './EpisodicPivots.module.css'

const fetcher = url => fetch(url).then(r => r.json())

export default function EpisodicPivots({ data: propData }) {
  const { data: fetched } = useSWR(propData !== undefined ? null : '/api/leadership', fetcher)
  const raw = propData !== undefined ? propData : fetched
  const data = Array.isArray(raw) ? raw.slice(0, 6) : []

  if (raw === null) return <TileCard title="Episodic Pivots"><p className={styles.loading}>Loading…</p></TileCard>

  return (
    <TileCard title="Episodic Pivots">
      {data.length === 0 ? (
        <p className={styles.loading}>No data yet</p>
      ) : (
        <div className={styles.grid}>
          {data.map(stock => (
            <div
              key={stock.sym}
              className={styles.card}
              onClick={() => window.open(`https://finviz.com/quote.ashx?t=${stock.sym}`, '_blank')}
            >
              <div className={styles.sym}>{stock.sym}</div>
              {stock.price && <div className={styles.price}>{stock.price}</div>}
              {stock.chg && (
                <div className={`${styles.chg} ${stock.css === 'neg' ? styles.neg : styles.pos}`}>
                  {stock.chg}
                </div>
              )}
              {stock.score && <div className={styles.score}>{stock.score}</div>}
            </div>
          ))}
        </div>
      )}
    </TileCard>
  )
}
