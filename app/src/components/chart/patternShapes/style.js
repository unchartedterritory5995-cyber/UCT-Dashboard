// app/src/components/chart/patternShapes/style.js — shared visual conventions for pattern shape renderers.
//
// Each helper takes a Detection object and returns a primitive style value (color, opacity, etc.). All
// shape renderers (TrendlinePair, Neckline, CupCurve, Rectangle, CandleMark, HorizontalLine) consume
// these so the visual language stays consistent across geometry types.
//
// The "recent" glow filter (#patternGlow) is defined in PatternOverlay's <defs> and applied here via
// `getGlowFilter(detection)` when the detection landed within the last 5 minutes — gives a subtle
// pulse so users notice fresh signals.

export const PATTERN_COLORS = {
  bullish: '#10b981', // emerald-500
  bearish: '#ef4444', // red-500
  neutral: '#c9a84c', // UCT gold
  // The CAUTION layer (owner decision 7): bearish setups drawn as exit risk on a stock the member holds, amber,
  // never the red of a "short" signal. Set by cautionLayer.cautionDisplayRow, never by a server direction.
  caution: '#f59e0b', // amber-500
}

export function getColor(detection) {
  return PATTERN_COLORS[detection?.direction] || PATTERN_COLORS.neutral
}

// Bars after a structure's own last bar (geometry.extras.pattern_age_bars) past
// which it is drawn faded: still shown, but visibly not the live structure.
export const STALE_AFTER_BARS = 20

export function isExperimental(detection) {
  return detection?.display_tier === 'experimental'
}

// The bull_flag "flagging" tier (PatternOverlay.flaggingView): the team's looser "flag", drawn
// light -- dotted and faint -- and labelled with the team's own word.
export const FLAGGING_TIER = 'flagging'
export const FLAGGING_DASH = '2,4'

export function isFlagging(detection) {
  return detection?.flag_tier === FLAGGING_TIER
}

// The setup-drawing layer (`setup_draws`) is drawn the way its blind judges saw it (lab setup_triage/overlay_v3.py,
// the canvas of release_g4 / setups_r2 / setups_r3 / rectangle_v2): solid lines at full opacity, whatever the row's
// `status` / `confidence`. The server stamps every setup row `status: "forming"`, `confidence: null`; on a pattern
// detection those mean provisional (dashed, half opacity), on a judged setup drawing they mean nothing. Set by
// cautionLayer.visibleSetupDraws on every row it returns, never by the server, so a pattern or base "forming" state
// keeps its dashed style. A horizontal line keeps its judged touch-count dash (HorizontalLine.jsx, overlay_v3 too).
export const SETUP_DRAW_STYLE = 'judged'

export function isJudgedSetupDraw(detection) {
  return detection?.setup_draw_style === SETUP_DRAW_STYLE
}

export function isStale(detection) {
  const age = detection?.geometry?.extras?.pattern_age_bars
  return typeof age === 'number' && age > STALE_AFTER_BARS
}

export function getOpacity(detection) {
  if (isJudgedSetupDraw(detection)) return 1.0
  const conf = detection?.confidence ?? 50
  let op = Math.max(0.4, Math.min(1.0, conf / 100))
  // Display-only distinctions (lab/geometry_eval tiers + pattern age): an
  // experimental detector reads quieter than a trusted one, a stale structure
  // quieter still. Never below a legible floor.
  if (isExperimental(detection)) op *= 0.75
  if (isStale(detection)) op *= 0.6
  if (isFlagging(detection)) op *= 0.55
  return Math.max(0.25, op)
}

export function getStrokeWidth(detection) {
  return detection?.status === 'triggered' ? 3 : 2
}

export function getStrokeDasharray(detection) {
  if (isJudgedSetupDraw(detection)) return 'none'
  if (isFlagging(detection)) return FLAGGING_DASH
  if (detection?.status === 'forming') return '5,3'
  // Experimental tier: a dotted stroke, so it never reads as a trusted line.
  return isExperimental(detection) ? '2,3' : 'none'
}

export function isRecent(detection) {
  // detected_at within last 5 minutes = "recent" → glow
  if (!detection?.detected_at) return false
  const now = Math.floor(Date.now() / 1000)
  return (now - detection.detected_at) < 300
}

export function getGlowFilter(detection) {
  return isRecent(detection) ? 'url(#patternGlow)' : 'none'
}

export function formatLabel(detection) {
  if (isFlagging(detection)) return FLAGGING_TIER
  const name = detection?.pattern_name || detection?.pattern_id || 'pattern'
  const conf = detection?.confidence
  const base = conf == null ? name : `${name} (${Math.round(conf)})`
  const tags = []
  if (isExperimental(detection)) tags.push('exp')
  if (isStale(detection)) tags.push(`${detection.geometry.extras.pattern_age_bars} bars ago`)
  return tags.length ? `${base} · ${tags.join(' · ')}` : base
}
