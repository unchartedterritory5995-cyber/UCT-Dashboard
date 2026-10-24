import { tableModelOf, measuresOf, fmtValue } from './builtModel'
import { useCellGroup, drillFor } from './cellGroup'
import { W, scale } from './svg'
import styles from './builtViews.module.css'
import { snapshotStyles as s } from '../SnapshotFrame'

/**
 * Built widgets (wave 8, Task 8.14): the Scatter view. One closed trade per point, the first measure across and
 * the second up, coloured by its result (Win, Loss, Breakeven). Pure inline SVG (`<circle>`); never a fetch.
 * ⛔ A trade with an unknown measure is not plotted at zero: it is left off, and counted under the chart.
 * A point drills to its own trade (`{d, x, y}`).
 */
const H = 220
const PAD_L = 56
const PAD_R = 12
const PAD_T = 12
const PAD_B = 34
const RESULT = { win: 'Win', loss: 'Loss', be: 'Breakeven' }
const DOT = { win: 'dotWin', loss: 'dotLoss', be: 'dotBe' }

export default function ScatterView({ params, onDrill }) {
  const p = params || {}
  const model = tableModelOf(p)
  const [mx = {}, my = {}] = measuresOf(p)
  const group = useCellGroup()
  const pts = model.rows.filter((r) => typeof r.point?.x === 'number' && typeof r.point?.y === 'number')
  const left = model.rows.length - pts.length
  if (!pts.length) {
    return <p className={s.empty}>{model.rows.length ? `No trade has both values (${left} not plotted).` : 'No rows to show.'}</p>
  }
  const xsv = pts.map((r) => r.point.x)
  const ysv = pts.map((r) => r.point.y)
  const xlo = Math.min(...xsv)
  const xhi = Math.max(...xsv)
  const ylo = Math.min(...ysv)
  const yhi = Math.max(...ysv)
  const xOf = scale(xlo, xhi, PAD_L + 8, W - PAD_R - 8)
  const yOf = scale(ylo, yhi, H - PAD_B - 8, PAD_T + 8)
  return (
    <div className={styles.chartWrap}>
      <svg className={styles.chart} viewBox={`0 0 ${W} ${H}`} width="100%" role="group"
        aria-label={`${my.label || 'Y'} against ${mx.label || 'X'}`} data-testid="built-scatter-view" {...group.groupProps}>
        <line x1={PAD_L} x2={W - PAD_R} y1={H - PAD_B} y2={H - PAD_B} className={styles.axis} />
        <line x1={PAD_L} x2={PAD_L} y1={PAD_T} y2={H - PAD_B} className={styles.axis} />
        {xlo < 0 && xhi > 0 && <line x1={xOf(0)} x2={xOf(0)} y1={PAD_T} y2={H - PAD_B} className={styles.grid} />}
        {ylo < 0 && yhi > 0 && <line x1={PAD_L} x2={W - PAD_R} y1={yOf(0)} y2={yOf(0)} className={styles.grid} />}
        <text x={PAD_L} y={H - PAD_B + 14} className={styles.tick}>{fmtValue(xlo, mx.fmt)}</text>
        <text x={W - PAD_R} y={H - PAD_B + 14} className={styles.tick} textAnchor="end">{fmtValue(xhi, mx.fmt)}</text>
        <text x={(PAD_L + W) / 2} y={H - 4} className={styles.tick} textAnchor="middle">{mx.label || 'X'}</text>
        <text x={PAD_L - 4} y={H - PAD_B} className={styles.tick} textAnchor="end">{fmtValue(ylo, my.fmt)}</text>
        <text x={PAD_L - 4} y={PAD_T + 8} className={styles.tick} textAnchor="end">{fmtValue(yhi, my.fmt)}</text>
        {pts.map((r, i) => {
          const res = r.point.r
          const label = `${r.label || 'A trade'}: ${mx.label || 'X'} ${fmtValue(r.point.x, mx.fmt)}, `
            + `${my.label || 'Y'} ${fmtValue(r.point.y, my.fmt)}${res ? `, ${RESULT[res]}` : ''}`
          return (
            <g key={r.key} className={styles.mark} {...group.itemProps(i, drillFor(onDrill, r, r.label || 'This trade'), label)}>
              <circle cx={xOf(r.point.x)} cy={yOf(r.point.y)} r={9} className={styles.hit} />
              <circle cx={xOf(r.point.x)} cy={yOf(r.point.y)} r={4} className={styles[DOT[res] || 'dot']} />
            </g>
          )
        })}
      </svg>
      <p className={styles.caption}>
        {'Blue: win · Orange: loss · Grey: breakeven.'}
        {left > 0 ? ` ${left} ${left === 1 ? 'trade has' : 'trades have'} no data for one of the two values and ${left === 1 ? 'is' : 'are'} not plotted.` : ''}
      </p>
    </div>
  )
}
