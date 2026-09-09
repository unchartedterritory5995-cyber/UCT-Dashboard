/**
 * Spark — a thin, flat-capped, trend-coloured line. Never a mini chart.
 *
 * Extracted from DockFinancials so Financials and Earnings draw the same glyph
 * from one implementation rather than two that drift. The deliberate
 * constraints, unchanged: 46px wide (at 72px it started reading as a chart
 * competing with the numbers beside it), no axes, no grid, no fill — and a dot
 * on the newest point, which is the only thing the eye needs anchored.
 */
export default function Spark({ series, width = 46, height = 15, title }) {
  const pts = (series || []).filter(v => v != null)
  if (pts.length < 2) return null
  const min = Math.min(...pts)
  const max = Math.max(...pts)
  const rng = (max - min) || 1
  const PAD = 1.5
  const step = width / (pts.length - 1)
  const y = v => PAD + (height - PAD * 2) - ((v - min) / rng) * (height - PAD * 2)
  const d = pts.map((v, i) => `${(i * step).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const up = pts[pts.length - 1] >= pts[0]
  const stroke = up ? 'var(--dock-up-text,#3fc885)' : 'var(--dock-down-text,#f1696e)'
  const lastX = ((pts.length - 1) * step).toFixed(1)
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}
      role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : 'true'}>
      {title && <title>{title}</title>}
      <polyline points={d} fill="none" stroke={stroke} strokeWidth="1.25"
        strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <circle cx={lastX} cy={y(pts[pts.length - 1])} r="1.5" fill={stroke} />
    </svg>
  )
}
