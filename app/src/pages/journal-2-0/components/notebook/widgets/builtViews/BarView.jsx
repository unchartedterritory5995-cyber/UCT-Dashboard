import { tableModelOf, measuresOf, SMALL_SAMPLE } from './builtModel'
import { useCellGroup, drillFor } from './cellGroup'
import { W, clipText } from './svg'
import styles from './builtViews.module.css'
import { snapshotStyles as s } from '../SnapshotFrame'

/**
 * Built widgets (wave 8, Task 8.14): the Bar view. One horizontal bar per row (best first, as the server sorted
 * them), the first measure's value. Pure inline SVG (`<rect>`, `<text>`); never a chart engine, never a fetch.
 * A bar with no value draws no bar and says why ("no data", "Not enough trades yet (n)"), never a zero-length bar
 * that reads as $0. Negatives grow left from the zero line. Rows come from `tableModelOf`, so a shared widget's
 * account names are already "Account N" here (R-25).
 */
const ROW_H = 28
const LABEL_W = 170
const VALUE_W = 170
const PAD = 6

export default function BarView({ params, onDrill }) {
  const p = params || {}
  const model = tableModelOf(p)
  const m = measuresOf(p)[0] || {}
  const group = useCellGroup()
  if (!model.rows.length) return <p className={s.empty}>{'No rows to show.'}</p>
  const vals = model.rows.map((r) => r.values[0]?.value).filter((v) => typeof v === 'number')
  const lo = Math.min(0, ...vals)
  const hi = Math.max(0, ...vals)
  const span = hi - lo || 1
  const plotX = LABEL_W + PAD
  const plotW = W - LABEL_W - VALUE_W - PAD * 2
  const xOf = (v) => plotX + ((v - lo) / span) * plotW
  const zeroX = xOf(0)
  const height = model.rows.length * ROW_H + PAD * 2
  return (
    <svg className={styles.chart} viewBox={`0 0 ${W} ${height}`} width="100%" role="group"
      aria-label={`${m.label || 'Value'} by row`} data-testid="built-bar-view" {...group.groupProps}>
      <line x1={zeroX} x2={zeroX} y1={PAD} y2={height - PAD} className={styles.axis} />
      {model.rows.map((r, i) => {
        const c = r.values[0] || { text: '', value: null }
        const what = r.label2 ? `${r.label} · ${r.label2}` : r.label
        const y = PAD + i * ROW_H
        const v = c.value
        const x0 = typeof v === 'number' ? Math.min(zeroX, xOf(v)) : zeroX
        const bw = typeof v === 'number' ? Math.abs(xOf(v) - zeroX) : 0
        const valueText = `${c.text}${c.small ? ` · ${SMALL_SAMPLE}` : ''}`
        const mark = group.itemProps(i, drillFor(onDrill, r, what), `${what}: ${valueText}${r.flagged ? ', Flagged' : ''}`)
        return (
          <g key={r.key} className={styles.mark} {...mark}>
            <rect x={0} y={y} width={W} height={ROW_H} className={styles.hit} />
            <text x={LABEL_W} y={y + ROW_H / 2} className={styles.label} textAnchor="end" dominantBaseline="middle">
              {clipText(what, 26)}
              {r.flagged && <tspan className={styles.flagText}> Flagged</tspan>}
            </text>
            {typeof v === 'number' && (
              <rect x={x0} y={y + 5} width={Math.max(bw, 1)} height={ROW_H - 10}
                className={v < 0 ? styles.barNeg : styles.barPos} />
            )}
            <text x={W - VALUE_W + PAD} y={y + ROW_H / 2} dominantBaseline="middle"
              className={c.hidden || typeof v !== 'number' ? styles.valueDim : styles.value}>
              {c.text}
              {c.small && <tspan dx="6" className={styles.badgeText}>{SMALL_SAMPLE}</tspan>}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
