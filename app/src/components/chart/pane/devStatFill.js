// DEV-ONLY header stat placeholders (owner 11-17): on localhost the light-mode backend leaves many info-row stats
// empty ('—'), so the owner cannot judge how a stat LOOKS (its size, box, colors). This fills only the MISSING
// values with plausible, stable fakes. Real values always win.
//
// ⛔ NEVER IN PRODUCTION: the only caller wraps it in `if (import.meta.env.DEV)`, so Vite drops this module from
// the build (checked by grepping app/dist for DEV_STAT_FILL_MARK). Off switch on localhost: `?realstats`.
// Stable per symbol + stat key (a seeded hash, never Math.random), so a live tick never makes it flicker.
import { SIGN_POS, SIGN_NEG } from '../headerFields'
import { formatCompact } from '../../../lib/presentation/presentationPrimitives'

export const DEV_STAT_FILL_MARK = 'uct-dev-stat-fill'

/** FNV-1a → a 0..1 number, stable for one string. */
function unit(s) {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  return ((h >>> 0) % 100000) / 100000
}
const pick = (u, list) => list[Math.floor(u * list.length) % list.length]
// The placeholder ladder: T at two decimals, B / M / K at one, and K covers everything below it (TERM-066: the
// suffix is decided by the shared formatter; `promote: false` keeps each tier the magnitude chose).
const PLACEHOLDER_TIERS = Object.freeze([
  Object.freeze({ at: 1e12, suffix: 'T', decimals: 2 }),
  Object.freeze({ at: 1e9, suffix: 'B', decimals: 1 }),
  Object.freeze({ at: 1e6, suffix: 'M', decimals: 1 }),
  Object.freeze({ at: 1e3, suffix: 'K', decimals: 1 }),
])
export const compact = (n) => formatCompact(n, { tiers: PLACEHOLDER_TIERS, fixedUnit: true, promote: false })

const TEXT = {
  name: ['Example Corp', 'Sample Holdings', 'Demo Industries'],
  sector: ['Technology', 'Healthcare', 'Industrials', 'Energy', 'Financials'],
  industry: ['Semiconductors', 'Software', 'Biotech', 'Aerospace', 'Banks'],
  theme: ['AI Infrastructure', 'Nuclear', 'Space', 'Robotics', 'Cybersecurity'],
  country: ['USA', 'Canada', 'Israel', 'Netherlands'],
  exch: ['NASDAQ', 'NYSE', 'AMEX'],
  consensus: ['Buy', 'Strong Buy', 'Hold'],
  accdis: ['A', 'B+', 'B', 'C', 'D'],
  mastack: ['Stacked', 'Mixed', 'Inverted'],
  rsline: ['Rising', 'Flat', 'Falling'],
}
const COMPACT = { mcap: [2e9, 900e9], vol: [2e6, 90e6], dolvol: [40e6, 4e9], avgvol: [2e6, 60e6], avgdv: [40e6, 3e9], float: [50e6, 3e9], shares: [60e6, 4e9] }
const DATE = new Set(['earn', 'ipoDate'])
const DOLLAR = new Set(['price', 'dchg'])
const PERCENT_UNSIGNED = new Set(['dcr', 'adr', 'divy', 'shortf', 'inst', 'insider'])
const RATIO = { pe: [8, 60], pefwd: [8, 45], ps: [1, 25], beta: [0.5, 2.2], rvol: [0.4, 3.5], udvol: [0.6, 2.4], shortr: [0.5, 7], rsi: [25, 78], rsrank: [10, 99], dte: [3, 80] }

/** A plausible fake for one stat: { value, sign? }. `signed` = the stat is tinted by sign. */
export function devStatValue(sym, key, { signed = false, custom = false } = {}) {
  const u = unit(`${sym}|${key}`)
  const span = (lo, hi) => lo + u * (hi - lo)
  if (TEXT[key]) return { value: pick(u, TEXT[key]) }
  if (COMPACT[key]) return { value: compact(span(...COMPACT[key])) }
  if (DATE.has(key)) {
    const d = new Date(Date.UTC(2027, 0, 1) + Math.floor(u * 300) * 86400000)
    return { value: `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}` }
  }
  if (key === 'dayrange') { const lo = span(20, 400); return { value: `${lo.toFixed(2)} – ${(lo * 1.03).toFixed(2)}` } }
  if (DOLLAR.has(key)) {
    if (key === 'dchg') { const v = span(-6, 8); return { value: `${v < 0 ? '-' : '+'}$${Math.abs(v).toFixed(2)}`, sign: v < 0 ? 'neg' : 'pos' } }
    return { value: `$${span(12, 480).toFixed(2)}` }
  }
  if (PERCENT_UNSIGNED.has(key)) return { value: `${span(0.5, 18).toFixed(1)}%` }
  if (RATIO[key]) { const [lo, hi] = RATIO[key]; return { value: span(lo, hi).toFixed(hi > 20 ? 0 : 2) } }
  if (custom) {
    if (signed) { const v = span(-4.2, 6.8); return { value: v.toFixed(2), sign: v < 0 ? 'neg' : 'pos' } }
    return { value: span(10, 90).toFixed(2) }
  }
  // every other catalog stat is a % (changes, distances, growth); signed ones show the up / down colors
  const v = signed ? span(-4.2, 6.8) : span(0, 40)
  return { value: `${signed && v >= 0 ? '+' : ''}${v.toFixed(2)}%`, sign: signed ? (v < 0 ? 'neg' : 'pos') : undefined }
}

/** `items` with every missing value filled (`devFill: true` marks them). The sign tint follows the fake sign unless
 *  the member set an override color for it. Untouched when `?realstats` is in the URL. */
export function withDevStatFill(items, sym, { isSigned, colors = {} } = {}) {
  try { if (new URLSearchParams(window.location.search).has('realstats')) return items } catch { /* no window */ }
  let changed = false
  const out = items.map((it) => {
    if (it.value != null && it.value !== '' && it.value !== '—' && it.value !== 'n/a') return it
    const signed = typeof isSigned === 'function' ? isSigned(it) : !!it.sign
    const f = devStatValue(sym || '', it.key, { signed, custom: !!it.custom })
    changed = true
    const next = { ...it, value: f.value, devFill: DEV_STAT_FILL_MARK }
    if (f.sign && signed) {
      next.sign = f.sign
      const ck = it.colorKey || it.key
      next.color = colors[`${ck}:${f.sign}`] || (f.sign === 'neg' ? SIGN_NEG : SIGN_POS)
    }
    return next
  })
  return changed ? out : items
}
