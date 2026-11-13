// UCT Agent — COT research (Phase 2): CFTC Commitments of Traders positioning, one generalized capability.
//
//   cot.positioning  where large speculators / commercials / small speculators are positioned in 1–6 futures markets,
//                    how that changed week over week or over N weeks, where it sits in its own N-year history
//                    (range, percentile, high / low), and a side-by-side comparison when several markets are named.
//
// DATA: ONE `cot.positioning` gateway read (api/services/uct_agent/marketdata/cot.py): the COT tab's stored weekly rows,
// unchanged, with the Tuesday report date (as_of), the publish delay and `stale` from cot_service's own calendar rule.
// MATH: the COT tab's SINGLE analytics authority, app/src/pages/cot/cotRead.js (cotIndex, percentileRank, computeSnapshot —
// CLAUDE.md: never ported to Python). This module only selects rows by date and formats; it adds no positioning statistic.
// GROUNDING: the member's answer is templated from `facts` (returned beside it): every number in the text is a fact's
// number, or a date of one. The model's pre-read reply is never served for this action (turn.DATA_READ_ACTIONS).
//
// Dark by construction: registered only while the server serves the `cot.positioning` kind (UCT_AGENT_DATA_KINDS,
// fail-closed). Its routing group's words are armed only while it is registered (routing.js keeps them empty), so a
// dark server routes exactly as before.

import { registerCapability } from '../capabilities'
import * as agentClient from '../agentClient'
import { readData } from '../marketdata/client'
import { currentTurnId } from '../trace'
import { GROUPS } from '../routing'
import { cotIndex, percentileRank, computeSnapshot } from '../../pages/cot/cotRead'

export const CAPABILITY = 'cot.positioning'
export const KIND = 'cot.positioning'
export const MAX_MARKETS = 6
export const GROUP_KEYS = ['large_specs', 'commercials', 'small_specs', 'open_interest']
const FIELD = { large_specs: 'large_spec_net', commercials: 'commercial_net', small_specs: 'small_spec_net', open_interest: 'open_interest' }
const LABEL = { large_specs: 'Large speculators', commercials: 'Commercials', small_specs: 'Small speculators', open_interest: 'Open interest' }
const SNAP_KEY = { large_specs: 'largeSpecs', commercials: 'commercials', small_specs: 'smallSpecs' }
const ZONE_WORD = { 'extreme-long': 'extreme long', long: 'long', neutral: 'neutral', short: 'short', 'extreme-short': 'extreme short' }
export const DEFAULT_YEARS = 3
export const MAX_YEARS = 10
const WEEK_MS = 7 * 86400000

export const LIMITS = 'Weekly data only (CFTC legacy futures-only report: no daily or intraday positioning, no options); '
  + 'UCT stores about ten years per market, and only the futures markets on the COT tab are covered.'
const NO_TURN = "this needs the Agent's turn, which wasn't available"
const NO_READ = {
  refused: "that request wasn't allowed for this question, so no COT data was read",
  unavailable: "UCT's COT data could not answer it right now",
}

export function cotServed() {
  if (!agentClient.serverServesData()) return false
  const kinds = typeof agentClient.serverDataKinds === 'function' ? agentClient.serverDataKinds() : null
  return Array.isArray(kinds) && kinds.includes(KIND)
}

// ── formatting (pure) ──────────────────────────────────────────────────────────────────────────────────────────────────
/** "2026-11-10" → "Nov 10, 2026" (a calendar date: noon UTC, so no zone moves it). */
export function dayText(ymd) {
  if (typeof ymd !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(`${ymd}T12:00:00Z`))
}
const n0 = (v) => (v == null ? '—' : Math.round(v).toLocaleString('en-US'))
const signed = (v) => (v == null ? 'n/a' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(Math.round(v)).toLocaleString('en-US')}`)
const netWord = (v) => (v == null ? '—' : v > 0 ? `net long ${n0(v)}` : v < 0 ? `net short ${n0(Math.abs(v))}` : 'flat (net 0)')
// Round half AWAY from zero, the same rule cotFacts.js uses for the narrative's facts
const rnd = (v, k) => Math.sign(v) * Math.round(Math.abs(v) * k) / k
const r0 = (v) => (v == null || !Number.isFinite(v) ? null : rnd(v, 1))
const r1 = (v) => (v == null || !Number.isFinite(v) ? null : rnd(v, 10))
const ordinal = (n) => { const s = ['th', 'st', 'nd', 'rd']; const v = n % 100; return `${n}${s[(v - 20) % 10] || s[v] || s[0]}` }

// ── the facts (pure; exported for tests) ──────────────────────────────────────────────────────────────────────────────
const ms = (ymd) => Date.parse(`${ymd}T00:00:00Z`)
/** the stored row exactly `weeks` report weeks before `last`, or null when that week is missing (never interpolated) */
function rowWeeksBack(rows, last, weeks) {
  const want = ms(last.date) - weeks * WEEK_MS
  for (let i = rows.length - 1; i >= 0; i--) {
    const t = ms(rows[i].date)
    if (t === want) return rows[i]
    if (t < want) return null
  }
  return null
}

/**
 * One market's facts from its stored rows. `years` = the lookback for the range / percentile / high-low; `changeWeeks` =
 * the N-week change (week over week is always given). Every statistic is cotRead's or a date-matched difference.
 */
export function marketFacts(series, { years = DEFAULT_YEARS, changeWeeks = null } = {}) {
  const rows = Array.isArray(series?.rows) ? series.rows : []
  if (!rows.length) return null
  const idx = rows.length - 1
  const last = rows[idx]
  const snap = computeSnapshot(rows, idx)                 // the COT tab's own 3-year index + zone + % of OI
  const fromMs = ms(last.date) - (years * 52 - 1) * WEEK_MS
  const win = rows.filter(r => ms(r.date) >= fromMs)
  const prev = rowWeeksBack(rows, last, 1)
  const backN = changeWeeks && changeWeeks > 1 ? rowWeeksBack(rows, last, changeWeeks) : null
  const groups = {}
  for (const key of GROUP_KEYS) {
    const f = FIELD[key]
    const vals = win.map(r => r[f])
    let hi = win[0]; let lo = win[0]
    for (const r of win) { if (r[f] > hi[f]) hi = r; if (r[f] < lo[f]) lo = r }
    const s = SNAP_KEY[key] ? snap.groups[SNAP_KEY[key]] : null
    groups[key] = {
      net: last[f],
      wow: prev ? last[f] - prev[f] : null,
      change: changeWeeks && changeWeeks > 1 ? { weeks: changeWeeks, value: backN ? last[f] - backN[f] : null } : null,
      pct_of_oi: s ? r1(s.pctOi) : null,
      high: { value: hi[f], date: hi.date }, low: { value: lo[f], date: lo.date },
      at_high: last[f] === hi[f] && win.length > 1, at_low: last[f] === lo[f] && win.length > 1,
      percentile: r0(percentileRank(vals, last[f])),
      index: r0(cotIndex(vals)),
      index_3y: s ? r0(s.index) : null, zone_3y: s ? s.zone : null,
    }
  }
  return {
    symbol: series.symbol, name: series.name || series.symbol, report_date: last.date, stale: !!series.stale,
    first_date: rows[0].date, lookback: { years, weeks: win.length, from: win[0].date, short: win.length < years * 52 },
    missing_weeks: series.missing_weeks || 0, wow_missing: !prev, change_missing: !!(changeWeeks && changeWeeks > 1 && !backN),
    groups,
  }
}

function groupLine(key, g, f) {
  const yrs = `${f.lookback.years}-year`
  const parts = []
  if (key === 'open_interest') parts.push(`${LABEL[key]}: ${n0(g.net)} contracts`)
  else parts.push(`${LABEL[key]}: ${netWord(g.net)} contracts${g.pct_of_oi != null ? ` (${g.pct_of_oi}% of open interest)` : ''}`)
  parts.push(`week over week ${f.wow_missing ? 'n/a (the prior week is missing)' : signed(g.wow)}`)
  if (g.change) parts.push(`${g.change.weeks}-week change ${g.change.value == null ? `n/a (no report ${g.change.weeks} weeks back)` : signed(g.change.value)}`)
  const extreme = g.at_high ? ` — at its ${yrs} high` : g.at_low ? ` — at its ${yrs} low` : ''
  parts.push(`${yrs} range ${signed(g.low.value)} (${dayText(g.low.date)}) to ${signed(g.high.value)} (${dayText(g.high.date)})${extreme}`)
  if (g.percentile != null) parts.push(`${ordinal(g.percentile)} percentile of that history`)
  if (g.index_3y != null && key !== 'open_interest') parts.push(`3-year COT Index ${g.index_3y} (${ZONE_WORD[g.zone_3y] || g.zone_3y})`)
  return `• ${parts.join('; ')}.`
}

const rosterLine = (covered) => (Array.isArray(covered) && covered.length
  ? `Covered markets: ${covered.map(c => `${c.name} (${c.symbol})`).join(', ')}.` : '')

/** The `cot.positioning` envelope → the member's answer + its facts (pure; exported for tests). */
export function answerFromCot(envl, { group = null, years = DEFAULT_YEARS, changeWeeks = null } = {}) {
  const usable = !!envl && (envl.status === 'ok' || envl.status === 'partial') && envl.data && typeof envl.data === 'object'
  if (!usable) return { text: `I couldn't read UCT's COT data: ${NO_READ[envl?.status] || NO_READ.unavailable}. No figure is stated.` }
  const d = envl.data
  const series = Array.isArray(d.series) ? d.series : []
  const facts = series.map(s => marketFacts(s, { years, changeWeeks })).filter(Boolean)
  const notCovered = [...(d.not_covered || []), ...(d.no_history || []).map(c => `${c} (no stored history)`)]
  const keys = group && GROUP_KEYS.includes(group) ? [group] : GROUP_KEYS
  const lines = []
  if (!facts.length) {
    lines.push(`UCT's COT data doesn't cover ${notCovered.length ? notCovered.join(', ') : 'that'}, so no positioning figure is stated.`)
    lines.push(rosterLine(d.covered))
    lines.push(LIMITS)
    return { text: lines.filter(Boolean).join('\n'), facts: { markets: [], not_covered: notCovered }, link: { href: '/breadth?tab=cot', label: 'Open COT Data' } }
  }
  const report = d.report_date || facts[0].report_date
  lines.push(`COT positioning — ${facts.map(f => `${f.name} (${f.symbol})`).join(', ')}: CFTC report of ${dayText(report)} (positions as of that Tuesday, published by CFTC the following Friday, about ${d.delay_days ?? 3} days later).`)
  for (const f of facts) {
    if (facts.length > 1) lines.push(`${f.name} (${f.symbol}), report of ${dayText(f.report_date)}:`)
    for (const k of keys) lines.push(groupLine(k, f.groups[k], f))
    if (f.lookback.short) lines.push(`Note: only ${f.lookback.weeks} weeks are stored for ${f.symbol} (from ${dayText(f.lookback.from)}), less than ${f.lookback.years} years.`)
    if (f.missing_weeks) lines.push(`Note: ${f.missing_weeks} report week${f.missing_weeks === 1 ? ' is' : 's are'} missing from ${f.symbol}'s stored history; changes across a missing week are not stated.`)
  }
  if (envl.stale) {
    const late = facts.filter(f => f.stale).map(f => f.symbol)
    lines.push(`Stale: the newest report here is ${dayText(report)}, but CFTC's report of ${dayText(d.expected_report_date)} should already be out${late.length ? ` (behind: ${late.join(', ')})` : ''}, so this is not the latest week.`)
  }
  if (notCovered.length) { lines.push(`Not covered by UCT's COT data: ${notCovered.join(', ')}.`); lines.push(rosterLine(d.covered)) }
  lines.push(`Source: CFTC Commitments of Traders via UCT's COT store; stored history from ${dayText(facts.reduce((a, f) => (f.first_date < a ? f.first_date : a), facts[0].first_date))}. ${LIMITS} Positioning is context, not a trading signal.`)
  const focus = keys.length === 1 ? keys[0] : 'large_specs'
  const table = facts.length > 1 ? {
    columns: [{ key: 'market', label: 'Market' }, { key: 'report', label: 'Report' }, { key: 'net', label: `${LABEL[focus]} net` },
      { key: 'wow', label: 'WoW' }, ...(changeWeeks && changeWeeks > 1 ? [{ key: 'chg', label: `${changeWeeks}-wk chg` }] : []),
      { key: 'pctile', label: `%ile (${years}y)` }, { key: 'idx', label: 'COT Index (3y)' }],
    rows: facts.map(f => { const g = f.groups[focus]; return {
      market: `${f.name} (${f.symbol})`, report: dayText(f.report_date), net: signed(g.net), wow: f.wow_missing ? 'n/a' : signed(g.wow),
      ...(changeWeeks && changeWeeks > 1 ? { chg: g.change?.value == null ? 'n/a' : signed(g.change.value) } : {}),
      pctile: g.percentile == null ? '—' : String(g.percentile), idx: g.index_3y == null ? '—' : `${g.index_3y} ${ZONE_WORD[g.zone_3y] || ''}`.trim(),
    } }),
  } : null
  return {
    text: lines.filter(Boolean).join('\n'),
    ...(table ? { table } : {}),
    facts: { report_date: report, stale: !!envl.stale, expected_report_date: d.expected_report_date, delay_days: d.delay_days ?? 3, markets: facts, not_covered: notCovered },
    link: { href: `/breadth?tab=cot&cot=${encodeURIComponent(facts[0].symbol)}`, label: `Open ${facts[0].symbol} in COT Data` },
  }
}

/** the rows one read needs: the lookback, the 3-year index window, the N-week change and the 6-week movement */
export const weeksFor = (years, changeWeeks) => Math.min(520, Math.max(years * 52, 156) + Math.max(changeWeeks || 1, 6) + 1)

export async function answerCot(args = {}) {
  const markets = (Array.isArray(args.markets) ? args.markets : []).map(m => String(m || '').trim()).filter(Boolean).slice(0, MAX_MARKETS)
  if (!markets.length) return { text: 'Which futures market should I read COT positioning for (for example gold, crude oil, the S&P 500 or the 10-year note)? No figure is stated.' }
  const years = Math.min(Math.max(Number.isInteger(args.lookback_years) ? args.lookback_years : DEFAULT_YEARS, 1), MAX_YEARS)
  const changeWeeks = Number.isInteger(args.change_weeks) && args.change_weeks > 1 ? Math.min(args.change_weeks, 260) : null
  const group = GROUP_KEYS.includes(args.group) ? args.group : null
  const turnId = currentTurnId()
  if (!turnId) return { text: `I couldn't read UCT's COT data: ${NO_TURN}.` }
  const envl = await readData(KIND, { symbols: markets, weeks: weeksFor(years, changeWeeks) }, { purpose: 'answer', turnId })
  return answerFromCot(envl, { group, years, changeWeeks })
}

// ── routing words (armed only while registered; routing.js keeps the group's words empty) ──────────────────────────────
const MARKET = '(?:gold|silver|copper|platinum|palladium|crude|oil|wti|brent|natural gas|nat ?gas|gasoline|heating oil|wheat|corn|soybeans?|soy|cotton|coffee|sugar|cocoa|cattle|hogs|lumber|treasur(?:y|ies)|bonds?|t-?notes?|10[- ]?y(?:ea)?r?|2[- ]?y(?:ea)?r?|5[- ]?y(?:ea)?r?|30[- ]?y(?:ea)?r?|euro|yen|pound|sterling|franc|aussie|loonie|peso|dollar|dxy|bitcoin|ether(?:eum)?|vix|s ?& ?p|s and p|nasdaq|dow|russell|nikkei|futures)'
export const COT_ROUTE_WORDS = [
  /\bcot\b|\bcommitments? of traders\b|\bcftc\b/,
  /\b(?:large|small|big|non-?commercial)[\s-]+spec(?:ulator)?s?\b|\bmanaged money\b|\bhedge funds?\b.*\b(?:net )?(?:long|short)\b.*\bfutures\b/,
  new RegExp(`\\b(?:speculators?|specs|commercials|hedgers)\\b.*\\b(?:net|long|short|positioned|positioning|crowded|extreme)\\b|\\b(?:net|long|short|positioned|positioning|crowded)\\b.*\\b(?:speculators?|specs|commercials|hedgers)\\b`),
  new RegExp(`\\b(?:positioning|positioned|net (?:long|short)|open interest)\\b.*\\b${MARKET}\\b|\\b${MARKET}\\b.*\\b(?:positioning|positioned|net (?:long|short)|open interest)\\b`),
]
const cotGroup = () => GROUPS.find(g => g.id === 'cot')
function armRoutes(on) {
  const g = cotGroup()
  if (g) g.words.splice(0, g.words.length, ...(on ? COT_ROUTE_WORDS : []))
}

let registered = false
let unregister = null
/** Idempotent; registers cot.positioning ONLY while the server serves `cot.positioning` (builtins.registerServerGatedBuiltins). */
export function registerCotCapability() {
  if (registered || !cotServed()) return false
  registered = true
  armRoutes(true)
  const un = registerCapability({
    name: CAPABILITY,
    surfaces: ['*'],
    target: 'market', query: true,
    summary: 'CFTC Commitments of Traders (COT) positioning for 1–6 futures markets: large speculators, commercials, small speculators net and open interest; '
      + 'week-over-week or N-week change; where it sits in its own N-year history (range, percentile, high / low); several markets side by side. Weekly, report-dated.',
    hints: 'target = the ref of the stockData entry. markets = the member\'s words or COT codes ("gold", "crude", "the S&P", "10-year", "euro", GC); '
      + 'group: large_specs|commercials|small_specs|open_interest (null = all); change_weeks: N for an N-week change (null = week over week only); '
      + 'lookback_years 1–10 (null = 3). Not for prices or stock positioning. reply: one short line, no figures.',
    args: {
      type: 'object',
      properties: {
        markets: { type: 'array', items: { type: 'string' } },
        group: { type: ['string', 'null'], enum: [...GROUP_KEYS, null] },
        change_weeks: { type: ['integer', 'null'] },
        lookback_years: { type: ['integer', 'null'] },
      },
      required: ['markets', 'group', 'change_weeks', 'lookback_years'], additionalProperties: false,
    },
    answer: (_snap, args) => answerCot(args || {}),
  })
  unregister = () => { un?.(); armRoutes(false) }
  return true
}
export const _resetCotForTest = () => { if (unregister) unregister(); else armRoutes(false); unregister = null; registered = false }
