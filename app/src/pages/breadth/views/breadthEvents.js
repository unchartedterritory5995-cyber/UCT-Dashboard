/**
 * Named market events, derived — never invented.
 *
 * Every threshold here comes from one of three places and each event says
 * which: the metric's OWN `getTier` verdict (the registry owns the number), a
 * PUBLISHED formula (Zweig, 90% volume days, the collector's FTD flag), or a
 * PERCENTILE of the loaded window, which is labeled as such on screen. Adding
 * an event with a hand-picked threshold breaks that contract — the number would
 * have no author and no way to be checked.
 */
import { HM_METRICS_BY_KEY } from '../heatmapMetrics'

const ZWEIG_PERIOD = 10
const ZWEIG_LOW = 0.40
const ZWEIG_HIGH = 0.615
const ZWEIG_WINDOW = 10
// 90% up/down volume day: the share of volume in advancing names.
const VOL_SHARE = 0.9
// Both highs-lows percentile events cut at the same quantile — one constant, so
// the washout and the thrust can never end up on different definitions of
// "extreme" while sharing one sentence in the spec.
const EXTREME_PCTILE = 0.95
// The smallest N where the top (1 - EXTREME_PCTILE) fraction of a window is
// even one row wide — derived from the same constant the cut uses, so tuning
// EXTREME_PCTILE can never leave this floor (or its on-screen "Needs N
// readings" text) stale beside it.
const PCTILE_MIN_N = Math.ceil(1 / (1 - EXTREME_PCTILE))

/** 10-day EMA of advancing/(advancing+declining), oldest→newest. null until seeded. */
export function zweigEma(ratios) {
  const k = 2 / (ZWEIG_PERIOD + 1)
  const out = []
  let ema = null, seen = 0
  for (const r of ratios) {
    if (r == null) { out.push(null); continue }
    seen++
    ema = ema == null ? r : r * k + ema * (1 - k)
    out.push(seen >= ZWEIG_PERIOD ? ema : null)
  }
  return out
}

const tierOf = (key, row) => {
  const m = HM_METRICS_BY_KEY[key]
  if (!m || !m.getTier) return ''
  try { return m.getTier(row) || '' } catch { return '' }
}

// An absent metric must be distinguishable from a measured, calm one: getTier
// returns '' for both an absent field and a genuinely tier-less reading, so
// check the raw value before comparing tiers — that's what lets a tier event
// signal "unmeasurable" (null) instead of quietly reading as "did not fire".
const tierIs = (key, row, want) => (row?.[key] == null ? null : tierOf(key, row) === want)

// `up_vol_ratio` is up volume / DOWN volume (breadth_collector.py:1178), so the
// share of advancing volume is r/(1+r). Reading the ratio itself as a share is
// the defect this conversion exists to prevent.
const upVolShare = (row) => {
  const r = row?.up_vol_ratio
  if (r == null || isNaN(Number(r)) || Number(r) < 0) return null
  return Number(r) / (1 + Number(r))
}

// The two percentile events differ ONLY in which series they rank, so the note
// and the detector have one author apiece. A hand-copied second detector is how
// the highs side would quietly end up reading the lows cut.
const pctileNote = (series) =>
  `${series} in the top ${Math.round((1 - EXTREME_PCTILE) * 100)}% of the loaded window`

const pctileDetect = (ctx, i, def) => {
  const cut = ctx.pctileCut(def.pctileField, def.pctileQ)
  const v = ctx.rows[i]?.[def.pctileField]
  return (cut == null || v == null) ? null : Number(v) >= cut
}

export const EVENT_DEFS = [
  { key: 'ftd', label: 'Follow-Through Day', family: 'thrust', basis: 'collected',
    note: 'The collector\'s own is_ftd flag',
    detect: (ctx, i) => { const v = ctx.rows[i]?.is_ftd; return v == null ? null : !!v } },

  { key: 'zweig', label: 'Zweig Breadth Thrust', family: 'thrust', basis: 'formula',
    note: `10-day EMA of advances/(advances+declines) from below ${ZWEIG_LOW} to above ${ZWEIG_HIGH} within ${ZWEIG_WINDOW} sessions`,
    detect: (ctx, i) => {
      const e = ctx.zweig  // ascending index space
      const a = ctx.ascIdx(i)
      if (e[a] == null) return null
      if (e[a] <= ZWEIG_HIGH) return false
      for (let k = Math.max(0, a - ZWEIG_WINDOW); k < a; k++) {
        if (e[k] != null && e[k] < ZWEIG_LOW) return true
      }
      return false
    } },

  { key: 'vol90up', label: '90% Up Volume Day', family: 'volume', basis: 'formula',
    note: `Advancing volume ≥ ${Math.round(VOL_SHARE * 100)}% of up+down volume (ratio ≥ ${(VOL_SHARE / (1 - VOL_SHARE)).toFixed(1)})`,
    detect: (ctx, i) => { const s = upVolShare(ctx.rows[i]); return s == null ? null : s >= VOL_SHARE } },

  { key: 'vol90dn', label: '90% Down Volume Day', family: 'volume', basis: 'formula',
    note: `Declining volume ≥ ${Math.round(VOL_SHARE * 100)}% of up+down volume (ratio ≤ ${((1 - VOL_SHARE) / VOL_SHARE).toFixed(3)})`,
    detect: (ctx, i) => { const s = upVolShare(ctx.rows[i]); return s == null ? null : s <= 1 - VOL_SHARE } },

  { key: 'mcclellanHot', label: 'McClellan Overbought', family: 'oscillator', basis: 'tier',
    note: 'The McClellan metric\'s own extreme-bullish tier',
    detect: (ctx, i) => tierIs('mcclellan_osc', ctx.rows[i], 'g3') },

  { key: 'mcclellanCold', label: 'McClellan Oversold', family: 'oscillator', basis: 'tier',
    note: 'The McClellan metric\'s own extreme-bearish tier',
    detect: (ctx, i) => tierIs('mcclellan_osc', ctx.rows[i], 'r3') },

  { key: 'hvcSurge', label: 'HVC Surge', family: 'supply', basis: 'tier',
    note: 'High-volume-close count at its own top tier',
    detect: (ctx, i) => tierIs('hvc_52w', ctx.rows[i], 'g3') },

  { key: 'atrFroth', label: 'ATR Extension Froth', family: 'supply', basis: 'tier',
    note: 'Names >7× ATR extended at their own top tier',
    detect: (ctx, i) => tierIs('atr_ext_7', ctx.rows[i], 'g3') },

  // ⛔ A PERCENTILE EVENT OWNS ITS OWN FIELD. `pctileField` / `pctileQ` are read
  // by BOTH the coverage guard in `scanEvents` and the detector below, so a
  // second percentile event on a different series cannot end up guarded against
  // this one's — which is what a hardcoded `'new_52w_lows'` in the guard did.
  // There are TWO of them now, on different series, which is what makes that
  // fix testable: a fixture where one field is deep and the other is empty
  // cannot pass with a hardcoded field in the guard.
  { key: 'lowWashout', label: 'New-Low Washout', family: 'washout', basis: 'percentile',
    pctileField: 'new_52w_lows', pctileQ: EXTREME_PCTILE,
    note: pctileNote('New 52-week lows'),
    detect: pctileDetect },

  // The spec's percentile row reads "Washout / thrust in highs-lows" — this is
  // the highs half. Same shape, same quantile, its own series.
  //
  // ⛔ IT IS NOT TINTED GREEN, and that is not an oversight. The Event Ledger's
  // fired state is a direction-NEUTRAL accent (see `EventLedgerView.jsx`): the
  // lens reports that a named thing happened and does not grade it. A thrust in
  // new highs is arguably bullish and arguably late-cycle froth; that call is
  // the owner's, not this file's.
  { key: 'highThrust', label: 'New-High Thrust', family: 'thrust', basis: 'percentile',
    pctileField: 'new_52w_highs', pctileQ: EXTREME_PCTILE,
    note: pctileNote('New 52-week highs'),
    detect: pctileDetect },
]

/** The families the ledger actually defines — the ONE authority the Customize
 *  dropdown builds its choices from (`viewMetricConfig.js`). A family added or
 *  removed here moves the filter with it; a hand-typed copy there offered a
 *  filter that rendered an empty grid with no explanation. */
export const EVENT_FAMILIES = [...new Set(EVENT_DEFS.map(d => d.family))]

/**
 * Scan the window for every event. Returns one row per event with whether it
 * fired today, when it last fired, or why it could not be evaluated.
 * `rows` is newest-first (the lens bundle's order).
 */
export function scanEvents(rows = [], { families = null } = {}) {
  const n = rows.length
  const asc = [...rows].reverse()
  const ascIdx = (i) => n - 1 - i

  const ratios = asc.map(r => {
    const a = r?.advancing, d = r?.declining
    if (a == null || d == null || (Number(a) + Number(d)) === 0) return null
    return Number(a) / (Number(a) + Number(d))
  })
  const zweig = zweigEma(ratios)
  const adCoverage = ratios.filter(v => v != null).length

  const cuts = {}
  const pctileCut = (key, q) => {
    if (!(key in cuts)) {
      const vals = rows.map(r => r?.[key]).filter(v => v != null && !isNaN(Number(v))).map(Number)
      cuts[key] = vals.length < PCTILE_MIN_N ? null : [...vals].sort((a, b) => a - b)[Math.floor(vals.length * q)]
    }
    return cuts[key]
  }

  const ctx = { rows, asc, ascIdx, zweig, pctileCut }

  return EVENT_DEFS
    .filter(d => !families || families.includes(d.family))
    .map(d => {
      let unavailable = null
      if (d.key === 'zweig' && adCoverage < ZWEIG_PERIOD + 1) {
        unavailable = `Advance/decline counts cover ${adCoverage} of ${n} sessions — needs ${ZWEIG_PERIOD + 1}`
      }
      if (d.basis === 'percentile' && pctileCut(d.pctileField, d.pctileQ) == null) {
        unavailable = `Needs ${PCTILE_MIN_N} readings to rank a percentile`
      }

      let firedToday = false, lastIdx = null
      if (!unavailable) {
        // `detect` returns true/false when it could evaluate a session and
        // null when it couldn't (field absent that day). If EVERY session in
        // the window came back null, the event was never measurable here —
        // that is a different fact from "measured every day, never fired",
        // and the two specific checks above (Zweig's coverage count, the
        // percentile floor) already cover their own events more precisely,
        // so this generic rule only fires when neither of those applied.
        let everMeasurable = false
        for (let i = 0; i < n; i++) {
          const hit = d.detect(ctx, i, d)
          if (hit != null) everMeasurable = true
          if (hit === true) { lastIdx = i; break }
        }
        firedToday = lastIdx === 0
        if (!everMeasurable) {
          unavailable = `${d.label} was not reported in any of the ${n} sessions loaded`
        }
      }

      return {
        key: d.key, label: d.label, family: d.family, basis: d.basis, note: d.note,
        firedToday, lastIdx,
        lastDate: lastIdx == null ? null : rows[lastIdx]?.date ?? null,
        sessionsAgo: lastIdx,
        unavailable,
        windowLength: n,
      }
    })
}
