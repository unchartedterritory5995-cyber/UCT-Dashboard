/**
 * Regime Clock — participation level (x) against its rate of change (y), with
 * the four quadrants named and a fading trail showing the path in. Level says
 * where we are; momentum says which way we are going. No snapshot view can
 * show both, which is the whole reason this lens exists.
 */
import { resolveViewColors } from './breadthViewShared'

export function quadrantOf(level, momentum) {
  if (level >= 50) return momentum >= 0 ? 'Expansion' : 'Distribution'
  return momentum >= 0 ? 'Recovery' : 'Contraction'
}

const QUADRANT_NOTE = {
  Expansion:    'Broad and still broadening',
  Recovery:     'Narrow but repairing',
  Distribution: 'Broad but deteriorating',
  Contraction:  'Narrow and still narrowing',
}

export default function RegimeClockView({ rows = [], rowIdx = 0, options = {} }) {
  const colors = resolveViewColors(options.palette, options.intensity)
  const roc = Number(options.rocWindow ?? 20)
  const trailLen = Number(options.trail ?? 30)
  const levelKey = options.level ?? 'pct_above_50sma'
  const window = rows.slice(rowIdx)
  const need = roc + 1

  const levelAt = (i) => {
    const v = window[i]?.[levelKey]
    return v == null || isNaN(Number(v)) ? null : Number(v)
  }

  if (window.length < need || levelAt(0) == null || levelAt(roc) == null) {
    return (
      <div style={{ padding: 24, font: '600 12px \'Instrument Sans\', sans-serif', color: '#94a3b8' }}>
        <div data-testid="clock-insufficient">
          Needs {need} sessions of {levelKey} to measure momentum — has {window.length}.
        </div>
        <div style={{ marginTop: 6, color: '#64748b', fontSize: 11 }}>
          Widen the window with the day pills above.
        </div>
      </div>
    )
  }

  // Trail points: newest-first index i → (level, level - level(i+roc)).
  const pts = []
  for (let i = 0; i < Math.min(trailLen, window.length - roc); i++) {
    const lv = levelAt(i), prior = levelAt(i + roc)
    if (lv == null || prior == null) continue
    pts.push({ i, date: window[i].date, level: lv, mom: lv - prior })
  }
  if (!pts.length) return null

  const today = pts[0]
  const regime = quadrantOf(today.level, today.mom)
  const maxMom = Math.max(10, ...pts.map(p => Math.abs(p.mom)))

  // viewBox 0..100 both axes; x = level, y inverted so positive momentum is up.
  const X = (level) => Math.max(0, Math.min(100, level))
  const Y = (mom) => 50 - (mom / maxMom) * 48

  const path = pts.map((p, k) => `${k === 0 ? 'M' : 'L'}${X(p.level).toFixed(2)},${Y(p.mom).toFixed(2)}`).join(' ')
  const label = (text, x, y, anchor) => (
    <text x={x} y={y} textAnchor={anchor} fill="#475569"
          fontFamily="Instrument Sans, sans-serif" fontWeight="800" fontSize="3.4"
          letterSpacing="0.4">{text}</text>
  )

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '10px 18px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <span data-testid="regime-name"
              style={{ font: '800 20px \'Instrument Sans\', sans-serif', color: colors.bull }}>
          {regime}
        </span>
        <span style={{ font: '600 11px \'Instrument Sans\', sans-serif', color: '#94a3b8' }}>
          {QUADRANT_NOTE[regime]}
        </span>
        <span style={{ font: '600 11px \'Instrument Sans\', sans-serif', color: '#64748b', marginLeft: 'auto' }}>
          level <strong style={{ color: '#e2e8f0' }}>{today.level.toFixed(1)}</strong>
          {'  ·  '}{roc}d momentum{' '}
          <strong data-testid="regime-momentum" style={{ color: today.mom >= 0 ? colors.bull : colors.bear }}>
            {today.mom >= 0 ? '+' : ''}{today.mom.toFixed(1)}
          </strong>
        </span>
      </div>

      <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img"
           aria-label={`Regime clock: ${regime}, level ${today.level.toFixed(1)}, ${roc}-day momentum ${today.mom.toFixed(1)}`}
           style={{ flex: 1, minHeight: 0, marginTop: 10 }}>
        <line x1="50" y1="0" x2="50" y2="100" stroke="#1e293b" strokeWidth="0.4" vectorEffect="non-scaling-stroke" />
        <line x1="0" y1="50" x2="100" y2="50" stroke="#1e293b" strokeWidth="0.4" vectorEffect="non-scaling-stroke" />
        {label('RECOVERY', 2, 6, 'start')}
        {label('EXPANSION', 98, 6, 'end')}
        {label('CONTRACTION', 2, 97, 'start')}
        {label('DISTRIBUTION', 98, 97, 'end')}

        <path d={path} fill="none" stroke={colors.bull} strokeWidth="1.1" opacity="0.35"
              vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        {pts.map((p, k) => (
          <circle key={p.date ?? k} cx={X(p.level)} cy={Y(p.mom)} r={k === 0 ? 1.9 : 0.8}
                  fill={k === 0 ? colors.bull : '#475569'}
                  opacity={k === 0 ? 1 : Math.max(0.15, 1 - k / pts.length)}>
            <title>{`${p.date} · level ${p.level.toFixed(1)} · momentum ${p.mom.toFixed(1)}`}</title>
          </circle>
        ))}
      </svg>

      <div style={{ font: '600 10px \'Instrument Sans\', sans-serif', color: '#64748b', marginTop: 6 }}>
        {pts.length} sessions plotted · since {pts[pts.length - 1].date} · y-axis ±{maxMom.toFixed(0)}
      </div>
    </div>
  )
}
