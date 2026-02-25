// app/src/components/tiles/MARelationship.jsx
// SPY + QQQ price relationship to 9EMA, 20EMA, 50SMA, 200SMA
import useSWR from 'swr'
import styles from './MARelationship.module.css'

const fetcher = url => fetch(url).then(r => r.json())

const ROW1 = [
  { key: 'ema9_pct',  label: '9EMA' },
  { key: 'ema20_pct', label: '20EMA' },
]
const ROW2 = [
  { key: 'sma50_pct',  label: '50SMA' },
  { key: 'sma200_pct', label: '200SMA' },
]

function MAChip({ label, pct }) {
  const above  = pct != null && pct >= 0
  const color  = pct == null ? 'var(--text-muted)' : above ? 'var(--gain)' : 'var(--loss)'
  const arrow  = pct == null ? '' : above ? '▲' : '▼'
  const fmtPct = pct == null ? '—' : `${above ? '+' : ''}${pct.toFixed(2)}%`

  return (
    <div className={styles.chip} style={{ borderColor: color }}>
      <span className={styles.chipLabel}>{label}</span>
      <span className={styles.chipArrow} style={{ color }}>{arrow}</span>
      <span className={styles.chipPct} style={{ color }}>{fmtPct}</span>
    </div>
  )
}

function TickerCol({ ticker, data, livePrice }) {
  if (!data) return null
  const price = livePrice
    ? `$${livePrice}`
    : data.price != null ? `$${data.price.toFixed(2)}` : '—'

  return (
    <div className={styles.col}>
      <div className={styles.colHeader}>
        <span className={styles.ticker}>{ticker}</span>
        <span className={styles.price}>{price}</span>
      </div>
      <div className={styles.maGrid}>
        {ROW1.map(m => <MAChip key={m.key} label={m.label} pct={data[m.key] ?? null} />)}
        {ROW2.map(m => <MAChip key={m.key} label={m.label} pct={data[m.key] ?? null} />)}
      </div>
    </div>
  )
}

export default function MARelationship({ maData }) {
  if (!maData || (!maData.spy && !maData.qqq)) return null

  const { data: snapData } = useSWR('/api/snapshot', fetcher, { refreshInterval: 15000 })

  return (
    <div className={styles.wrap}>
      <div className={styles.cols}>
        <TickerCol ticker="SPY" data={maData.spy} livePrice={snapData?.etfs?.SPY?.price} />
        <TickerCol ticker="QQQ" data={maData.qqq} livePrice={snapData?.etfs?.QQQ?.price} />
      </div>
    </div>
  )
}
