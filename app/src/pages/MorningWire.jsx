import useSWR from 'swr'
import TileCard from '../components/TileCard'
import TickerPopup from '../components/TickerPopup'
import styles from './MorningWire.module.css'

const fetcher = url => fetch(url).then(r => r.json())

// Small stat pill used in the page header strip
function StatPill({ label, value, color }) {
  return (
    <div className={`${styles.statPill} ${styles[`pill_${color}`]}`}>
      <span className={styles.pillLabel}>{label}</span>
      <span className={styles.pillValue}>{value}</span>
    </div>
  )
}

// Verdict badge for earnings rows
function VerdictBadge({ verdict }) {
  if (!verdict) return null
  const isbeat = verdict.toUpperCase() === 'BEAT'
  return (
    <span className={isbeat ? styles.beat : styles.miss}>
      {verdict.toUpperCase()}
    </span>
  )
}

// One earnings row inside "By the Numbers"
function EarningsRow({ row }) {
  const sym = row.sym || row.ticker || row.symbol
  const surprise = row.surprise_pct
  const isPos = typeof surprise === 'number' ? surprise > 0
    : typeof surprise === 'string' ? surprise.startsWith('+') : false

  return (
    <div className={styles.earningsRow}>
      <TickerPopup sym={sym} className={styles.earningsTicker} />
      <VerdictBadge verdict={row.verdict} />
      <span className={`${styles.surprise} ${isPos ? styles.gainText : styles.lossText}`}>
        {surprise != null
          ? (typeof surprise === 'number'
              ? `${surprise > 0 ? '+' : ''}${surprise.toFixed(1)}%`
              : surprise)
          : '—'}
      </span>
    </div>
  )
}

function ActionRow({ item, type }) {
  const { ticker, action, firm, from_rating, to_rating, price_target } = item
  const pt = price_target ? price_target.replace(/^\$/, '') : null
  const hasRatingChange = from_rating && to_rating && from_rating !== to_rating

  return (
    <div className={`${styles.actionRow} ${type === 'upgrade' ? styles.actionUp : styles.actionDown}`}>
      <TickerPopup sym={ticker} className={styles.actionTicker} />
      <span className={`${styles.actionBadge} ${type === 'upgrade' ? styles.badgeUp : styles.badgeDown}`}>
        {action}
      </span>
      {hasRatingChange && (
        <span className={styles.actionRating}>
          <span className={styles.ratingFrom}>{from_rating}</span>
          <span className={styles.ratingArrow}>→</span>
          <span className={styles.ratingTo}>{to_rating}</span>
        </span>
      )}
      {!hasRatingChange && to_rating && (
        <span className={styles.ratingTo}>{to_rating}</span>
      )}
      {pt && <span className={styles.actionPt}>${pt}</span>}
      {firm && <span className={styles.actionFirm}>{firm}</span>}
    </div>
  )
}

export default function MorningWire() {
  const { data: rundown }  = useSWR('/api/rundown',         fetcher, { refreshInterval: 300000 })
  const { data: analysts } = useSWR('/api/analyst-actions', fetcher, { refreshInterval: 300000 })

  const upgrades  = analysts?.upgrades  || []
  const downgrades = analysts?.downgrades || []

  return (
    <div className={styles.page}>

      {/* ── Page header ─────────────────────────────────────────── */}
      <div className={styles.pageHeader}>
        <div className={styles.titleRow}>
          <span className={styles.wireName}>The Morning Wire</span>
          {rundown?.date && <span className={styles.wireDate}>{rundown.date}</span>}
        </div>
      </div>

      {/* ── The Rundown ──────────────────────────────────────────── */}
      <TileCard>
        {rundown?.html
          ? (
            <div
              className={styles.rundownWrap}
              dangerouslySetInnerHTML={{ __html: rundown.html }}
            />
          )
          : <p className={styles.loading}>Loading rundown…</p>
        }
      </TileCard>

      {/* ── Analyst Activity ─────────────────────────────────────── */}
      <div className={styles.analystRow}>
        <TileCard title="Analyst Upgrades">
          {upgrades.length > 0
            ? upgrades.map((a, i) => <ActionRow key={i} item={a} type="upgrade" />)
            : <span className={styles.noData}>{analysts ? 'No upgrades today' : 'Loading…'}</span>
          }
        </TileCard>
        <TileCard title="Analyst Downgrades">
          {downgrades.length > 0
            ? downgrades.map((a, i) => <ActionRow key={i} item={a} type="downgrade" />)
            : <span className={styles.noData}>{analysts ? 'No downgrades today' : 'Loading…'}</span>
          }
        </TileCard>
      </div>

    </div>
  )
}
