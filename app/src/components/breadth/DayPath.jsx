import { useMemo } from 'react'
import styles from './DayPath.module.css'

/**
 * The session so far, as one line.
 *
 * A reading of 65% above the 50-day means one thing if it opened at 71 and
 * another if it opened at 58, and the daily row can never carry that — by the
 * time it exists the session is over. So the number gets its path drawn beside
 * it, plus the move since the open, which is the comparison a trader actually
 * makes during the day.
 *
 * Deliberately not a chart library: this renders inside a table cell and beside
 * a tile value, where a 90-byte polyline beats mounting ECharts.
 */
export default function DayPath({
  points,            // [[epochSeconds, value], ...] oldest first
  width = 84,
  height = 22,
  showDelta = true,
  decimals = 1,
  label = '',
  // 'bull' — a rise is an improvement (the default). 'bear' — a rise is
  // deterioration, so the colour has to invert: more names down 4% is not good
  // news, and painting it green says the opposite of what happened.
  polarity = 'bull',
}) {
  const shape = useMemo(() => {
    // `null` must be dropped BEFORE the Number() coercion — `Number(null)` is
    // 0, which passes isFinite and would plot a missing sample as a crash to
    // zero rather than as a gap.
    const vals = (points ?? [])
      .map(p => p?.[1])
      .filter(v => v !== null && v !== undefined && v !== '')
      .map(Number)
      .filter(Number.isFinite)
    // One point is a reading, not a path — there is nothing to draw yet, and a
    // flat line across the panel would imply a session that hasn't happened.
    if (vals.length < 2) return null

    const min = Math.min(...vals)
    const max = Math.max(...vals)
    const span = max - min
    const pad = 2
    const h = height - pad * 2
    // A dead-flat series has no range to scale into; draw it down the middle
    // rather than dividing by zero or slamming it to an edge.
    const y = v => (span === 0 ? pad + h / 2 : pad + h - ((v - min) / span) * h)
    const x = i => (vals.length === 1 ? 0 : (i / (vals.length - 1)) * width)

    return {
      d: vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(''),
      last: { x: x(vals.length - 1), y: y(vals.at(-1)) },
      open: vals[0],
      now: vals.at(-1),
    }
  }, [points, width, height])

  if (!shape) return null

  const delta = shape.now - shape.open
  const sign = delta > 0 ? '+' : ''
  const better = polarity === 'bear' ? -delta : delta
  const dir = better > 0 ? 'up' : better < 0 ? 'down' : 'flat'
  const stroke = dir === 'up' ? 'var(--gain)'
    : dir === 'down' ? 'var(--loss)' : 'var(--text-muted)'

  return (
    <span
      className={styles.wrap}
      title={`${label ? label + ' — ' : ''}opened ${shape.open.toFixed(decimals)}, `
        + `now ${shape.now.toFixed(decimals)} (${sign}${delta.toFixed(decimals)} since the open)`}
    >
      <svg className={styles.svg} width={width} height={height}
           viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
        <path d={shape.d} fill="none" stroke={stroke} strokeWidth="1.5"
              strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={shape.last.x} cy={shape.last.y} r="2.2" fill={stroke} />
      </svg>
      {showDelta && (
        <span className={`${styles.delta} ${styles[dir]}`}>
          {sign}{delta.toFixed(decimals)}
        </span>
      )}
    </span>
  )
}
