// app/src/components/tiles/EarningsModal.jsx
import { useEffect, useState } from 'react'
import TickerPopup from '../TickerPopup'
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
  const [gap, setGap]           = useState(null)
  const [aiState, setAiState]   = useState({ loading: true, data: null })

  // Live gap %
  useEffect(() => {
    if (!row) return
    setGap(null)
    fetch(`/api/snapshot/${row.sym}`)
      .then(r => r.json())
      .then(d => { if (d.change_pct != null) setGap(d.change_pct) })
      .catch(() => {})
  }, [row?.sym])

  // AI analysis + related news
  useEffect(() => {
    if (!row) return
    setAiState({ loading: true, data: null })
    fetch(`/api/earnings-analysis/${row.sym}`)
      .then(r => r.json())
      .then(d => setAiState({ loading: false, data: d }))
      .catch(() => setAiState({ loading: false, data: null }))
  }, [row?.sym])

  // Escape key
  useEffect(() => {
    const handleKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  if (!row) return null

  const isBeat = row.verdict?.toLowerCase() === 'beat'
  const isPending = row.verdict?.toLowerCase() === 'pending'
  const summaryText = row.reported_eps != null && row.eps_estimate != null
    ? `${isBeat ? '✓ Beat' : '✗ Miss'} — EPS ${fmtEps(row.reported_eps)} vs ${fmtEps(row.eps_estimate)} est (${row.surprise_pct} surprise)`
    : isPending ? 'Pending — not yet reported' : null

  const hasAiContent = aiState.data?.analysis || aiState.data?.news

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

        {/* AI Analysis + Related News */}
        {!isPending && (
          aiState.loading ? (
            <div className={styles.aiLoading}>
              <span className={styles.aiSpinner} />
              Analyzing earnings…
            </div>
          ) : hasAiContent ? (
            <div className={styles.aiSection}>
              {aiState.data.analysis && (
                <p className={styles.aiText}>{aiState.data.analysis}</p>
              )}
              {aiState.data.news && (
                <a
                  href={aiState.data.news.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.newsLink}
                >
                  <span className={styles.newsSource}>{aiState.data.news.source}</span>
                  {aiState.data.news.headline} ↗
                </a>
              )}
            </div>
          ) : null
        )}

        <div className={styles.actions}>
          <TickerPopup sym={row.sym} showFinviz={true} as="button" className={styles.btnChart}>
            ▶ View Chart
          </TickerPopup>
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
