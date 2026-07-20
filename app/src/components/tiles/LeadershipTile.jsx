// app/src/components/tiles/LeadershipTile.jsx
import { useState, useMemo } from 'react'
import useMobileSWR from '../../hooks/useMobileSWR'
import useRealtimePrices from '../../hooks/useRealtimePrices'
import TileCard from '../TileCard'
import TickerPopup from '../TickerPopup'
import CompanyLogo from '../CompanyLogo'
import ErrorState from '../ErrorState'
import { SkeletonTable } from '../Skeleton'
import styles from './LeadershipTile.module.css'

const fetcher = url => fetch(url).then(r => r.json())

export default function LeadershipTile() {
  const { data: rows, error, mutate } = useMobileSWR('/api/leadership', fetcher, { refreshInterval: 30000, marketHoursOnly: true })
  const [expandedIdx, setExpandedIdx] = useState(null)
  // Accept both the new wrapped shape and the legacy raw-array shape.
  const rawStocks = Array.isArray(rows)
    ? rows
    : Array.isArray(rows?.stocks) ? rows.stocks : []
  const stocks = rawStocks.slice(0, 20)
  const leadershipStatus = (rows && !Array.isArray(rows)) ? rows.status : null

  const allTickers = useMemo(() =>
    stocks.map(item => item.ticker ?? item.sym ?? item.symbol).filter(Boolean),
    [stocks]
  )
  const { prices } = useRealtimePrices(allTickers)

  function toggle(i) {
    setExpandedIdx(prev => prev === i ? null : i)
  }

  return (
    <TileCard icon="star" title="UCT 20">
      {error ? (
        <ErrorState compact message="Failed to load leadership" onRetry={() => mutate()} />
      ) : !rows ? (
        <SkeletonTable rows={5} cols={3} />
      ) : stocks.length === 0 ? (
        <p className={styles.loading}>
          {leadershipStatus === 'stale'
            ? 'Leadership data is stale. Next refresh: 7:35 AM ET.'
            : 'Leadership refreshes daily at 7:35 AM ET. Check back after.'}
        </p>
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
                    <CompanyLogo sym={sym} size={20} tile />
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
                      <span className={styles.score}>RATING {score.toFixed ? score.toFixed(1) : score}</span>
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
