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
 *   · A SECOND SHAPE — the same board `prevRow` sessions back, dashed and
 *     unfilled. The Meters row already answers "and which way is it moving?"
 *     with a ghost marker off the same session; a radar that could not was the
 *     odd one out, and the two boards now say the same thing in their own idiom.
 *
 * ⛔⛔ THE DRAWING SPACE IS MEASURED IN PIXELS, NOT DECLARED IN VIEWBOX UNITS,
 * AND THAT IS THE FIX FOR THE ONE DEFECT HERE THAT READ AS BROKEN.
 *
 * A `<text>` inside a scaled viewBox scales with it. On a fixed `700×350` box
 * that meant `fontSize="9"` rendered at 16.6px across a full-width panel — a
 * caption bigger than this tab's headline type — and at 5.0px in a quarter-size
 * compare pane, where it was illegible (measured in Chromium: caption box 40.5px
 * tall at 1500×686, 12.0px at 710×245, for the same declaration). Nothing about
 * a metric's NAME should get bigger because the panel did.
 *
 * So the box measures itself (`ResizeObserver`) and the viewBox is set to its
 * own pixel size: one user unit is one device pixel, `fontSize` means what it
 * says, and every caption is the same size at every panel size. Until the first
 * measurement — and in jsdom, which has no `ResizeObserver` — `FALLBACK` stands
 * in, so the tree still renders and every test below still describes it.
 *
 * ⭐ AND THE MEASUREMENT IS WHAT LETS THE WIDTH EARN ITS PLACE. A circle cannot
 * fill a 2.2:1 panel: at the old fixed geometry the outer ring was 464px across
 * with 273px of dead width to the right of the last caption (measured). Knowing
 * the real box, the ring takes the HEIGHT (540px across at full width) and the
 * captions ride an ellipse pinned to the real WIDTH, each one joined to its own
 * spoke by a dotted continuation of that spoke — so the span between the shape
 * and its labels is the chart's own structure rather than a gap.
 *
 * ⛔ THE RINGS STAY CIRCULAR while the caption ellipse does not. Stretching the
 * grid would fill more pixels and make a spoke at 3 o'clock look longer than the
 * identical reading at 12 — the one thing a radar exists to let you compare.
 */
import { useLayoutEffect, useRef, useState } from 'react'
import { NORM_TICKS, normBasis, resolveViewColors } from './breadthViewShared'

// What the geometry uses before the first measurement, and forever in jsdom.
// Roughly a full-width panel, so an unmeasured render is a plausible one.
const FALLBACK = { w: 900, h: 420 }

// ⭐ TYPE SIZES IN PIXELS, AND THEY ARE THE POINT OF THE VIEWBOX ABOVE. These
// are the sizes that reach the screen at EVERY panel size.
const LABEL_FS = 11
const VALUE_FS = 11.5
const SCALE_FS = 9
// Below this ring radius the numbered ticks would be stacked closer than their
// own line height, so the rings stay and their numbers go — the basis line above
// already names the ticks. A caption that cannot be read is worse than none.
const SCALE_MIN_R = 78

// Room reserved OUTSIDE the ring: horizontally for a caption's own width (svg
// text neither wraps nor ellipsises, so this is what stops one running off the
// panel), vertically for its two lines.
const CAP_W = 120
const CAP_H = 28
// How far the captions sit outside the ring at minimum, and the gap between a
// caption's baseline pair.
const CAP_GAP = 20
const LINE_GAP = 12.5

/**
 * The box measures itself. `ResizeObserver` is guarded rather than assumed:
 * jsdom does not implement it, and a view that threw there would take every
 * rail in `viewRegistry.test.jsx` with it.
 */
function useBoxSize() {
  const ref = useRef(null)
  const [size, setSize] = useState(FALLBACK)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(([entry]) => {
      const r = entry.contentRect
      if (r.width > 1 && r.height > 1) {
        setSize(prev => (Math.abs(prev.w - r.width) < 1 && Math.abs(prev.h - r.height) < 1
          ? prev : { w: r.width, h: r.height }))
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, size]
}

export default function RadarView({
  currentRow, prevRow, rows = [], metrics, normalize, onDrill, signalKey, notableKey, options = {},
}) {
  const [plotRef, box] = useBoxSize()

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

  // ── the geometry, in pixels of the box we just measured ────────────────────
  const W = Math.max(120, box.w), H = Math.max(90, box.h)
  const CX = W / 2, CY = H / 2
  // The ring takes the HEIGHT (it is the scarce axis on every panel this tab
  // draws) and is bounded by the width only where the panel is genuinely narrow.
  const R = Math.max(26, Math.min(H / 2 - CAP_H - CAP_GAP, W / 2 - CAP_W - 24))
  // …and the captions ride an ellipse pinned to the REAL width: as far out as
  // the box allows once a caption's own width is reserved, never inside the ring.
  const RX = Math.max(R + CAP_GAP, W / 2 - CAP_W)
  const RY = R + CAP_GAP
  const showScale = R >= SCALE_MIN_R

  const N = shown.length
  const angleAt = (i) => (-90 + i * 360 / N) * Math.PI / 180
  const pt = (i, rad) => {
    const a = angleAt(i)
    return [CX + rad * Math.cos(a), CY + rad * Math.sin(a)]
  }
  const labelPt = (i) => {
    const a = angleAt(i)
    return [CX + RX * Math.cos(a), CY + RY * Math.sin(a)]
  }
  const ringOf = (row) => shown.map((m, i) => {
    const v = row ? normalize(m, row) : null
    return pt(i, R * ((v == null ? 0 : Math.max(0, Math.min(100, v))) / 100))
  })
  const asPoints = (pts) => pts.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')
  const valPts = ringOf(currentRow)
  const polyStr = asPoints(valPts)
  // The ghost is drawn only when it says something: an identical shape under the
  // live one is two lines claiming to be one reading.
  const ghostPts = prevRow ? ringOf(prevRow) : null
  const ghostStr = ghostPts && asPoints(ghostPts)
  const ghostMoved = !!ghostStr && ghostStr !== polyStr

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0,
                  padding: '12px 18px' }}>
      <div data-testid="radar-basis"
           style={{ font: '600 10px \'Instrument Sans\', sans-serif', color: '#64748b',
                    letterSpacing: '.4px', marginBottom: 4, flex: '0 0 auto' }}>
        {`Spoke length = ${normBasis(rows.length)} · rings at ${NORM_TICKS.filter(t => t > 0).join(' · ')}`}
        {ghostMoved ? ' · the dashed shape is three sessions back' : ''}
      </div>
      {/* 🔴 THE PLOT IS OUT OF FLOW, THE SAME SIZING FIX THE ROTATION LENS
          CARRIES: an `<svg>` with a viewBox has an INTRINSIC ASPECT RATIO, so
          in flow its own preferred height is a function of its width and it
          fights the column it sits in. Absolutely positioned inside a measured
          wrapper it contributes nothing to that calculation — and the wrapper is
          what `ResizeObserver` watches. */}
      <div ref={plotRef} style={{ flex: '1 1 auto', minHeight: 0, position: 'relative' }}>
        <svg width="100%" height="100%" viewBox={`0 0 ${W.toFixed(1)} ${H.toFixed(1)}`}
             preserveAspectRatio="xMidYMid meet"
             style={{ position: 'absolute', inset: 0, display: 'block' }}>
          {/* Scale rings — every tick the other boards mark. */}
          {NORM_TICKS.filter(t => t > 0).map(t => (
            <polygon key={`ring-${t}`} fill="none"
                     stroke={t === 100 ? '#243247' : '#1b2534'} strokeWidth={t === 100 ? 1.2 : 1}
                     vectorEffect="non-scaling-stroke"
                     points={asPoints(shown.map((_, i) => pt(i, R * t / 100)))} />
          ))}
          {shown.map((_, i) => {
            const [x, y] = pt(i, R)
            const [lx, ly] = labelPt(i)
            return (
              <g key={`spoke-${i}`}>
                <line x1={CX} y1={CY} x2={x.toFixed(1)} y2={y.toFixed(1)}
                      stroke="#1b2534" vectorEffect="non-scaling-stroke" />
                {/* ⭐ THE SPOKE CONTINUES TO ITS OWN CAPTION. The caption ellipse
                    is wider than the ring on purpose — that is what spends a
                    2.2:1 panel's width — and without this the span between a
                    vertex and the name of the thing it measures is a gap the
                    reader has to bridge by eye. */}
                <line x1={x.toFixed(1)} y1={y.toFixed(1)} x2={lx.toFixed(1)} y2={ly.toFixed(1)}
                      stroke="#141b26" strokeDasharray="2 4" vectorEffect="non-scaling-stroke" />
              </g>
            )
          })}
          {showScale && NORM_TICKS.filter(t => t > 0).map(t => (
            <text key={`sc-${t}`} data-radar-scale={t} x={CX - 6} y={CY - R * t / 100 + 3}
                  textAnchor="end" fill="#4b5a70" fontSize={SCALE_FS} fontWeight="700"
                  fontFamily="Instrument Sans, sans-serif">{t}</text>
          ))}
          {/* ⛔ A DASHED OUTLINE, NEVER A SECOND FILL. Two filled polygons on one
              radar read as an area chart of nothing; the prior shape is a
              boundary, and today's is the one with weight. */}
          {ghostMoved && (
            <polygon data-testid="radar-ghost" points={ghostStr} fill="none"
                     stroke={colors.bull} strokeWidth="1.2" strokeDasharray="4 4"
                     vectorEffect="non-scaling-stroke" opacity="0.34" />
          )}
          <polygon data-testid="radar-shape" points={polyStr}
                   fill={`${colors.bull}2e`} stroke={colors.bull} strokeWidth="2"
                   vectorEffect="non-scaling-stroke"
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
              <text key={m.key} data-radar-axis={m.key} x={x} y={(ly - LINE_GAP / 2).toFixed(1)}
                    textAnchor={anchor} dominantBaseline="middle"
                    fontSize={LABEL_FS} fontWeight="700" fontFamily="Instrument Sans, sans-serif"
                    style={{ cursor: clickable ? 'pointer' : 'default' }}
                    onClick={clickable ? () => onDrill(m) : undefined}>
                <tspan x={x} fill={isSignal ? '#c9a84c' : isNotable ? colors.tier.a : '#94a3b8'}>
                  {isSignal ? '★ ' : ''}{m.label}
                </tspan>
                {/* ⭐ THE NUMBER, BESIDE THE NAME. A vertex on a numbered ring is
                    readable; a vertex plus its reading needs no ring at all. */}
                <tspan x={x} dy={LINE_GAP} fill="#cbd5e1" fontSize={VALUE_FS} fontWeight="800">
                  {m.getFmt(currentRow)}
                </tspan>
              </text>
            )
          })}
        </svg>
      </div>
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
