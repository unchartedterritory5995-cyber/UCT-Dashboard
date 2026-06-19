// app/src/components/tiles/OptionsFlowPreview.jsx
// Dashboard preview of the Options Flow conviction board — top 10 tickers by
// net option premium, laid out as two rows of five. The whole tile links
// through to the full /options-flow page (per-card and header).
import { Link } from 'react-router-dom'
import useMobileSWR from '../../hooks/useMobileSWR'
import TileCard from '../TileCard'
import ErrorState from '../ErrorState'
import { SkeletonTable } from '../Skeleton'
import styles from './OptionsFlowPreview.module.css'

const fetcher = url => fetch(url).then(r => r.json())

const fmt = (n) => {
  const a = Math.abs(n || 0)
  if (a >= 1e6) return '$' + (a / 1e6).toFixed(1) + 'M'
  if (a >= 1e3) return '$' + (a / 1e3).toFixed(0) + 'K'
  return '$' + a.toFixed(0)
}

const fmtStrike = (s) => (Number.isInteger(s) ? String(s) : Number(s).toFixed(2))

function FlowCard({ item }) {
  const bull = item.dir === 'BULL'
  const tc = item.topContract
  const dirClass = bull ? styles.bull : styles.bear
  return (
    <Link to="/options-flow" className={`${styles.card} ${dirClass}`}>
      <div className={styles.cardTop}>
        <span className={styles.rank}>{item.rank}</span>
        <span className={styles.sym}>{item.sym}</span>
        {item.er && <span className={styles.erTag}>ER</span>}
        <span className={`${styles.dirPill} ${dirClass}`}>{item.dir}</span>
      </div>
      <div className={styles.premRow}>
        <span className={`${styles.prem} ${dirClass}`}>{fmt(item.netPremium)}</span>
        <span className={styles.bullPct}>{item.bullPct}%</span>
      </div>
      {tc ? (
        <div className={styles.contract}>
          <div className={styles.contractLine}>
            <span className={tc.cp === 'C' ? styles.call : styles.put}>{tc.cp}</span>
            <span className={styles.strike}>${fmtStrike(tc.strike)}</span>
            <span className={styles.exp}>{tc.exp}</span>
            <span className={styles.hits}>{tc.hits}x</span>
          </div>
          <div className={styles.contractLine}>
            <span className={styles.tcPrem}>{fmt(tc.premium)}</span>
            <span className={styles.money}>
              {tc.moneyness}{tc.moneyness === 'OTM' && tc.otmPct ? ` +${tc.otmPct}%` : ''}
            </span>
          </div>
        </div>
      ) : (
        <div className={styles.contract} />
      )}
    </Link>
  )
}

export default function OptionsFlowPreview() {
  const { data, error, mutate } = useMobileSWR('/api/flow/top-conviction', fetcher, {
    refreshInterval: 60000,
    marketHoursOnly: true,
  })

  const items = Array.isArray(data?.items) ? data.items : []

  const viewAll = (
    <Link to="/options-flow" className={styles.viewAll}>View all →</Link>
  )

  return (
    <TileCard title="Options Flow" badge={data?.date || undefined} actions={viewAll}>
      {error ? (
        <ErrorState compact message="Failed to load options flow" onRetry={() => mutate()} />
      ) : !data ? (
        <SkeletonTable rows={2} cols={5} />
      ) : items.length === 0 ? (
        <Link to="/options-flow" className={styles.empty}>
          No conviction flow yet today — open the full board →
        </Link>
      ) : (
        <div className={styles.grid}>
          {items.map((it) => (
            <FlowCard key={it.sym} item={it} />
          ))}
        </div>
      )}
    </TileCard>
  )
}
