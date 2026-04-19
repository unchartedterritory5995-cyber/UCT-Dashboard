/**
 * Generate Report modal — configures the report scope then opens a
 * new tab with a print-friendly view. User hits Cmd/Ctrl+P to save PDF.
 *
 * Keeps config in-memory only; the print page re-fetches data using the
 * URL params passed through the generated route.
 */

import { useEffect, useState } from 'react'
import useJ2Accounts from '../hooks/useJ2Accounts'
import useJ2SelectedAccount from '../hooks/useJ2SelectedAccount'
import styles from './GenerateReportModal.module.css'

const PERIODS = [
  { key: 'week', label: 'This Week' },
  { key: 'month', label: 'This Month' },
  { key: 'last-month', label: 'Last Month' },
  { key: 'ytd', label: 'YTD' },
  { key: 'all', label: 'All Time' },
]

const SECTIONS = [
  { key: 'summary', label: 'Summary Stats' },
  { key: 'equity', label: 'Equity Curve' },
  { key: 'daily', label: 'Daily P&L' },
  { key: 'dow', label: 'Day of Week' },
  { key: 'hourly', label: 'Hourly Performance' },
  { key: 'bySetup', label: 'By Setup' },
  { key: 'bySymbol', label: 'By Symbol' },
  { key: 'trades', label: 'Full Trade Log' },
]

function computeRange(period) {
  const now = new Date()
  const y = now.getUTCFullYear()
  const m = now.getUTCMonth()
  const d = now.getUTCDate()
  const iso = (dt) => dt.toISOString().slice(0, 10)
  switch (period) {
    case 'week': {
      const dow = now.getUTCDay() // 0 = Sun
      const mon = new Date(Date.UTC(y, m, d - ((dow + 6) % 7)))
      return { from: iso(mon), to: iso(now) }
    }
    case 'month':
      return { from: `${y}-${String(m + 1).padStart(2, '0')}-01`, to: iso(now) }
    case 'last-month': {
      const lm = m === 0 ? 11 : m - 1
      const ly = m === 0 ? y - 1 : y
      const lastDay = new Date(Date.UTC(ly, lm + 1, 0))
      return {
        from: `${ly}-${String(lm + 1).padStart(2, '0')}-01`,
        to: iso(lastDay),
      }
    }
    case 'ytd':
      return { from: `${y}-01-01`, to: iso(now) }
    default:
      return { from: null, to: null }
  }
}

export default function GenerateReportModal({ onClose }) {
  const { accounts } = useJ2Accounts()
  const { accountId } = useJ2SelectedAccount()
  const [period, setPeriod] = useState('month')
  const [accountFilter, setAccountFilter] = useState(accountId || 'all')
  const [selectedSections, setSelectedSections] = useState(
    SECTIONS.reduce((acc, s) => ({ ...acc, [s.key]: true }), {}),
  )

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const toggleSection = (key) => {
    setSelectedSections((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const generate = () => {
    const { from, to } = computeRange(period)
    const params = new URLSearchParams()
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    params.set('period', period)
    if (accountFilter !== 'all') params.set('account_id', accountFilter)
    const sections = Object.entries(selectedSections)
      .filter(([, v]) => v)
      .map(([k]) => k)
      .join(',')
    params.set('sections', sections)
    const url = `/journal-2-0/report?${params.toString()}`
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  const selectedCount = Object.values(selectedSections).filter(Boolean).length

  return (
    <div className={styles.backdrop} onClick={(e) => { if (e.target === e.currentTarget) onClose?.() }}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2 className={styles.title}>Generate Report</h2>
          <button type="button" className={styles.xBtn} onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className={styles.body}>
          <div className={styles.field}>
            <span className={styles.label}>Period</span>
            <div className={styles.pills}>
              {PERIODS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  className={`${styles.pill} ${period === p.key ? styles.pillActive : ''}`}
                  onClick={() => setPeriod(p.key)}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <label className={styles.field}>
            <span className={styles.label}>Account</span>
            <select
              value={accountFilter}
              onChange={(e) => setAccountFilter(e.target.value)}
              className={styles.select}
            >
              <option value="all">All Accounts</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </label>

          <div className={styles.field}>
            <span className={styles.label}>Sections</span>
            <div className={styles.sectionsGrid}>
              {SECTIONS.map((s) => (
                <label key={s.key} className={styles.checkRow}>
                  <input
                    type="checkbox"
                    checked={!!selectedSections[s.key]}
                    onChange={() => toggleSection(s.key)}
                    className={styles.checkbox}
                  />
                  <span>{s.label}</span>
                </label>
              ))}
            </div>
          </div>

          <p className={styles.hint}>
            Opens a print-friendly view in a new tab. Use <kbd>Ctrl</kbd>+<kbd>P</kbd>
            (or <kbd>⌘</kbd>+<kbd>P</kbd>) to save as PDF or print.
          </p>
        </div>
        <div className={styles.footer}>
          <button type="button" className={styles.ghost} onClick={onClose}>Cancel</button>
          <button
            type="button"
            className={styles.primary}
            onClick={generate}
            disabled={selectedCount === 0}
          >
            Generate Report
          </button>
        </div>
      </div>
    </div>
  )
}
