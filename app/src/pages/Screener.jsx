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

const ALERT_META = {
  BREAKING:   { label: 'BREAKING',  cls: styles.alertBreaking },
  READY:      { label: 'READY',     cls: styles.alertReady },
  WATCH:      { label: 'WATCH',     cls: styles.alertWatch },
  PATTERN:    { label: 'PATTERN',   cls: styles.alertPattern },
  NO_PATTERN: { label: '—',         cls: styles.alertNone },
  NO_DATA:    { label: 'NO DATA',   cls: styles.alertNone },
}

function SetupBadge({ type }) {
  const meta = SETUP_META[type] ?? { label: type, cls: '' }
  return <span className={`${styles.badge} ${meta.cls}`}>{meta.label}</span>
}

function AlertBadge({ state }) {
  const meta = ALERT_META[state] ?? { label: state || '—', cls: styles.alertNone }
  return <span className={`${styles.alertBadge} ${meta.cls}`}>{meta.label}</span>
}

function fmtPct(val) {
  if (val == null) return <span className={styles.numNeutral}>—</span>
  const sign = val >= 0 ? '+' : ''
  const cls = val > 0 ? styles.numPos : val < 0 ? styles.numNeg : styles.numNeutral
  return <span className={cls}>{sign}{val.toFixed(1)}%</span>
}

function fmtScore(val) {
  if (val == null) return <span className={styles.numNeutral}>—</span>
  const cls = val >= 80 ? styles.numPos : val >= 60 ? styles.numAmber : styles.numNeutral
  return <span className={cls}>{val}</span>
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

function PremarketBar({ ctx }) {
  if (!ctx) return null
  const { spy_change_pct, qqq_change_pct, summary, time_ct } = ctx
  return (
    <div className={styles.premarketBar}>
      <span className={styles.premarketLabel}>PREMARKET{time_ct ? ` · ${time_ct} CT` : ''}</span>
      <span className={styles.premarketItem}>SPY {fmtPct(spy_change_pct)}</span>
      <span className={styles.premarketDivider}>·</span>
      <span className={styles.premarketItem}>QQQ {fmtPct(qqq_change_pct)}</span>
      {summary && <span className={styles.premarketSummary}>{summary}</span>}
    </div>
  )
}

function PullbackRow({ row }) {
  const hasPattern = row.pattern_detected
  const patternLabel = hasPattern
    ? [
        row.pattern_type ?? 'pattern',
        row.consolidation_days != null ? `${row.consolidation_days}d` : null,
        row.depth_pct != null ? `${row.depth_pct.toFixed(1)}%` : null,
      ].filter(Boolean).join(' · ')
    : null

  const rowCls = [
    styles.row,
    row.alert_state === 'BREAKING' ? styles.rowBreaking : '',
    row.alert_state === 'READY'    ? styles.rowReady    : '',
  ].filter(Boolean).join(' ')

  return (
    <tr className={rowCls}>
      <td><AlertBadge state={row.alert_state} /></td>
      <td className={styles.tickerCell}>
        <div className={styles.tickerLine}>
          <TickerPopup sym={row.ticker} />
          <AlsoChips list={row.also_qualified_as} />
        </div>
        {row.candle_notes && (
          <div className={styles.candleNotes}>{row.candle_notes}</div>
        )}
      </td>
      <td className={styles.company}>{row.company || '—'}</td>
      <td className={styles.patternCell}>
        {patternLabel
          ? <>
              <span className={styles.patternLabel}>{patternLabel}</span>
              {row.apex_days_remaining != null && (
                <span className={styles.apexTag}>apex {row.apex_days_remaining}d</span>
              )}
            </>
          : <span className={styles.numNeutral}>—</span>
        }
      </td>
      <td className={styles.scoreCell}>{fmtScore(row.candle_score)}</td>
      <td>
        {row.pm_change_pct != null
          ? <>{fmtPct(row.pm_change_pct)}{row.pm_note ? <span className={styles.pmNote}> {row.pm_note}</span> : null}</>
          : <span className={styles.numNeutral}>—</span>
        }
      </td>
    </tr>
  )
}

function RemountRow({ row }) {
  return (
    <tr className={styles.row}>
      <td><SetupBadge type={row.setup_type} /></td>
      <td className={styles.ticker}>
        <TickerPopup sym={row.ticker} />
        <AlsoChips list={row.also_qualified_as} />
      </td>
      <td className={styles.company}>{row.company || '—'}</td>
      <td className={styles.sector}>{row.sector || '—'}</td>
      <td>{fmtPct(row.sma20_dist_pct)}</td>
      <td>{fmtPct(row.sma50_dist_pct)}</td>
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
      <td>{fmtPct(row.gap_pct)}</td>
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

  if (tabKey === 'pullback_ma') {
    return (
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Alert</th>
            <th>Ticker</th>
            <th>Company</th>
            <th>Pattern</th>
            <th>Score</th>
            <th>PM</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => <PullbackRow key={row.ticker || i} row={row} />)}
        </tbody>
      </table>
    )
  }

  if (tabKey === 'gapper_news') {
    return (
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Setup</th>
            <th>Ticker</th>
            <th>Company</th>
            <th>Sector</th>
            <th>Gap%</th>
            <th>Chg%</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => <GapperRow key={row.ticker || i} row={row} />)}
        </tbody>
      </table>
    )
  }

  // remount
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>Setup</th>
          <th>Ticker</th>
          <th>Company</th>
          <th>Sector</th>
          <th>SMA20%</th>
          <th>SMA50%</th>
          <th>Chg%</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => <RemountRow key={row.ticker || i} row={row} />)}
      </tbody>
    </table>
  )
}

export default function Screener() {
  const [activeTab, setActiveTab] = useState('pullback_ma')

  const { data, error } = useSWR('/api/candidates', fetcher, {
    refreshInterval: 30 * 60 * 1000,
  })

  const candidates    = data?.candidates ?? {}
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

  const leadingSectors = data?.leading_sectors_used  ?? []
  const generatedAt    = data?.generated_at           ?? null
  const premarketCtx   = data?.premarket_context      ?? null

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

      {data && <PremarketBar ctx={premarketCtx} />}

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
