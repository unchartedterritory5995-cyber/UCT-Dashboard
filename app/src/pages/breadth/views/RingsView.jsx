/**
 * Vitals Rings — the first visible metric renders as a large hero ring; the rest
 * orbit as smaller rings. Fill arc = normalize(metric,row); color = metricColor.
 */
import { metricColor } from './breadthViewShared'

function Ring({ metric, row, norm, size, onDrill }) {
  const stroke = size >= 110 ? 11 : 7
  const r = (size - stroke) / 2 - 2
  const c = 2 * Math.PI * r
  const pct = norm == null ? 0 : norm
  const offset = c * (1 - pct / 100)
  const color = metricColor(metric, row)
  const clickable = !!metric.drillKey
  const cx = size / 2
  return (
    <div style={{ textAlign: 'center' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}
           role={clickable ? 'button' : undefined}
           aria-label={clickable ? `${metric.label} details` : undefined}
           style={{ cursor: clickable ? 'pointer' : 'default' }}
           onClick={clickable ? () => onDrill(metric) : undefined}>
        <circle cx={cx} cy={cx} r={r} fill="none" stroke="#1e293b" strokeWidth={stroke} />
        <circle cx={cx} cy={cx} r={r} fill="none" stroke={color} strokeWidth={stroke}
                strokeLinecap="round" strokeDasharray={c} strokeDashoffset={offset}
                transform={`rotate(-90 ${cx} ${cx})`}
                style={{ filter: `drop-shadow(0 0 5px ${color}66)`, transition: 'stroke-dashoffset .4s ease' }} />
        <text x={cx} y={cx + 4} textAnchor="middle" fill="#e2e8f0"
              fontFamily="Instrument Sans, sans-serif" fontWeight="800"
              fontSize={size >= 110 ? 30 : 15}>{metric.getFmt(row)}</text>
      </svg>
      <div style={{ font: '700 9px Instrument Sans, sans-serif', letterSpacing: '.6px',
                    textTransform: 'uppercase', color: '#94a3b8', marginTop: 2 }}>
        {metric.label}
      </div>
    </div>
  )
}

export default function RingsView({ currentRow, metrics, normalize, onDrill }) {
  if (!currentRow || metrics.length === 0) return null
  const [hero, ...rest] = metrics
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'center',
                  justifyContent: 'center', padding: '24px 18px' }}>
      <Ring metric={hero} row={currentRow} norm={normalize(hero, currentRow)} size={140} onDrill={onDrill} />
      {rest.map(m => (
        <Ring key={m.key} metric={m} row={currentRow} norm={normalize(m, currentRow)} size={84} onDrill={onDrill} />
      ))}
    </div>
  )
}
