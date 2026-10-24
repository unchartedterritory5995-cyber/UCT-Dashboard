// app/src/components/chart/cautionLayer.js — the CAUTION layer's client half (owner decision 7, 2026-10-24).
//
// Bearish setups are an exit toolkit for a stock the member holds, never short ideas. The server keeps sending
// them and marks every one `direction: "bearish"` (auto_structures.CAUTION_SETUP_IDS, the one authority on WHICH
// setups are bearish); the client decides what is shown, behind the UCT Intelligence "Caution" sub-toggle, OFF by
// default (uctIntelligence.js).
//
// ⛔ Wording is exit / risk framing only: "watch <level> if you hold". Never "short", never a sell instruction,
// never a badge (there is no replay edge for any bearish type). cautionLayer.test.js scans every label.
// ⛔ The death cross is a MOVING-AVERAGE STATE ("50-day below 200-day"), not a chart pattern.

/** Is this setup row a caution-layer (bearish) row? The server's direction is the only signal. */
export function isCautionRow(row) {
  return row?.direction === 'bearish'
}

/** The member-facing label for one caution row, by the server's row id. */
export const CAUTION_LABELS = Object.freeze({
  'draw:double-top': 'Possible double top: watch the 2nd-peak low if you hold',
  'draw:wyckoff-upthrust': 'Possible upthrust: watch the range top if you hold',
  'draw:bear-flag': 'Possible bear flag: watch the flag low if you hold',
  'draw:descending-triangle': 'Possible descending triangle: watch the flat support if you hold',
  'draw:death-cross': '50-day below 200-day',
})

/** The label a caution row is drawn and listed with. An id this file does not name still gets exit framing. */
export function cautionLabel(row) {
  const known = CAUTION_LABELS[row?.pattern_id]
  if (known) return known
  const name = String(row?.pattern_name || 'Caution setup').trim()
  return `Caution: ${name}, review your stop if you hold`
}

/** The style key a caution row is drawn with (patternShapes/style.js PATTERN_COLORS.caution: amber). */
export const CAUTION_DIRECTION = 'caution'

/** The display copy of a caution row: amber style, exit label, no badge. The row passed in is not modified. */
export function cautionDisplayRow(row) {
  const { measured_edge: _drop, ...rest } = row || {}
  return { ...rest, direction: CAUTION_DIRECTION, pattern_name: cautionLabel(row), caution: true }
}

/** The setup-drawing rows to DRAW, after the two toggles: bullish/neutral rows only while Setups is on, caution
 *  rows only while Caution is on (and then in their display form). Bullish rows pass through unchanged. */
export function visibleSetupDraws(rows, { setups = false, caution = false } = {}) {
  if (!Array.isArray(rows)) return []
  const out = []
  for (const r of rows) {
    if (!r) continue
    if (isCautionRow(r)) {
      if (caution) out.push(cautionDisplayRow(r))
    } else if (setups) {
      out.push(r)
    }
  }
  return out
}

/** The caution rows to LIST in the panel (one per setup: the death cross draws two curves under one id). */
export function cautionListRows(rows) {
  if (!Array.isArray(rows)) return []
  const seen = new Set()
  const out = []
  for (const r of rows) {
    if (!isCautionRow(r) || seen.has(r.pattern_id)) continue
    seen.add(r.pattern_id)
    out.push({ id: r.id, pattern_id: r.pattern_id, label: cautionLabel(r) })
  }
  return out
}
