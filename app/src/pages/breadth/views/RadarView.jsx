/**
 * Radar / Shape — every visible metric is a spoke; the filled polygon is the
 * "shape" of the board. A balanced market = big even polygon; a lopsided one =
 * a spiky dent. Signal of the Day axis label is gold ★; notable is amber.
 */
import { resolveViewColors } from './breadthViewShared'
import UIcon from '../../../components/ui/UIcon'

export default function RadarView({ currentRow, metrics, normalize, onDrill, signalKey, notableKey, options = {} }) {
  if (!currentRow || (metrics?.length ?? 0) < 3) {
    return (
      <div style={{ padding: 24, color: '#94a3b8', font: '600 12px Instrument Sans, sans-serif' }}>
        Radar needs at least 3 visible metrics — enable more in Customize.
      </div>
    )
  }
  const MAX_SPOKES = options.maxSpokes ?? 14
  const asListed = options.spokeSelect === 'listed'
  const colors = resolveViewColors(options.palette, options.intensity)
  const ext = (m) => Math.abs((normalize(m, currentRow) ?? 50) - 50)
  const capped = metrics.length > MAX_SPOKES
  let shown = metrics
  if (capped) {
    if (asListed) {
      shown = metrics.slice(0, MAX_SPOKES)
    } else {
      const top = [...metrics].sort((a, b) => ext(b) - ext(a)).slice(0, MAX_SPOKES)
      for (const key of [signalKey, notableKey]) {
        if (key && !top.some(m => m.key === key)) {
          const m = metrics.find(x => x.key === key)
          if (m) { top.pop(); top.push(m) }
        }
      }
      shown = top
    }
  }

  const N = shown.length
  const cx = 160, cy = 160, R = 120
  const pt = (i, rad) => {
    const ang = (-90 + i * 360 / N) * Math.PI / 180
    return [cx + rad * Math.cos(ang), cy + rad * Math.sin(ang)]
  }
  const valPts = shown.map((m, i) => {
    const v = normalize(m, currentRow)
    return pt(i, R * ((v == null ? 0 : v) / 100))
  })
  const polyStr = valPts.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center',
                  justifyContent: 'center', height: '100%' }}>
      <svg width="100%" height="100%" viewBox="0 0 320 320" preserveAspectRatio="xMidYMid meet"
           style={{ minHeight: 0 }}>
        {[1, 0.66, 0.33].map((lv, gi) => (
          <polygon key={gi} fill="none" stroke="#1e293b" strokeWidth="1"
                   points={shown.map((_, i) => pt(i, R * lv).join(',')).join(' ')} />
        ))}
        {shown.map((_, i) => {
          const [x, y] = pt(i, R)
          return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="#1e293b" />
        })}
        <polygon points={polyStr} fill={`${colors.bull}2e`} stroke={colors.bull} strokeWidth="2" />
        {valPts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r="2.5" fill={colors.bull} />)}
        {shown.map((m, i) => {
          const [lx, ly] = pt(i, R + 14)
          const isSignal = m.key === signalKey
          const isNotable = m.key === notableKey
          const clickable = !!m.drillKey
          const anchor = lx < cx - 5 ? 'end' : lx > cx + 5 ? 'start' : 'middle'
          return (
            <text key={m.key} x={lx} y={ly} textAnchor={anchor} dominantBaseline="middle"
                  fill={isSignal ? '#c9a84c' : isNotable ? '#fbbf24' : '#94a3b8'}
                  fontSize="8" fontWeight="700" fontFamily="Instrument Sans, sans-serif"
                  style={{ cursor: clickable ? 'pointer' : 'default' }}
                  onClick={clickable ? () => onDrill(m) : undefined}>
              {isSignal ? <UIcon name="star-fill" size={11} style={{ verticalAlign: '-1px', marginRight: 3 }} /> : null}{m.label}
            </text>
          )
        })}
      </svg>
      {capped && (
        <div style={{ font: '600 9px Instrument Sans, sans-serif', color: '#64748b', marginTop: 2 }}>
          showing {shown.length} of {metrics.length} — narrow the set in Customize
        </div>
      )}
    </div>
  )
}
