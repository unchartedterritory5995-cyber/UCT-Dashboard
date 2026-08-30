/**
 * Vitals Rings — the first visible metric renders as a large hero ring; the rest
 * orbit as smaller rings. Fill arc = normalize(metric,row); color = metricColor.
 * The Signal of the Day gets a gold ★; the notable divergence pulses.
 */
import { drillProps, metricColor, resolveViewColors } from './breadthViewShared'
import signalStyles from './signals.module.css'
import UIcon from '../../../components/ui/UIcon'

function Ring({ metric, row, norm, size, onDrill, isSignal, isNotable, colors }) {
  const stroke = size >= 110 ? 11 : 7
  const r = (size - stroke) / 2 - 2
  const c = 2 * Math.PI * r
  const pct = norm == null ? 0 : norm
  const offset = c * (1 - pct / 100)
  const color = metricColor(metric, row, colors.tier)
  const clickable = !!metric.drillKey
  const cx = size / 2
  return (
    <div className={isNotable ? signalStyles.pulse : undefined}
         style={{ textAlign: 'center', borderRadius: 12, padding: 4,
                  boxShadow: isSignal ? '0 0 0 1px #c9a84c, 0 0 14px rgba(201,168,76,.35)' : 'none' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}
           {...drillProps(metric, onDrill)}
           style={{ cursor: clickable ? 'pointer' : 'default' }}>
        <circle cx={cx} cy={cx} r={r} fill="none" stroke="#1e293b" strokeWidth={stroke} />
        <circle cx={cx} cy={cx} r={r} fill="none" stroke={color} strokeWidth={stroke}
                strokeLinecap="round" strokeDasharray={c} strokeDashoffset={offset}
                opacity={colors.fillOpacity}
                transform={`rotate(-90 ${cx} ${cx})`}
                style={{ filter: colors.dim ? 'none' : `drop-shadow(0 0 ${colors.glow ? 9 : 5}px ${color}66)`, transition: 'stroke-dashoffset .4s ease' }} />
        <text x={cx} y={cx + 4} textAnchor="middle" fill="#e2e8f0"
              fontFamily="Instrument Sans, sans-serif" fontWeight="800"
              fontSize={size >= 110 ? 30 : 15}>{metric.getFmt(row)}</text>
      </svg>
      <div style={{ font: '700 9px Instrument Sans, sans-serif', letterSpacing: '.6px',
                    textTransform: 'uppercase', color: isSignal ? '#c9a84c' : '#94a3b8', marginTop: 2 }}>
        {isSignal ? <><UIcon name="star-fill" size={9} style={{ verticalAlign: '-1px', marginRight: 3 }} /></> : ''}{metric.label}
      </div>
    </div>
  )
}

export default function RingsView({ currentRow, metrics, normalize, onDrill, signalKey, notableKey, options = {} }) {
  if (!currentRow || metrics.length === 0) return null
  const colors = resolveViewColors(options.palette, options.intensity)
  const [hero, ...rest] = metrics
  const ringFor = (m, size) => (
    <Ring key={m.key} metric={m} row={currentRow} norm={normalize(m, currentRow)} size={size}
          onDrill={onDrill} isSignal={m.key === signalKey} isNotable={m.key === notableKey} colors={colors} />
  )
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'center',
                  justifyContent: 'center', padding: '24px 18px' }}>
      {ringFor(hero, 140)}
      {rest.map(m => ringFor(m, 84))}
    </div>
  )
}
