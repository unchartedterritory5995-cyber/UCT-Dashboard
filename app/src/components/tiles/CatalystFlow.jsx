// app/src/components/tiles/CatalystFlow.jsx
import { useState, useRef, useCallback } from 'react'
import useSWR from 'swr'
import TileCard from '../TileCard'
import EarningsModal from './EarningsModal'
import ErrorBoundary from '../ErrorBoundary'
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
            <th>EPS Act</th>
            <th>Rev Act</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.sym} className={styles.clickRow} onClick={() => onSelect(row, label)}>
              <td><span className={styles.sym}>{row.sym}</span></td>
              <td><VerdictPill verdict={row.verdict} /></td>
              <td><GapCell value={liveGaps?.[row.sym] ?? row.change_pct} /></td>
              <td>{fmtEps(row.reported_eps)}</td>
              <td>{fmtRev(row.rev_actual)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function CatalystFlow({ data: propData }) {
  const { data: fetched } = useSWR(
    propData !== undefined ? null : '/api/earnings',
    fetcher,
    { refreshInterval: 300000 }
  )
  const { data: liveGaps } = useSWR(
    '/api/earnings-gaps',
    fetcher,
    { refreshInterval: 30000 }
  )

  const data = propData !== undefined ? propData : fetched
  const [selected, setSelected] = useState(null)
  const [capturing, setCapturing] = useState(false)
  const tileRef = useRef(null)
  const scrollBodyRef = useRef(null)

  const captureScreenshot = useCallback(async () => {
    if (!tileRef.current || !scrollBodyRef.current || capturing) return
    setCapturing(true)

    const tileEl = tileRef.current
    const scrollEl = scrollBodyRef.current
    const bodyEl = scrollEl.parentElement   // TileCard's .body div (has overflow:hidden)

    // Save all constrained styles
    const prevTileOverflow = tileEl.style.overflow
    const prevTileHeight = tileEl.style.height
    const prevScrollOverflow = scrollEl.style.overflow
    const prevScrollHeight = scrollEl.style.height
    const prevBodyOverflow = bodyEl.style.overflow
    const prevBodyHeight = bodyEl.style.height

    // Expand all three containers so every row is visible before capture
    tileEl.style.overflow = 'visible'
    tileEl.style.height = 'auto'
    scrollEl.style.overflow = 'visible'
    scrollEl.style.height = 'auto'
    bodyEl.style.overflow = 'visible'
    bodyEl.style.height = 'auto'

    try {
      const { default: html2canvas } = await import('html2canvas')
      const bgColor = getComputedStyle(tileEl).backgroundColor
      const canvas = await html2canvas(tileEl, {
        backgroundColor: bgColor || '#0d0d0f',
        scale: 2,
        useCORS: true,
        logging: false,
        height: tileEl.scrollHeight,
        windowHeight: tileEl.scrollHeight,
      })

      const date = new Date().toISOString().slice(0, 10)
      const link = document.createElement('a')
      link.download = `earnings-${date}.png`
      link.href = canvas.toDataURL('image/png')
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    } finally {
      tileEl.style.overflow = prevTileOverflow
      tileEl.style.height = prevTileHeight
      scrollEl.style.overflow = prevScrollOverflow
      scrollEl.style.height = prevScrollHeight
      bodyEl.style.overflow = prevBodyOverflow
      bodyEl.style.height = prevBodyHeight
      setCapturing(false)
    }
  }, [capturing])

  const exportBtn = (
    <button
      className={styles.exportBtn}
      onClick={captureScreenshot}
      disabled={capturing}
      title="Export as PNG"
    >
      {capturing ? '…' : '📷'}
    </button>
  )

  if (!data) return <TileCard title="Catalyst Flow"><p className={styles.loading}>Loading…</p></TileCard>

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
