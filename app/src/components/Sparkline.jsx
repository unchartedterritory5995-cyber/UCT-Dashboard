/**
 * Generic mini price sparkline (Robinhood-style). Pure SVG, no deps.
 * Colored by trend: last value >= first → gain green, else loss red.
 */
import { useId } from 'react'

/** Pure path builder: number[] → { line, area, up } (viewBox 0..100), or null. */
export function sparkPaths(values) {
  const pts = (values || []).filter((v) => Number.isFinite(v))
  if (pts.length < 2) return null
  const min = Math.min(...pts)
  const max = Math.max(...pts)
  const span = max - min || 1
  const n = pts.length
  const coords = pts.map((v, i) => ({
    x: (i / (n - 1)) * 100,
    y: 100 - ((v - min) / span) * 100,
  }))
  const line = coords.map((c, i) => `${i ? 'L' : 'M'}${c.x.toFixed(2)} ${c.y.toFixed(2)}`).join(' ')
  const area = `${line} L100 100 L0 100 Z`
  return { line, area, up: pts[n - 1] >= pts[0] }
}

export default function Sparkline({ values, width = 96, height = 32, fill = true, className = '' }) {
  const gradId = useId()
  const spark = sparkPaths(values)
  if (!spark) return null
  const color = spark.up ? 'var(--gain, #22c55e)' : 'var(--loss, #ef4444)'
  return (
    <svg
      className={className}
      width={width}
      height={height}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {fill && (
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.22" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
      )}
      {fill && <path d={spark.area} fill={`url(#${gradId})`} />}
      <path
        d={spark.line}
        fill="none"
        stroke={color}
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}
