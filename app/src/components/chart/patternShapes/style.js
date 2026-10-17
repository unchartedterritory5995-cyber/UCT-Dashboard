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

export function isStale(detection) {
  const age = detection?.geometry?.extras?.pattern_age_bars
  return typeof age === 'number' && age > STALE_AFTER_BARS
}

export function getOpacity(detection) {
  const conf = detection?.confidence ?? 50
  let op = Math.max(0.4, Math.min(1.0, conf / 100))
  // Display-only distinctions (lab/geometry_eval tiers + pattern age): an
  // experimental detector reads quieter than a trusted one, a stale structure
  // quieter still. Never below a legible floor.
  if (isExperimental(detection)) op *= 0.75
  if (isStale(detection)) op *= 0.6
  return Math.max(0.25, op)
}

export function getStrokeWidth(detection) {
  return detection?.status === 'triggered' ? 3 : 2
}

export function getStrokeDasharray(detection) {
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
  const name = detection?.pattern_name || detection?.pattern_id || 'pattern'
  const conf = detection?.confidence
  const base = conf == null ? name : `${name} (${Math.round(conf)})`
  const tags = []
  if (isExperimental(detection)) tags.push('exp')
  if (isStale(detection)) tags.push(`${detection.geometry.extras.pattern_age_bars} bars ago`)
  return tags.length ? `${base} · ${tags.join(' · ')}` : base
}
