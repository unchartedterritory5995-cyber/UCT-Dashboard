// app/src/components/tiles/LeadershipTile.jsx
import { useState, useMemo } from 'react'
import useMobileSWR from '../../hooks/useMobileSWR'
import useLivePrices from '../../hooks/useLivePrices'
import TileCard from '../TileCard'
import TickerPopup from '../TickerPopup'
import ErrorState from '../ErrorState'
import { SkeletonTable } from '../Skeleton'
import styles from './LeadershipTile.module.css'

const fetcher = url => fetch(url).then(r => r.json())

export default function LeadershipTile() {
  const { data: rows, error, mutate } = useMobileSWR('/api/leadership', fetcher, { refreshInterval: 30000, marketHoursOnly: true })
  const [expandedIdx, setExpandedIdx] = useState(null)
  const stocks = Array.isArray(rows) ? rows.slice(0, 20) : []

  const allTickers = useMemo(() =>
    stocks.map(item => item.ticker ?? item.sym ?? item.symbol).filter(Boolean),
    [stocks]
  )
  const { prices } = useLivePrices(allTickers)

  function toggle(i) {
    setExpandedIdx(prev => prev === i ? null : i)
  }

  return (
    <TileCard title="UCT 20">
      {error ? (
        <ErrorState compact message="Failed to load leadership" onRetry={() => mutate()} />
      ) : !rows ? (
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
            const live     = prices[sym]
            return (
              <div key={sym} className={styles.row}>
                <span className={styles.rank}>#{i + 1}</span>
                <div className={styles.body}>
                  <div className={styles.top} onClick={() => thesis && toggle(i)} style={thesis ? { cursor: 'pointer' } : undefined}>
                    <TickerPopup sym={sym}>
                      <span className={styles.sym}>{sym}</span>
                    </TickerPopup>
                    {live?.price != null && (
                      <span className={styles.livePrice}>${live.price.toFixed(2)}</span>
                    )}
                    {live?.change_pct != null && (
                      <span className={`${styles.liveChange} ${live.change_pct >= 0 ? styles.gain : styles.loss}`}>
                        {live.change_pct >= 0 ? '+' : ''}{live.change_pct.toFixed(1)}%
                      </span>
                    )}
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
