// The chart header's info-row STAT CATALOG (owner 11-16, Release 1: "the header stats, stat rename/picker").
//
// ONE list, shared with the Watchlist column library (UCT Signature §3 "Picker": "the chart header's stat picker and
// the watchlist column menu offer the same list"). Three sources, each with the value path the Watchlist already uses:
//   • 'header' — the 22 original info-row fields (headerFields.js), resolved exactly as before;
//   • 'live'   — LIVE_COLUMNS (Gap %, Day Range, Days to Earnings), computed from the live quote / the snapshot;
//   • 'fact'   — FACT_COLUMNS, the nightly screener snapshot (POST /api/watchlists/column-facts), re-based on the live
//                price where the stat is price-relative and formatted with the Screener's own formatters.
// The Watchlist-only columns (ATR %, ATR from 50SMA, Attention, RS Exit) are not offered: their values are computed
// inside the Watchlist page and have no single-symbol source the chart can ask for.
//
// STORAGE (both under `header`, both absent by default, so an untouched chart is today's exact row):
//   header.fields     — the chosen stat keys, in left-to-right order (the key the info row has always used).
//   header.statLabels — { [statKey]: 'short custom label' } — a member's rename; absent / empty = the stat's own name.
// Both are SANITISED ON READ here (known keys only, no duplicates, trimmed, capped) — the same discipline as
// `headerFieldKeys`, so a hand-edited or stale blob can never put an unknown stat or a long label on the chart.

import { HEADER_FIELDS, headerFieldKeys, resolveHeaderField, SIGN_POS, SIGN_NEG } from './headerFields'
import {
  COLUMN_GROUPS, LIVE_COLUMNS, FACT_COLUMNS, EXISTING_PLACEMENT, factFieldsFor, factValue, factText,
} from '../../pages/watchlist/watchlistColumnCatalog'
import { isCustomStatKey, customStatsOf, customStatKey, customStatFor, customStatsWithout } from './headerCustomStats'
import { statStylesOf, withStatStyle, statStylesWithout } from './headerStatStyle'

export const STAT_LABEL_MAX = 16

const HEADER_STAT_LIST = [
  ...HEADER_FIELDS.map((f) => ({
    key: f.key, label: f.label, short: f.short || f.label, group: EXISTING_PLACEMENT[f.key]?.[0] || 'price',
    desc: EXISTING_PLACEMENT[f.key]?.[1] || '', source: 'header', signed: !!f.signed, colorKey: f.colorKey, dflt: f.dflt ?? null,
    title: f.title,
  })),
  ...Object.entries(LIVE_COLUMNS).map(([key, c]) => ({
    key, label: c.label, short: c.short || c.label, group: c.group, desc: c.desc || '', source: 'live',
    signed: !!c.signed, colorKey: key, dflt: null,
  })),
  ...Object.entries(FACT_COLUMNS).map(([key, c]) => ({
    key, label: c.label, short: c.short || c.label, group: c.group, desc: c.desc || '', source: 'fact',
    signed: !!c.signed, colorKey: key, dflt: null,
  })),
]

/** Every stat the picker offers, grouped in the Watchlist library's group order (stable within a group). */
export const HEADER_STAT_GROUPS = COLUMN_GROUPS
  .map((g) => ({ key: g.key, label: g.label, stats: HEADER_STAT_LIST.filter((s) => s.group === g.key) }))
  .filter((g) => g.stats.length)
export const HEADER_STATS = HEADER_STAT_GROUPS.flatMap((g) => g.stats)
// null prototype: a stored key such as '__proto__' or 'constructor' is never mistaken for a stat
export const HEADER_STAT_BY_KEY = Object.assign(Object.create(null), Object.fromEntries(HEADER_STATS.map((s) => [s.key, s])))

// Stats with no meaning for an ETF / index / breadth series (no company behind them): '—', like Market Cap today.
const COMPANY_ONLY_GROUPS = new Set(['fund', 'own', 'analyst'])
const COMPANY_ONLY_KEYS = new Set(['epsg', 'revg', 'epsny', 'dte'])
const companyOnly = (s) => s.source !== 'header' && (COMPANY_ONLY_GROUPS.has(s.group) || COMPANY_ONLY_KEYS.has(s.key))

/** The chosen stat keys, in order — known keys only, first occurrence wins. A blob with no `fields` reads as
 *  today's row (the legacy show* migration in `headerFieldKeys`: Market Cap · Next Earnings). */
export function headerStatKeys(header) {
  if (!Array.isArray(header?.fields)) return headerFieldKeys(header)
  const seen = new Set()
  const out = []
  // a custom stat's key (`cx:<id>`, headerCustomStats.js) is known while its entry is stored
  const custom = new Set(customStatsOf(header).map((c) => customStatKey(c.id)))
  for (const k of header.fields) {
    if (typeof k !== 'string' || (!HEADER_STAT_BY_KEY[k] && !custom.has(k)) || seen.has(k)) continue
    seen.add(k)
    out.push(k)
  }
  return out
}

/** One label, cleaned: a string, whitespace collapsed, trimmed, at most STAT_LABEL_MAX characters. '' = none. */
export function cleanStatLabel(v) {
  if (typeof v !== 'string') return ''
  return v.replace(/\s+/g, ' ').trim().slice(0, STAT_LABEL_MAX).trim()
}

/** The member's renames — known stat keys only, each label cleaned; empties dropped. Always a fresh object. */
export function statLabelsOf(header) {
  const raw = header?.statLabels
  const out = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  const custom = new Set(customStatsOf(header).map((c) => customStatKey(c.id)))
  for (const [k, v] of Object.entries(raw)) {
    if (!HEADER_STAT_BY_KEY[k] && !custom.has(k)) continue
    const l = cleanStatLabel(v)
    if (l) out[k] = l
  }
  return out
}

/** The `statLabels` map after renaming one stat. An empty label, or the stat's own full name, removes the rename. */
export function withStatLabel(header, key, label) {
  const next = statLabelsOf(header)
  const l = cleanStatLabel(label)
  const s = HEADER_STAT_BY_KEY[key] || (customStatFor(header, key) ? { label: customStatFor(header, key).name || '' } : null)
  if (!s) return next
  if (!l || l === s.label) delete next[key]
  else next[key] = l
  return next
}

/** The `header` patch for toggling one stat: a pick is appended, an unpick is removed (with its rename). */
export function headerStatTogglePatch(header, key) {
  if (isCustomStatKey(key)) {
    // a custom stat is ADDED by the custom-stat builder (addCustomStatPatch); here it can only be removed, and it
    // takes its stored entry, rename and color with it (a freed id may be reused by the next custom stat)
    if (!customStatFor(header, key)) return {}
    const labels = statLabelsOf(header)
    delete labels[key]
    const patch = { fields: headerStatKeys(header).filter((k) => k !== key), statLabels: labels, customStats: customStatsWithout(header, key) }
    if (header?.statStyle) patch.statStyle = statStylesWithout(header, key, isHeaderStatKeyOf(header))
    const colors = header?.colors && typeof header.colors === 'object' ? header.colors : null
    if (colors && [key, `${key}:pos`, `${key}:neg`].some((k) => k in colors)) {
      const c = { ...colors }
      delete c[key]; delete c[`${key}:pos`]; delete c[`${key}:neg`]
      patch.colors = c
    }
    return patch
  }
  if (!HEADER_STAT_BY_KEY[key]) return {}
  const cur = headerStatKeys(header)
  if (!cur.includes(key)) return { fields: [...cur, key] }
  const labels = statLabelsOf(header)
  delete labels[key]
  const patch = { fields: cur.filter((k) => k !== key), statLabels: labels }
  // its look (label color, box, size) goes with it, like its rename; the value color stays (`header.colors`, as before)
  if (header?.statStyle) patch.statStyle = statStylesWithout(header, key, isHeaderStatKeyOf(header))
  return patch
}

/** `(key) => boolean`: is `key` a stat this header can carry (a catalog stat, or one of ITS custom stats)? */
export function isHeaderStatKeyOf(header) {
  const custom = new Set(customStatsOf(header).map((c) => customStatKey(c.id)))
  return (k) => !!HEADER_STAT_BY_KEY[k] || custom.has(k)
}

/** The member's per-stat looks (headerStatStyle.js), known stats only. */
export const statStylesFor = (header) => statStylesOf(header, isHeaderStatKeyOf(header))

/** The `header.statStyle` map after patching one stat's look (`{labelColor, box, boxColor, size}`; null = default). */
export const withHeaderStatStyle = (header, key, patch) => withStatStyle(header, key, patch, isHeaderStatKeyOf(header))

/** The `header.fields` after moving one chosen stat from index `from` to index `to` (clamped). */
export function movedHeaderStats(header, from, to) {
  const cur = headerStatKeys(header)
  if (from < 0 || from >= cur.length) return cur
  const t = Math.max(0, Math.min(cur.length - 1, to))
  if (t === from) return cur
  const next = cur.slice()
  const [k] = next.splice(from, 1)
  next.splice(t, 0, k)
  return next
}

// ── data needs (so ChartPane asks only for what a chosen stat reads) ──
const QUOTE_LIVE = new Set(['gap', 'dayrange'])
/** True when a chosen stat reads the live quote (the 'header' quote fields are QUOTE_HEADER_KEYS in headerFields). */
export const statNeedsQuote = (key) => {
  const s = HEADER_STAT_BY_KEY[key]
  if (!s) return false
  if (s.source === 'live') return QUOTE_LIVE.has(key)
  if (s.source === 'fact') return FACT_COLUMNS[key]?.kind !== 'static'   // re-based on the live price
  return false
}
/** The snapshot fields the chosen 'fact' stats need ([] = no column-facts request at all). */
export const statFactFields = (keys) => factFieldsFor((keys || []).filter((k) => HEADER_STAT_BY_KEY[k]?.source === 'fact'))

const num = (v) => typeof v === 'number' && Number.isFinite(v)
const signOf = (v) => (num(v) ? (v >= 0 ? 'pos' : 'neg') : null)

/** Resolve one stat → { value, color, sign }. `value` null = unknown / not applicable (the row prints '—').
 *  ctx = ChartPane's header context plus `facts` (this symbol's column-facts row). Never throws. */
export function resolveHeaderStat(key, ctx) {
  const s = HEADER_STAT_BY_KEY[key]
  if (!s) return { value: null }
  try {
    if (s.source === 'header') return resolveHeaderField(key, ctx)
    if (ctx?.isFundLike && companyOnly(s)) return { value: null }
    const q = ctx?.quote || {}
    if (s.source === 'live') {
      const c = LIVE_COLUMNS[key]
      const meta = { ...(ctx?.meta || {}), next_earnings: ctx?.meta?.next_earnings || ctx?.fund?.next_earnings || null }
      const v = c.value(q, meta)
      if (v == null) return { value: null }
      const text = c.fmt(v)
      if (!s.signed) return { value: text }
      return { value: text, color: num(v) ? (v >= 0 ? SIGN_POS : SIGN_NEG) : null, sign: signOf(v) }
    }
    const v = factValue(key, ctx?.facts || null, q)
    if (v == null) return { value: null }
    const text = factText(key, v)
    if (text == null || text === '—' || text === '') return { value: null }
    if (!s.signed) return { value: String(text) }
    return { value: String(text), color: num(v) ? (v >= 0 ? SIGN_POS : SIGN_NEG) : null, sign: signOf(v) }
  } catch {
    return { value: null }
  }
}

/** The info row's items for the chosen stats, in order → ChartMetaRow. Colour: a signed stat takes the member's
 *  `<colorKey>:pos|neg` override by the value's sign, else the green / red tint; any other stat takes its override,
 *  else its own default (null = the row's white). A rename replaces the full AND the narrow label, and the hover
 *  then names the stat it stands for. Unknown keys are skipped; a missing value is left null (the row prints '—'). */
export function headerStatItems(keys, labels, colors, ctx) {
  const own = labels || {}
  const ov = colors || {}
  const out = []
  // per-stat looks (owner 11-17): absent = no `style` on the item at all, so the row renders exactly as before
  const looks = ctx && ctx.header ? statStylesFor(ctx.header) : {}
  for (const key of keys || []) {
    if (isCustomStatKey(key)) {
      const ci = customStatItem(key, own[key], ov, ctx)
      if (looks[key]) ci.style = looks[key]
      out.push(ci)
      continue
    }
    const f = HEADER_STAT_BY_KEY[key]
    if (!f) continue
    const { value, color, sign } = resolveHeaderStat(key, ctx)
    let finalColor
    if (f.signed) {
      const s = sign || 'pos'
      finalColor = ov[`${f.colorKey}:${s}`] || color || (s === 'neg' ? SIGN_NEG : SIGN_POS)
    } else {
      finalColor = (f.colorKey ? ov[f.colorKey] : null) || color || f.dflt || null
    }
    const name = own[key]
    const item = {
      key, label: name || f.label, short: name || f.short || f.label, title: name ? f.label : f.title,
      value: value ?? null, color: finalColor, sign: f.signed ? (sign || 'pos') : null,
    }
    if (looks[key]) item.style = looks[key]
    out.push(item)
  }
  return out
}

/** A custom stat's info-row item. The value is the compute's (`ctx.custom[key]`, engine/customStatCompute.js, run by
 *  the chart over its own bars); until it answers, the stored name and '—'. A stat whose output sits around zero
 *  (the indicator declares a 0 guide) is signed: green / red by sign, or the member's `<key>:pos|neg` override. */
function customStatItem(key, rename, ov, ctx) {
  const c = (ctx && ctx.custom && ctx.custom[key]) || null
  const stored = c ? null : customStatFor(ctx?.header, key)
  const label = (c && c.label) || (stored && stored.name) || 'Custom stat'
  const short = (c && c.short) || label
  const value = c && c.state === 'value' ? c.text : (c && c.state === 'refused' ? 'n/a' : null)
  const signed = !!(c && c.signed)
  const num = c && Number.isFinite(c.value) ? c.value : null
  const sign = signed ? (num != null && num < 0 ? 'neg' : 'pos') : null
  const color = signed
    ? (ov[`${key}:${sign}`] || (num == null ? null : (sign === 'neg' ? SIGN_NEG : SIGN_POS)))
    : (ov[key] || null)
  const title = [rename ? label : (c && c.title) || label, c && c.reason].filter(Boolean).join(' · ')
  return { key, label: rename || label, short: rename || short, title, value: value ?? null, color, sign, custom: true }
}

/** The settings window's description of one chosen stat: the catalog's own entry, or a custom stat's (its live
 *  `meta` from customStatCompute when given, else the stored name). null = not a stat of this header. */
export function headerStatMetaOf(header, key, customMeta) {
  if (HEADER_STAT_BY_KEY[key]) return HEADER_STAT_BY_KEY[key]
  const c = customStatFor(header, key)
  if (!c) return null
  const m = (customMeta && customMeta[key]) || null
  const label = (m && m.label) || c.name || 'Custom stat'
  return {
    key, label, short: label, desc: (m && m.desc) || 'Custom stat: an indicator value on the newest bar',
    source: 'custom', signed: !!(m && m.signed), colorKey: key, dflt: null, custom: true,
  }
}
