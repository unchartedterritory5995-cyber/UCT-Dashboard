/**
 * Regime Clock — participation level (x) against its rate of change (y), with
 * the four quadrants named and a fading trail showing the path in. Level says
 * where we are; momentum says which way we are going. No snapshot view can
 * show both, which is the whole reason this lens exists.
 */
import { resolveViewColors, WIDEN_WINDOW_HINT, quadrantOf } from './breadthViewShared'
import useHoverReadout from './useHoverReadout'
import HoverReadout from './HoverReadout'
import { optionLabel } from './viewMetricConfig'

// The option schema already carries the human label the Customize panel shows
// ("% above 50 SMA"). The refusal below printed the raw field key at the reader
// instead — two names for one series, and the one shown was the internal one.
// The lookup itself now lives in the registry (`optionLabel`) because The Read
// names the same series and must name it the same way.
const levelLabel = (value) => optionLabel('clock', 'level', value)

// ⭐ `quadrantOf` LIVES IN `breadthViewShared.js` — exactly ONE implementation.
// The Read names the regime too, and a second copy of the `>= 50` / `>= 0`
// boundaries is how the strip and the plot beneath it would come to disagree
// about which quadrant today is in.
// ⛔ It is NOT re-exported from here (see the note in `AnalogueDeckView.jsx`).

const QUADRANT_NOTE = {
  Expansion:    'Broad and still broadening',
  Recovery:     'Narrow but repairing',
  Distribution: 'Broad but deteriorating',
  Contraction:  'Narrow and still narrowing',
}

/**
 * The four quadrant names, and where each one lives. Level runs left → right and
 * momentum runs bottom → top, so the corners follow from `quadrantOf`'s own
 * boundaries rather than from a designer's memory of them.
 */
const QUADRANT_CORNERS = [
  { name: 'Recovery',     x: 'left',  y: 'top' },      // narrow, improving
  { name: 'Expansion',    x: 'right', y: 'top' },      // broad, improving
  { name: 'Contraction',  x: 'left',  y: 'bottom' },   // narrow, deteriorating
  { name: 'Distribution', x: 'right', y: 'bottom' },   // broad, deteriorating
]

// The level axis is a percentage, so its ticks are fixed. The MOMENTUM axis is
// not: `maxMom` is derived from the trail, so a hardcoded ±10 would be a lie the
// moment a trail ran hotter than that. Its ticks are FRACTIONS of the bound and
// are labelled from it.
const LEVEL_TICKS = [0, 25, 50, 75, 100]
const MOM_TICK_FRACTIONS = [1, 0.5, 0, -0.5, -1]
const momTickLabel = (v) => {
  if (v === 0) return '0'
  // One decimal where a half-tick needs it, none where it does not: a tick
  // reading "+5.0" beside "+10.0" is precision the axis does not have.
  const n = Number(v.toFixed(1))
  return `${n > 0 ? '+' : ''}${n}`
}

// Room for the two gutters the ticks are printed in. The plot is an absolutely
// positioned box inside them, so a viewBox unit is exactly 1% of the plot and an
// HTML label can be placed with the SAME X()/Y() the trail is drawn with.
const GUTTER_L = 34
const GUTTER_B = 26
const tickText = { position: 'absolute', font: '600 8px \'Instrument Sans\', sans-serif',
                   color: '#64748b', whiteSpace: 'nowrap' }

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
  const momTicks = MOM_TICK_FRACTIONS.map(f => f * maxMom)

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

      {/* ⭐ THE PLOT IS A BOX INSIDE TWO GUTTERS, AND THE TICK TEXT IS HTML.
          The svg is `preserveAspectRatio="none"` because the trail has to fill
          whatever shape the pane is — which stretches any `<text>` inside it by
          the same factor. The quadrant names WERE svg text and were being drawn
          several times wider than tall; every label lives in an overlay now, so
          the plot stays geometric and the type stays type. Because the svg fills
          the box exactly over a 0..100 viewBox, one viewBox unit is 1% of the
          box and a label can be placed with the SAME X()/Y() the dots use. */}
      <div style={{ flex: 1, minHeight: 0, marginTop: 10, position: 'relative' }}>
        <div style={{ position: 'absolute', left: GUTTER_L, right: 8, top: 4, bottom: GUTTER_B }}>
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img"
               aria-label={`Regime clock: ${regime}, level ${today.level.toFixed(1)}, ${roc}-day momentum ${today.mom.toFixed(1)}`}
               style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
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
            <rect x="0" y="0" width="100" height="100" fill="none" stroke="#151d28"
                  strokeWidth="1" vectorEffect="non-scaling-stroke" />
            {/* The quarter gridlines are what make a position READABLE off the
                plot; the two quadrant boundaries stay the stronger pair because
                they are the only lines that mean something. */}
            {LEVEL_TICKS.filter(v => v !== 0 && v !== 100).map(v => (
              <line key={`gx${v}`} x1={X(v)} y1="0" x2={X(v)} y2="100"
                    stroke={v === 50 ? '#233043' : '#161f2b'} strokeWidth={v === 50 ? 0.9 : 0.6}
                    vectorEffect="non-scaling-stroke" />
            ))}
            {momTicks.map(v => (
              <line key={`gy${v}`} x1="0" y1={Y(v)} x2="100" y2={Y(v)}
                    stroke={v === 0 ? '#233043' : '#161f2b'} strokeWidth={v === 0 ? 0.9 : 0.6}
                    vectorEffect="non-scaling-stroke" />
            ))}

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

          {/* The scale, and the four names — one layer, no pointer events, so
              nothing here can eat a click meant for a trail dot. */}
          <div aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
            {momTicks.map(v => (
              <span key={`ty${v}`} data-testid={`clock-tick-y-${v.toFixed(1)}`}
                    style={{ ...tickText, right: '100%', top: `${Y(v)}%`,
                             transform: 'translateY(-50%)', paddingRight: 6 }}>
                {momTickLabel(v)}
              </span>
            ))}
            {LEVEL_TICKS.map(v => (
              <span key={`tx${v}`} data-testid={`clock-tick-x-${v}`}
                    style={{ ...tickText, left: `${X(v)}%`, top: '100%',
                             transform: 'translate(-50%, 3px)' }}>
                {v}
              </span>
            ))}
            <span style={{ ...tickText, left: '50%', top: '100%', fontSize: 7,
                           letterSpacing: '.7px', color: '#475569',
                           transform: 'translate(-50%, 14px)' }}>
              PARTICIPATION LEVEL %
            </span>
            {QUADRANT_CORNERS.map(q => (
              <span key={q.name}
                    style={{ position: 'absolute', [q.x]: 4, [q.y]: 4,
                             font: '800 8px \'Instrument Sans\', sans-serif',
                             letterSpacing: '.7px', textTransform: 'uppercase',
                             color: q.name === regime ? '#94a3b8' : '#3d4a5c' }}>
                {q.name}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* ⭐ THE BASIS NAMES BOTH AXES, because one of them is self-scaling. The
          y bound moves with the trail, so a reader who does not know that could
          compare two screenshots of this lens and read a change in the SHAPE as
          a change in the market. */}
      <div data-testid="clock-basis"
           style={{ font: '600 10px \'Instrument Sans\', sans-serif', color: '#64748b', marginTop: 6 }}>
        {pts.length} sessions plotted · since {pts[pts.length - 1].date}
        {' · x-axis level 0–100 · y-axis '}{roc}d momentum ±{maxMom.toFixed(0)}
      </div>
      <HoverReadout tipRef={tipRef} styleKey="clock" />
    </div>
  )
}
