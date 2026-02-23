// app/src/components/tiles/EarningsModal.jsx
import { useEffect, useState } from 'react'
import styles from './EarningsModal.module.css'

function fmtEps(v) {
  if (v == null) return '—'
  const sign = v < 0 ? '-' : ''
  return `${sign}$${Math.abs(v).toFixed(2)}`
}

function fmtRev(m) {
  if (m == null) return '—'
  return m >= 1000 ? `$${(m / 1000).toFixed(2)}B` : `$${Math.round(m)}M`
}

export default function EarningsModal({ row, label, onClose }) {
  const [gap, setGap] = useState(null)

  useEffect(() => {
    if (!row) return
    setGap(null)
    fetch(`/api/snapshot/${row.sym}`)
      .then(r => r.json())
      .then(d => { if (d.change_pct != null) setGap(d.change_pct) })
      .catch(() => {})
  }, [row?.sym])

  useEffect(() => {
    const handleKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  if (!row) return null

  const isBeat = row.verdict?.toLowerCase() === 'beat'
  const summaryText = row.reported_eps != null && row.eps_estimate != null
    ? `${isBeat ? '✓ Beat' : '✗ Miss'} — EPS ${fmtEps(row.reported_eps)} vs ${fmtEps(row.eps_estimate)} est (${row.surprise_pct} surprise)`
    : row.verdict === 'Pending' ? 'Pending — not yet reported' : null

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">

        <div className={styles.header}>
          <span className={styles.sym}>{row.sym}</span>
          <button className={styles.close} onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className={styles.badges}>
          <span className={styles.badge}>⬛ EARNINGS REPORT</span>
          <span className={styles.badgeTime}>{label}</span>
        </div>

        <table className={styles.table}>
          <thead>
            <tr>
              <th>METRIC</th>
              <th>EXPECTED</th>
              <th>REPORTED</th>
              <th>SURPRISE</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>EPS</td>
              <td>{fmtEps(row.eps_estimate)}</td>
              <td>{fmtEps(row.reported_eps)}</td>
              <td className={row.surprise_pct?.startsWith('+') ? styles.pos : styles.neg}>
                {row.surprise_pct ?? '—'}
              </td>
            </tr>
            <tr>
              <td>REVENUE</td>
              <td>{fmtRev(row.rev_estimate)}</td>
              <td>{fmtRev(row.rev_actual)}</td>
              <td className={row.rev_surprise_pct?.startsWith('+') ? styles.pos : styles.neg}>
                {row.rev_surprise_pct ?? '—'}
              </td>
            </tr>
          </tbody>
        </table>

        {summaryText && (
          <div className={`${styles.summary} ${isBeat ? styles.summaryBeat : styles.summaryMiss}`}>
            {summaryText}
          </div>
        )}

        {gap != null && (
          <div className={`${styles.gap} ${gap >= 0 ? styles.pos : styles.neg}`}>
            {gap >= 0 ? '↑' : '↓'} Gap {gap >= 0 ? '+' : ''}{gap.toFixed(2)}%
          </div>
        )}

        <div className={styles.actions}>
          <a
            href={`https://finviz.com/chart.ashx?t=${row.sym}&ty=c&ta=1&p=d&s=l`}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.btnChart}
          >
            ▶ View Chart
          </a>
          <a
            href={`https://finviz.com/quote.ashx?t=${row.sym}`}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.btnFinviz}
          >
            FinViz ↗
          </a>
        </div>

      </div>
    </div>
  )
}
