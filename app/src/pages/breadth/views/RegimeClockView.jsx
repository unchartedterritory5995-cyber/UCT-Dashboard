/**
 * Regime Clock — participation level (x) against its rate of change (y), with
 * the four quadrants named and a fading trail showing the path in. Level says
 * where we are; momentum says which way we are going. No snapshot view can
 * show both, which is the whole reason this lens exists.
 */
import { resolveViewColors, WIDEN_WINDOW_HINT } from './breadthViewShared'
import useHoverReadout from './useHoverReadout'
import HoverReadout from './HoverReadout'
import { optionsSchema } from './viewMetricConfig'

// The option schema already carries the human label the Customize panel shows
// ("% above 50 SMA"). The refusal below printed the raw field key at the reader
// instead — two names for one series, and the one shown was the internal one.
const levelLabel = (value) =>
  optionsSchema('clock').find(o => o.name === 'level')?.choices
    ?.find(c => c.value === value)?.label ?? value

// Both axes are closed on the UPPER side: level 50 counts as broad, momentum 0
// counts as improving. Neither boundary is arbitrary — 50 is the midpoint of a
// participation percentage and 0 is the sign change of a difference — but they
// ARE decisions, so `RegimeClockView.test.jsx` pins both rather than leaving a
// reader to infer them from `>=`.
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

// The trail dot under the pointer, found once per event instead of one handler
// per dot. Each hit target names the session it stands for.
const dotIndex = (e) => {
  const el = e.target?.closest?.('[data-seek-idx]')
  if (!el) return null
  const k = Number(el.getAttribute('data-seek-idx'))
  return Number.isInteger(k) ? k : null
}

export default function RegimeClockView({
  rows = [], rowIdx = 0, onSeek, canSeek, options = {},
}) {
  const { hostRef, tipRef, show, hide } = useHoverReadout()
  const colors = resolveViewColors(options.palette, options.intensity)
  const roc = Number(options.rocWindow ?? 20)
  const trailLen = Number(options.trail ?? 30)
  const levelKey = options.level ?? 'pct_above_50sma'
  // `win`, not `window`: a local named `window` shadows the global for the
  // whole function body.
  const win = rows.slice(rowIdx)
  const need = roc + 1

  const levelAt = (i) => {
    const v = win[i]?.[levelKey]
    return v == null || isNaN(Number(v)) ? null : Number(v)
  }

  if (win.length < need || levelAt(0) == null || levelAt(roc) == null) {
    return (
      <div style={{ padding: 24, font: '600 12px \'Instrument Sans\', sans-serif', color: '#94a3b8' }}>
        <div data-testid="clock-refusal">
          Needs {need} sessions of {levelLabel(levelKey)} to measure momentum — has {win.length}.
        </div>
        <div data-testid="clock-refusal-hint" style={{ marginTop: 6, color: '#64748b', fontSize: 11 }}>
          {WIDEN_WINDOW_HINT}
        </div>
      </div>
    )
  }

  // Trail points: newest-first index i → (level, level - level(i+roc)).
  const pts = []
  for (let i = 0; i < Math.min(trailLen, win.length - roc); i++) {
    const lv = levelAt(i), prior = levelAt(i + roc)
    if (lv == null || prior == null) continue
    pts.push({ i, date: win[i].date, level: lv, mom: lv - prior })
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
    <div ref={hostRef}
         style={{ height: '100%', display: 'flex', flexDirection: 'column',
                  padding: '10px 18px 16px', position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <span data-testid="clock-regime"
              style={{ font: '800 20px \'Instrument Sans\', sans-serif', color: colors.bull }}>
          {regime}
        </span>
        <span style={{ font: '600 11px \'Instrument Sans\', sans-serif', color: '#94a3b8' }}>
          {QUADRANT_NOTE[regime]}
        </span>
        <span style={{ font: '600 11px \'Instrument Sans\', sans-serif', color: '#64748b', marginLeft: 'auto' }}>
          level <strong style={{ color: '#e2e8f0' }}>{today.level.toFixed(1)}</strong>
          {'  ·  '}{roc}d momentum{' '}
          <strong data-testid="clock-momentum" style={{ color: today.mom >= 0 ? colors.bull : colors.bear }}>
            {today.mom >= 0 ? '+' : ''}{today.mom.toFixed(1)}
          </strong>
        </span>
      </div>

      <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img"
           aria-label={`Regime clock: ${regime}, level ${today.level.toFixed(1)}, ${roc}-day momentum ${today.mom.toFixed(1)}`}
           style={{ flex: 1, minHeight: 0, marginTop: 10 }}
           onClick={(e) => {
             const k = dotIndex(e)
             if (k == null) return
             const d = pts[k]?.date
             if (d && (canSeek ? canSeek(d) : false)) onSeek?.(d)
           }}
           onMouseOver={(e) => {
             const k = dotIndex(e)
             if (k == null) { hide(); return }
             const p = pts[k]
             show(e, `dot:${k}`, p.date,
                  [`level ${p.level.toFixed(1)}`, `${roc}d momentum ${p.mom >= 0 ? '+' : ''}${p.mom.toFixed(1)}`])
           }}
           onMouseLeave={hide}>
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
                  opacity={k === 0 ? 1 : Math.max(0.15, 1 - k / pts.length)} />
        ))}
        {/* A trail dot is r=0.8 in a 100×100 box — unhittable. The hit target
            is its own transparent circle, so the drawn trail keeps the fade
            that makes it readable as a path. */}
        {pts.map((p, k) => {
          const reachable = canSeek ? !!canSeek(p.date) : false
          return (
            <circle key={`hit-${p.date ?? k}`} data-testid={`clock-dot-${k}`}
                    data-seek-idx={k} data-seek-date={p.date}
                    cx={X(p.level)} cy={Y(p.mom)} r="2.6" fill="transparent"
                    style={{ cursor: reachable ? 'pointer' : 'default' }}>
              <title>{`${p.date} · level ${p.level.toFixed(1)} · momentum ${p.mom.toFixed(1)}`}</title>
            </circle>
          )
        })}
      </svg>

      <div data-testid="clock-basis"
           style={{ font: '600 10px \'Instrument Sans\', sans-serif', color: '#64748b', marginTop: 6 }}>
        {pts.length} sessions plotted · since {pts[pts.length - 1].date} · y-axis ±{maxMom.toFixed(0)}
      </div>
      <HoverReadout tipRef={tipRef} styleKey="clock" />
    </div>
  )
}
