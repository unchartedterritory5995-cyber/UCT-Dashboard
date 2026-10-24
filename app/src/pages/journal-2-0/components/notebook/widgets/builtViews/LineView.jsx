import { tableModelOf, measuresOf, fmtValue, cellSpeech, SMALL_SAMPLE } from './builtModel'
import { useCellGroup, drillFor } from './cellGroup'
import { useChartWidth, useHitFloor, scale, textW, DASHES } from './svg'
import styles from './builtViews.module.css'
import { snapshotStyles as s } from '../SnapshotFrame'

/**
 * Built widgets (wave 8, Task 8.14): the Line view. The series runs oldest first (the server's order), one point
 * per day or month, a line per measure (up to three). Lines differ by DASH PATTERN, never by colour alone, and the
 * legend draws each pattern. Pure inline SVG (`<polyline>`, `<circle>`), laid out in real pixels at the measured
 * width (R-31); never a fetch. The y axis shows the first measure's low and high; with more than one measure each
 * line has its own scale, and says so.
 * ⛔ An unknown point is a GAP in the line, never a point at zero: the line breaks there, and the periods with no
 * value are named under the chart ("No data for ..."). A small sample is drawn hollow and named under the chart.
 * Each period is one focusable mark (a band the full height of the plot) whose name and tooltip read every value.
 */
const H = 190
const PAD_R = 10
const PAD_T = 22
const PAD_B = 26

export default function LineView({ params, onDrill, width: forced }) {
  const p = params || {}
  const model = tableModelOf(p)
  const ms = measuresOf(p)
  const [boxRef, width] = useChartWidth(forced)
  const floor = useHitFloor()
  const group = useCellGroup()
  if (!model.rows.length || !ms.length) return <p className={s.empty}>{'No rows to show.'}</p>
  const rows = model.rows
  const multi = ms.length > 1
  const known = (k) => rows.map((r) => r.values[k]?.value).filter((v) => typeof v === 'number')
  const range = (k) => {
    const vs = known(k)
    return vs.length ? [Math.min(...vs), Math.max(...vs)] : [0, 1]
  }
  const [lo0, hi0] = range(0)
  const ticks = [fmtValue(hi0, ms[0].fmt), fmtValue(lo0, ms[0].fmt)]
  const padL = Math.ceil(Math.max(...ticks.map((t) => textW(t, 11)))) + 10
  // Points never closer than the hit floor: on a phone a long series scrolls rather than shrinking its marks.
  const step = rows.length > 1 ? Math.max(floor, (width - padL - PAD_R - floor) / (rows.length - 1)) : 0
  const svgW = rows.length > 1 ? Math.max(width, padL + PAD_R + floor + step * (rows.length - 1)) : width
  const xs = rows.map((_, i) => (rows.length > 1 ? padL + floor / 2 + i * step : (padL + svgW - PAD_R) / 2))
  const band = rows.length > 1 ? step : Math.max(floor, 60)
  const yOfs = ms.map((_, k) => {
    const [lo, hi] = range(k)
    return scale(lo, hi, H - PAD_B, PAD_T)
  })
  const runsOf = (k) => {
    const out = []
    let run = []
    rows.forEach((r, i) => {
      const v = r.values[k]?.value
      if (typeof v === 'number') run.push(`${xs[i].toFixed(1)},${yOfs[k](v).toFixed(1)}`)
      else if (run.length) { out.push(run); run = [] }
    })
    if (run.length) out.push(run)
    return out
  }
  const nameOf = (m, k) => m.label || `Measure ${k + 1}`
  const missing = ms.map((m, k) => ({ m, k, rows: rows.filter((r) => typeof r.values[k]?.value !== 'number' && !r.values[k]?.hidden) }))
    .filter((x) => x.rows.length)
  const hidden = rows.flatMap((r) => ms.map((m, k) => (r.values[k]?.hidden ? `${r.label}${multi ? ` (${nameOf(m, k)})` : ''}: ${r.values[k].text}` : null)))
    .filter(Boolean)
  const small = rows.flatMap((r) => ms.map((m, k) => (r.values[k]?.small ? `${r.label}${multi ? ` (${nameOf(m, k)})` : ''}` : null)))
    .filter(Boolean)
  return (
    <div className={styles.chartWrap}>
      <div className={styles.chartBox} ref={boxRef}>
        <svg className={styles.chart} viewBox={`0 0 ${svgW} ${H}`} width={svgW} height={H} role="group"
          aria-label={`${ms.map(nameOf).join(', ')} over time`} data-testid="built-line-view" {...group.groupProps}>
          <line x1={padL} x2={padL} y1={PAD_T} y2={H - PAD_B} className={styles.axis} />
          <text x={padL - 4} y={PAD_T} className={styles.tick} textAnchor="end" dominantBaseline="middle"
            data-axis="max">{ticks[0]}</text>
          <text x={padL - 4} y={H - PAD_B} className={styles.tick} textAnchor="end" dominantBaseline="middle"
            data-axis="min">{ticks[1]}</text>
          {lo0 < 0 && hi0 > 0 && (
            <line x1={padL} x2={svgW - PAD_R} y1={yOfs[0](0)} y2={yOfs[0](0)} className={styles.grid} />
          )}
          {ms.map((m, k) => runsOf(k).map((pts, j) => (
            <polyline key={`m${k}r${j}`} points={pts.join(' ')} className={styles.line} fill="none"
              strokeDasharray={DASHES[k] || undefined} data-measure={k + 1} />
          )))}
          {rows.map((r, i) => {
            const speech = `${r.label}: ${ms.map((m, k) => `${multi ? `${nameOf(m, k)} ` : ''}${cellSpeech(r.values[k], m)}`).join('; ')}`
            return (
              <g key={r.key} className={styles.mark} {...group.itemProps(i, drillFor(onDrill, r, r.label), speech)}>
                <title>{speech}</title>
                <rect x={xs[i] - band / 2} y={PAD_T - 8} width={band} height={H - PAD_B - PAD_T + 16}
                  className={styles.hit} data-hit="" />
                {ms.map((m, k) => {
                  const c = r.values[k]
                  if (typeof c?.value !== 'number') return null
                  return (
                    <circle key={`d${k}`} cx={xs[i]} cy={yOfs[k](c.value)} r={3.5} data-small={c.small ? '' : undefined}
                      className={c.small ? styles.dotHollow : (c.value < 0 ? styles.dotNeg : styles.dot)} />
                  )
                })}
              </g>
            )
          })}
          <text x={xs[0]} y={H - 8} className={styles.tick} textAnchor={rows.length > 1 ? 'start' : 'middle'}>{rows[0].label}</text>
          {rows.length > 1 && (
            <text x={xs[xs.length - 1]} y={H - 8} className={styles.tick} textAnchor="end">{rows[rows.length - 1].label}</text>
          )}
        </svg>
      </div>
      {multi && (
        <ul className={styles.legend} data-testid="built-line-legend">
          {ms.map((m, k) => (
            <li key={`l${k}`}>
              <svg width="28" height="10" aria-hidden="true">
                <line x1="1" x2="27" y1="5" y2="5" className={styles.line} strokeDasharray={DASHES[k] || undefined} />
              </svg>
              {nameOf(m, k)}
            </li>
          ))}
          <li>Each line is on its own scale; the axis is the first.</li>
        </ul>
      )}
      {missing.map((x) => (
        <p key={`n${x.k}`} className={styles.caption}>
          {`No data for ${x.rows.map((r) => r.label).join(', ')}${multi ? ` (${nameOf(x.m, x.k)})` : ''}.`}
        </p>
      ))}
      {hidden.length > 0 && <p className={styles.caption}>{hidden.join(' · ')}</p>}
      {small.length > 0 && (
        <p className={styles.caption} data-testid="built-line-small">
          <span className={styles.badge}>{SMALL_SAMPLE}</span>{` ${small.join(', ')} (drawn hollow)`}
        </p>
      )}
    </div>
  )
}
