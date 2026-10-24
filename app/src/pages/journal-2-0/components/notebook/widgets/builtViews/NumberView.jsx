import { measuresOf, cellOf, SMALL_SAMPLE, unitWord } from './builtModel'
import styles from './builtViews.module.css'
import { snapshotStyles as s, toneOf } from '../SnapshotFrame'

/**
 * Built widgets (wave 8, Task 8.13): the Number view. One figure per measure (at most three), from the payload's
 * `value` (fixed keys v1..v3 / n1..n3 / s1..s3). Rendered from params alone; it never fetches.
 * ⛔ Never a zero for an unknown: a missing value reads "no data", a hidden one "Not enough trades yet (n)", and an
 * average or rate on a small sample carries the "small sample" badge beside its count.
 */
export default function NumberView({ params }) {
  const p = params || {}
  const measures = measuresOf(p)
  const value = p.value && typeof p.value === 'object' ? p.value : {}
  if (!measures.length) return <p className={s.empty}>{'This widget has nothing to show.'}</p>
  return (
    <div className={styles.numbers} data-testid="built-number-view">
      {measures.map((m, k) => {
        const i = k + 1
        const c = cellOf(value, i, m)
        const n = value[`n${i}`]
        return (
          <div key={`m${i}`} className={styles.metric}>
            <span className={styles.metricLabel}>{m.label || `Measure ${i}`}</span>
            <span className={`${styles.metricValue} ${c.hidden ? styles.metricHidden : toneOf(c.value)}`}>
              {c.text}
              {c.small && <span className={styles.badge}>{SMALL_SAMPLE}</span>}
            </span>
            {!c.hidden && typeof n === 'number' && Number.isFinite(n) && (
              <span className={styles.metricCount}>{`from ${n} ${n === 1 ? unitWord(m.unit).replace(/s$/, '') : unitWord(m.unit)}`}</span>
            )}
          </div>
        )
      })}
    </div>
  )
}
