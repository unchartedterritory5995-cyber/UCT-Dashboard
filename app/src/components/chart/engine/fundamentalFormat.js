// app/src/components/chart/engine/fundamentalFormat.js
//
// ─── HOW A FUNDAMENTAL READS: FROM THE CATALOGUE'S `fmt`, NEVER FROM A LABEL ─
//
// ⭐ The catalogue states each metric's unit and format (`compact_usd`, `usd2`,
// `pct1`, `x2`, `num2`, `compact`); this module is the ONE place that turns a
// number into that text -- for the legend chip AND the price axis, so the two
// can never disagree.
//
// ⚠️ PERCENT METRICS ARRIVE AS PERCENT NUMBERS (23.45 = 23.45%), the same
// convention the Screener columns and formula scalars already use -- so `pct1`
// appends a sign, it never multiplies.
// ⛔ NO `sourceRef` IMPORT: `readout.js` reads this module and must not join the
// sourceRef import graph (see readout's own header). The grammar module is
// dependency-free for exactly this reason.
import { parseFundamentalSource } from './fundamentalGrammar'
import { catalogMetric } from './fundamentalSeries'

function compact(v, digits = 2) {
  const n = Math.abs(v)
  if (n >= 1e12) return `${(v / 1e12).toFixed(digits)}T`
  if (n >= 1e9) return `${(v / 1e9).toFixed(digits)}B`
  if (n >= 1e6) return `${(v / 1e6).toFixed(digits)}M`
  if (n >= 1e3) return `${(v / 1e3).toFixed(1)}K`
  return v.toFixed(0)
}

const usd = (text, v) => (v < 0 ? `-$${text.replace(/^-/, '')}` : `$${text}`)

/** @returns {string} '' for a non-finite value */
export function formatFundamentalValue(v, fmt) {
  if (!Number.isFinite(v)) return ''
  switch (fmt) {
    case 'compact_usd': return usd(compact(v), v)
    case 'usd2': return usd(Math.abs(v).toFixed(2), v)
    case 'pct1': return `${v.toFixed(1)}%`
    case 'x2': return `${v.toFixed(2)}x`
    case 'compact': return compact(v)
    case 'num2': return v.toFixed(2)
    default: return v.toFixed(2)
  }
}

/** Same answer from an instance's INPUTS (the legend lane has inputs, not the instance). */
export function fundamentalFormatOfInputs(inputs) {
  const src = inputs && typeof inputs.source === 'string' ? inputs.source : null
  const p = src ? parseFundamentalSource(src) : null
  if (!p || p.kind !== 'fundamental') return null
  const m = catalogMetric(p.metric)
  return m && typeof m.fmt === 'string' ? m.fmt : null
}

// ⭐ ONE FROZEN priceFormat PER fmt, so re-binding the same series hands the
// renderer the SAME object and never looks like an option change.
const _priceFormats = new Map()

/** LWC `priceFormat` for a fundamental axis. */
export function fundamentalPriceFormat(fmt) {
  if (!fmt) return null
  let pf = _priceFormats.get(fmt)
  if (!pf) {
    pf = Object.freeze({ type: 'custom', minMove: fmt === 'compact_usd' || fmt === 'compact' ? 1 : 0.01,
      formatter: (v) => formatFundamentalValue(v, fmt) })
    _priceFormats.set(fmt, pf)
  }
  return pf
}
