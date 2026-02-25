// app/src/pages/UCT20.jsx
import useSWR from 'swr'
import TileCard from '../components/TileCard'
import styles from './UCT20.module.css'

const fetcher = url => fetch(url).then(r => r.json())

export default function UCT20() {
  const { data: rows, mutate } = useSWR('/api/leadership', fetcher, { refreshInterval: 3600000 })

  const stocks = Array.isArray(rows) ? rows.slice(0, 20) : []

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.heading}>UCT 20</h1>
        <button className={styles.refreshBtn} onClick={() => mutate()}>Refresh</button>
      </div>
      <TileCard title="Leadership 20 — Current Top Setups">
        {!rows ? (
          <p className={styles.loading}>Loading…</p>
        ) : stocks.length === 0 ? (
          <p className={styles.loading}>No leadership data yet. Run the Morning Wire engine to populate.</p>
        ) : (
          <div className={styles.list}>
            {stocks.map((item, i) => {
              const sym = item.ticker ?? item.sym ?? item.symbol ?? '—'
              const score = item.score ?? item.rs_score ?? null
              const thesis = item.thesis ?? ''
              const cap = item.cap_tier ?? ''
              return (
                <div key={sym} className={styles.card}>
                  <div className={styles.rank}>#{i + 1}</div>
                  <div className={styles.body}>
                    <div className={styles.top}>
                      <span className={styles.sym}>{sym}</span>
                      {cap && <span className={styles.cap}>{cap}</span>}
                      {score != null && (
                        <span className={styles.score}>UCT {score.toFixed ? score.toFixed(1) : score}</span>
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
    </div>
  )
}
