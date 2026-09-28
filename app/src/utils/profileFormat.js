// app/src/utils/profileFormat.js
//
// The Stock Profile number grammar — ONE copy, read by the /charts Profile
// widget and the earnings modal's Profile section. These used to live as
// private helpers inside ProfileWidget.jsx; the moment a second surface needed
// them, a second hand-written copy was the defect waiting to happen
// (lesson_one_grammar_four_hand_written_copies).

import { formatCompact } from '../lib/presentation/presentationPrimitives'

// `Number(null) === 0` — the phantom-zero trap. Every formatter here treats a
// missing value as MISSING (an em dash), never as a confident 0. The widget
// used to guard this at each call site; the guard belongs in the grammar.
const num = (v) => {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// +952% / -63% — signed, rounded to a whole percent (Model Book style).
export function fmtPct(v) {
  const n = num(v)
  if (n == null) return '—'
  const r = Math.round(n)
  return `${r >= 0 ? '+' : ''}${r}%`
}

// ⭐ THE MAGNITUDE SUFFIX IS `lib/presentation`'s (TERM-066). Each ladder below
// is the one this grammar ALREADY had, passed in rather than unified: the three
// disagree (K at one decimal / at none; B and M at one decimal / at two) and a
// shared ladder would move a member-visible number. The missing-value gates
// stay here, where the unit is known. Byte-identity to the pre-TERM-066 bodies
// is proved over every input class by `lib/presentation/compactAdoption.test.jsx`.
const VOL_TIERS = [
  { at: 1e9, suffix: 'B', decimals: 1 },
  { at: 1e6, suffix: 'M', decimals: 1 },
  { at: 1e3, suffix: 'K', decimals: 1 },
]
const REVENUE_TIERS = [
  { at: 1e9, suffix: 'B', decimals: 2 },
  { at: 1e6, suffix: 'M', decimals: 2 },
  { at: 1e3, suffix: 'K', decimals: 1 },
]
const SHARES_TIERS = [
  { at: 1e9, suffix: 'B', decimals: 1 },
  { at: 1e6, suffix: 'M', decimals: 1 },
  { at: 1e3, suffix: 'K', decimals: 0 },
]

// $11.8M — dollar volume with a magnitude suffix (Model Book fmtVol).
export function fmtVol(v) {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return '—'
  return formatCompact(n, { tiers: VOL_TIERS, prefix: '$' })
}

export function fmtEps(v) {
  const n = num(v)
  return n == null ? '—' : n.toFixed(2)
}

// $1.23B — the sign stays INSIDE the dollar sign ("$-1.50B"), as it always has.
export function fmtRevenue(v) {
  const n = Number(v)
  if (!Number.isFinite(n) || n === 0) return '—'
  return formatCompact(n, { tiers: REVENUE_TIERS, prefix: '$' })
}

// A % surprise cell → {text, dir} so the caller can color it up/down.
export function pctCell(v) {
  const n = num(v)
  if (n == null) return { text: '—', dir: 0 }
  const r = Math.round(n)
  // `Math.round(-0.4)` is -0, which prints as "0"; the sign comes from the
  // rounded value so "-0%" can never render.
  return { text: `${r >= 0 ? '+' : ''}${r}%`, dir: n > 0 ? 1 : n < 0 ? -1 : 0 }
}

// 66.2 → "66.2%" — a one-decimal percent for float / short-interest / inst-own.
export function pctText(v) {
  const n = num(v)
  return n == null ? '—' : `${n.toFixed(1)}%`
}

export function fmtQuarter(r) {
  return `Q${r?.quarter ?? '?'} ${r?.year ?? ''}`.trim()
}

export function fmtShares(v) {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return '—'
  return formatCompact(n, { tiers: SHARES_TIERS })
}

export function fmtEarnDate(iso) {
  if (!iso) return '—'
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number)
  return (m && d && y) ? `${m}/${d}/${String(y).slice(-2)}` : String(iso)
}

// Time trading since inception (first-trade date): years / months / weeks / days.
export function fmtAge(iso, now = Date.now()) {
  if (!iso) return '—'
  const start = Date.parse(String(iso).slice(0, 10) + 'T00:00:00Z')
  if (Number.isNaN(start)) return '—'
  const days = (now - start) / 86400000
  if (days < 0) return '—'
  if (days >= 365.25) return `${(days / 365.25).toFixed(1)} years`
  if (days >= 30.44) return `${(days / 30.44).toFixed(1)} months`
  if (days >= 7) return `${(days / 7).toFixed(1)} weeks`
  return `${Math.max(1, Math.round(days))} days`
}

export function websiteDomain(url) {
  return String(url || '').replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '')
}
