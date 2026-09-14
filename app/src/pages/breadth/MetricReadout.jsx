import { useMemo } from 'react'
import UIcon from '../../components/ui/UIcon'
import { LABEL_MAP, resolveColors, staleAllowance } from './chartMetrics'
import { percentileOf, latestPoint, comparableCount } from './percentile'
import { shortSessionDate } from './sessionDates'
import styles from './MetricReadout.module.css'

const ORDINAL = n => {
  const tens = n % 100
  if (tens >= 11 && tens <= 13) return `${n}th`
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`
}

const format = v => (v == null ? '—' : v % 1 === 0 ? String(v) : v.toFixed(2))

/**
 * Replaces the ECharts legend: the same swatch and label, plus the latest value
 * and where it sits in the visible window. A line's shape says what happened;
 * the percentile says whether it is unusual, which is the question the chart is
 * being asked.
 *
 * A-12: the percentile names its basis ("8th of 62 shown") — a rank within the
 * window on screen, not within history. A-10: a reading older than its cadence
 * allows carries the date it was last reported and never passes as today's.
 */
export default function MetricReadout({ rows, selected, hidden, onToggle }) {
  const colors = useMemo(() => resolveColors(selected), [selected])

  const items = useMemo(() => {
    const newest = rows.length ? rows[rows.length - 1].date : null
    return selected.map(key => {
      const label = LABEL_MAP[key] ?? key
      const point = latestPoint(rows, key)
      const value = point?.value ?? null
      const values = rows.map(r => r[key])
      const pct = percentileOf(values, value)
      const basis = comparableCount(values)
      const lastReported = point && rows.length - 1 - point.index > staleAllowance(key)
        ? shortSessionDate(point.date, newest)
        : null
      return {
        key, label, value, pct, basis, lastReported,
        // The spans sit flush in the DOM, so the computed accessible name would
        // run together as "52W Highs129100th of 62 shown". Spell it out instead.
        aria: `${label}, ${value == null ? 'no value' : format(value)}` +
              `${lastReported ? `, not reported since ${lastReported}` : ''}, ` +
              `${pct == null ? 'percentile unavailable' : `${ORDINAL(pct)} percentile of ${basis} readings shown`}`,
      }
    })
  }, [rows, selected])

  return (
    <div className={styles.strip}>
      {items.map(item => (
        <button
          key={item.key}
          type="button"
          aria-label={item.aria}
          aria-pressed={!hidden.has(item.key)}
          className={`${styles.item} ${hidden.has(item.key) ? styles.hidden : ''}`}
          onClick={() => onToggle(item.key)}
        >
          <span
            className={styles.swatch}
            data-swatch={colors[item.key]}
            style={{ background: colors[item.key] }}
          />
          <span className={styles.name}>{item.label}</span>
          <span className={styles.value}>{format(item.value)}</span>
          {item.lastReported && (
            <span className={styles.stale}>
              <UIcon name="clock" size={11} gold={false} />last {item.lastReported}
            </span>
          )}
          <span className={styles.pct}>{item.pct == null ? '—' : `${ORDINAL(item.pct)} of ${item.basis} shown`}</span>
        </button>
      ))}
    </div>
  )
}
