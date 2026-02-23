// app/src/components/tiles/LeadershipTile.jsx
import useSWR from 'swr'
import TileCard from '../TileCard'
import TickerPopup from '../TickerPopup'
import styles from './LeadershipTile.module.css'

const fetcher = url => fetch(url).then(r => r.json())

export default function LeadershipTile() {
  const { data: rows } = useSWR('/api/leadership', fetcher, { refreshInterval: 3600000 })
  const stocks = Array.isArray(rows) ? rows.slice(0, 20) : []

  return (
    <TileCard title="UCT 20">
      {!rows ? (
        <p className={styles.loading}>Loading…</p>
      ) : stocks.length === 0 ? (
        <p className={styles.loading}>No data — run Morning Wire engine</p>
      ) : (
        <div className={styles.list}>
          {stocks.map((item, i) => {
            const sym    = item.ticker ?? item.sym ?? item.symbol ?? '—'
            const score  = item.score ?? item.rs_score ?? null
            const thesis = item.thesis ?? ''
            const cap    = item.cap_tier ?? ''
            return (
              <div key={sym} className={styles.row}>
                <span className={styles.rank}>#{i + 1}</span>
                <div className={styles.body}>
                  <div className={styles.top}>
                    <TickerPopup sym={sym}>
                      <span className={styles.sym}>{sym}</span>
                    </TickerPopup>
                    {cap && <span className={styles.cap}>{cap}</span>}
                    {score != null && (
                      <span className={styles.score}>RS {score.toFixed ? score.toFixed(1) : score}</span>
                    )}
                  </div>
                  {thesis && <p className={styles.thesis}>{thesis}</p>}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </TileCard>
  )
}
