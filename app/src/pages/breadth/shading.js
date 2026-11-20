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
//
// ⭐ PER UNIVERSE (the Monitor's universe switcher). The cutoffs file is
// `{ uct: {...}, us: {...}, nasdaq: {...}, nyse: {...} }`, each universe calibrated over its
// own full history (`calibrate_breadth_shading.py --universe`). A market-wide column (VIX,
// sentiment, the index readings, UCT Exp...) is the same reading on every universe, so it
// is always shaded by UCT's cutoffs.
import spec from './shadeSpec.json'
import cutoffsByUniverse from './shadeCutoffs.generated.json'
import { MARKET_WIDE_COLS } from './monitorUniverses'

/** How rare a reading must be (% of all history, per side). Edit in shadeSpec.json;
 *  each value must be on the cutoffs file's grid (no re-run needed within it). */
export const SHADE_PCTS = spec.pcts
export const SHADE_SPEC = spec
/** UCT's cutoffs (the historical single-universe shape). */
export const SHADE_CUTOFFS = cutoffsByUniverse.uct
export const SHADE_CUTOFFS_BY_UNIVERSE = cutoffsByUniverse

/** The cutoffs a column is shaded by on a universe: UCT's for UCT and for every market-wide
 *  column; otherwise that universe's own (none calibrated → the column is left unshaded). */
export function cutoffsFor(universe, key) {
  if (!universe || universe === 'uct' || MARKET_WIDE_COLS.has(key)) return cutoffsByUniverse.uct
  return cutoffsByUniverse[universe] ?? null
}

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

// ⭐ SHARE OF THE UNIVERSE (owner 2026-11-19). A COUNT column (`per: 'universe_count'` in
// shadeSpec.json) is ranked by value / universe_count for its row, so a universe that grew or
// shrank over the years — or is simply bigger — is ranked fairly. The sheet still DISPLAYS the
// raw count; only the ranking uses the share. A signed count keeps its sign. The cutoffs for a
// share-ranked column are stored under '<key>/<per>' so a raw-count cutoff can never be read
// as a share (or the reverse).
export const cutKey = (c, field) => (c.per ? `${field}/${c.per}` : field)

export function shadeValue(c, field, row) {
  const v = num(row[field])
  if (v == null || !c.per) return v
  const d = num(row[c.per])
  return d && d > 0 ? v / d : null
}

/**
 * The cell's shade, or null when it is in the unshaded middle.
 * @returns {{ tone: 'bull'|'bear', level: 1|2|3 } | null}
 */
export function shadeFor(key, row, { specIn = spec, cut, universe = 'uct' } = {}) {
  const c = specIn.cols[key]
  if (!c || !row) return null
  cut = cut ?? cutoffsFor(universe, key)
  if (c.kind === 'flag') return row[key] ? { tone: 'bull', level: 2 } : null
  if (c.kind === 'pair') {
    const mine = num(row[key]), other = num(row[c.with])
    return c.side === 'up' ? paired(mine, other, 'up') : paired(other, mine, 'down')
  }
  const field = c.basis || key
  const v = shadeValue(c, field, row)
  const t = cut?.cols?.[cutKey(c, field)]
  if (v == null || !t) return null
  const idx = Object.fromEntries(LEVELS.map(lv => [lv, cut.grid.indexOf(specIn.pcts[lv])]))
  const sides = c.sides || 'both'
  // UCT keeps its floors in the displayed units; a share-ranked column on any other
  // universe uses the same floor as a share of the universe (`shareFloors`).
  const floors = (c.per && universe !== 'uct' ? c.shareFloors : c.floors) || {}
  // the value a floor is compared with: the raw count on UCT, the share elsewhere
  const fv = c.per && universe === 'uct' ? num(row[field]) : v
  let level = 0
  let end = null
  if (c.zero) {
    // Signed columns (Net NH-NL, A/D, McClellan; owner 2026-11-19): zero sets the
    // color, so a positive reading is never red and a negative one never green. The
    // strength is still rarity, and a negative reading must be at least as far from
    // zero as a positive one of the same level, so small readings stay unshaded
    // even when history leans one way (+1 was red because most days were higher).
    if (v > 0) {
      LEVELS.forEach((lv, i) => { if (v >= Math.max(t.hi[idx[lv]], 0)) { level = i + 1; end = 'high' } })
      if (floors.high != null && fv >= floors.high) { level = Math.max(level, 2); end = 'high' }
    } else if (v < 0) {
      LEVELS.forEach((lv, i) => {
        if (v <= Math.min(t.lo[idx[lv]], -Math.max(t.hi[idx[lv]], 0))) { level = i + 1; end = 'low' }
      })
      if (floors.low != null && fv <= floors.low) { level = Math.max(level, 2); end = 'low' }
    }
    if (!level) return null
    return { tone: end === c.bull ? 'bull' : 'bear', level }
  }
  if ((sides === 'both' || sides === 'high') && v > t.mid) {
    LEVELS.forEach((lv, i) => { if (v >= t.hi[idx[lv]]) { level = i + 1; end = 'high' } })
    if (floors.high != null && fv >= floors.high) { level = Math.max(level, 2); end = 'high' }
  }
  if (!level && (sides === 'both' || sides === 'low') && v < t.mid) {
    LEVELS.forEach((lv, i) => { if (v <= t.lo[idx[lv]]) { level = i + 1; end = 'low' } })
  }
  if ((sides === 'both' || sides === 'low') && floors.low != null && fv <= floors.low) {
    level = Math.max(level, 2); end = 'low'
  }
  if (!level) return null
  return { tone: end === c.bull ? 'bull' : 'bear', level }
}
