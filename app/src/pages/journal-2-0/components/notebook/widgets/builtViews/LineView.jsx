import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { useIsTouch } from '../../../../../../hooks/useBreakpoint'
import { tableModelOf, measuresOf, fmtValue, cellSpeech, SMALL_SAMPLE, w10Of, runningSpeech, DRAWDOWN_LEGEND } from './builtModel'
import { useCellGroup, drillFor } from './cellGroup'
import { useChartWidth, useHitFloor, scale, textW, clamp, svgId, DASHES, trackInputKind, lastInputWasKey } from './svg'
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
 * it answers gets a guide line and an HTML READOUT that wraps, one line per measure. The readout sits over the top
 * edge of the plot, or its bottom edge when a point of that period would be under it (else beside the point), and
 * never left of the axis, so it never covers a tick or the point it describes (`readoutPlace`). A mouse or a pen
 * hovers to read and clicks to drill, at once, even in a narrow window: the pointer's own type beats the touch
 * tier, and a click leaves no selection behind, so the readout goes with the pointer. On touch the first tap
 * SELECTS a period (guide and readout) and a second tap on the same period drills. Where there is no drill (a
 * read-only or shared copy) a tap only reads. Keyboard: each period is still a mark in the roving group (Enter
 * drills), and the focused mark shows its readout while it has focus from the keyboard.
 * ⛔ An unknown point is a GAP in the line, never a point at zero; the periods with no value are named under the
 * chart ("No data for ..."). A small sample is drawn hollow and named under the chart.
 * Wave 10 (Task 10.18): a RUNNING TOTAL (`display.cumulative`: `vN` the total so far, `dN` the day's own amount, `dd1`
 * the first line's drop from its running high, server widget_engine/payload.py) draws that drop as a HATCHED band
 * from the running high down to the curve, named by a "Drawdown" legend that draws the same hatch (a pattern, never
 * colour alone), and its readout reads "-$50.00 total · -$250.00 that day". A gap breaks the band as it breaks the
 * line. The y axis reaches the running high the band hangs from. A shared body draws none of it (W10-R7).
 */
const H = 190
const PAD_R = 10
const PAD_T = 26
const PAD_B = 26
/** The readout: how far it sits from the plot's top or bottom edge, the gap it keeps from a point, a dot's radius. */
const TIP_EDGE = 2
const TIP_GAP = 4
const DOT_R = 3.5

/** The index of the period nearest x (positions `xs`, ascending). */
export function nearestIndex(xs, x) {
  let best = 0
  for (let i = 1; i < xs.length; i += 1) if (Math.abs(xs[i] - x) < Math.abs(xs[best] - x)) best = i
  return best
}

/**
 * Where the readout goes, in the chart's own pixels: `ys` are the period's points, `h`/`w` the readout's size, `x`
 * the period, `padL` the axis. Over the TOP edge when every point is clear of it, else over the BOTTOM edge, else
 * beside the point (right, then left). Its left edge is never left of the axis, so the max and min ticks are never
 * covered. Too wide to sit beside the point, it goes in the largest clear gap between the period's points (`v: 'at'`,
 * with `top`), so it covers none of them. Returns `{ v: 'top' | 'bottom' | 'at', left, top? }`.
 */
export function readoutPlace({ ys, h, x, w, width, padL, height = H }) {
  const centred = clamp(x - w / 2, padL, Math.max(padL, width - w))
  if (ys.every((y) => y - DOT_R >= TIP_EDGE + h + TIP_GAP)) return { v: 'top', left: centred }
  if (ys.every((y) => y + DOT_R <= height - TIP_EDGE - h - TIP_GAP)) return { v: 'bottom', left: centred }
  if (x + DOT_R + TIP_GAP + w <= width) return { v: 'top', left: x + DOT_R + TIP_GAP }
  if (x - DOT_R - TIP_GAP - w >= padL) return { v: 'top', left: x - DOT_R - TIP_GAP - w }
  // too wide to sit beside it: the largest clear vertical gap between this period's points (or an edge band)
  const sorted = [...ys].sort((a, b) => a - b)
  const bands = []
  let from = TIP_EDGE
  for (const y of sorted) { bands.push([from, y - DOT_R - TIP_GAP]); from = y + DOT_R + TIP_GAP }
  bands.push([from, height - TIP_EDGE])
  const fits = bands.filter(([a, b]) => b - a >= h).sort((p, q) => (q[1] - q[0]) - (p[1] - p[0]))
  if (fits.length) {
    const [a, b] = fits[0]
    return { v: 'at', top: Math.round(a + (b - a - h) / 2), left: centred }
  }
  // nowhere is clear at all (a readout taller than every gap): the edge away from most of the points
  const mid = ys.reduce((a, y) => a + y, 0) / (ys.length || 1)
  return { v: mid < height / 2 ? 'bottom' : 'top', left: centred }
}

export default function LineView({ params, onDrill, width: forced }) {
  const p = params || {}
  const model = tableModelOf(p)
  const ms = measuresOf(p)
  const [boxRef, width] = useChartWidth(forced)
  const floor = useHitFloor()
  const group = useCellGroup()
  const [hover, setHover] = useState(null)    // the period under a mouse
  const [sel, setSel] = useState(null)        // the period a tap or keyboard focus selected
  const selBy = useRef(null)                  // 'tap' | 'key': what made the selection
  const pointer = useRef('')
  const tipRef = useRef(null)
  const [tip, setTip] = useState({ w: 0, h: 0 })
  const isTouch = useIsTouch()
  const ddId = `built-dd-${svgId(useId())}`
  const active = hover ?? sel
  useEffect(() => { trackInputKind() }, [])
  // The readout's real size, once drawn (an estimate until then), so it can be clamped and placed clear of the point.
  useLayoutEffect(() => {
    const w = tipRef.current?.offsetWidth || 0
    const h = tipRef.current?.offsetHeight || 0
    setTip((prev) => (prev.w === w && prev.h === h ? prev : { w, h }))
  }, [active, width])
  if (!model.rows.length || !ms.length) return <p className={s.empty}>{'No rows to show.'}</p>
  const rows = model.rows
  const multi = ms.length > 1
  const cum = w10Of(p).cumulative
  /** The running high a period's drawdown hangs from (its total less its drop), or null. */
  const peakOf = (r) => (cum && typeof r.values[0]?.value === 'number' && typeof r.dd === 'number' ? r.values[0].value - r.dd : null)
  const known = (k) => rows.map((r) => r.values[k]?.value).filter((v) => typeof v === 'number')
  const range = (k) => {
    const vs = [...known(k), ...(k === 0 ? rows.map(peakOf).filter((v) => v !== null) : [])]
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
  /** The drawdown band: one polygon per unbroken run of periods (high along the top, the curve back along the
   *  bottom), drawn only where the run falls below its high at all. */
  const bands = []
  if (cum) {
    let run = []
    const close = () => {
      if (run.length > 1 && run.some((i) => rows[i].dd < 0)) {
        const top = run.map((i) => `${xs[i].toFixed(1)},${yOfs[0](peakOf(rows[i])).toFixed(1)}`)
        const bottom = [...run].reverse().map((i) => `${xs[i].toFixed(1)},${yOfs[0](rows[i].values[0].value).toFixed(1)}`)
        bands.push([...top, ...bottom].join(' '))
      }
      run = []
    }
    rows.forEach((r, i) => { if (peakOf(r) !== null) run.push(i); else close() })
    close()
  }
  const nameOf = (m, k) => m.label || `Measure ${k + 1}`
  const valueSpeech = (r, k, m) => (cum ? runningSpeech(r.values[k], r.day?.[k], m) : cellSpeech(r.values[k], m))
  const speechOf = (r) => `${r.label}: ${ms.map((m, k) => `${multi ? `${nameOf(m, k)} ` : ''}${valueSpeech(r, k, m)}`).join('; ')}`
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
          {bands.length > 0 && (
            <defs>
              <pattern id={ddId} data-dd-pattern="" patternUnits="userSpaceOnUse" width="6" height="6"
                patternTransform="rotate(45)">
                <line x1="0" y1="0" x2="0" y2="6" className={styles.ddHatch} />
              </pattern>
            </defs>
          )}
          {bands.map((pts, j) => (
            <polygon key={`dd${j}`} points={pts} fill={`url(#${ddId})`} className={styles.ddBand} data-dd-band="" />
          ))}
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
            const mark = group.itemProps(i, drillFor(onDrill, r, r.label), speech)
            // Focus from the keyboard shows this period's readout; leaving clears it.
            const focus = mark.onFocus ? {
              onFocus: (e) => {
                mark.onFocus(e)
                if (!lastInputWasKey()) return
                selBy.current = 'key'
                setSel(i)
              },
              onBlur: () => {
                if (selBy.current !== 'key') return
                selBy.current = null
                setSel(null)
              },
            } : {}
            return (
              <g key={r.key} className={styles.mark} data-period={i} {...mark} {...focus}>
                <title>{speech}</title>
                {/* Its focus band (the keyboard's ring); the pointer goes to the overlay. */}
                <rect x={xs[i] - Math.max(step, 8) / 2} y={PAD_T - 6} width={Math.max(step, 8)} height={H - PAD_B - PAD_T + 12}
                  className={styles.band} />
                {ms.map((m, k) => {
                  const c = r.values[k]
                  if (typeof c?.value !== 'number') return null
                  return (
                    <circle key={`d${k}`} cx={xs[i]} cy={yOfs[k](c.value)} r={DOT_R} data-small={c.small ? '' : undefined}
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
            onPointerLeave={(e) => {
              setHover(null)
              // a mouse or pen that leaves takes any tap selection with it (a keyboard one stays with its focus)
              if ((e.pointerType === 'mouse' || e.pointerType === 'pen') && selBy.current === 'tap') {
                selBy.current = null
                setSel(null)
              }
            }}
            onClick={(e) => {
              const i = nearestIndex(xs, xAt(e))
              const drill = drillFor(onDrill, rows[i], rows[i].label)
              const opener = () => markOf(e.currentTarget.ownerSVGElement, i) || e.currentTarget
              // The click's own pointer type, else the press that started it. A mouse or a pen beats the touch
              // tier (a narrow desktop window): it hovers to read, so one click drills and selects nothing.
              const kind = e.nativeEvent?.pointerType || pointer.current
              if (kind === 'mouse' || kind === 'pen') {
                if (selBy.current === 'tap') { selBy.current = null; setSel(null) }
                if (drill) drill(opener())
                return
              }
              const touch = kind === 'touch' || isTouch
              // read-only: a tap reads; touch: the first tap selects, a second on the same period drills
              selBy.current = 'tap'
              setSel(i)
              if (!drill || (touch && sel !== i)) return
              drill(opener())
            }} />
          <text x={xs[0]} y={H - 8} className={styles.tick} textAnchor={rows.length > 1 ? 'start' : 'middle'}>{rows[0].label}</text>
          {rows.length > 1 && (
            <text x={xs[xs.length - 1]} y={H - 8} className={styles.tick} textAnchor="end">{rows[rows.length - 1].label}</text>
          )}
        </svg>
        {active !== null && rows[active] && (() => {
          const lines = [rows[active].label, ...ms.map((m, k) => `${multi ? `${nameOf(m, k)}: ` : ''}${valueSpeech(rows[active], k, m)}`)]
          const room = Math.max(0, width - padL)        // never left of the axis
          const w = tip.w || Math.min(room, Math.ceil(Math.max(...lines.map((t) => textW(t, 12)))) + 18)
          const h = tip.h || Math.ceil(lines.length * 12 * 1.35) + 10
          const ys = ms.map((m, k) => rows[active].values[k]?.value)
            .map((v, k) => (typeof v === 'number' ? yOfs[k](v) : null)).filter((y) => y !== null)
          const at = readoutPlace({ ys, h, x: xs[active], w, width, padL })
          return (
            <div ref={tipRef} className={styles.readout} aria-hidden="true" data-testid="built-line-readout"
              data-place={at.v}
              style={{ left: at.left, maxWidth: room, ...(at.v === 'at' ? { top: at.top }
                : at.v === 'top' ? { top: TIP_EDGE } : { bottom: TIP_EDGE }) }}>
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
      {bands.length > 0 && (
        <ul className={styles.legend} data-testid="built-line-dd-legend">
          <li>
            <svg width="28" height="12" aria-hidden="true">
              <rect x="0" y="0" width="28" height="12" fill={`url(#${ddId})`} className={styles.ddBand} />
            </svg>
            {DRAWDOWN_LEGEND}
          </li>
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
