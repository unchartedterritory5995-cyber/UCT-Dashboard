// app/src/components/tiles/CatalystFlow.jsx
import { useState } from 'react'
import useSWR from 'swr'
import TileCard from '../TileCard'
import EarningsModal from './EarningsModal'
import styles from './CatalystFlow.module.css'

const fetcher = url => fetch(url).then(r => r.json())

function VerdictPill({ verdict }) {
  const v = verdict?.toLowerCase()
  if (v === 'pending') return <span className={`${styles.pill} ${styles.pillPending}`}>PENDING</span>
  if (v === 'beat')    return <span className={`${styles.pill} ${styles.pillBeat}`}>BEAT</span>
  if (v === 'miss')    return <span className={`${styles.pill} ${styles.pillMiss}`}>MISS</span>
  return <span className={styles.pillPending}>{verdict ?? '—'}</span>
}

function SurpriseCell({ value }) {
  if (value == null) return <span className={styles.muted}>—</span>
  const isPos = typeof value === 'string' ? value.startsWith('+') : value > 0
  return <span className={isPos ? styles.pos : styles.neg}>{value}</span>
}

function GapCell({ value }) {
  if (value == null) return <span className={styles.muted}>—</span>
  const n = typeof value === 'number' ? value : parseFloat(value)
  if (isNaN(n)) return <span className={styles.muted}>—</span>
  const fmt = n >= 0 ? `+${n.toFixed(2)}%` : `${n.toFixed(2)}%`
  return <span className={n >= 0 ? styles.pos : styles.neg}>{fmt}</span>
}

function EarningsTable({ rows, label, onSelect }) {
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
            <tr key={row.sym} className={styles.clickRow} onClick={() => onSelect(row, label)}>
              <td><span className={styles.sym}>{row.sym}</span></td>
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
  const [selected, setSelected] = useState(null)

  if (!data) return <TileCard title="Catalyst Flow"><p className={styles.loading}>Loading…</p></TileCard>

  return (
    <>
      <TileCard title="Catalyst Flow · Earnings">
        <EarningsTable rows={data.bmo} label="BEFORE MARKET OPEN" onSelect={(row, label) => setSelected({ row, label })} />
        <EarningsTable rows={data.amc} label="AFTER CLOSE · YESTERDAY" onSelect={(row, label) => setSelected({ row, label })} />
        {!data.bmo?.length && !data.amc?.length && (
          <p className={styles.loading}>No earnings today</p>
        )}
      </TileCard>

      {selected && (
        <EarningsModal
          row={selected.row}
          label={selected.label}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  )
}
