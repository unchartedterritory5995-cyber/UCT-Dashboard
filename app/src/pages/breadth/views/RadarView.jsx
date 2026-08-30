/**
 * Radar / Shape — every visible metric is a spoke and the polygon is the shape
 * of the board: even and wide = broad participation, dented = lopsided.
 *
 * 🔴 A SHAPE DRAWN AGAINST NOTHING IS NOT A READING. The polygon floated in a
 * large black field with three unlabelled grey rings, so a long spike read as
 * "something is broken" rather than "this metric is at 90 and the rest are at
 * 55". Three things were missing and all three are here now:
 *
 *   · LABELLED SCALE RINGS at `NORM_TICKS`, numbered up the vertical axis — the
 *     same marks the Rings gauge and the Meters track carry, so a reader who has
 *     decoded one board has decoded this one.
 *   · THE READING AT EVERY SPOKE, under its name, so the shape names its own
 *     numbers instead of sending the reader to another view for them.
 *   · A WIDE VIEWBOX. A circle cannot fill a 2.16:1 panel, but its LABELS can:
 *     the axis captions are placed on an ellipse (wider than the polygon they
 *     annotate), so the composition spans the panel and the long names on the
 *     left and right edges finally have room instead of overflowing their box.
 *
 * ⛔ THE RINGS STAY CIRCULAR while the label ellipse does not. Stretching the
 * grid would fill more pixels and make a spoke at 3 o'clock look longer than the
 * identical reading at 12 — the one thing a radar exists to let you compare.
 */
import { NORM_TICKS, normBasis, resolveViewColors } from './breadthViewShared'

// The drawing space. Wider than tall so the caption ellipse has somewhere to go.
const VB_W = 700, VB_H = 350
const CX = VB_W / 2, CY = 168, R = 126
// How far the captions sit outside the polygon, and how much wider than tall
// that ring of captions is. `KX` is what spends the panel's spare width.
const LABEL_PAD = 16
const KX = 1.6, KY = 1.06

export default function RadarView({
  currentRow, rows = [], metrics, normalize, onDrill, signalKey, notableKey, options = {},
}) {
  if (!currentRow || (metrics?.length ?? 0) < 3) {
    return (
      <div data-testid="radar-refusal"
           style={{ padding: 24, color: '#94a3b8', font: '600 12px Instrument Sans, sans-serif' }}>
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
  const angleAt = (i) => (-90 + i * 360 / N) * Math.PI / 180
  const pt = (i, rad) => {
    const a = angleAt(i)
    return [CX + rad * Math.cos(a), CY + rad * Math.sin(a)]
  }
  const labelPt = (i) => {
    const a = angleAt(i)
    const rad = R + LABEL_PAD
    return [CX + rad * KX * Math.cos(a), CY + rad * KY * Math.sin(a)]
  }
  const valPts = shown.map((m, i) => {
    const v = normalize(m, currentRow)
    return pt(i, R * ((v == null ? 0 : Math.max(0, Math.min(100, v))) / 100))
  })
  const polyStr = valPts.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0,
                  padding: '12px 18px' }}>
      <div data-testid="radar-basis"
           style={{ font: '600 10px \'Instrument Sans\', sans-serif', color: '#64748b',
                    letterSpacing: '.4px', marginBottom: 4, flex: '0 0 auto' }}>
        {`Spoke length = ${normBasis(rows.length)} · rings at ${NORM_TICKS.filter(t => t > 0).join(' · ')}`}
      </div>
      <svg width="100%" height="100%" viewBox={`0 0 ${VB_W} ${VB_H}`}
           preserveAspectRatio="xMidYMid meet"
           style={{ flex: '1 1 auto', minHeight: 0 }}>
        {/* Scale rings — every tick the other boards mark, drawn and NUMBERED. */}
        {NORM_TICKS.filter(t => t > 0).map(t => (
          <polygon key={`ring-${t}`} fill="none"
                   stroke={t === 100 ? '#243247' : '#1b2534'} strokeWidth={t === 100 ? 1.2 : 1}
                   points={shown.map((_, i) => pt(i, R * t / 100).map(v => v.toFixed(1)).join(',')).join(' ')} />
        ))}
        {shown.map((_, i) => {
          const [x, y] = pt(i, R)
          return <line key={`spoke-${i}`} x1={CX} y1={CY} x2={x.toFixed(1)} y2={y.toFixed(1)} stroke="#1b2534" />
        })}
        {NORM_TICKS.filter(t => t > 0).map(t => (
          <text key={`sc-${t}`} data-radar-scale={t} x={CX - 5} y={CY - R * t / 100 + 3}
                textAnchor="end" fill="#4b5a70" fontSize="7.5" fontWeight="700"
                fontFamily="Instrument Sans, sans-serif">{t}</text>
        ))}
        <polygon data-testid="radar-shape" points={polyStr}
                 fill={`${colors.bull}2e`} stroke={colors.bull} strokeWidth="2"
                 opacity={colors.fillOpacity} />
        {valPts.map((p, i) => (
          <circle key={`v${i}`} cx={p[0].toFixed(1)} cy={p[1].toFixed(1)} r="3" fill={colors.bull} />
        ))}
        {shown.map((m, i) => {
          const [lx, ly] = labelPt(i)
          const isSignal = m.key === signalKey
          const isNotable = m.key === notableKey
          const clickable = !!m.drillKey
          const anchor = lx < CX - 6 ? 'end' : lx > CX + 6 ? 'start' : 'middle'
          const x = lx.toFixed(1)
          return (
            <text key={m.key} data-radar-axis={m.key} x={x} y={ly.toFixed(1)} textAnchor={anchor}
                  dominantBaseline="middle"
                  fontSize="9" fontWeight="700" fontFamily="Instrument Sans, sans-serif"
                  style={{ cursor: clickable ? 'pointer' : 'default' }}
                  onClick={clickable ? () => onDrill(m) : undefined}>
              <tspan x={x} fill={isSignal ? '#c9a84c' : isNotable ? colors.tier.a : '#94a3b8'}>
                {isSignal ? '★ ' : ''}{m.label}
              </tspan>
              {/* ⭐ THE NUMBER, BESIDE THE NAME. A vertex on a numbered ring is
                  readable; a vertex plus its reading needs no ring at all. */}
              <tspan x={x} dy="11" fill="#cbd5e1" fontSize="9.5" fontWeight="800">
                {m.getFmt(currentRow)}
              </tspan>
            </text>
          )
        })}
      </svg>
      {capped && (
        <div data-testid="radar-cap"
             style={{ font: '600 9px Instrument Sans, sans-serif', color: '#64748b',
                      marginTop: 2, flex: '0 0 auto' }}>
          showing {shown.length} of {metrics.length} — narrow the set in Customize
        </div>
      )}
    </div>
  )
}
