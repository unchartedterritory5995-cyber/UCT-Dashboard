/**
 * TWO TIMEFRAMES AN INDICATOR CAN HAVE, AND THEY ARE NOT THE SAME THING.
 *
 *   CALCULATION TIMEFRAME — `inst.calculationTimeframe`: which resolution's bars
 *     compute it. Absent means CHART: the indicator computes on whatever the
 *     chart shows, exactly as every indicator always has.
 *
 *   VISIBILITY — `inst.visibility`: on which CHART timeframes it is drawn.
 *     Absent means ALL. Presentation only: a hidden-here indicator still exists,
 *     keeps every setting, and still computes if something visible reads it.
 *
 * ⛔⛔ THERE IS NO SECOND TIMEFRAME LIST. Every code here is `timeframes.js`'s:
 * `NATIVE_TFS` is what a calculation can be fetched at (the server serves those
 * and only those), `TF_MENU` is what a chart can be on, `parseTf` decides what is
 * intraday and what is daily-and-above. A timeframe added there arrives here.
 *
 * ⛔ BACKWARD COMPATIBILITY IS THE ABSENT KEY. Neither field is written for the
 * default, so every blob stored before this module existed means Chart / All and
 * draws byte-identically — no migration, nothing rewritten.
 */

import { NATIVE_TFS, TF_MENU, parseTf, tfLabel, tfSortKey, isValidTf } from '../timeframes'

// ─── calculation timeframe ──────────────────────────────────────────────────

/** What a calculation may be fetched at — the server's native codes, lowest first. */
export const CALC_TIMEFRAMES = Object.freeze([...NATIVE_TFS])

/** The stored calculation timeframe, or `null` for CHART. A value outside
 *  `CALC_TIMEFRAMES` is data that bypassed the writer and reads as CHART — the
 *  fail-safe direction, because CHART is what the indicator did before. */
export function calcTimeframeOf(inst) {
  const v = inst && inst.calculationTimeframe
  return typeof v === 'string' && CALC_TIMEFRAMES.includes(v) ? v : null
}

const isIntradayUnit = (unit) => unit === 'minutes' || unit === 'hours'

/** Is this chart/calc code intraday (minutes or hours)? */
export function isIntradayCode(code) {
  const p = parseTf(code)
  return !Number.isNaN(p.count) && isIntradayUnit(p.unit)
}

/**
 * How a calculation frame relates to the chart it is drawn on.
 *
 *   'chart'      — no explicit frame, or the frame IS the chart's: compute on the
 *                  chart's own bars (the pre-existing path, untouched)
 *   'higher'     — the supported V1 case: compute on the higher frame's canonical
 *                  bars, project onto the chart (`mtfProjection.js`)
 *   'lower'      — a LOWER frame onto a higher chart (5m RSI on a Daily chart).
 *                  ⛔ GATED IN V1: many observations per chart bar, and choosing
 *                  one (the last? an average?) is a product decision nobody has
 *                  made. Not drawn, never guessed.
 *   'straddle'   — the chart is a multi-day/week/month CUSTOM code (2D, 2W, 3M…)
 *                  whose bars can straddle a higher period's boundary, so "the
 *                  period that closed before this bar began" has no single answer.
 *                  ⛔ GATED IN V1 for the same reason.
 */
export function frameRelation(calcTf, chartTf) {
  if (!calcTf || calcTf === chartTf) return 'chart'
  if (!isValidTf(chartTf)) return 'chart'
  const chart = parseTf(chartTf)
  const rc = tfSortKey(calcTf)
  const rchart = tfSortKey(chartTf)
  if (rc === rchart) return 'chart'
  if (rc < rchart) return 'lower'
  if (!isIntradayUnit(chart.unit) && chart.count > 1) return 'straddle'
  return 'higher'
}

/**
 * The frame this instance computes at ON THIS CHART: `null` (the chart's own bars)
 * or a native code strictly above the chart. Anything gated answers `null` with
 * `gated` set, so a caller can say WHY rather than draw the wrong thing.
 */
export function effectiveCalcFrame(inst, chartTf) {
  const calc = calcTimeframeOf(inst)
  const relation = frameRelation(calc, chartTf)
  if (relation === 'higher') return { frame: calc, relation, gated: null }
  if (relation === 'chart') return { frame: null, relation, gated: null }
  return { frame: null, relation, gated: relation }
}

/** "1D", "1W", "1h" — the one spelling a calculation frame wears everywhere. */
export function calcTimeframeLabel(code) {
  return code ? tfLabel(code) : 'Chart'
}

/** The member-facing words for a gated relation. */
export function gatedReason(relation, calcTf, chartTf) {
  if (relation === 'lower') {
    return `A ${tfLabel(calcTf)} calculation can't be shown on a ${tfLabel(chartTf)} chart.`
  }
  if (relation === 'straddle') {
    return `A ${tfLabel(calcTf)} calculation can't be shown on a ${tfLabel(chartTf)} chart.`
  }
  return null
}

// ─── visibility ─────────────────────────────────────────────────────────────

/**
 * ⭐⭐ PRESETS ARE SEMANTIC, NOT COPIED CHECKBOX LISTS. `intraday` is stored as the
 * WORD, so a timeframe `timeframes.js` adds tomorrow (a 2m, a 4h) is intraday the
 * day it ships without touching a single saved chart. Only CUSTOM stores codes,
 * because only custom means those exact codes.
 */
export const VISIBILITY_PRESETS = Object.freeze([
  { value: 'all', label: 'All timeframes' },
  { value: 'intraday', label: 'Intraday only' },
  { value: 'dailyUp', label: 'Daily & above' },
  { value: 'custom', label: 'Custom…' },
])

/** Every chart timeframe a Custom policy may name — `TF_MENU`, grouped as the
 *  chart's own timeframe menu groups it. */
export function visibilityChoices() {
  return TF_MENU.map((g) => ({ group: g.group, codes: [...g.codes] }))
}

const MENU_CODES = new Set(TF_MENU.flatMap((g) => g.codes))

/**
 * The stored policy normalised, or `null` for ALL. Anything malformed reads as
 * ALL — the fail-OPEN direction on purpose: visibility only ever HIDES, and an
 * unreadable policy that hid a member's indicator everywhere would look exactly
 * like data loss.
 */
export function normalizeVisibility(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  if (v.preset === 'intraday' || v.preset === 'dailyUp') return { preset: v.preset }
  if (v.preset === 'custom' && Array.isArray(v.tfs)) {
    const tfs = [...new Set(v.tfs.filter((c) => typeof c === 'string' && isValidTf(c)))]
      .sort((a, b) => tfSortKey(a) - tfSortKey(b))
    return tfs.length ? { preset: 'custom', tfs } : null
  }
  return null
}

export function visibilityOf(inst) {
  return normalizeVisibility(inst && inst.visibility)
}

/** Is this instance drawn on a chart at `chartTf`? */
export function isVisibleOnTimeframe(inst, chartTf) {
  const v = visibilityOf(inst)
  if (!v) return true
  // ⛔ AN UNKNOWN CHART TIMEFRAME GATES NOTHING — the same rule `eligibility.js`
  // applies to `def.meta.timeframes`: a surface that cannot say what it shows must
  // not have indicators vanish on it.
  if (chartTf === undefined || chartTf === null || chartTf === '' || !isValidTf(chartTf)) return true
  if (v.preset === 'intraday') return isIntradayCode(chartTf)
  if (v.preset === 'dailyUp') return !isIntradayCode(chartTf)
  return v.tfs.includes(String(chartTf))
}

/** What the collapsed control says: "All timeframes", "Daily only",
 *  "Daily + Weekly", "3 timeframes" — never a long comma list. */
export function visibilitySummary(v) {
  const n = normalizeVisibility(v)
  if (!n) return 'All timeframes'
  if (n.preset === 'intraday') return 'Intraday only'
  if (n.preset === 'dailyUp') return 'Daily & above'
  const words = n.tfs.map(timeframeWord)
  if (words.length === 1) return `${words[0]} only`
  if (words.length === 2) return `${words[0]} + ${words[1]}`
  return `${words.length} timeframes`
}

/** "Daily", "Weekly", "Monthly" for the three a member names in words; the short
 *  label (`5m`, `1h`, `2D`) for everything else. */
export function timeframeWord(code) {
  if (code === 'D') return 'Daily'
  if (code === 'W') return 'Weekly'
  if (code === 'M') return 'Monthly'
  return tfLabel(code)
}

/** Is `code` one a Custom policy can hold? (Exported for the writer.) */
export function isVisibilityCode(code) {
  return typeof code === 'string' && (MENU_CODES.has(code) || isValidTf(code))
}
