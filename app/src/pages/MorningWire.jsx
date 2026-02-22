import useSWR from 'swr'
import TileCard from '../components/TileCard'
import styles from './MorningWire.module.css'

const fetcher = url => fetch(url).then(r => r.json())

export default function MorningWire() {
  const { data: rundown } = useSWR('/api/rundown', fetcher, { refreshInterval: 300000 })
  const { data: breadth } = useSWR('/api/breadth', fetcher, { refreshInterval: 300000 })
  const { data: earnings } = useSWR('/api/earnings', fetcher, { refreshInterval: 300000 })
  const { data: leadership } = useSWR('/api/leadership', fetcher, { refreshInterval: 300000 })

  return (
    <div className={styles.page}>
      <h1 className={styles.heading}>The Morning Wire</h1>

      {/* The Rundown — AI narrative */}
      <TileCard title="The Rundown">
        {rundown?.html
          ? <div className={styles.rundownContent} dangerouslySetInnerHTML={{ __html: rundown.html }} />
          : <p className={styles.loading}>Loading rundown…</p>
        }
      </TileCard>

      {/* Market Breadth & Regime */}
      <TileCard title="Market Breadth & Regime">
        {breadth
          ? (
            <div className={styles.breadthGrid}>
              <div className={styles.stat}>
                <span className={styles.label}>Market Phase</span>
                <span className={styles.value}>{breadth.market_phase || 'N/A'}</span>
              </div>
              <div className={styles.stat}>
                <span className={styles.label}>Distribution Days</span>
                <span className={styles.value} style={{color: (breadth.distribution_days || 0) >= 5 ? 'var(--loss)' : 'var(--warn)'}}>
                  {breadth.distribution_days ?? 0}
                </span>
              </div>
              <div className={styles.stat}>
                <span className={styles.label}>% Above 50MA</span>
                <span className={styles.value} style={{color:'var(--gain)'}}>{breadth.pct_above_50ma?.toFixed(1)}%</span>
              </div>
              <div className={styles.stat}>
                <span className={styles.label}>% Above 200MA</span>
                <span className={styles.value} style={{color:'var(--info)'}}>{breadth.pct_above_200ma?.toFixed(1)}%</span>
              </div>
            </div>
          )
          : <p className={styles.loading}>Loading breadth…</p>
        }
      </TileCard>

      {/* The Wire — Earnings */}
      <TileCard title="The Wire · Earnings">
        {earnings
          ? (
            <div>
              <div className={styles.earningsSection}>
                <h3 className={styles.subheading}>Before Market Open</h3>
                <EarningsTable rows={earnings.bmo || []} />
              </div>
              <div className={styles.earningsSection}>
                <h3 className={styles.subheading}>After Market Close</h3>
                <EarningsTable rows={earnings.amc || []} />
              </div>
            </div>
          )
          : <p className={styles.loading}>Loading earnings…</p>
        }
      </TileCard>

      {/* Leadership 20 */}
      <TileCard title="UCT Leadership 20">
        {leadership && leadership.length > 0
          ? (
            <div className={styles.leadershipGrid}>
              {leadership.map((item, i) => (
                <div key={item.sym || item.ticker || item.symbol || i} className={styles.leaderCard}>
                  <span className={styles.leaderSym}>{item.sym || item.ticker || item.symbol}</span>
                  {item.thesis && <p className={styles.leaderThesis}>{item.thesis}</p>}
                </div>
              ))}
            </div>
          )
          : <p className={styles.loading}>Loading leadership…</p>
        }
      </TileCard>

      {/* Options Flow — placeholder */}
      <TileCard title="Options Flow">
        <p className={styles.loading}>Options flow data coming soon</p>
      </TileCard>
    </div>
  )
}

function EarningsTable({ rows }) {
  if (!rows.length) return <p className={styles.noData}>No earnings</p>
  return (
    <table className={styles.earningsTable}>
      <thead>
        <tr>
          <th>Ticker</th>
          <th>EPS Est</th>
          <th>EPS Act</th>
          <th>Surprise</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={row.sym || row.ticker || i}>
            <td className={styles.sym}>{row.sym || row.ticker}</td>
            <td>{row.eps_est ?? '—'}</td>
            <td>{row.eps_act ?? '—'}</td>
            <td style={{color: (row.surprise_pct ?? 0) > 0 ? 'var(--gain)' : 'var(--loss)'}}>
              {row.surprise_pct != null ? `${row.surprise_pct > 0 ? '+' : ''}${row.surprise_pct}%` : '—'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
