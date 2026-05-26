import { useState } from 'react'
import useCatalysts from '../../hooks/useCatalysts'
import HighlightThesis from '../../utils/highlightThesis'
import { timeAgo } from '../../utils/timeAgo'
import TickerPopup from '../TickerPopup'
import { useAuth } from '../../context/AuthContext'
import styles from './CatalystTable.module.css'

const UI_ENABLED = (import.meta.env.VITE_CATALYST_UI_ENABLED ?? '1') !== '0'

function TagChip({ tag }) {
  const cls = {
    Catalyst: styles.tagCatalyst,
    Earnings: styles.tagEarnings,
    Gapper:   styles.tagGapper,
    News:     styles.tagNews,
  }[tag] || styles.tagDefault
  return <span className={`${styles.tag} ${cls}`}>{tag || '—'}</span>
}

function fmtPct(v) {
  if (v == null) return '—'
  const sign = v > 0 ? '+' : ''
  return `${sign}${v.toFixed(2)}%`
}

function fmtVolX(v) {
  if (v == null || v === 0) return '—'
  if (v >= 100) return `${v.toFixed(0)}×`
  if (v >= 10) return `${v.toFixed(1)}×`
  return `${v.toFixed(2)}×`
}

function fmtPrice(v) {
  if (v == null) return '—'
  return `$${v.toFixed(2)}`
}

export default function CatalystTable() {
  const { data, mutate, isValidating } = useCatalysts()
  const auth = useAuth() || {}
  const isAdmin = auth?.user?.role === 'admin'
  const [refreshing, setRefreshing] = useState(false)

  if (!UI_ENABLED) return null

  const rows = data?.rows || []
  const generatedAt = data?.generated_at

  async function forceRefresh() {
    if (!isAdmin) return
    setRefreshing(true)
    try {
      await fetch('/api/catalysts/refresh', { method: 'POST' })
      setTimeout(() => mutate(), 3000)
    } finally {
      setTimeout(() => setRefreshing(false), 4000)
    }
  }

  const updatedText = generatedAt ? `updated ${timeAgo(generatedAt)}` : 'no data yet'

  return (
    <div className={styles.tile}>
      <div className={styles.header}>
        <span className={styles.title}>🎯 MORNING CATALYSTS</span>
        <span className={styles.meta}>
          <span className={styles.updated}>{updatedText}</span>
          {isAdmin && (
            <button
              type="button"
              className={styles.refreshBtn}
              onClick={forceRefresh}
              disabled={refreshing || isValidating}
            >
              {refreshing ? '…' : '↻ Refresh'}
            </button>
          )}
        </span>
      </div>

      {rows.length === 0 ? (
        <div className={styles.empty}>
          No catalysts yet. Engine refreshes every 5 min during market hours.
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.colSym}>Sym</th>
                <th className={styles.colPrice}>Price</th>
                <th className={styles.colGap}>Gap %</th>
                <th className={styles.colVol}>Vol×</th>
                <th className={styles.colTag}>Tag</th>
                <th className={styles.colThesis}>Catalyst</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.ticker}>
                  <td className={styles.colSym}>
                    <TickerPopup sym={r.ticker}>
                      <span className={styles.ticker}>{r.ticker}</span>
                    </TickerPopup>
                  </td>
                  <td className={styles.colPrice}>{fmtPrice(r.price)}</td>
                  <td className={`${styles.colGap} ${(r.gap_pct ?? 0) >= 0 ? styles.gain : styles.loss}`}>
                    {fmtPct(r.gap_pct)}
                  </td>
                  <td className={styles.colVol}>{fmtVolX(r.vol_x)}</td>
                  <td className={styles.colTag}><TagChip tag={r.tag} /></td>
                  <td className={styles.colThesis}>
                    <HighlightThesis text={r.thesis_text} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className={styles.footer}>
        Informational only — not investment advice. Synthesized by Claude Opus 4.7.
      </div>
    </div>
  )
}
