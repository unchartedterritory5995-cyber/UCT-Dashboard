// app/src/components/tiles/LeadershipTile.jsx
import { useState } from 'react'
import useMobileSWR from '../../hooks/useMobileSWR'
import TileCard from '../TileCard'
import TickerPopup from '../TickerPopup'
import { SkeletonTable } from '../Skeleton'
import styles from './LeadershipTile.module.css'

const fetcher = url => fetch(url).then(r => r.json())

export default function LeadershipTile() {
  const { data: rows } = useMobileSWR('/api/leadership', fetcher, { refreshInterval: 3600000 })
  const [expandedIdx, setExpandedIdx] = useState(null)
  const stocks = Array.isArray(rows) ? rows.slice(0, 20) : []

  function toggle(i) {
    setExpandedIdx(prev => prev === i ? null : i)
  }

  return (
    <TileCard title="UCT 20">
      {!rows ? (
        <SkeletonTable rows={5} cols={3} />
      ) : stocks.length === 0 ? (
        <p className={styles.loading}>No data — run Morning Wire engine</p>
      ) : (
        <div className={styles.list}>
          {stocks.map((item, i) => {
            const sym      = item.ticker ?? item.sym ?? item.symbol ?? '—'
            const score    = item.score ?? item.rs_score ?? null
            const thesis   = item.thesis ?? ''
            const cap      = item.cap_tier ?? ''
            const expanded = expandedIdx === i
            return (
              <div key={sym} className={styles.row}>
                <span className={styles.rank}>#{i + 1}</span>
                <div className={styles.body}>
                  <div className={styles.top} onClick={() => thesis && toggle(i)} style={thesis ? { cursor: 'pointer' } : undefined}>
                    <TickerPopup sym={sym}>
                      <span className={styles.sym}>{sym}</span>
                    </TickerPopup>
                    {cap && <span className={styles.cap}>{cap}</span>}
                    {score != null && (
                      <span className={styles.score}>RS {score.toFixed ? score.toFixed(1) : score}</span>
                    )}
                    {thesis && (
                      <span className={styles.caret}>{expanded ? '▾' : '▸'}</span>
                    )}
                  </div>
                  {expanded && thesis && (
                    <p className={styles.thesis}>{thesis}</p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </TileCard>
  )
}
