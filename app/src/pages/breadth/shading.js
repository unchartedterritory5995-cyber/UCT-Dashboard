// Breadth Monitor shading (owner round 5, 2026-11-19).
//
// A cell is shaded by how RARE its reading is across all the breadth history we
// hold, at three levels — Notable / Strong / Extreme — and colored by what it
// MEANS (bullish green, bearish red), not by up/down. The rules live in
// shadeSpec.json (shared with the calibration script); the frozen cutoffs in
// shadeCutoffs.generated.json, written by tools/breadth/calibrate_breadth_shading.py
// and re-run about once a year, so a past day never changes color.
//
// ⛔ This module mirrors `shade()` in the calibration script line for line: the
// script's value-free report counts days per level with the SAME rule the page
// draws. Change one, change the other.
import spec from './shadeSpec.json'
import cutoffs from './shadeCutoffs.generated.json'

/** How rare a reading must be (% of all history, per side). Edit in shadeSpec.json;
 *  each value must be on the cutoffs file's grid (no re-run needed within it). */
export const SHADE_PCTS = spec.pcts
export const SHADE_SPEC = spec
export const SHADE_CUTOFFS = cutoffs

const LEVELS = ['notable', 'strong', 'extreme']

function num(v) {
  if (v === null || v === undefined || typeof v === 'boolean') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// The two-of-a-pair columns (Stage 2 / Stage 4) keep their pair rule: the share of
// the pair decides, mapped onto the levels (≥70% Strong, ≥60% Notable; never Extreme,
// which is reserved for rarity).
function paired(u, d, side) {
  if (u == null || d == null || u + d === 0) return null
  const r = u / (u + d)
  if (side === 'up') return r >= 0.70 ? { tone: 'bull', level: 2 } : r >= 0.60 ? { tone: 'bull', level: 1 } : null
  return r <= 0.30 ? { tone: 'bear', level: 2 } : r <= 0.40 ? { tone: 'bear', level: 1 } : null
}

/**
 * The cell's shade, or null when it is in the unshaded middle.
 * @returns {{ tone: 'bull'|'bear', level: 1|2|3 } | null}
 */
export function shadeFor(key, row, { specIn = spec, cut = cutoffs } = {}) {
  const c = specIn.cols[key]
  if (!c || !row) return null
  if (c.kind === 'flag') return row[key] ? { tone: 'bull', level: 2 } : null
  if (c.kind === 'pair') {
    const mine = num(row[key]), other = num(row[c.with])
    return c.side === 'up' ? paired(mine, other, 'up') : paired(other, mine, 'down')
  }
  const field = c.basis || key
  const v = num(row[field])
  const t = cut.cols?.[field]
  if (v == null || !t) return null
  const idx = Object.fromEntries(LEVELS.map(lv => [lv, cut.grid.indexOf(specIn.pcts[lv])]))
  const sides = c.sides || 'both'
  const floors = c.floors || {}
  let level = 0
  let end = null
  if ((sides === 'both' || sides === 'high') && v > t.mid) {
    LEVELS.forEach((lv, i) => { if (v >= t.hi[idx[lv]]) { level = i + 1; end = 'high' } })
    if (floors.high != null && v >= floors.high) { level = Math.max(level, 2); end = 'high' }
  }
  if (!level && (sides === 'both' || sides === 'low') && v < t.mid) {
    LEVELS.forEach((lv, i) => { if (v <= t.lo[idx[lv]]) { level = i + 1; end = 'low' } })
  }
  if ((sides === 'both' || sides === 'low') && floors.low != null && v <= floors.low) {
    level = Math.max(level, 2); end = 'low'
  }
  if (!level) return null
  return { tone: end === c.bull ? 'bull' : 'bear', level }
}
