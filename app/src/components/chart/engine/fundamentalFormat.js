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
import { parseEconomicSource } from './econMark'
import { economicMeta } from './economicSeries'
import { formatCompact } from '../../../lib/presentation/presentationPrimitives'
import { marketIndicatorRecord } from '../../../hooks/useMarketIndicators'

/**
 * A MARKET-INDICATOR series' registry unit → the format it reads in, where the plain
 * two-decimal default would misstate it. ⭐ ONE ROW TODAY: a COT net position is a
 * whole number of CONTRACTS (`62,340`, never `62340.00`). Every other unit is absent
 * and keeps the default, exactly as before.
 */
const MARKET_INDICATOR_UNIT_FORMAT = Object.freeze({ contracts: 'num0' })

function marketIndicatorFormatOf(src) {
  if (typeof src !== 'string' || !src.startsWith('sym:')) return null
  // `sym:<SYMBOL>:<field>` — the symbol may itself contain ':' (`COT:NQ:COMM`).
  const cut = src.lastIndexOf(':')
  const sym = cut > 4 ? src.slice(4, cut) : ''
  const row = sym ? marketIndicatorRecord(sym) : null
  const fmt = row && Object.prototype.hasOwnProperty.call(MARKET_INDICATOR_UNIT_FORMAT, row.unit)
    ? MARKET_INDICATOR_UNIT_FORMAT[row.unit] : null
  return fmt || null
}

// Barrels always read in millions (a stock of crude is never "0.4B" or "426,398K").
const MBBL_TIERS = Object.freeze([Object.freeze({ at: 1e6, suffix: 'M', decimals: 1 })])

// TERM-066: T/B/M at the caller's `digits`, K always one decimal — the ladder
// this grammar already had, passed to the one formatter.
const compactTiers = (digits) => [
  { at: 1e12, suffix: 'T', decimals: digits },
  { at: 1e9, suffix: 'B', decimals: digits },
  { at: 1e6, suffix: 'M', decimals: digits },
  { at: 1e3, suffix: 'K', decimals: 1 },
]

function compact(v, digits = 2) {
  const n = Math.abs(v)
  if (n >= 1e3) return formatCompact(v, { tiers: compactTiers(digits) })
  return v.toFixed(0)
}

const usd = (text, v) => (v < 0 ? `-$${text.replace(/^-/, '')}` : `$${text}`)

// ─── ECONOMIC FORMATS (the econ registry's `units.fmt` vocabulary) ──────────
//
// ⭐ ONE REGISTRY, TWO FAMILIES. The econ vocabulary (docs/economic-data/
// PHASE1-DESIGN.md: num0 num1 num2 num3 pct1 pct2 pp2 bps0 usd_compact k_persons
// mbbl bcf usd3) joins the fundamentals one here, so the axis and the legend of
// an economic series read through the SAME function, exactly as a fundamental's
// do. `pct1` and `num2` are shared names with identical output for every value a
// fundamental produces (a fundamental never reaches 1,000 on `num2`).
//
// ⭐⭐ SCALE TRAVELS IN THE FORMAT KEY. An econ value is stored in its source's raw
// unit (Retail Sales in MILLIONS of USD) and `units.scale` converts it to base
// units, so the key is `fmt` or `fmt@scale` (`usd_compact@1000000`): the value
// 773900 then reads `$773.90B`. A plain key (every fundamental) is scale 1 and
// byte-identical to before. The key is a STRING so a chip still carries one
// primitive and the frozen priceFormat memo below still keys on it.
const _grouped = new Map()
function grouped(v, digits) {
  let f = _grouped.get(digits)
  if (!f) {
    f = new Intl.NumberFormat('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
    _grouped.set(digits, f)
  }
  return f.format(v)
}

/** `fmt@scale` -> [fmt, scale]; a bare fmt is scale 1. */
export function splitFormatKey(key) {
  if (typeof key !== 'string' || !key) return [null, 1]
  const at = key.indexOf('@')
  if (at < 0) return [key, 1]
  const scale = Number(key.slice(at + 1))
  return [key.slice(0, at), Number.isFinite(scale) && scale > 0 ? scale : 1]
}

/** `{fmt, scale}` (an econ `units` block) -> the format key; null without a fmt. */
export function formatKeyOf(units) {
  const fmt = units && typeof units.fmt === 'string' && units.fmt ? units.fmt : null
  if (!fmt) return null
  const scale = Number(units.scale)
  return Number.isFinite(scale) && scale > 0 && scale !== 1 ? `${fmt}@${scale}` : fmt
}

const signed = (text, v) => (v < 0 ? `-${text.replace(/^-/, '')}` : text)

/** @returns {string} '' for a non-finite value */
export function formatFundamentalValue(v, key) {
  if (!Number.isFinite(v)) return ''
  const [fmt, scale] = splitFormatKey(key)
  const x = v * scale
  switch (fmt) {
    case 'compact_usd': return usd(compact(x), x)
    case 'usd2': return usd(Math.abs(x).toFixed(2), x)
    case 'pct1': return `${x.toFixed(1)}%`
    case 'x2': return `${x.toFixed(2)}x`
    case 'compact': return compact(x)
    case 'num2': return grouped(x, 2)
    // ── econ ──
    case 'num0': return grouped(x, 0)
    case 'num1': return grouped(x, 1)
    case 'num3': return grouped(x, 3)
    case 'pct2': return `${x.toFixed(2)}%`
    case 'pp2': return `${x.toFixed(2)} pp`
    case 'bps0': return `${grouped(x, 0)} bp`
    case 'usd_compact': return usd(compact(x), x)
    case 'usd3': return usd(Math.abs(x).toFixed(3), x)
    // a count of people: 231,000 claims -> 231.0K, 159.5M payrolls -> 159.50M
    case 'k_persons': return signed(compact(x, 2), x)
    // barrels: 426,398 thousand bbl (scale 1000) -> 426.4M bbl. The M suffix is
    // decided by the shared primitive (TERM-066 census: no hand-rolled K/M/B/T).
    case 'mbbl': return `${formatCompact(x, { tiers: MBBL_TIERS })} bbl`
    // natural gas storage, already in Bcf
    case 'bcf': return `${grouped(x, 0)} Bcf`
    default: return x.toFixed(2)
  }
}

/** The unit-neutral name for the same function (econ and fundamentals alike). */
export const formatSeriesValue = formatFundamentalValue

/** Same answer from an instance's INPUTS (the legend lane has inputs, not the instance). */
export function fundamentalFormatOfInputs(inputs) {
  const src = inputs && typeof inputs.source === 'string' ? inputs.source : null
  // ⭐ An ECONOMIC source reads in its registry unit, scale included.
  const e = src ? parseEconomicSource(src) : null
  if (e) return formatKeyOf(economicMeta(e.symbol) && economicMeta(e.symbol).units)
  const mi = marketIndicatorFormatOf(src)
  if (mi) return mi
  const p = src ? parseFundamentalSource(src) : null
  if (!p || p.kind !== 'fundamental') return null
  const m = catalogMetric(p.metric)
  return m && typeof m.fmt === 'string' ? m.fmt : null
}

/**
 * The unit an INSTANCE reads in: its own `fund:` source's, or -- for a
 * definition that declares `domainBehavior: 'inherit'` (the Moving Average) --
 * the unit of the instance it averages, recursively. An average of a percent is
 * a percent; a definition that makes no such claim inherits nothing, which is
 * the same rule `sourceRef.resolveScaleDomain` applies to ranges.
 *
 * ⚠️ The instance grammar (`@<instanceId>::<plotKey>`, `pool.bindingKey`) is
 * read here rather than through `sourceRef.parseSource` -- see the no-sourceRef
 * note above.
 */
export function fundamentalFormatOfInstance(inst, defOf, instances, depth = 0) {
  if (!inst || depth > 8) return null
  const own = fundamentalFormatOfInputs(inst.inputs)
  if (own) return own
  const def = typeof defOf === 'function' ? defOf(inst.defId) : null
  if (!def || def.domainBehavior !== 'inherit') return null
  const src = inst.inputs && typeof inst.inputs.source === 'string' ? inst.inputs.source : ''
  if (src[0] !== '@') return null
  const cut = src.lastIndexOf('::')
  const id = cut > 1 ? src.slice(1, cut) : null
  const next = id && Array.isArray(instances) ? instances.find((i) => i && i.instanceId === id) : null
  return next ? fundamentalFormatOfInstance(next, defOf, instances, depth + 1) : null
}

// ⭐ ONE FROZEN priceFormat PER fmt, so re-binding the same series hands the
// renderer the SAME object and never looks like an option change.
const _priceFormats = new Map()

/** The axis step in RAW units. The fundamentals answers are unchanged; an econ
 *  key's step follows its printed precision divided by its scale, so a series
 *  stored in thousands does not round its axis to whole thousands. */
function minMoveOf(key) {
  const [fmt, scale] = splitFormatKey(key)
  if (fmt === 'compact_usd' || fmt === 'compact') return 1
  const step = { num0: 1, num1: 0.1, num3: 0.001, bps0: 1, usd3: 0.001, bcf: 1 }[fmt]
  if (step === undefined) {
    if (fmt === 'usd_compact' || fmt === 'k_persons' || fmt === 'mbbl') return 0.001
    return 0.01
  }
  return step / scale
}

/** LWC `priceFormat` for a fundamental (or economic) axis. */
export function fundamentalPriceFormat(fmt) {
  if (!fmt) return null
  let pf = _priceFormats.get(fmt)
  if (!pf) {
    pf = Object.freeze({ type: 'custom', minMove: minMoveOf(fmt),
      formatter: (v) => formatFundamentalValue(v, fmt) })
    _priceFormats.set(fmt, pf)
  }
  return pf
}
