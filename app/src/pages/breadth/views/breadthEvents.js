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
const WASHOUT_PCTILE = 0.95

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

// `up_vol_ratio` is up volume / DOWN volume (breadth_collector.py:1178), so the
// share of advancing volume is r/(1+r). Reading the ratio itself as a share is
// the defect this conversion exists to prevent.
const upVolShare = (row) => {
  const r = row?.up_vol_ratio
  if (r == null || isNaN(Number(r)) || Number(r) < 0) return null
  return Number(r) / (1 + Number(r))
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
    note: 'Advancing volume ≥ 90% of up+down volume (ratio ≥ 9.0)',
    detect: (ctx, i) => { const s = upVolShare(ctx.rows[i]); return s == null ? null : s >= VOL_SHARE } },

  { key: 'vol90dn', label: '90% Down Volume Day', family: 'volume', basis: 'formula',
    note: 'Declining volume ≥ 90% of up+down volume (ratio ≤ 0.111)',
    detect: (ctx, i) => { const s = upVolShare(ctx.rows[i]); return s == null ? null : s <= 1 - VOL_SHARE } },

  { key: 'mcclellanHot', label: 'McClellan Overbought', family: 'oscillator', basis: 'tier',
    note: 'The McClellan metric\'s own extreme-bullish tier',
    detect: (ctx, i) => tierOf('mcclellan_osc', ctx.rows[i]) === 'g3' },

  { key: 'mcclellanCold', label: 'McClellan Oversold', family: 'oscillator', basis: 'tier',
    note: 'The McClellan metric\'s own extreme-bearish tier',
    detect: (ctx, i) => tierOf('mcclellan_osc', ctx.rows[i]) === 'r3' },

  { key: 'hvcSurge', label: 'HVC Surge', family: 'supply', basis: 'tier',
    note: 'High-volume-close count at its own top tier',
    detect: (ctx, i) => tierOf('hvc_52w', ctx.rows[i]) === 'g3' },

  { key: 'atrFroth', label: 'ATR Extension Froth', family: 'supply', basis: 'tier',
    note: 'Names >7× ATR extended at their own top tier',
    detect: (ctx, i) => tierOf('atr_ext_7', ctx.rows[i]) === 'g3' },

  { key: 'lowWashout', label: 'New-Low Washout', family: 'washout', basis: 'percentile',
    note: `New 52-week lows in the top 5% of the loaded window`,
    detect: (ctx, i) => {
      const cut = ctx.pctileCut('new_52w_lows', WASHOUT_PCTILE)
      const v = ctx.rows[i]?.new_52w_lows
      return (cut == null || v == null) ? null : Number(v) >= cut
    } },
]

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
      cuts[key] = vals.length < 20 ? null : [...vals].sort((a, b) => a - b)[Math.floor(vals.length * q)]
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
      if (d.basis === 'percentile' && pctileCut('new_52w_lows', WASHOUT_PCTILE) == null) {
        unavailable = 'Needs 20 readings to rank a percentile'
      }

      let firedToday = false, lastIdx = null
      if (!unavailable) {
        for (let i = 0; i < n; i++) {
          const hit = d.detect(ctx, i)
          if (hit === true) { lastIdx = i; break }
        }
        firedToday = lastIdx === 0
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
