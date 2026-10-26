import { measuresOf, cellOf, SMALL_SAMPLE, figureNotesOf } from './builtModel'
import { useCellGroup } from './cellGroup'
import { CountLine, FigureNotes } from './Counts'
import styles from './builtViews.module.css'
import { snapshotStyles as s, toneOf } from '../SnapshotFrame'

/**
 * Built widgets (wave 8, Task 8.13): the Number view. One figure per measure (at most three), from the payload's
 * `value` (fixed keys v1..v3 / n1..n3 / s1..s3). Rendered from params alone; it never fetches.
 * ⛔ Never a zero for an unknown: a missing value reads "no data", a hidden one "Not enough trades yet (n)", and an
 * average or rate on a small sample carries the "small sample" badge beside its count.
 * Task 8.14: each figure says what it was made from (CountLine), and Enter or a click on it opens the rows behind
 * it (`onDrill`, absent on a shared page).
 * Wave 10 (Task 10.18): the server's own sentences under their figure, verbatim: a max drawdown's dates
 * (`drawdown.line`) and the stop-after line (`stop.line`). Placed under the plan's `max_drawdown` / `current_streak`
 * figure, or after the figures when the note carries no plan; absent keys (and a shared page, W10-R7) draw nothing.
 */
export default function NumberView({ params, onDrill }) {
  const p = params || {}
  const measures = measuresOf(p)
  const value = p.value && typeof p.value === 'object' ? p.value : {}
  const group = useCellGroup()
  if (!measures.length) return <p className={s.empty}>{'This widget has nothing to show.'}</p>
  const notes = figureNotesOf(p)
  return (
    <div className={styles.numbers} data-testid="built-number-view" {...group.groupProps}>
      {measures.map((m, k) => {
        const i = k + 1
        const c = cellOf(value, i, m)
        const label = m.label || `Measure ${i}`
        const drill = typeof onDrill === 'function' ? (el) => onDrill({}, label, el) : null
        const mark = group.itemProps(k, drill, `${label}: ${c.text}${c.small ? `, ${SMALL_SAMPLE}` : ''}`)
        return (
          <div key={`m${i}`} className={styles.metric}>
            <span className={`${styles.metricBody} ${drill ? styles.drillable : ''}`} {...mark}>
              <span className={styles.metricLabel}>{label}</span>
              <span className={`${styles.metricValue} ${c.hidden ? styles.metricHidden : toneOf(c.value)}`}>
                {c.text}
                {c.small && <span className={styles.badge}>{SMALL_SAMPLE}</span>}
              </span>
            </span>
            {!c.hidden && <CountLine params={p} i={i} measure={m} />}
            <FigureNotes notes={notes} slot={k} />
          </div>
        )
      })}
      <FigureNotes notes={notes} count={measures.length} />
    </div>
  )
}
