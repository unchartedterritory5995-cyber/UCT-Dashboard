import useMobileSWR from '../hooks/useMobileSWR'
import TickerPopup from '../components/TickerPopup'
import styles from './PostMarket.module.css'

const fetcher = url => fetch(url).then(r => r.json())

const SESSION_LABELS = {
  pre_market:  'Pre-Market',
  post_market: 'After Hours',
  regular:     'Market Open',
}

function formatVolume(v) {
  if (!v) return '—'
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`
  return String(v)
}

function MoverRow({ item, isGainer }) {
  const pctClass = isGainer ? styles.pctGreen : styles.pctRed
  const sign = isGainer ? '+' : ''
  return (
    <tr className={styles.row}>
      <td className={styles.tickerCell}>
        <TickerPopup sym={item.ticker} />
      </td>
      <td className={styles.priceCell}>${item.price?.toFixed(2)}</td>
      <td className={pctClass}>{sign}{item.change_pct?.toFixed(2)}%</td>
      <td className={styles.volCell}>{formatVolume(item.volume)}</td>
    </tr>
  )
}

function MoverTable({ title, items, isGainer }) {
  return (
    <div className={styles.column}>
      <h3 className={`${styles.colTitle} ${isGainer ? styles.colTitleGreen : styles.colTitleRed}`}>
        {title}
      </h3>
      <table className={styles.table}>
        <thead>
          <tr>
            <th className={styles.th}>Ticker</th>
            <th className={styles.th}>Price</th>
            <th className={styles.th}>% Chg</th>
            <th className={styles.th}>Volume</th>
          </tr>
        </thead>
        <tbody>
          {items?.length > 0
            ? items.map(item => (
                <MoverRow key={item.ticker} item={item} isGainer={isGainer} />
              ))
            : <tr><td colSpan={4} className={styles.empty}>No movers</td></tr>
          }
        </tbody>
      </table>
    </div>
  )
}

export default function PostMarket() {
  const { data, error } = useMobileSWR('/api/extended-movers', fetcher, {
    refreshInterval: 60_000,
    marketHoursOnly: true,
  })

  const session = data?.session || 'post_market'
  const label = SESSION_LABELS[session] || 'Extended Hours'

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.heading}>Extended Hours Movers</h1>
        <span className={`${styles.sessionBadge} ${styles[`session_${session}`]}`}>
          {label}
        </span>
      </div>

      {error && !data && (
        <p className={styles.errorText}>Failed to load movers data.</p>
      )}

      <div className={styles.grid}>
        <MoverTable title="Gainers" items={data?.gainers} isGainer={true} />
        <MoverTable title="Losers" items={data?.losers} isGainer={false} />
      </div>
    </div>
  )
}
