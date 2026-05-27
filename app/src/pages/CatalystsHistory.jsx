// app/src/pages/CatalystsHistory.jsx
//
// Read-only browser for past catalyst snapshots. Lets the user pick a
// trading date and see what catalysts the engine surfaced that day,
// with the same prose/tag/source-citation richness as the live tile.
//
// Uses GET /api/catalysts/by-date/{yyyy-mm-dd} which has been live since
// Phase 1 — historical data is already accumulating.
import { useEffect, useState } from 'react'
import useSWR from 'swr'
import HighlightThesis from '../utils/highlightThesis'
import { timeAgo, formatET } from '../utils/timeAgo'
import TickerPopup from '../components/TickerPopup'
import styles from './CatalystsHistory.module.css'

const fetcher = (url) => fetch(url).then((r) => (r.ok ? r.json() : { rows: [] }))

function ymdNDaysAgo(n) {
  // ET-aware date string. Returns YYYY-MM-DD.
  const now = new Date()
  // Approximate ET offset by formatting in America/New_York
  const etStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now)
  // etStr is "YYYY-MM-DD"; subtract n days using a Date
  const [y, m, d] = etStr.split('-').map(Number)
  const base = new Date(Date.UTC(y, m - 1, d))
  base.setUTCDate(base.getUTCDate() - n)
  return `${base.getUTCFullYear()}-${String(base.getUTCMonth() + 1).padStart(2, '0')}-${String(base.getUTCDate()).padStart(2, '0')}`
}

function fmtPct(v) {
  if (v == null) return '—'
  const sign = v > 0 ? '+' : ''
  return `${sign}${v.toFixed(2)}%`
}

function fmtPrice(v) {
  if (v == null) return '—'
  return `$${v.toFixed(2)}`
}

function TagChip({ tag }) {
  const cls = {
    Catalyst: styles.tagCatalyst,
    Earnings: styles.tagEarnings,
    Gapper: styles.tagGapper,
    News: styles.tagNews,
  }[tag] || styles.tagDefault
  return <span className={`${styles.tag} ${cls}`}>{tag || '—'}</span>
}

function parseSources(raw) {
  if (!raw) return []
  if (Array.isArray(raw)) return raw.filter(Boolean)
  try {
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.filter(Boolean) : []
  } catch {
    return []
  }
}

export default function CatalystsHistory() {
  const [date, setDate] = useState(ymdNDaysAgo(0))
  const { data, isLoading } = useSWR(
    `/api/catalysts/by-date/${date}`,
    fetcher,
    { revalidateOnFocus: false }
  )
  const rows = data?.rows || []

  // Quick-jump links
  const quickJumps = [
    { label: 'Today', d: ymdNDaysAgo(0) },
    { label: 'Yesterday', d: ymdNDaysAgo(1) },
    { label: '1 week ago', d: ymdNDaysAgo(7) },
    { label: '30 days ago', d: ymdNDaysAgo(30) },
  ]

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>📚 Catalyst History</h1>
        <p className={styles.subtitle}>
          Browse the engine's top-ranked single-stock catalysts from any past trading day.
          What was moving — and why — on a date you remember.
        </p>
      </div>

      <div className={styles.controlsRow}>
        <label className={styles.dateLabel}>
          <span>Pick a date:</span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className={styles.dateInput}
            max={ymdNDaysAgo(0)}
          />
        </label>
        <div className={styles.quickJumps}>
          {quickJumps.map((q) => (
            <button
              key={q.label}
              type="button"
              className={`${styles.quickBtn} ${q.d === date ? styles.quickBtnActive : ''}`}
              onClick={() => setDate(q.d)}
            >
              {q.label}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.tile}>
        <div className={styles.tileHeader}>
          <span className={styles.tileTitle}>🎯 Top Catalysts · {date}</span>
          <span className={styles.tileMeta}>{rows.length} rows</span>
        </div>

        {isLoading ? (
          <div className={styles.empty}>Loading…</div>
        ) : rows.length === 0 ? (
          <div className={styles.empty}>
            No catalysts recorded for this date. The engine started persisting on 2026-05-25;
            earlier dates won't have data. Weekends + holidays may also be empty.
          </div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.colSym}>Sym</th>
                  <th className={styles.colPrice}>Price</th>
                  <th className={styles.colGap}>% Change</th>
                  <th className={styles.colVol}>Vol×</th>
                  <th className={styles.colTag}>Tag</th>
                  <th className={styles.colThesis}>Catalyst</th>
                  <th className={styles.colWhen}>Catalyst Time</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const sources = parseSources(r.thesis_sources)
                  return (
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
                      <td className={styles.colVol}>
                        {r.vol_x ? `${r.vol_x.toFixed(2)}×` : '—'}
                      </td>
                      <td className={styles.colTag}><TagChip tag={r.tag} /></td>
                      <td className={styles.colThesis}>
                        <HighlightThesis text={r.thesis_text} />
                        {sources.length > 0 && (
                          <span className={styles.sourceCount} title={`${sources.length} cited sources`}>
                            · {sources.length} src
                          </span>
                        )}
                      </td>
                      <td className={styles.colWhen}>
                        {r.catalyst_at
                          ? formatET(r.catalyst_at)
                          : (r.thesis_at ? formatET(r.thesis_at) : '—')}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className={styles.footer}>
          Historical snapshots are read-only. Informational only — not investment advice.
        </div>
      </div>
    </div>
  )
}
