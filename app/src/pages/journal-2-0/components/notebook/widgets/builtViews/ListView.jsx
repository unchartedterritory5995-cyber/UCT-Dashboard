import { tableModelOf, measuresOf, SMALL_SAMPLE } from './builtModel'
import { useCellGroup, drillFor } from './cellGroup'
import styles from './builtViews.module.css'
import { snapshotStyles as s, toneOf } from '../SnapshotFrame'

/**
 * Built widgets (wave 8, Task 8.14): the List view. Each row the widget read (a trade, a position, a day), newest
 * first, with its values and a small inline-SVG bar for the first one (`<rect>`). A flagged trade is listed and
 * says "Flagged". Never a fetch; Enter or a click on a row opens the rows behind it.
 */
const BAR_W = 60
const BAR_H = 8

export default function ListView({ params, onDrill }) {
  const p = params || {}
  const model = tableModelOf(p)
  const measures = measuresOf(p)
  const group = useCellGroup()
  if (!model.rows.length) return <p className={s.empty}>{'No rows to show.'}</p>
  const extent = Math.max(0, ...model.rows.map((r) => Math.abs(r.values[0]?.value ?? 0))) || 1
  return (
    <ul className={styles.list} data-testid="built-list-view" aria-label={`${measures[0]?.label || 'Rows'}, each row`}
      {...group.groupProps}>
      {model.rows.map((r, i) => {
        const what = r.label2 ? `${r.label} · ${r.label2}` : r.label
        const v = r.values[0]?.value
        return (
          <li key={r.key} className={`${styles.listRow} ${onDrill ? styles.drillable : ''}`}
            {...group.itemProps(i, drillFor(onDrill, r, what), what, { native: true })}>
            <span className={styles.listLabel}>
              {r.label}
              {r.label2 && <span className={styles.listSub}>{r.label2}</span>}
              {r.flagged && <span className={styles.flagged}>Flagged</span>}
            </span>
            <svg className={styles.listBar} viewBox={`0 0 ${BAR_W} ${BAR_H}`} width={BAR_W} height={BAR_H} aria-hidden="true">
              {typeof v === 'number' && (
                <rect x={0} y={0} height={BAR_H} width={Math.max(1, (Math.abs(v) / extent) * BAR_W)}
                  className={v < 0 ? styles.barNeg : styles.barPos} />
              )}
            </svg>
            {r.values.map((c, k) => (
              <span key={`v${k}`} className={`${styles.listValue} ${c.hidden ? styles.valueDimText : toneOf(c.value)}`}>
                {c.text}
                {c.small && <span className={styles.badge}>{SMALL_SAMPLE}</span>}
              </span>
            ))}
          </li>
        )
      })}
    </ul>
  )
}
