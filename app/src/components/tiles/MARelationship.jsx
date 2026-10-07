// app/src/components/tiles/MARelationship.jsx
// SPY + QQQ price relationship to 9EMA, 20EMA, 50SMA, 200SMA
import useMobileSWR from '../../hooks/useMobileSWR'
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
  // Text reads in the text inks (WCAG AA on every theme); the border keeps the up/down hue.
  const ink    = pct == null ? 'var(--text-muted)' : above ? 'var(--success-ink)' : 'var(--danger-ink)'
  const arrow  = pct == null ? '' : above ? '▲' : '▼'
  const fmtPct = pct == null ? '—' : `${above ? '+' : ''}${pct.toFixed(2)}%`

  return (
    <div className={styles.chip} style={{ borderColor: color }}>
      <span className={styles.chipLabel}>{label}</span>
      <span className={styles.chipArrow} style={{ color: ink }}>{arrow}</span>
      <span className={styles.chipPct} style={{ color: ink }}>{fmtPct}</span>
    </div>
  )
}

function TickerCol({ ticker, data, livePrice, chg, chgCss, override }) {
  if (!data) return null
  // `override` ({price, label}) is a caller-supplied print — the newsletter's
  // pre-market number (owner ruling 2026-09-29: the internals panel must show
  // the same SPY/QQQ the letter quotes). When present it replaces the live
  // snapshot price AND hides the live day-change, which belongs to a
  // different print and would contradict it. Absent = unchanged behaviour.
  const hasOverride = override && Number.isFinite(override.price) && override.price > 0
  const price = hasOverride
    ? `$${override.price.toFixed(2)}`
    : livePrice
      ? `$${livePrice}`
      : data.price != null ? `$${data.price.toFixed(2)}` : '—'
  const chgColor = chgCss === 'pos' ? 'var(--success-ink)' : chgCss === 'neg' ? 'var(--danger-ink)' : 'var(--text-muted)'
  const chgArrow = chgCss === 'pos' ? '▲' : chgCss === 'neg' ? '▼' : ''

  return (
    <div className={styles.col}>
      <div className={styles.colHeader}>
        <span className={styles.ticker}>{ticker}</span>
        <span className={styles.price}>{price}</span>
        {hasOverride && override.label && (
          <span data-testid={`price-label-${ticker}`} className={styles.dayChg}
                style={{ color: 'var(--text-muted)', textTransform: 'lowercase' }}>
            {override.label}
          </span>
        )}
        {!hasOverride && chg && (
          <span className={styles.dayChg} style={{ color: chgColor }}>
            {chgArrow} {chg}
          </span>
        )}
      </div>
      <div className={styles.maGrid}>
        {ROW1.map(m => <MAChip key={m.key} label={m.label} pct={data[m.key] ?? null} />)}
        {ROW2.map(m => <MAChip key={m.key} label={m.label} pct={data[m.key] ?? null} />)}
      </div>
    </div>
  )
}

export default function MARelationship({ maData, priceOverride = null }) {
  if (!maData || (!maData.spy && !maData.qqq)) return null

  const { data: snapData } = useMobileSWR('/api/snapshot', fetcher, { refreshInterval: 15000 })

  return (
    <div className={styles.wrap}>
      <div className={styles.cols}>
        <TickerCol ticker="SPY" data={maData.spy} livePrice={snapData?.etfs?.SPY?.price}
          chg={snapData?.etfs?.SPY?.chg} chgCss={snapData?.etfs?.SPY?.css}
          override={priceOverride?.SPY} />
        <TickerCol ticker="QQQ" data={maData.qqq} livePrice={snapData?.etfs?.QQQ?.price}
          chg={snapData?.etfs?.QQQ?.chg} chgCss={snapData?.etfs?.QQQ?.css}
          override={priceOverride?.QQQ} />
      </div>
    </div>
  )
}
