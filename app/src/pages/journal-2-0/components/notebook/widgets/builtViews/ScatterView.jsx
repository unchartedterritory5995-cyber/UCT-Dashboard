import { tableModelOf, measuresOf, fmtValue } from './builtModel'
import { useCellGroup, drillFor } from './cellGroup'
import { useChartWidth, useHitFloor, scale, textW } from './svg'
import styles from './builtViews.module.css'
import { snapshotStyles as s } from '../SnapshotFrame'

/**
 * Built widgets (wave 8, Task 8.14): the Scatter view. One closed trade per point, the first measure across and
 * the second up. ⛔ The result is told by SHAPE, never colour alone: a win is a filled circle, a loss a hollow ring,
 * breakeven a short dash, and the legend draws the three. Pure inline SVG, in real pixels at the measured width
 * (R-31); never a fetch. A trade with an unknown measure is not plotted at zero: it is left off, and counted under
 * the chart. A point drills to its own trade (`{d, x, y}`).
 */
const H = 230
const PAD_R = 14
const PAD_T = 12
const PAD_B = 38
const RESULT = { win: 'Win', loss: 'Loss', be: 'Breakeven' }

/** The mark for one result, centred on (x, y). */
export function ResultShape({ r, x, y }) {
  if (r === 'loss') return <circle cx={x} cy={y} r={4.5} className={styles.ring} data-shape="ring" />
  if (r === 'be') return <rect x={x - 5} y={y - 1.5} width={10} height={3} className={styles.dash} data-shape="dash" />
  return <circle cx={x} cy={y} r={4.5} className={styles.dotWin} data-shape="dot" />
}

export default function ScatterView({ params, onDrill, width: forced }) {
  const p = params || {}
  const model = tableModelOf(p)
  const [mx = {}, my = {}] = measuresOf(p)
  const [boxRef, width] = useChartWidth(forced)
  const floor = useHitFloor()
  const group = useCellGroup()
  const pts = model.rows.filter((r) => typeof r.point?.x === 'number' && typeof r.point?.y === 'number')
  const left = model.rows.length - pts.length
  if (!pts.length) {
    return <p className={s.empty}>{model.rows.length ? `No trade has both values (${left} not plotted).` : 'No rows to show.'}</p>
  }
  const xsv = pts.map((r) => r.point.x)
  const ysv = pts.map((r) => r.point.y)
  const [xlo, xhi, ylo, yhi] = [Math.min(...xsv), Math.max(...xsv), Math.min(...ysv), Math.max(...ysv)]
  const yTicks = [fmtValue(yhi, my.fmt), fmtValue(ylo, my.fmt)]
  // The left margin fits the widest y tick (a money tick like -$12,345.67 is wide), measured, not guessed.
  const padL = Math.ceil(Math.max(...yTicks.map((t) => textW(t, 11)))) + 12
  const hitR = floor / 2
  const xOf = scale(xlo, xhi, padL + hitR, width - PAD_R - hitR)
  const yOf = scale(ylo, yhi, H - PAD_B - hitR, PAD_T + hitR)
  return (
    <div className={styles.chartWrap}>
      <div className={styles.chartFit} ref={boxRef}>
        <svg className={styles.chart} viewBox={`0 0 ${width} ${H}`} width={width} height={H} role="group"
          aria-label={`${my.label || 'Y'} against ${mx.label || 'X'}`} data-testid="built-scatter-view"
          {...group.groupProps}>
          <line x1={padL} x2={width - PAD_R} y1={H - PAD_B} y2={H - PAD_B} className={styles.axis} />
          <line x1={padL} x2={padL} y1={PAD_T} y2={H - PAD_B} className={styles.axis} />
          {xlo < 0 && xhi > 0 && <line x1={xOf(0)} x2={xOf(0)} y1={PAD_T} y2={H - PAD_B} className={styles.grid} />}
          {ylo < 0 && yhi > 0 && <line x1={padL} x2={width - PAD_R} y1={yOf(0)} y2={yOf(0)} className={styles.grid} />}
          <text x={padL} y={H - PAD_B + 15} className={styles.tick}>{fmtValue(xlo, mx.fmt)}</text>
          <text x={width - PAD_R} y={H - PAD_B + 15} className={styles.tick} textAnchor="end">{fmtValue(xhi, mx.fmt)}</text>
          <text x={(padL + width) / 2} y={H - 4} className={styles.tick} textAnchor="middle">{mx.label || 'X'}</text>
          <text x={padL - 6} y={PAD_T + 6} className={styles.tick} textAnchor="end" data-axis="max">{yTicks[0]}</text>
          <text x={padL - 6} y={H - PAD_B} className={styles.tick} textAnchor="end" data-axis="min">{yTicks[1]}</text>
          {pts.map((r, i) => {
            const res = r.point.r
            const label = `${r.label || 'A trade'}: ${mx.label || 'X'} ${fmtValue(r.point.x, mx.fmt)}, `
              + `${my.label || 'Y'} ${fmtValue(r.point.y, my.fmt)}${res ? `, ${RESULT[res]}` : ''}`
            const x = xOf(r.point.x)
            const y = yOf(r.point.y)
            return (
              <g key={r.key} className={styles.mark} data-result={res || 'none'}
                {...group.itemProps(i, drillFor(onDrill, r, r.label || 'This trade'), label)}>
                <title>{label}</title>
                <circle cx={x} cy={y} r={hitR} className={styles.hit} data-hit="" />
                <ResultShape r={res} x={x} y={y} />
              </g>
            )
          })}
        </svg>
      </div>
      <ul className={styles.legend} data-testid="built-scatter-legend">
        {[['win', 'Win'], ['loss', 'Loss'], ['be', 'Breakeven']].map(([r, t]) => (
          <li key={r}>
            <svg width="14" height="14" aria-hidden="true"><ResultShape r={r} x={7} y={7} /></svg>
            {t}
          </li>
        ))}
      </ul>
      {left > 0 && (
        <p className={styles.caption}>
          {`${left} ${left === 1 ? 'trade has' : 'trades have'} no data for one of the two values and ${left === 1 ? 'is' : 'are'} not plotted.`}
        </p>
      )}
    </div>
  )
}
