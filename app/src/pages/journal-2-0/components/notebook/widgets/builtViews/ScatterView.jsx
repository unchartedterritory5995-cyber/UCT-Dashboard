import { tableModelOf, measuresOf, fmtValue, w10Of, QUADRANT_TEXT, QUADRANT_NOTE } from './builtModel'
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
 * Wave 10 (Task 10.18): `quadrants: "excursion"` (MAE across, MFE up, both in R) draws a dashed 1R guide on each axis
 * (each axis always reaches 1R), captions the top-left quadrant "gave it back" (MFE at least 1R, MAE under 1R) and the
 * bottom-right "stopped too tight" (MAE at least 1R, MFE under 1R), and says what the guides are under the chart. A
 * caption is drawn only where it fits inside its quadrant at the measured width; one that does not is named in the
 * line under the chart instead. Result shapes are wave 8's. A shared body draws none of it (W10-R7).
 */
const H = 230
const PAD_R = 14
const PAD_T = 12
const PAD_B = 38
const RESULT = { win: 'Win', loss: 'Loss', be: 'Breakeven' }
/** A quadrant caption's size (CSS .quadrantText) and its inset from the guides and the plot's edges. */
const CAP_PX = 11
const CAP_GAP = 4

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
  const quad = w10Of(p).quadrants
  // with quadrants each axis reaches 1R, so both guides are always on the chart
  const xsv = [...pts.map((r) => r.point.x), ...(quad ? [1] : [])]
  const ysv = [...pts.map((r) => r.point.y), ...(quad ? [1] : [])]
  const [xlo, xhi, ylo, yhi] = [Math.min(...xsv), Math.max(...xsv), Math.min(...ysv), Math.max(...ysv)]
  const yTicks = [fmtValue(yhi, my.fmt), fmtValue(ylo, my.fmt)]
  // The left margin fits the widest y tick (a money tick like -$12,345.67 is wide), measured, not guessed.
  const padL = Math.ceil(Math.max(...yTicks.map((t) => textW(t, 11)))) + 12
  const hitR = floor / 2
  const xOf = scale(xlo, xhi, padL + hitR, width - PAD_R - hitR)
  const yOf = scale(ylo, yhi, H - PAD_B - hitR, PAD_T + hitR)
  // the captions: each drawn only where it fits inside its own quadrant
  const caps = []
  if (quad) {
    const vx = xOf(1)
    const hy = yOf(1)
    const gw = textW(QUADRANT_TEXT.gave, CAP_PX)
    const tw = textW(QUADRANT_TEXT.tight, CAP_PX)
    const gaveY = PAD_T + CAP_PX
    const tightY = H - PAD_B - CAP_GAP
    if (padL + CAP_GAP + gw <= vx - CAP_GAP && gaveY <= hy - CAP_GAP) {
      caps.push({ id: 'gave', x: padL + CAP_GAP, y: gaveY, anchor: 'start' })
    }
    if (vx + CAP_GAP + tw <= width - PAD_R - CAP_GAP && tightY - CAP_PX >= hy + CAP_GAP) {
      caps.push({ id: 'tight', x: width - PAD_R - CAP_GAP, y: tightY, anchor: 'end' })
    }
  }
  const unplaced = quad ? ['gave', 'tight'].filter((id) => !caps.some((c) => c.id === id)) : []
  const where = { gave: 'top left', tight: 'bottom right' }
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
          {quad && (
            <>
              <line x1={xOf(1)} x2={xOf(1)} y1={PAD_T} y2={H - PAD_B} className={styles.guide1r} data-guide="x1r" />
              <line x1={padL} x2={width - PAD_R} y1={yOf(1)} y2={yOf(1)} className={styles.guide1r} data-guide="y1r" />
              {caps.map((c) => (
                <text key={c.id} x={c.x} y={c.y} textAnchor={c.anchor} className={styles.quadrantText}
                  data-quadrant={c.id}>{QUADRANT_TEXT[c.id]}</text>
              ))}
            </>
          )}
          {pts.map((r, i) => {
            const res = r.point.r
            const label = `${r.label || 'A trade'}: ${mx.label || 'X'} ${fmtValue(r.point.x, mx.fmt)}, `
              + `${my.label || 'Y'} ${fmtValue(r.point.y, my.fmt)}${res ? `, ${RESULT[res]}` : ''}`
              + `${quad && r.quadrant ? `, ${QUADRANT_TEXT[r.quadrant]}` : ''}`
            const x = xOf(r.point.x)
            const y = yOf(r.point.y)
            return (
              <g key={r.key} className={styles.mark} data-result={res || 'none'} data-day={quad ? r.label : undefined}
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
      {quad && (
        <p className={styles.caption} data-testid="built-scatter-quadrants">
          {[QUADRANT_NOTE, ...unplaced.map((id) => `${where[id][0].toUpperCase()}${where[id].slice(1)}: ${QUADRANT_TEXT[id]}.`)].join(' ')}
        </p>
      )}
      {left > 0 && (
        <p className={styles.caption}>
          {`${left} ${left === 1 ? 'trade has' : 'trades have'} no data for one of the two values and ${left === 1 ? 'is' : 'are'} not plotted.`}
        </p>
      )}
    </div>
  )
}
