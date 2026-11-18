// Scan filters for the breadth drill — the pure half (no React).
//
// A filter is a FACET: a group of options. Inside a facet the options OR (Tech or
// Healthcare); across facets they AND (Tech AND market cap $2B+). Signals are the
// exception: each one is a condition of its own ("New 52-week high" AND
// "Stage 2"), because that is how a scan reads.
//
// Signals come mostly from the OTHER breadth lists the stock is on that same day
// (the drill context's `also`), so "New 52-week high" is exactly the Breadth
// Monitor's own 52-week-high list — never a second, client-side definition.
//
// Every option carries a count: how many stocks you would see if you also picked
// it, given everything else already picked. An option that would leave nothing
// says 0 rather than disappearing, so the panel does not reshuffle under you.

export const LIST_SIGNALS = [
  ['new_52w_highs_list', 'New 52-week high'],
  ['new_ath_list', 'All-time high'],
  ['new_20d_highs_list', 'New 20-day high'],
  ['hvc_52w_list', 'Highest-volume close (1 yr)'],
  ['stage2_list', 'Stage 2'],
  ['up_20pct_5d_list', 'Up 20%+ in 5 days'],
  ['up_25pct_month_list', 'Up 25%+ in a month'],
  ['up_50pct_month_list', 'Up 50%+ in a month'],
  ['up_25pct_quarter_list', 'Up 25%+ in a quarter'],
  ['magna_up_list', 'Magna up'],
  ['atr_ext_7_list', '7+ ATRs above the 50-day'],
  ['up_4pct_today_list', 'Up 4%+ today'],
  ['down_4pct_today_list', 'Down 4%+ today'],
  ['new_52w_lows_list', 'New 52-week low'],
  ['new_20d_lows_list', 'New 20-day low'],
  ['stage4_list', 'Stage 4'],
  ['down_20pct_5d_list', 'Down 20%+ in 5 days'],
  ['down_25pct_month_list', 'Down 25%+ in a month'],
  ['down_50pct_month_list', 'Down 50%+ in a month'],
  ['down_25pct_quarter_list', 'Down 25%+ in a quarter'],
  ['magna_down_list', 'Magna down'],
]
const LIST_SIGNAL_LABEL = Object.fromEntries(LIST_SIGNALS)

const DAY = 86400000
const isoMs = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '')
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null
}

// Signals the drill can answer without another list.
export const ROW_SIGNALS = [
  { key: 'firstTime', label: 'First time on this list', title: 'Not on this list on any of the previous 5 sessions',
    test: (r) => r.repeat === 0 },
  { key: 'regular', label: 'On this list 3+ of the last 5 days', test: (r) => r.repeat >= 3 },
  { key: 'earnSoon', label: 'Earnings within 2 weeks',
    test: (r, ctx) => {
      const e = isoMs(r.nextEarnings); const d = isoMs(ctx?.date) ?? ctx?.now ?? Date.now()
      return e != null && e >= d && e - d <= 14 * DAY
    } },
  { key: 'above50', label: 'Above the 50-day', test: (r) => Number.isFinite(r.a50) && r.a50 > 0 },
]
const ROW_SIGNAL = Object.fromEntries(ROW_SIGNALS.map(s => [s.key, s]))

export const MCAP_BUCKETS = [
  { key: 'micro', label: 'Micro', hint: '< $300M', min: 0, max: 3e8 },
  { key: 'small', label: 'Small', hint: '$300M–2B', min: 3e8, max: 2e9 },
  { key: 'mid', label: 'Mid', hint: '$2–10B', min: 2e9, max: 1e10 },
  { key: 'large', label: 'Large', hint: '$10–200B', min: 1e10, max: 2e11 },
  { key: 'mega', label: 'Mega', hint: '$200B+', min: 2e11, max: Infinity },
]
const MCAP = Object.fromEntries(MCAP_BUCKETS.map(b => [b.key, b]))

// "At least" facets: pick one step (or Any).
export const MIN_FACETS = [
  { key: 'move', label: 'Move', field: (r) => (Number.isFinite(r.pct) ? Math.abs(r.pct) : null), steps: [5, 10, 20, 30], fmt: (v) => `${v}%+` },
  { key: 'rvol', label: 'Relative volume', field: (r) => r.rvol, steps: [1.5, 2, 3, 5], fmt: (v) => `${v}x+` },
  { key: 'price', label: 'Price', field: (r) => r.price, steps: [5, 10, 20, 50], fmt: (v) => `$${v}+` },
  { key: 'rating', label: 'UCT rating', field: (r) => r.rating, steps: [60, 70, 80, 90], fmt: (v) => `${v}+` },
]
const MIN = Object.fromEntries(MIN_FACETS.map(f => [f.key, f]))

export const SET_FACETS = ['signals', 'sector', 'industry', 'theme', 'mcap']

export function emptySelection() {
  return { signals: new Set(), sector: new Set(), industry: new Set(), theme: new Set(), mcap: new Set(),
    move: null, rvol: null, price: null, rating: null }
}

export function signalLabel(key) {
  return LIST_SIGNAL_LABEL[key] || ROW_SIGNAL[key]?.label || key
}

function signalTest(r, key, ctx) {
  const rs = ROW_SIGNAL[key]
  if (rs) return rs.test(r, ctx)
  return Array.isArray(r.also) && r.also.includes(key)
}

function facetPass(r, facet, sel, ctx) {
  if (facet === 'signals') {
    for (const k of sel.signals) if (!signalTest(r, k, ctx)) return false
    return true
  }
  if (facet === 'sector' || facet === 'industry' || facet === 'theme') {
    const s = sel[facet]
    return !s.size || s.has(r[facet] || '')
  }
  if (facet === 'mcap') {
    if (!sel.mcap.size) return true
    if (!Number.isFinite(r.mcap)) return false
    for (const k of sel.mcap) { const b = MCAP[k]; if (b && r.mcap >= b.min && r.mcap < b.max) return true }
    return false
  }
  const f = MIN[facet]
  if (f && sel[facet] != null) {
    const v = f.field(r)
    return Number.isFinite(v) && v >= sel[facet]
  }
  return true
}

const ALL_FACETS = [...SET_FACETS, ...MIN_FACETS.map(f => f.key)]

/** Rows passing every facet except `skip`. */
export function applyFacets(rows, sel, ctx = {}, skip = null) {
  if (!sel) return rows
  return rows.filter(r => ALL_FACETS.every(f => f === skip || facetPass(r, f, sel, ctx)))
}

export function activeCount(sel) {
  if (!sel) return 0
  let n = 0
  for (const f of SET_FACETS) n += sel[f].size
  for (const f of MIN_FACETS) if (sel[f.key] != null) n += 1
  return n
}

/** Removable chips for what is picked, in panel order. */
export function activeChips(sel) {
  if (!sel) return []
  const out = []
  for (const k of sel.signals) out.push({ facet: 'signals', value: k, label: signalLabel(k) })
  for (const f of ['sector', 'industry', 'theme']) for (const v of sel[f]) out.push({ facet: f, value: v, label: v || 'Unclassified' })
  for (const k of sel.mcap) out.push({ facet: 'mcap', value: k, label: `${MCAP[k]?.label || k} cap` })
  for (const f of MIN_FACETS) if (sel[f.key] != null) out.push({ facet: f.key, value: sel[f.key], label: `${f.label} ${f.fmt(sel[f.key])}` })
  return out
}

/**
 * Everything the panel draws, with counts. Options that no stock in the drill
 * has at all are left out (a list with no themes shows no Theme section).
 */
export function facetModel(rows, sel, ctx = {}) {
  const s = sel || emptySelection()
  const countBy = (facet, keyOf) => {
    const base = applyFacets(rows, s, ctx, facet)
    const m = new Map()
    for (const r of base) { const k = keyOf(r); if (k == null) continue; m.set(k, (m.get(k) || 0) + 1) }
    return m
  }
  const groupOpts = (facet) => {
    const seen = new Map()
    for (const r of rows) { const k = r[facet] || ''; seen.set(k, (seen.get(k) || 0) + 1) }
    const live = countBy(facet, r => r[facet] || '')
    return [...seen.keys()]
      .filter(k => k !== '' || seen.size > 1)
      .map(k => ({ key: k, label: k || 'Unclassified', count: live.get(k) || 0, on: s[facet].has(k) }))
      .sort((a, b) => (a.key === '') - (b.key === '') || b.count - a.count || a.label.localeCompare(b.label))
  }

  // Signals: AND, so an option's count is "the rest, AND this one".
  const sigBase = applyFacets(rows, s, ctx)
  const present = new Set()
  for (const r of rows) for (const k of r.also || []) present.add(k)
  const sigKeys = [
    ...LIST_SIGNALS.map(([k]) => k).filter(k => present.has(k)),
    ...ROW_SIGNALS.map(x => x.key).filter(k => rows.some(r => ROW_SIGNAL[k].test(r, ctx))),
  ]
  const signals = sigKeys.map(k => ({
    key: k, label: signalLabel(k), title: ROW_SIGNAL[k]?.title,
    count: sigBase.filter(r => signalTest(r, k, ctx)).length, on: s.signals.has(k),
  }))

  const capCounts = countBy('mcap', r => {
    if (!Number.isFinite(r.mcap)) return null
    return MCAP_BUCKETS.find(b => r.mcap >= b.min && r.mcap < b.max)?.key ?? null
  })
  const hasCap = rows.some(r => Number.isFinite(r.mcap))
  const mcap = hasCap ? MCAP_BUCKETS.map(b => ({ key: b.key, label: b.label, hint: b.hint, count: capCounts.get(b.key) || 0, on: s.mcap.has(b.key) })) : []

  const mins = MIN_FACETS
    .filter(f => rows.some(r => Number.isFinite(f.field(r))))
    .map(f => {
      const base = applyFacets(rows, s, ctx, f.key)
      return {
        key: f.key, label: f.label, value: s[f.key],
        steps: f.steps.map(v => ({ value: v, label: f.fmt(v), count: base.filter(r => { const x = f.field(r); return Number.isFinite(x) && x >= v }).length })),
      }
    })

  return {
    signals,
    sector: groupOpts('sector'),
    industry: groupOpts('industry'),
    theme: groupOpts('theme'),
    mcap,
    mins,
  }
}

/** Immutable toggles. */
export function toggleFacet(sel, facet, value) {
  const next = { ...sel }
  if (SET_FACETS.includes(facet)) {
    const s = new Set(sel[facet])
    if (s.has(value)) s.delete(value); else s.add(value)
    next[facet] = s
  } else {
    next[facet] = sel[facet] === value ? null : value
  }
  return next
}

// Marks every popover the drill window owns, so the window's Escape handler can
// tell "close the popover" from "close the window".
export const DRILL_POPOVER_ATTR = 'data-drill-popover'

// How the list can be grouped: the switch in the list's title row.
export const GROUP_OPTIONS = [
  ['none', 'All'], ['sector', 'Sector'], ['industry', 'Industry'], ['theme', 'Theme'],
]
