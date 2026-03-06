import { useState } from 'react'
import useSWR from 'swr'
import TickerPopup from '../components/TickerPopup'
import styles from './Screener.module.css'

const fetcher = url => fetch(url).then(r => r.json())

const TABS = [
  { key: 'pullback_ma', label: 'Pullback MA' },
  { key: 'remount',     label: 'Remount' },
  { key: 'gapper_news', label: 'Gappers' },
]

const SETUP_META = {
  PULLBACK_MA:  { label: 'PULLBACK MA', cls: styles.badgePullback },
  REMOUNT:      { label: 'REMOUNT',     cls: styles.badgeRemount },
  GAPPER_NEWS:  { label: 'GAPPER',      cls: styles.badgeGapper },
}

function SetupBadge({ type }) {
  const meta = SETUP_META[type] ?? { label: type, cls: '' }
  return <span className={`${styles.badge} ${meta.cls}`}>{meta.label}</span>
}

function fmtPct(val, forcePos = false) {
  if (val == null) return <span className={styles.numNeutral}>—</span>
  const sign = val >= 0 ? '+' : ''
  const cls = val > 0 ? styles.numPos : val < 0 ? styles.numNeg : styles.numNeutral
  return <span className={cls}>{sign}{val.toFixed(1)}%</span>
}

function fmtRsi(val) {
  if (val == null) return <span className={styles.numNeutral}>—</span>
  return <span className={styles.numNeutral}>{Math.round(val)}</span>
}

function AlsoChips({ list }) {
  if (!list || list.length === 0) return null
  return (
    <>
      {list.map(t => (
        <span key={t} className={styles.alsoChip}>also: {t.replaceAll('_', ' ').toLowerCase()}</span>
      ))}
    </>
  )
}

function PullbackRow({ row }) {
  return (
    <tr className={styles.row}>
      <td><SetupBadge type={row.setup_type} /></td>
      <td className={styles.ticker}>
        <TickerPopup sym={row.ticker} />
        <AlsoChips list={row.also_qualified_as} />
      </td>
      <td className={styles.company}>{row.company || '—'}</td>
      <td className={styles.sector}>{row.sector || '—'}</td>
      <td>{fmtRsi(row.rsi)}</td>
      <td>{fmtPct(row.sma20_dist_pct, true)}</td>
      <td>{fmtPct(row.sma50_dist_pct, true)}</td>
      <td>{fmtPct(row.change_pct)}</td>
    </tr>
  )
}

function GapperRow({ row }) {
  return (
    <tr className={styles.row}>
      <td><SetupBadge type={row.setup_type} /></td>
      <td className={styles.ticker}>
        <TickerPopup sym={row.ticker} />
        <AlsoChips list={row.also_qualified_as} />
      </td>
      <td className={styles.company}>{row.company || '—'}</td>
      <td className={styles.sector}>{row.sector || '—'}</td>
      <td>{fmtPct(row.gap_pct, true)}</td>
      <td>{fmtPct(row.change_pct)}</td>
    </tr>
  )
}

function CandidateTable({ rows, tabKey }) {
  if (!rows || rows.length === 0) {
    return (
      <div className={styles.emptyState}>
        No candidates — scanner runs at 7:00 AM CT
      </div>
    )
  }

  const isGapper = tabKey === 'gapper_news'

  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>Setup</th>
          <th>Ticker</th>
          <th>Company</th>
          <th>Sector</th>
          {isGapper ? (
            <>
              <th>Gap%</th>
              <th>Chg%</th>
            </>
          ) : (
            <>
              <th>RSI</th>
              <th>SMA20%</th>
              <th>SMA50%</th>
              <th>Chg%</th>
            </>
          )}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          isGapper
            ? <GapperRow key={row.ticker || i} row={row} />
            : <PullbackRow key={row.ticker || i} row={row} />
        ))}
      </tbody>
    </table>
  )
}

export default function Screener() {
  const [activeTab, setActiveTab] = useState('pullback_ma')

  const { data, error } = useSWR('/api/candidates', fetcher, {
    refreshInterval: 30 * 60 * 1000,
  })

  const candidates = data?.candidates ?? {}
  const pullbackRows  = candidates.pullback_ma  ?? []
  const remountRows   = candidates.remount      ?? []
  const gapperRows    = candidates.gapper_news  ?? []

  const totalCount = pullbackRows.length + remountRows.length + gapperRows.length

  const countFor = {
    pullback_ma: pullbackRows.length,
    remount:     remountRows.length,
    gapper_news: gapperRows.length,
  }

  const activeRows = activeTab === 'pullback_ma'
    ? pullbackRows
    : activeTab === 'remount'
      ? remountRows
      : gapperRows

  const leadingSectors = data?.leading_sectors_used ?? []
  const generatedAt    = data?.generated_at ?? null

  return (
    <div className={styles.container}>

      <div className={styles.header}>
        <h1 className={styles.heading}>Scanner Hub</h1>
        <div className={styles.headerRight}>
          {leadingSectors.length > 0 && (
            <div className={styles.sectorPills}>
              <span className={styles.sectorLabel}>Leading sectors:</span>
              {leadingSectors.map(s => (
                <span key={s} className={styles.sectorPill}>{s}</span>
              ))}
            </div>
          )}
          {totalCount > 0 && (
            <span className={styles.totalCount}>{totalCount} candidates</span>
          )}
        </div>
      </div>

      {error ? (
        <div className={styles.emptyState}>Scanner data unavailable</div>
      ) : !data ? (
        <div className={styles.emptyState}>Loading scanner data...</div>
      ) : (
        <>
          <div className={styles.tabs}>
            {TABS.map(t => (
              <button
                key={t.key}
                className={`${styles.tab} ${activeTab === t.key ? styles.tabActive : ''}`}
                onClick={() => setActiveTab(t.key)}
              >
                {t.label}
                {countFor[t.key] > 0 && (
                  <span className={styles.count}>{countFor[t.key]}</span>
                )}
              </button>
            ))}
          </div>

          <CandidateTable rows={activeRows} tabKey={activeTab} />

          {generatedAt && (
            <div className={styles.meta}>
              Generated: {generatedAt}
            </div>
          )}
        </>
      )}
    </div>
  )
}
