// app/src/components/tiles/MARelationship.jsx
// SPY + QQQ price relationship to 9EMA, 20EMA, 50SMA, 200SMA
import useSWR from 'swr'
import styles from './MARelationship.module.css'

const fetcher = url => fetch(url).then(r => r.json())

const MAS = [
  { key: 'ema9_pct',   label: '9E' },
  { key: 'ema20_pct',  label: '20E' },
  { key: 'sma50_pct',  label: '50S' },
  { key: 'sma200_pct', label: '200S' },
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

function TickerRow({ ticker, data, livePrice }) {
  if (!data) return null
  const price = livePrice
    ? `$${livePrice}`
    : data.price != null ? `$${data.price.toFixed(2)}` : '—'

  return (
    <div className={styles.row}>
      <div className={styles.tickerCol}>
        <span className={styles.ticker}>{ticker}</span>
        <span className={styles.price}>{price}</span>
      </div>
      <div className={styles.chips}>
        {MAS.map(m => (
          <MAChip key={m.key} label={m.label} pct={data[m.key] ?? null} />
        ))}
      </div>
    </div>
  )
}

export default function MARelationship({ maData }) {
  if (!maData || (!maData.spy && !maData.qqq)) return null

  const { data: snapData } = useSWR('/api/snapshot', fetcher, { refreshInterval: 15000 })

  return (
    <div className={styles.wrap}>
      <TickerRow ticker="SPY" data={maData.spy} livePrice={snapData?.etfs?.SPY?.price} />
      <TickerRow ticker="QQQ" data={maData.qqq} livePrice={snapData?.etfs?.QQQ?.price} />
    </div>
  )
}
