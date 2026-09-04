// app/src/components/chart/patternShapes/CandleMark.jsx — single/multi-candle pattern markers.
//
// Covers all candlestick patterns (doji, hammer, engulfing, etc.), swing_pivots, stage_analysis,
// accumulation_distribution, episodic_pivot, power_earnings_gap, 52w_proximity.
//
// Rendering convention:
//   - bullish → badge ABOVE the trigger candle (y offset -20)
//   - bearish → badge BELOW the trigger candle (y offset +20)
//   - neutral → badge to the RIGHT of the trigger candle (gold)
//   - swing_pivots → small dots at every anchor (multiple pivots on the chart)
//
// For multi-anchor candlestick patterns (engulfing, harami, star: 2-3 anchors), the LAST anchor
// is the trigger candle — that's where the badge goes. We still optionally render small markers
// at the earlier anchors so reviewers can see the full setup geometry.
//
// Package 8D: when `geometry.semantic_subtype === "gap_event"` (currently
// only power_earnings_gap) AND anchor_roles name a "gap_open"/"gap_close"
// pair, ALSO draw a CandleEmphasis white outline around that real gap
// candle — additive, on top of the existing badge/dots, which are
// UNCHANGED. Every family without this semantic_subtype renders exactly as
// before (this is the "optional-by-family, absence is not brokenness"
// principle applied to rendering, not just data).
import {
  getColor,
  getOpacity,
  getGlowFilter,
  formatLabel,
} from './style'
import CandleEmphasis from './CandleEmphasis'

const PATTERN_LETTERS = {
  doji: 'D',
  hammer: 'H',
  hanging_man: 'H',
  shooting_star: 'S',
  bullish_engulfing: 'E',
  bearish_engulfing: 'E',
  piercing: 'P',
  dark_cloud_cover: 'D',
  bullish_harami: 'H',
  bearish_harami: 'H',
  morning_star: '★',
  evening_star: '★',
  three_white_soldiers: '3↑',
  three_black_crows: '3↓',
  episodic_pivot: 'EP',
  power_earnings_gap: 'PEG',
  swing_pivots: '•',
  stage_analysis: '2',
  accumulation_distribution: 'A/D',
  '52w_proximity': '52w',
  outside_bar: 'OB',
  inside_bar_breakout: 'IB',
}

function badgeLetter(detection) {
  const explicit = PATTERN_LETTERS[detection?.pattern_id]
  if (explicit) return explicit
  // Fallback by direction
  if (detection?.direction === 'bullish') return '↑'
  if (detection?.direction === 'bearish') return '↓'
  return '•'
}

export default function CandleMark({ detection, tToX, priceToY, barHalfWidthPx, onClick }) {
  const anchors = detection?.geometry?.anchors || []
  if (!anchors.length) return null

  const color = getColor(detection)
  const opacity = getOpacity(detection)
  const glow = getGlowFilter(detection)
  const direction = detection?.direction

  // Package 8D: the gap-candle emphasis outline, computed from the SAME
  // anchors/roles as everything else here — never independently rediscovered.
  const roles = detection?.geometry?.anchor_roles
  let gapCandleEmphasis = null
  if (detection?.geometry?.semantic_subtype === 'gap_event' && Array.isArray(roles)) {
    const openIdx = roles.indexOf('gap_open')
    const closeIdx = roles.indexOf('gap_close')
    if (openIdx !== -1 && closeIdx !== -1 && anchors[openIdx] && anchors[closeIdx]) {
      const xCenter = tToX(anchors[openIdx].t)
      const yOpen = priceToY(anchors[openIdx].price)
      const yClose = priceToY(anchors[closeIdx].price)
      if (xCenter != null && yOpen != null && yClose != null) {
        gapCandleEmphasis = (
          <CandleEmphasis
            xCenter={xCenter}
            yOpen={yOpen}
            yClose={yClose}
            halfWidthPx={barHalfWidthPx}
            opacity={opacity}
          />
        )
      }
    }
  }

  // swing_pivots: render a small dot at every anchor — multi-pivot marker mode.
  if (detection?.pattern_id === 'swing_pivots') {
    return (
      <g
        onClick={() => onClick?.(detection)}
        style={{ cursor: 'pointer', pointerEvents: 'auto' }}
      >
        {anchors.map((a, i) => {
          const x = tToX(a.t)
          const y = priceToY(a.price)
          if (x == null || y == null) return null
          return <circle key={i} cx={x} cy={y} r={3} fill={color} opacity={opacity} />
        })}
      </g>
    )
  }

  // Trigger candle = last anchor.
  const triggerAnchor = anchors[anchors.length - 1]
  const tx = tToX(triggerAnchor.t)
  const ty = priceToY(triggerAnchor.price)
  if (tx == null || ty == null) return null

  // Badge offset based on direction.
  let bx = tx
  let by = ty
  if (direction === 'bullish') {
    by = ty - 20
  } else if (direction === 'bearish') {
    by = ty + 20
  } else {
    bx = tx + 16
  }

  const letter = badgeLetter(detection)

  return (
    <g
      onClick={() => onClick?.(detection)}
      style={{ cursor: 'pointer', pointerEvents: 'auto' }}
    >
      {/* Package 8D: white outline on the real gap candle, when applicable — see above. */}
      {gapCandleEmphasis}
      {/* Small dots at any non-trigger anchors so reviewers see the setup shape (engulfing, star, etc.) */}
      {anchors.slice(0, -1).map((a, i) => {
        const x = tToX(a.t)
        const y = priceToY(a.price)
        if (x == null || y == null) return null
        return <circle key={i} cx={x} cy={y} r={2} fill={color} opacity={opacity * 0.6} />
      })}
      {/* Badge circle */}
      <circle
        cx={bx}
        cy={by}
        r={9}
        fill={color}
        opacity={opacity}
        filter={glow}
        stroke="rgba(0,0,0,0.4)"
        strokeWidth={0.5}
      />
      {/* Letter inside badge */}
      <text
        x={bx}
        y={by + 3}
        fontSize="10"
        fontWeight="600"
        textAnchor="middle"
        fill="#0a0a0a"
        style={{ pointerEvents: 'none' }}
      >
        {letter}
      </text>
      {/* Pattern name beside the badge (faded — easy to ignore but reads on hover/inspection) */}
      <text
        x={bx + 14}
        y={by + 4}
        fontSize="10"
        fill={color}
        opacity={opacity * 0.8}
      >
        {formatLabel(detection)}
      </text>
    </g>
  )
}
