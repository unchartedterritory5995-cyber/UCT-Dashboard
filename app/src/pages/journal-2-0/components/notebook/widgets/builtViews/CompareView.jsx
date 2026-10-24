import { measuresOf, cellOf, fmtValue, SMALL_SAMPLE } from './builtModel'
import { useCellGroup } from './cellGroup'
import { CountLine } from './Counts'
import styles from './builtViews.module.css'
import { snapshotStyles as s, toneOf } from '../SnapshotFrame'

/**
 * Built widgets (wave 8, Task 8.14): the Compare view. Each measure for this period beside the period it is
 * compared with ("vs <compareLabel>"), as two inline-SVG bars (`<rect>`) and the change between them. Rendered
 * from params alone. ⛔ An unknown on either side says so ("no data", "Not enough trades yet (n)"), and then no
 * change is worked out: a change against a missing number is not a number.
 */
const BAR_W = 220
const BAR_H = 10

export default function CompareView({ params, onDrill }) {
  const p = params || {}
  const measures = measuresOf(p)
  const value = p.value && typeof p.value === 'object' ? p.value : {}
  const compare = p.compare && typeof p.compare === 'object' ? p.compare : null
  const vsLabel = typeof p.compareLabel === 'string' && p.compareLabel ? p.compareLabel : 'the period before'
  const group = useCellGroup()
  if (!measures.length) return <p className={s.empty}>{'This widget has nothing to show.'}</p>
  return (
    <div className={styles.numbers} data-testid="built-compare-view" {...group.groupProps}>
      {measures.map((m, k) => {
        const i = k + 1
        const now = cellOf(value, i, m)
        const then = compare ? cellOf(compare, i, m) : null
        const label = m.label || `Measure ${i}`
        const both = typeof now.value === 'number' && typeof then?.value === 'number'
        const diff = both ? now.value - then.value : null
        let change = ''
        if (diff !== null) {
          const t = fmtValue(diff, m.fmt === 'pf' ? 'ratio' : m.fmt)
          change = diff > 0 && !t.startsWith('+') ? `+${t}` : t
        }
        const extent = Math.max(Math.abs(now.value ?? 0), Math.abs(then?.value ?? 0)) || 1
        const drill = typeof onDrill === 'function' ? (el) => onDrill({}, label, el) : null
        const mark = group.itemProps(k, drill, `${label}: ${now.text}, vs ${vsLabel}: ${then ? then.text : 'no data'}`)
        return (
          <div key={`m${i}`} className={styles.metric}>
            <span className={`${styles.metricBody} ${drill ? styles.drillable : ''}`} {...mark}>
              <span className={styles.metricLabel}>{label}</span>
              <span className={`${styles.metricValue} ${now.hidden ? styles.metricHidden : toneOf(now.value)}`}>
                {now.text}
                {now.small && <span className={styles.badge}>{SMALL_SAMPLE}</span>}
              </span>
              <svg className={styles.compareBars} viewBox={`0 0 ${BAR_W} ${BAR_H * 2 + 4}`} width="100%" aria-hidden="true">
                {typeof now.value === 'number' && (
                  <rect x={0} y={0} height={BAR_H} width={Math.max(1, (Math.abs(now.value) / extent) * BAR_W)}
                    className={now.value < 0 ? styles.barNeg : styles.barPos} />
                )}
                {typeof then?.value === 'number' && (
                  <rect x={0} y={BAR_H + 4} height={BAR_H} width={Math.max(1, (Math.abs(then.value) / extent) * BAR_W)}
                    className={styles.barThen} />
                )}
              </svg>
              <span className={styles.compareLine}>
                <span>{`vs ${vsLabel}`}</span>
                <span className={styles.compareThen}>{then ? then.text : 'no data'}</span>
                {change && <span className={toneOf(diff)}>{`Change ${change}`}</span>}
              </span>
            </span>
            {!now.hidden && <CountLine params={p} i={i} measure={m} />}
          </div>
        )
      })}
    </div>
  )
}
