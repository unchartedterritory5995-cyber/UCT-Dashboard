// app/src/components/tiles/CatalystFlow.jsx
import useSWR from 'swr'
import TileCard from '../TileCard'
import styles from './CatalystFlow.module.css'

const fetcher = url => fetch(url).then(r => r.json())

function fmtRev(m) {
  if (m == null) return '—'
  return m >= 1000 ? `$${(m / 1000).toFixed(1)}B` : `$${Math.round(m)}M`
}

function VerdictPill({ verdict }) {
  const isBeat = verdict?.toLowerCase() === 'beat'
  return (
    <span className={`${styles.pill} ${isBeat ? styles.pillBeat : styles.pillMiss}`}>
      {verdict ?? '—'}
    </span>
  )
}

function EarningsTable({ rows, label }) {
  if (!rows?.length) return null
  return (
    <div className={styles.tableWrap}>
      <div className={styles.tableLabel}>{label}</div>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Ticker</th>
            <th>Verdict</th>
            <th>EPS Est</th>
            <th>EPS Act</th>
            <th>EPS Surp</th>
            <th>Rev Est</th>
            <th>Rev Act</th>
            <th>Rev Surp</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.sym}>
              <td className={styles.sym}>{row.sym}</td>
              <td><VerdictPill verdict={row.verdict} /></td>
              <td className={styles.mono}>{row.eps_estimate ?? '—'}</td>
              <td className={styles.mono}>{row.reported_eps ?? '—'}</td>
              <td className={`${styles.mono} ${row.surprise_pct?.startsWith('+') ? styles.pos : styles.neg}`}>
                {row.surprise_pct ?? '—'}
              </td>
              <td className={styles.mono}>{fmtRev(row.rev_estimate)}</td>
              <td className={styles.mono}>{fmtRev(row.rev_actual)}</td>
              <td className={`${styles.mono} ${row.rev_surprise_pct?.startsWith('+') ? styles.pos : styles.neg}`}>
                {row.rev_surprise_pct ?? '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function CatalystFlow({ data: propData }) {
  const { data: fetched } = useSWR(propData !== undefined ? null : '/api/earnings', fetcher)
  const data = propData !== undefined ? propData : fetched

  if (!data) return <TileCard title="Catalyst Flow"><p className={styles.loading}>Loading…</p></TileCard>

  return (
    <TileCard title="Catalyst Flow · Earnings">
      <EarningsTable rows={data.bmo} label="▲ Before Market Open" />
      <EarningsTable rows={data.amc} label="▼ After Close · Yesterday" />
      {!data.bmo?.length && !data.amc?.length && (
        <p className={styles.loading}>No earnings today</p>
      )}
    </TileCard>
  )
}
