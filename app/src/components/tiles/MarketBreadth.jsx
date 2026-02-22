// app/src/components/tiles/MarketBreadth.jsx
import useSWR from 'swr'
import TileCard from '../TileCard'
import styles from './MarketBreadth.module.css'

const fetcher = url => fetch(url).then(r => r.json())

function Gauge({ value }) {
  const pct = Math.min(100, Math.max(0, value))
  const circumference = 157 // half circle arc length approx (Math.PI * 50)
  const strokeDash = (pct / 100) * circumference
  const color = pct > 60 ? 'var(--gain)' : pct > 40 ? 'var(--warn)' : 'var(--loss)'

  return (
    <div className={styles.gaugeWrap}>
      <svg viewBox="0 0 120 70" className={styles.gaugeSvg}>
        {/* Track */}
        <path
          d="M15,65 A50,50 0 0,1 105,65"
          fill="none"
          stroke="var(--border)"
          strokeWidth="10"
          strokeLinecap="round"
        />
        {/* Fill */}
        <path
          d="M15,65 A50,50 0 0,1 105,65"
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={`${strokeDash} ${circumference}`}
        />
        <text x="60" y="60" textAnchor="middle" fontSize="18" fontWeight="700" fill="var(--text-heading)">
          {Math.round(pct)}
        </text>
        <text x="60" y="72" textAnchor="middle" fontSize="7" fill="var(--text-muted)" letterSpacing="1">
          BREADTH
        </text>
      </svg>
    </div>
  )
}

export default function MarketBreadth({ data: propData }) {
  const { data: fetched } = useSWR(propData !== undefined ? null : '/api/breadth', fetcher)
  const data = propData !== undefined ? propData : fetched

  if (!data) {
    return <TileCard title="Market Breadth"><p className={styles.loading}>Loading…</p></TileCard>
  }

  const score = ((data.pct_above_50ma ?? 0) + (data.pct_above_200ma ?? 0)) / 2
  const distDays = data.distribution_days ?? 0
  const distColor = distDays >= 5 ? 'var(--loss)' : distDays >= 3 ? 'var(--warn)' : 'var(--gain)'

  return (
    <TileCard title="Market Breadth">
      <Gauge value={score} />

      <div className={styles.distRow}>
        <span className={styles.label}>Distribution Days:</span>
        <span className={styles.distVal} style={{ color: distColor }}>{distDays}</span>
      </div>

      <div className={styles.adRow}>
        <div className={styles.adItem}>
          <span className={styles.adLabel}>Advancing</span>
          <span className={styles.advancing}>{data.advancing ?? '—'}</span>
        </div>
        <div className={styles.adItem}>
          <span className={styles.adLabel}>Declining</span>
          <span className={styles.declining}>{data.declining ?? '—'}</span>
        </div>
      </div>

      <div className={styles.maRow}>
        <div className={styles.maItem}>
          <span className={styles.maLabel}>50MA</span>
          <span className={styles.maVal} style={{ color: 'var(--gain)' }}>{data.pct_above_50ma?.toFixed(1)}%</span>
        </div>
        <div className={styles.maItem}>
          <span className={styles.maLabel}>200MA</span>
          <span className={styles.maVal} style={{ color: 'var(--info)' }}>{data.pct_above_200ma?.toFixed(1)}%</span>
        </div>
      </div>
    </TileCard>
  )
}
