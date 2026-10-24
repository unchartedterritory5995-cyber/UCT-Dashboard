import { tableModelOf, measuresOf, SMALL_SAMPLE } from './builtModel'
import { useCellGroup, drillFor } from './cellGroup'
import { W, spread, scale } from './svg'
import styles from './builtViews.module.css'
import { snapshotStyles as s } from '../SnapshotFrame'

/**
 * Built widgets (wave 8, Task 8.14): the Line view. The series runs oldest first (the server's order), one point
 * per day or month, the first measure's value. Pure inline SVG (`<polyline>`, `<circle>`); never a fetch.
 * ⛔ An unknown point is a GAP in the line, never a point at zero: the line breaks there, and the periods with no
 * value are named under the chart ("No data for ...").
 */
const H = 180
const PAD_L = 8
const PAD_R = 8
const PAD_T = 18
const PAD_B = 26

export default function LineView({ params, onDrill }) {
  const p = params || {}
  const model = tableModelOf(p)
  const m = measuresOf(p)[0] || {}
  const group = useCellGroup()
  if (!model.rows.length) return <p className={s.empty}>{'No rows to show.'}</p>
  const rows = model.rows
  const xs = spread(rows.length, PAD_L + 6, W - PAD_R - 6)
  const known = rows.map((r) => r.values[0]?.value).filter((v) => typeof v === 'number')
  const lo = known.length ? Math.min(...known) : 0
  const hi = known.length ? Math.max(...known) : 1
  const yOf = scale(lo, hi, H - PAD_B, PAD_T)
  // The line breaks at every unknown point: one polyline per run of known points.
  const runs = []
  let run = []
  rows.forEach((r, i) => {
    const v = r.values[0]?.value
    if (typeof v === 'number') run.push(`${xs[i].toFixed(1)},${yOf(v).toFixed(1)}`)
    else if (run.length) { runs.push(run); run = [] }
  })
  if (run.length) runs.push(run)
  const missing = rows.filter((r) => typeof r.values[0]?.value !== 'number' && !r.values[0]?.hidden)
  const hidden = rows.filter((r) => r.values[0]?.hidden)
  const last = [...rows].reverse().find((r) => typeof r.values[0]?.value === 'number')
  return (
    <div className={styles.chartWrap}>
      <svg className={styles.chart} viewBox={`0 0 ${W} ${H}`} width="100%" role="group"
        aria-label={`${m.label || 'Value'} over time`} data-testid="built-line-view" {...group.groupProps}>
        {lo < 0 && hi > 0 && (
          <line x1={PAD_L} x2={W - PAD_R} y1={yOf(0)} y2={yOf(0)} className={styles.axis} />
        )}
        {runs.map((pts, k) => (
          <polyline key={`run${k}`} points={pts.join(' ')} className={styles.line} fill="none" />
        ))}
        {rows.map((r, i) => {
          const c = r.values[0] || { text: '', value: null }
          if (typeof c.value !== 'number') return null
          const label = `${r.label}: ${c.text}${c.small ? `, ${SMALL_SAMPLE}` : ''}`
          return (
            <g key={r.key} className={styles.mark} {...group.itemProps(i, drillFor(onDrill, r, r.label), label)}>
              <circle cx={xs[i]} cy={yOf(c.value)} r={9} className={styles.hit} />
              <circle cx={xs[i]} cy={yOf(c.value)} r={3.5} className={c.value < 0 ? styles.dotNeg : styles.dot} />
            </g>
          )
        })}
        <text x={PAD_L} y={H - 8} className={styles.tick}>{rows[0].label}</text>
        {rows.length > 1 && (
          <text x={W - PAD_R} y={H - 8} className={styles.tick} textAnchor="end">{rows[rows.length - 1].label}</text>
        )}
        {last && (
          <text x={W - PAD_R} y={12} className={styles.value} textAnchor="end">
            {`${last.label}: ${last.values[0].text}`}
          </text>
        )}
      </svg>
      {missing.length > 0 && (
        <p className={styles.caption}>{`No data for ${missing.map((r) => r.label).join(', ')}.`}</p>
      )}
      {hidden.length > 0 && (
        <p className={styles.caption}>{hidden.map((r) => `${r.label}: ${r.values[0].text}`).join(' · ')}</p>
      )}
    </div>
  )
}
