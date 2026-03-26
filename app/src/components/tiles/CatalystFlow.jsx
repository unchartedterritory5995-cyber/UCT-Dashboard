// app/src/components/tiles/CatalystFlow.jsx
import { useState, useRef } from 'react'
import useMobileSWR from '../../hooks/useMobileSWR'
import TileCard from '../TileCard'
import EarningsModal from './EarningsModal'
import ErrorBoundary from '../ErrorBoundary'
import { useTileCapture } from '../../hooks/useTileCapture'
import { SkeletonTable } from '../Skeleton'
import styles from './CatalystFlow.module.css'

const fetcher = url => fetch(url).then(r => r.json())

function VerdictPill({ verdict }) {
  const v = verdict?.toLowerCase()
  if (v === 'pending') return <span className={`${styles.pill} ${styles.pillPending}`}>PENDING</span>
  if (v === 'beat')    return <span className={`${styles.pill} ${styles.pillBeat}`}>BEAT</span>
  if (v === 'miss')    return <span className={`${styles.pill} ${styles.pillMiss}`}>MISS</span>
  if (v === 'mixed')   return <span className={`${styles.pill} ${styles.pillMixed}`}>MIXED</span>
  return <span className={styles.pillPending}>{verdict ?? '—'}</span>
}

function fmtEps(v) {
  if (v == null) return '—'
  const sign = v < 0 ? '-' : ''
  return `${sign}$${Math.abs(v).toFixed(2)}`
}

function fmtRev(m) {
  if (m == null) return '—'
  return m >= 1000 ? `$${(m / 1000).toFixed(1)}B` : `$${Math.round(m)}M`
}

function GapCell({ value }) {
  if (value == null) return <span className={styles.muted}>—</span>
  const n = typeof value === 'number' ? value : parseFloat(value)
  if (isNaN(n)) return <span className={styles.muted}>—</span>
  const fmt = n >= 0 ? `+${n.toFixed(2)}%` : `${n.toFixed(2)}%`
  return <span className={n >= 0 ? styles.pos : styles.neg}>{fmt}</span>
}

function EarningsTable({ rows, label, onSelect, liveGaps }) {
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
            <th className={styles.hideOnMobile}>EPS Act</th>
            <th className={styles.hideOnMobile}>Rev Act</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.sym} className={styles.clickRow} onClick={() => onSelect(row, label)}>
              <td><span className={styles.sym}>{row.sym}</span></td>
              <td><VerdictPill verdict={row.verdict} /></td>
              <td><GapCell value={liveGaps?.[row.sym] ?? row.change_pct} /></td>
              <td className={styles.hideOnMobile}>{fmtEps(row.reported_eps)}</td>
              <td className={styles.hideOnMobile}>{fmtRev(row.rev_actual)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function CatalystFlow({ data: propData }) {
  const { data: fetched } = useMobileSWR(
    propData !== undefined ? null : '/api/earnings',
    fetcher,
    { refreshInterval: 300000 }
  )
  const { data: liveGaps } = useMobileSWR(
    '/api/earnings-gaps',
    fetcher,
    { refreshInterval: 30000 }
  )

  const data = propData !== undefined ? propData : fetched
  const [selected, setSelected] = useState(null)
  const scrollBodyRef = useRef(null)
  const { tileRef, capturing, capture } = useTileCapture('earnings')

  const exportBtn = (
    <button
      className={styles.exportBtn}
      onClick={capture}
      disabled={capturing}
      title="Export as PNG"
    >
      {capturing ? '…' : '📷'}
    </button>
  )

  if (!data) return <TileCard title="Catalyst Flow"><SkeletonTable rows={5} cols={3} /></TileCard>

  return (
    <>
      <TileCard ref={tileRef} title="Earnings" actions={exportBtn}>
        <div className={styles.scrollBody} ref={scrollBodyRef}>
          <EarningsTable
            rows={data.bmo}
            label="BEFORE MARKET OPEN"
            onSelect={(row, label) => setSelected({ row, label })}
            liveGaps={liveGaps}
          />
          <EarningsTable
            rows={data.amc_tonight}
            label="AFTER CLOSE · TONIGHT"
            onSelect={(row, label) => setSelected({ row, label })}
            liveGaps={liveGaps}
          />
          <EarningsTable
            rows={data.amc}
            label="AFTER CLOSE · YESTERDAY"
            onSelect={(row, label) => setSelected({ row, label })}
            liveGaps={liveGaps}
          />
          {!data.bmo?.length && !data.amc_tonight?.length && !data.amc?.length && (
            <p className={styles.loading}>No earnings today</p>
          )}
        </div>
      </TileCard>

      {selected && (
        <ErrorBoundary fallback={<div style={{ color: 'var(--text-muted)', fontSize: '11px', fontFamily: 'monospace', padding: '12px' }}>Unable to load — click a ticker to retry.</div>} key={selected.row.sym}>
          <EarningsModal
            row={selected.row}
            label={selected.label}
            onClose={() => setSelected(null)}
          />
        </ErrorBoundary>
      )}
    </>
  )
}
