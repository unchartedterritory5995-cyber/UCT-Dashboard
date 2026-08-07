import { useMemo } from 'react'
import { LABEL_MAP, resolveColors } from './chartMetrics'
import { percentileOf, latestValue } from './percentile'
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
 */
export default function MetricReadout({ rows, selected, hidden, onToggle }) {
  const colors = useMemo(() => resolveColors(selected), [selected])

  const items = useMemo(() => selected.map(key => {
    const value = latestValue(rows, key)
    return {
      key,
      label: LABEL_MAP[key] ?? key,
      value,
      pct: percentileOf(rows.map(r => r[key]), value),
    }
  }), [rows, selected])

  return (
    <div className={styles.strip}>
      {items.map(item => (
        <button
          key={item.key}
          type="button"
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
          <span className={styles.pct}>{item.pct == null ? '—' : ORDINAL(item.pct)}</span>
        </button>
      ))}
    </div>
  )
}
