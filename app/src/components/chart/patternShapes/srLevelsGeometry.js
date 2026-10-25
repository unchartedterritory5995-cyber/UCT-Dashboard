// app/src/components/chart/patternShapes/srLevelsGeometry.js — where the textbook support / resistance layer draws.
//
// The server's `levels_sr` block (auto_structures.levels_sr_for, drawing round r2, AUTO_STRUCTURES_SR_ENABLED):
//   zones:      [{role: 'Support'|'Resistance', bot, top, label, touches, first_t, last_t, broken_retested,
//                 state: 'intact'|'confirmed'}]
//   trendlines: [{side: 'support'|'resistance', t1, p1, t2, p2, slope_per_bar, label, touches, last_touch_t}]
//   asof_t:     the last COMPLETED session the layer was drawn at
// A zone is a thin band (bot..top, about half an ATR) from the first bar that reached it to just past the as-of bar;
// a trendline runs from its first anchor through the as-of bar and a little past it. Labels sit to the RIGHT of the
// drawing's end, like the judged chart. This file is the ONE authority on those positions: SupportResistanceLayer
// renders from it and patternLabelLayout lays the label TEXT out from it, so the two cannot drift. Pure — no React.

export const SR_SUPPORT_COLOR = '#1e88e5'
export const SR_RESISTANCE_COLOR = '#e65100'
/** Pixels the drawing runs past the as-of bar (the next-session slot of the judged render). */
export const SR_EXTEND_PX = 40

/** The suffix a CONFIRMED zone (broken, then a held retest from the new side: sr_levels `state: "confirmed"`) carries,
 *  exactly as the r7 blind judges saw it (lab recert/D_levels_candles/r7/build7.py `_render_src`: " | broken & retested
 *  (confirmed)", printed only when `state == 'confirmed'`). The judged band itself was drawn like an intact one, so the
 *  label is the only difference. */
export const SR_CONFIRMED_SUFFIX = ' | broken & retested (confirmed)'

/** A zone's label: the server's "Support a-b" / "Resistance a-b", plus the confirmed suffix on a confirmed zone. */
export function srZoneLabel(z) {
  const base = String(z?.label || '')
  if (!base || z?.state !== 'confirmed' || base.endsWith(SR_CONFIRMED_SUFFIX)) return base
  return base + SR_CONFIRMED_SUFFIX
}

export function srColor(roleOrSide) {
  return String(roleOrSide || '').toLowerCase() === 'support' ? SR_SUPPORT_COLOR : SR_RESISTANCE_COLOR
}

const finite = (v) => typeof v === 'number' && Number.isFinite(v)

/** True when `sr` is a well-formed block with something to draw. */
export function hasLevelsSr(sr) {
  return !!sr && ((Array.isArray(sr.zones) && sr.zones.length > 0)
    || (Array.isArray(sr.trendlines) && sr.trendlines.length > 0))
}

/**
 * Pixel geometry for every zone and trendline that can be placed, each with its label anchor. Items whose
 * coordinates cannot be resolved (off the loaded series, malformed numbers) are left out — never guessed.
 * @returns {{zones: Array<object>, lines: Array<object>}}
 */
export function srLevelsGeometry(sr, tToX, priceToY) {
  const out = { zones: [], lines: [] }
  if (!hasLevelsSr(sr)) return out
  const xAsOf = finite(sr.asof_t) ? tToX(sr.asof_t) : null
  ;(sr.zones || []).forEach((z, i) => {
    if (!z || !finite(z.bot) || !finite(z.top) || z.top < z.bot || xAsOf == null) return
    const x1raw = finite(z.first_t) ? tToX(z.first_t) : null
    const x1 = x1raw == null ? 0 : x1raw
    const yTop = priceToY(z.top)
    const yBot = priceToY(z.bot)
    if (yTop == null || yBot == null) return
    const x2 = xAsOf + SR_EXTEND_PX
    if (x2 - x1 < 1) return
    const y0 = Math.min(yTop, yBot)
    const h = Math.max(1, Math.abs(yBot - yTop))
    out.zones.push({
      key: `sr:z${i}`, role: z.role, color: srColor(z.role), x1, x2, y0, h,
      label: srZoneLabel(z), labelX: x2 + 4, labelY: y0 + h / 2 + 3,
      retested: !!z.broken_retested, confirmed: z.state === 'confirmed', touches: z.touches,
    })
  })
  ;(sr.trendlines || []).forEach((t, i) => {
    if (!t || !finite(t.t1) || !finite(t.t2) || !finite(t.p1) || !finite(t.p2)) return
    const xa = tToX(t.t1)
    const xb = tToX(t.t2)
    const ya = priceToY(t.p1)
    const yb = priceToY(t.p2)
    if (xa == null || xb == null || ya == null || yb == null || xb - xa < 1) return
    const slopePx = (yb - ya) / (xb - xa)
    const x2 = xb + SR_EXTEND_PX
    const y2 = yb + slopePx * SR_EXTEND_PX
    out.lines.push({
      key: `sr:t${i}`, side: t.side, color: srColor(t.side), x1: xa, y1: ya, x2, y2,
      label: String(t.label || ''), labelX: x2 + 4, labelY: y2 + 3, touches: t.touches,
    })
  })
  return out
}

/** Every S/R label as {key, x, y, text}: the label-collision pass reads these. */
export function srLabelItems(sr, tToX, priceToY) {
  const g = srLevelsGeometry(sr, tToX, priceToY)
  return [...g.zones, ...g.lines].filter((x) => x.label).map((x) => ({ key: x.key, x: x.labelX, y: x.labelY, text: x.label }))
}
