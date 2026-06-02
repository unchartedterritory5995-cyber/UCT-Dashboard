/**
 * Radar / Shape — every visible metric is a spoke; the filled polygon is the
 * "shape" of the board. A balanced market = big even polygon; a lopsided one =
 * a spiky dent. Signal of the Day axis label is gold ★; notable is amber.
 */
export default function RadarView({ currentRow, metrics, normalize, onDrill, signalKey, notableKey }) {
  if (!currentRow || (metrics?.length ?? 0) < 3) {
    return (
      <div style={{ padding: 24, color: '#94a3b8', font: '600 12px Instrument Sans, sans-serif' }}>
        Radar needs at least 3 visible metrics — enable more in Customize.
      </div>
    )
  }
  const N = metrics.length
  const cx = 160, cy = 160, R = 120
  const pt = (i, rad) => {
    const ang = (-90 + i * 360 / N) * Math.PI / 180
    return [cx + rad * Math.cos(ang), cy + rad * Math.sin(ang)]
  }
  const valPts = metrics.map((m, i) => {
    const v = normalize(m, currentRow)
    return pt(i, R * ((v == null ? 0 : v) / 100))
  })
  const polyStr = valPts.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
      <svg width="100%" height="100%" viewBox="0 0 320 320" preserveAspectRatio="xMidYMid meet">
        {[1, 0.66, 0.33].map((lv, gi) => (
          <polygon key={gi} fill="none" stroke="#1e293b" strokeWidth="1"
                   points={metrics.map((_, i) => pt(i, R * lv).join(',')).join(' ')} />
        ))}
        {metrics.map((_, i) => {
          const [x, y] = pt(i, R)
          return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="#1e293b" />
        })}
        <polygon points={polyStr} fill="rgba(52,211,153,.18)" stroke="#34d399" strokeWidth="2" />
        {valPts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r="2.5" fill="#34d399" />)}
        {metrics.map((m, i) => {
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
              {isSignal ? '★ ' : ''}{m.label}
            </text>
          )
        })}
      </svg>
    </div>
  )
}
