/**
 * Calendar header — view pills, period navigation, totals strip,
 * intensity-mode toggle.
 */

import { monthLabel, monthOffset, fmtSignedDollar, fmtSignedR } from '../../lib/calendar'
import styles from './CalendarHeader.module.css'

const VIEWS = [
  { key: 'year', label: 'Year' },
  { key: 'month', label: 'Month' },
  { key: 'week', label: 'Week' },
]

const MODES = [
  { key: 'pct', label: '%' },
  { key: 'dollar', label: '$' },
  { key: 'r', label: 'R' },
]

const BASES = [
  { key: 'account', label: 'Account Balance' },
  { key: 'closed', label: 'Closed Trades' },
]

export default function CalendarHeader({
  view,
  year,
  month,
  week,
  totals,
  mode,
  onViewChange,
  onPeriodChange,
  onModeChange,
  basis,
  showBasisToggle = false,
  onBasisChange,
}) {
  const periodLabel =
    view === 'year' ? String(year) :
    view === 'month' ? monthLabel(year, month) :
    `Week ${week}, ${year}`

  const onPrev = () => {
    if (view === 'month') {
      const next = monthOffset(year, month, -1)
      onPeriodChange({ year: next.year, month: next.month })
    } else if (view === 'year') {
      onPeriodChange({ year: year - 1 })
    } else {
      const w = (week || 1) - 1
      if (w < 1) onPeriodChange({ year: year - 1, week: 52 })
      else onPeriodChange({ year, week: w })
    }
  }
  const onNext = () => {
    if (view === 'month') {
      const next = monthOffset(year, month, 1)
      onPeriodChange({ year: next.year, month: next.month })
    } else if (view === 'year') {
      onPeriodChange({ year: year + 1 })
    } else {
      const w = (week || 1) + 1
      if (w > 52) onPeriodChange({ year: year + 1, week: 1 })
      else onPeriodChange({ year, week: w })
    }
  }

  const winRatePct =
    totals && totals.winRate != null
      ? `${(totals.winRate * 100).toFixed(0)}%`
      : '—'

  return (
    <div className={styles.wrap}>
      <div className={styles.controlsRow}>
        <div className={styles.viewPills} role="radiogroup" aria-label="Calendar view">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              type="button"
              className={`${styles.pill} ${view === v.key ? styles.pillActive : ''}`}
              onClick={() => onViewChange(v.key)}
              aria-pressed={view === v.key}
            >
              {v.label}
            </button>
          ))}
        </div>

        <div className={styles.periodNav}>
          <button type="button" className={styles.navBtn} onClick={onPrev} aria-label="Previous period">‹</button>
          <span className={styles.periodLabel}>{periodLabel}</span>
          <button type="button" className={styles.navBtn} onClick={onNext} aria-label="Next period">›</button>
        </div>

        {showBasisToggle && (
          <div className={styles.modeGroup}>
            <span className={styles.modeLabel}>P&amp;L basis</span>
            <div className={styles.viewPills} role="radiogroup" aria-label="P&L basis">
              {BASES.map((b) => (
                <button
                  key={b.key}
                  type="button"
                  className={`${styles.pill} ${basis === b.key ? styles.pillActive : ''}`}
                  onClick={() => onBasisChange?.(b.key)}
                  aria-pressed={basis === b.key}
                >
                  {b.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className={styles.modeGroup}>
          <span className={styles.modeLabel}>Color by</span>
          <div className={styles.viewPills} role="radiogroup" aria-label="Cell intensity mode">
            {MODES.map((m) => (
              <button
                key={m.key}
                type="button"
                className={`${styles.pill} ${mode === m.key ? styles.pillActive : ''}`}
                onClick={() => onModeChange(m.key)}
                aria-pressed={mode === m.key}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className={styles.totalsRow}>
        <Stat label="Net P&L" value={fmtSignedDollar(totals?.netPnlDollar ?? 0)} positive={totals?.netPnlDollar > 0} negative={totals?.netPnlDollar < 0} />
        <Stat label="Trades" value={totals?.tradeCount ?? 0} />
        <Stat label="Winners" value={totals?.winners ?? 0} />
        <Stat label="Losers" value={totals?.losers ?? 0} />
        <Stat label="Win Rate" value={winRatePct} />
        <Stat label="R-sum" value={fmtSignedR(totals?.rSum ?? 0)} positive={totals?.rSum > 0} negative={totals?.rSum < 0} />
      </div>
    </div>
  )
}

function Stat({ label, value, positive, negative }) {
  return (
    <div className={styles.stat}>
      <span className={styles.statLabel}>{label}</span>
      <span
        className={`${styles.statValue} ${positive ? styles.pos : ''} ${negative ? styles.neg : ''}`}
      >
        {value}
      </span>
    </div>
  )
}
