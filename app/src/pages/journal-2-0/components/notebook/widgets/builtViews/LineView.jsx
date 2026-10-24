import { useLayoutEffect, useRef, useState } from 'react'
import { useIsTouch } from '../../../../../../hooks/useBreakpoint'
import { tableModelOf, measuresOf, fmtValue, cellSpeech, SMALL_SAMPLE } from './builtModel'
import { useCellGroup, drillFor } from './cellGroup'
import { useChartWidth, useHitFloor, scale, textW, clamp, DASHES } from './svg'
import styles from './builtViews.module.css'
import { snapshotStyles as s } from '../SnapshotFrame'

/**
 * Built widgets (wave 8, Task 8.14): the Line view. The series runs oldest first (the server's order), one point
 * per day or month, a line per measure (up to three). Lines differ by DASH PATTERN, never by colour alone, and the
 * legend draws each pattern with that series' low and high. Pure inline SVG (`<polyline>`, `<circle>`), FITTED to
 * the measured width (R-31): it never scrolls sideways, however long the series. The y axis shows the first
 * measure's low and high; with more than one measure each line has its own scale, and says so.
 *
 * Pointer: ONE transparent overlay the full plot, which answers the NEAREST period, so a tap anywhere on the chart
 * hits something however close the points are (the whole plot is the target, always taller than 44 px). The period
 * it answers gets a guide line and an HTML READOUT that wraps, one line per measure, positioned at the point and
 * clamped inside the box. A mouse hovers to read and clicks to drill. On touch the first tap SELECTS a period (guide
 * and readout) and a second tap on the same period drills. Where there is no drill (a read-only or shared copy) a
 * tap only reads. Keyboard: each period is still a mark in the roving group (Enter drills).
 * ⛔ An unknown point is a GAP in the line, never a point at zero; the periods with no value are named under the
 * chart ("No data for ..."). A small sample is drawn hollow and named under the chart.
 */
const H = 190
const PAD_R = 10
const PAD_T = 26
const PAD_B = 26

/** The index of the period nearest x (positions `xs`, ascending). */
export function nearestIndex(xs, x) {
  let best = 0
  for (let i = 1; i < xs.length; i += 1) if (Math.abs(xs[i] - x) < Math.abs(xs[best] - x)) best = i
  return best
}

export default function LineView({ params, onDrill, width: forced }) {
  const p = params || {}
  const model = tableModelOf(p)
  const ms = measuresOf(p)
  const [boxRef, width] = useChartWidth(forced)
  const floor = useHitFloor()
  const group = useCellGroup()
  const [hover, setHover] = useState(null)    // the period under a mouse
  const [sel, setSel] = useState(null)        // the period a tap or a click selected
  const pointer = useRef('')
  const tipRef = useRef(null)
  const [tipW, setTipW] = useState(0)
  const isTouch = useIsTouch()
  const active = hover ?? sel
  // The readout's real width, once drawn (an estimate until then), so it can be clamped inside the box.
  useLayoutEffect(() => {
    const w = tipRef.current?.offsetWidth || 0
    setTipW((prev) => (prev === w ? prev : w))
  }, [active, width])
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
  const inset = 6
  const step = rows.length > 1 ? (width - padL - PAD_R - inset * 2) / (rows.length - 1) : 0
  const xs = rows.map((_, i) => (rows.length > 1 ? padL + inset + i * step : (padL + width - PAD_R) / 2))
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
  const speechOf = (r) => `${r.label}: ${ms.map((m, k) => `${multi ? `${nameOf(m, k)} ` : ''}${cellSpeech(r.values[k], m)}`).join('; ')}`
  const missing = ms.map((m, k) => ({ m, k, rows: rows.filter((r) => typeof r.values[k]?.value !== 'number' && !r.values[k]?.hidden) }))
    .filter((x) => x.rows.length)
  const hidden = rows.flatMap((r) => ms.map((m, k) => (r.values[k]?.hidden ? `${r.label}${multi ? ` (${nameOf(m, k)})` : ''}: ${r.values[k].text}` : null)))
    .filter(Boolean)
  const small = rows.flatMap((r) => ms.map((m, k) => (r.values[k]?.small ? `${r.label}${multi ? ` (${nameOf(m, k)})` : ''}` : null)))
    .filter(Boolean)
  // The pointer overlay: x (in the SVG, which is drawn at scale 1) to the nearest period.
  const xAt = (e) => {
    const box = e.currentTarget.ownerSVGElement?.getBoundingClientRect?.()
    return (e.clientX ?? 0) - (box?.left || 0)
  }
  const markOf = (svg, i) => svg?.querySelector(`[data-period="${i}"]`)
  return (
    <div className={styles.chartWrap}>
      <div className={styles.chartFit} ref={boxRef}>
        <svg className={styles.chart} viewBox={`0 0 ${width} ${H}`} width={width} height={H} role="group"
          aria-label={`${ms.map(nameOf).join(', ')} over time`} data-testid="built-line-view" {...group.groupProps}>
          <line x1={padL} x2={padL} y1={PAD_T} y2={H - PAD_B} className={styles.axis} />
          <text x={padL - 4} y={PAD_T} className={styles.tick} textAnchor="end" dominantBaseline="middle"
            data-axis="max">{ticks[0]}</text>
          <text x={padL - 4} y={H - PAD_B} className={styles.tick} textAnchor="end" dominantBaseline="middle"
            data-axis="min">{ticks[1]}</text>
          {lo0 < 0 && hi0 > 0 && (
            <line x1={padL} x2={width - PAD_R} y1={yOfs[0](0)} y2={yOfs[0](0)} className={styles.grid} />
          )}
          {ms.map((m, k) => runsOf(k).map((pts, j) => (
            <polyline key={`m${k}r${j}`} points={pts.join(' ')} className={styles.line} fill="none"
              strokeDasharray={DASHES[k] || undefined} data-measure={k + 1} />
          )))}
          {active !== null && rows[active] && (
            <line x1={xs[active]} x2={xs[active]} y1={PAD_T} y2={H - PAD_B} className={styles.guide}
              data-testid="built-line-guide" />
          )}
          {rows.map((r, i) => {
            const speech = speechOf(r)
            return (
              <g key={r.key} className={styles.mark} data-period={i}
                {...group.itemProps(i, drillFor(onDrill, r, r.label), speech)}>
                <title>{speech}</title>
                {/* Its focus band (the keyboard's ring); the pointer goes to the overlay. */}
                <rect x={xs[i] - Math.max(step, 8) / 2} y={PAD_T - 6} width={Math.max(step, 8)} height={H - PAD_B - PAD_T + 12}
                  className={styles.band} />
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
          {/* The pointer target, last so it is on top: the whole plot, answering the nearest period. */}
          <rect x={padL} y={0} width={Math.max(0, width - padL)} height={Math.max(floor, H - PAD_B)}
            className={`${styles.overlay} ${onDrill ? styles.overlayDrill : ''}`} data-hit="" data-overlay=""
            data-drill-surface=""
            onPointerDown={(e) => { pointer.current = e.pointerType || '' }}
            onPointerMove={(e) => { if (e.pointerType !== 'touch') setHover(nearestIndex(xs, xAt(e))) }}
            onPointerLeave={() => setHover(null)}
            onClick={(e) => {
              const i = nearestIndex(xs, xAt(e))
              const drill = drillFor(onDrill, rows[i], rows[i].label)
              const touch = isTouch || pointer.current === 'touch'
              // read-only: a tap reads; touch: the first tap selects, a second on the same period drills
              if (!drill || (touch && sel !== i)) { setSel(i); return }
              setSel(i)
              drill(markOf(e.currentTarget.ownerSVGElement, i) || e.currentTarget)
            }} />
          <text x={xs[0]} y={H - 8} className={styles.tick} textAnchor={rows.length > 1 ? 'start' : 'middle'}>{rows[0].label}</text>
          {rows.length > 1 && (
            <text x={xs[xs.length - 1]} y={H - 8} className={styles.tick} textAnchor="end">{rows[rows.length - 1].label}</text>
          )}
        </svg>
        {active !== null && rows[active] && (() => {
          const lines = [rows[active].label, ...ms.map((m, k) => `${multi ? `${nameOf(m, k)}: ` : ''}${cellSpeech(rows[active].values[k], m)}`)]
          const est = Math.min(width, Math.ceil(Math.max(...lines.map((t) => textW(t, 12)))) + 16)
          const w = tipW || est
          const left = clamp(xs[active] - w / 2, 0, Math.max(0, width - w))
          return (
            <div ref={tipRef} className={styles.readout} style={{ left, maxWidth: width }} aria-hidden="true"
              data-testid="built-line-readout">
              {lines.map((t, k) => <div key={`t${k}`} className={k === 0 ? styles.readoutHead : undefined}>{t}</div>)}
            </div>
          )
        })()}
      </div>
      {multi && (
        <ul className={styles.legend} data-testid="built-line-legend">
          {ms.map((m, k) => {
            const vs = known(k)
            const span = vs.length ? `${fmtValue(Math.min(...vs), m.fmt)} to ${fmtValue(Math.max(...vs), m.fmt)}` : 'no data'
            return (
              <li key={`l${k}`} data-legend={k + 1}>
                <svg width="28" height="10" aria-hidden="true">
                  <line x1="1" x2="27" y1="5" y2="5" className={styles.line} strokeDasharray={DASHES[k] || undefined} />
                </svg>
                {`${nameOf(m, k)} (${span})`}
              </li>
            )
          })}
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
