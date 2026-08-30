/**
 * Rotation Lens — equal-weight vs cap-weight, small vs large, and the VXN-VIX
 * spread. All three series already ride in every breadth row and appear
 * nowhere else on this tab.
 *
 * ⭐ THREE STACKED INSTRUMENT PANELS, NOT THREE CARDS IN A ROW.
 *
 * Side by side on a 1500px page the three sat in a third of the width each with
 * a 30px sparkline, and the lens spent most of its viewport on nothing. There
 * are only ever three panels — the table below is the whole roster — so there is
 * no grid to be responsive about: stack them, let each take a third of the
 * height, and spend the width on the one thing that needed it. A ratio's
 * sparkline is a shape, and a shape over 90 sessions at 400px is a hairball; at
 * full width it is a trend.
 *
 * Each panel now reads as one instrument: the reading on the left, the trace on
 * the right, and the trace carries the REFERENCE the reading is measured from —
 * a dashed line at the value `measured` sessions ago, and a tick at the session
 * it came from. The delta printed beside the number is then something you can
 * see rather than something you have to take on trust.
 */
import { resolveViewColors } from './breadthViewShared'
// ⭐ The panel table MOVED to `rotation.js` (framework-free) — The Read quotes a
// panel's own `up`/`down` sentence, and a second copy of that copy is how the
// strip and the card beneath it would end up naming opposite directions. The
// `risingIsBull` ruling and the `measured` ruling both live there now.
import { ROTATION_PANELS as PANELS, rotationMeasured } from './rotation'

const pointIndex = (e) => {
  const el = e.target?.closest?.('[data-seek-idx]')
  if (!el) return null
  const i = Number(el.getAttribute('data-seek-idx'))
  return Number.isInteger(i) ? i : null
}

// The plot's own box. Height is a viewBox unit, not pixels — the svg stretches
// to whatever the flex row gives it — but the top/bottom insets keep the trace
// off its own edges so a series pinned at its window high is still visible.
const H = 40
const TOP = 3
const BOT = H - 3

// Every number this lens prints, printed the same way. It formats RATIOS (and a
// volatility spread), which is this file's own reading — the shared registry
// `getFmt` formats a metric ROW and none of these three is a registry metric —
// so one local authority is the right number of authorities.
const fmt = (v) => Number(v).toFixed(3)

export default function RotationView({
  rows = [], rowIdx = 0, onSeek, canSeek, options = {},
}) {
  const colors = resolveViewColors(options.palette, options.intensity)
  const lookback = Number(options.lookback ?? 20)
  // `win`, not `window`: a local named `window` shadows the global for the
  // whole function body.
  const win = rows.slice(rowIdx)
  if (!win.length) return null

  // The sparklines below plot oldest → newest; this is the session each drawn
  // x-position belongs to, computed ONCE rather than per panel.
  const ascRows = [...win].reverse()
  const lastX = Math.max(1, ascRows.length - 1)
  const colW = 100 / Math.max(1, ascRows.length - 1)
  const reachable = ascRows.map(r => (canSeek ? !!canSeek(r.date) : false))

  // THE SPAN MEASURED IS THE SPAN PRINTED — the rule, and its reason, live in
  // `rotation.js` beside the table this lens draws from.
  const measured = rotationMeasured(lookback, win.length)

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: '12px 18px',
                  display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div data-testid="rotation-basis"
           style={{ font: '600 10px \'Instrument Sans\', sans-serif', color: '#64748b',
                    letterSpacing: '.4px', flex: '0 0 auto' }}>
        {win.length} session{win.length === 1 ? '' : 's'} · since {win[win.length - 1].date}
        {measured < lookback
          ? ` · shorter than the ${lookback}-day setting, so changes are measured over ${measured}`
          : ` · changes measured over ${measured} sessions`}
      </div>

      {PANELS.map(p => {
        const series = win.map(p.read)
        const vals = series.filter(v => v != null && !isNaN(Number(v))).map(Number)
        const now = series[0]
        const prior = measured > 0 ? series[measured] : null
        const usable = now != null && prior != null && vals.length >= 2

        const delta = usable ? Number(now) - Number(prior) : null
        // A ratio's own direction is the whole signal; `up`/`down` name what
        // that direction means for THIS pair rather than a generic bull/bear.
        const verdict = !usable
          ? `${p.sub} not reported over this window`
          : (delta >= 0 ? p.up : p.down)
        // …and the colour reads the SAME declaration the sentence does.
        const rising = usable && delta >= 0
        const deltaColor = rising === p.risingIsBull ? colors.bull : colors.bear

        const min = vals.length ? Math.min(...vals) : 0
        const max = vals.length ? Math.max(...vals) : 1
        const range = (max - min) || 1
        const asc = [...series].reverse()
        const X = (i) => (i / lastX) * 100
        const Y = (v) => BOT - ((Number(v) - min) / range) * (BOT - TOP)
        const drawn = asc.map((v, i) => (v == null ? null : { i, v: Number(v) })).filter(Boolean)
        const pts = drawn.map(d => `${X(d.i).toFixed(2)},${Y(d.v).toFixed(2)}`).join(' ')
        // The fog under the trace — the FuturesStrip idiom, and the reason the
        // fill stops at the floor rather than at the reference line: a fill
        // between line and reference crosses itself every time the ratio does.
        const fog = drawn.length
          ? `${X(drawn[0].i).toFixed(2)},${BOT} ${pts} ${X(drawn[drawn.length - 1].i).toFixed(2)},${BOT}`
          : ''
        // Where the reference reading sits, on both axes.
        const refY = usable ? Y(prior) : null
        const refX = usable ? X(lastX - measured) : null
        const head = drawn.length ? drawn[drawn.length - 1] : null

        return (
          <div key={p.key} data-testid={`rotation-panel-${p.key}`}
               style={{ background: '#0e131a', borderRadius: 10, padding: '12px 14px',
                        border: '1px solid rgba(255,255,255,0.05)',
                        flex: '1 1 0', minHeight: 132,
                        display: 'grid', gap: 16, alignItems: 'stretch',
                        gridTemplateColumns: 'minmax(180px, 232px) minmax(0, 1fr)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ font: '700 10px \'Instrument Sans\', sans-serif', letterSpacing: '.5px',
                               textTransform: 'uppercase', color: '#94a3b8' }}>{p.label}</span>
                <span style={{ font: '600 9px \'Instrument Sans\', sans-serif', color: '#475569' }}>{p.sub}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 2 }}>
                <span data-testid={`rotation-value-${p.key}`}
                      style={{ font: '800 30px \'Instrument Sans\', sans-serif', color: '#e8e8ea',
                               letterSpacing: '-0.5px', lineHeight: 1.1 }}>
                  {usable ? fmt(now) : '—'}
                </span>
                {usable && (
                  <span data-testid={`rotation-delta-${p.key}`}
                        style={{ font: '700 11px \'Instrument Sans\', sans-serif',
                                 color: deltaColor }}>
                    {delta >= 0 ? '+' : ''}{fmt(delta)} / {measured}d
                  </span>
                )}
              </div>
              {usable && (
                <div data-testid={`rotation-reference-${p.key}`}
                     style={{ font: '600 9px \'Instrument Sans\', sans-serif', color: '#475569',
                              marginTop: 2 }}>
                  measured from {fmt(prior)} on {win[measured].date}
                </div>
              )}
              <div data-testid={`rotation-verdict-${p.key}`}
                   style={{ font: '600 11px \'Instrument Sans\', sans-serif', color: '#94a3b8',
                            marginTop: 'auto', paddingTop: 8, lineHeight: 1.45 }}>
                {verdict}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'stretch', gap: 8, minWidth: 0 }}>
              <svg width="100%" height="100%" viewBox={`0 0 100 ${H}`} preserveAspectRatio="none"
                   style={{ flex: 1, minWidth: 0, minHeight: 64, display: 'block' }}
                   aria-hidden="true"
                   onClick={(e) => {
                     const i = pointIndex(e)
                     if (i == null || !reachable[i]) return
                     onSeek?.(ascRows[i].date)
                   }}>
                {pts ? (
                  <>
                    <polygon points={fog} fill={deltaColor} opacity={0.10} />
                    {refY != null && (
                      <>
                        <line data-testid={`rotation-baseline-${p.key}`}
                              x1="0" y1={refY} x2="100" y2={refY} stroke="#475569" strokeWidth="0.8"
                              strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
                        <line x1={refX} y1={TOP} x2={refX} y2={BOT} stroke="#334155" strokeWidth="0.8"
                              strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
                      </>
                    )}
                    <polyline data-testid={`rotation-spark-${p.key}`} points={pts} fill="none"
                              strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round"
                              vectorEffect="non-scaling-stroke" opacity={colors.fillOpacity}
                              stroke={deltaColor} />
                    {head && (
                      <circle cx={X(head.i)} cy={Y(head.v)} r="1.4" fill={deltaColor}
                              opacity={colors.fillOpacity} />
                    )}
                  </>
                ) : (
                  <line x1="0" y1={H / 2} x2="100" y2={H / 2} stroke="#334155" strokeDasharray="2 2" />
                )}
                {pts && asc.map((v, i) => (v == null ? null : (
                  <rect key={ascRows[i]?.date ?? i} data-testid={`rotation-point-${p.key}-${i}`}
                        data-seek-idx={i} data-seek-date={ascRows[i]?.date}
                        x={Math.max(0, X(i) - colW / 2)}
                        y="0" width={colW} height={H} fill="transparent"
                        style={{ cursor: reachable[i] ? 'pointer' : 'default' }}>
                    <title>{`${ascRows[i]?.date} · ${p.sub} ${fmt(v)}`}</title>
                  </rect>
                )))}
              </svg>
              {/* The trace's own scale. Two numbers is the whole axis a ratio
                  needs, and without them the shape is unreadable in absolute
                  terms — which is the complaint a sparkline usually earns. */}
              {vals.length > 0 && (
                <div data-testid={`rotation-range-${p.key}`}
                     style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
                              font: '600 9px \'Instrument Sans\', sans-serif', color: '#475569',
                              textAlign: 'right', flex: '0 0 auto', padding: '2px 0' }}>
                  <span>{fmt(max)}</span>
                  <span>{fmt(min)}</span>
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
