// app/src/components/tiles/CatalystFlow.jsx
import { useState } from 'react'
import useSWR from 'swr'
import TileCard from '../TileCard'
import EarningsModal from './EarningsModal'
import styles from './CatalystFlow.module.css'

const fetcher = url => fetch(url).then(r => r.json())

function VerdictPill({ verdict }) {
  const isBeat = verdict?.toLowerCase() === 'beat'
  const isPending = verdict?.toLowerCase() === 'pending'
  if (isPending) return <span className={`${styles.pill} ${styles.pillPending}`}>{verdict}</span>
  return (
    <span className={`${styles.pill} ${isBeat ? styles.pillBeat : styles.pillMiss}`}>
      {verdict ?? '—'}
    </span>
  )
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
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.sym}>
              <td>
                <button className={styles.symBtn} onClick={() => onSelect(row, label)}>
                  {row.sym}
                </button>
              </td>
              <td><VerdictPill verdict={row.verdict} /></td>
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
  const [selected, setSelected] = useState(null)  // { row, label }

  if (!data) return <TileCard title="Catalyst Flow"><p className={styles.loading}>Loading…</p></TileCard>

  return (
    <>
      <TileCard title="Catalyst Flow · Earnings">
        <EarningsTable
          rows={data.bmo}
          label="BEFORE MARKET OPEN"
          onSelect={(row, label) => setSelected({ row, label })}
        />
        <EarningsTable
          rows={data.amc}
          label="AFTER CLOSE · YESTERDAY"
          onSelect={(row, label) => setSelected({ row, label })}
        />
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
