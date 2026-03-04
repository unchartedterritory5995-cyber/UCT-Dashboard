// app/src/components/tiles/CatalystFlow.jsx
import useSWR from 'swr'
import TileCard from '../TileCard'
import TickerPopup from '../TickerPopup'
import styles from './CatalystFlow.module.css'

const fetcher = url => fetch(url).then(r => r.json())

function VerdictPill({ verdict }) {
  const v = verdict?.toLowerCase()
  if (v === 'pending') return <span className={`${styles.pill} ${styles.pillPending}`}>PENDING</span>
  if (v === 'beat')    return <span className={`${styles.pill} ${styles.pillBeat}`}>BEAT</span>
  if (v === 'miss')    return <span className={`${styles.pill} ${styles.pillMiss}`}>MISS</span>
  return <span className={styles.pillPending}>{verdict ?? '—'}</span>
}

function fmtPct(val) {
  if (val == null) return null
  const n = typeof val === 'string' ? parseFloat(val) : val
  if (isNaN(n)) return null
  return n >= 0 ? `+${n.toFixed(2)}%` : `${n.toFixed(2)}%`
}

function SurpriseCell({ value }) {
  if (value == null) return <span className={styles.muted}>—</span>
  const isPos = typeof value === 'string' ? value.startsWith('+') : value > 0
  return <span className={isPos ? styles.pos : styles.neg}>{value}</span>
}

function GapCell({ value }) {
  const fmt = fmtPct(value)
  if (fmt == null) return <span className={styles.muted}>—</span>
  const isPos = (typeof value === 'number' ? value : parseFloat(value)) >= 0
  return <span className={isPos ? styles.pos : styles.neg}>{fmt}</span>
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
            <th>Gap</th>
            <th>EPS</th>
            <th>Rev</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.sym}>
              <td>
                <TickerPopup sym={row.sym} className={styles.sym} />
              </td>
              <td><VerdictPill verdict={row.verdict} /></td>
              <td><GapCell value={row.change_pct} /></td>
              <td><SurpriseCell value={row.surprise_pct} /></td>
              <td><SurpriseCell value={row.rev_surprise_pct} /></td>
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
      <EarningsTable rows={data.bmo} label="BEFORE MARKET OPEN" />
      <EarningsTable rows={data.amc} label="AFTER CLOSE · YESTERDAY" />
      {!data.bmo?.length && !data.amc?.length && (
        <p className={styles.loading}>No earnings today</p>
      )}
    </TileCard>
  )
}
