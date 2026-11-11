// UCT Agent market data — the four server-only MD-1 kinds wired to capabilities (W1-C C-02, builder-c), plus the
// gateway quote helpers the legacy stock.profile / alert.create reads use instead of /api/live-prices (C-04).
// Contract: MD-1 §3 (freshness wording) and §4.2 / §4.3 (the kinds' own shapes).
//
//   fundamentals  → stock.profile    periodic financial disclosures; as_of = the newest period end
//   earnings      → stock.earnings   reported quarters (no report date, so as_of is null) + the next scheduled report
//   news.company  → news.latest      UCT's news store, newest item first; stale = ingest health, not a quiet company
//   themes        → stock.themes     equal-weight theme returns; never worded as live (a server-gated capability)
//   quote/quotes  → stock.profile's price line and alert.create's "already reached" check
//
// Every read goes through marketdata/client.js (POST /api/agent/data) with the member's open turn id, and only
// { text, table, present, link, chart } leave this module: never the envelope, its notes array or provider fields.
// Freshness is said from the envelope's own flags and data (`freshness`, `stale`, `as_of`, `fetched_at`, coverage),
// never by echoing notes (agent-qa F-20): "live" appears only for a live, non-stale quote row; periodic data names the
// period or session it describes and says it is not live.
//
// Dark by construction: a kind the server does not list in `data_kinds` (UCT_AGENT_DATA_KINDS, fail-closed) is not
// served — `kindServed` is false, the legacy capability keeps its own route, and `registerMarketFactsCapabilities`
// registers nothing (the model's manifest is unchanged).

import { registerCapability } from '../capabilities'
import * as agentClient from '../agentClient'
import { readData } from '../marketdata/client'
import { currentTurnId } from '../trace'
import { num, money, signedPct } from './marketDataFormat'
import { formatCompact, TERMINAL_COMPACT_TIERS } from '../../lib/presentation/presentationPrimitives'

export const THEMES_CAPABILITY = 'stock.themes'
const ET = 'America/New_York'
const LIVE_SOURCES = new Set(['trade', 'minute'])
const BIG_TIERS = TERMINAL_COMPACT_TIERS.filter((t) => t.at >= 1e6)
export const PERIODS = ['1d', '1w', '1m', '3m', '1y', 'ytd']
const PERIOD_WORDS = { '1d': 'one session', '1w': 'one week', '1m': 'one month', '3m': 'three months', '1y': 'one year', ytd: 'the year to date' }

/** Is this kind served by THIS server (data gateway on AND the kind listed in `data_kinds`)? Fail closed. */
export function kindServed(kind) {
  if (!agentClient.serverServesData()) return false
  const kinds = typeof agentClient.serverDataKinds === 'function' ? agentClient.serverDataKinds() : null
  return Array.isArray(kinds) && kinds.includes(kind)
}

const usable = (env) => !!env && (env.status === 'ok' || env.status === 'partial') && env.data && typeof env.data === 'object'
const NO_TURN = "this needs the Agent's turn, which wasn't available"

// ── formatting (local to this module; the same ladders stock.js uses) ──
const big = (v) => {
  if (num(v) == null) return null
  return Math.abs(v) >= 1e6 ? formatCompact(v, { tiers: BIG_TIERS, prefix: '$', absent: null }) : money(v)
}
const etDay = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: ET, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
const etTime = (d) => new Intl.DateTimeFormat('en-US', { timeZone: ET, hour: 'numeric', minute: '2-digit' }).format(d)
const etDate = (d) => new Intl.DateTimeFormat('en-US', { timeZone: ET, weekday: 'short', month: 'short', day: 'numeric' }).format(d)
/** "10:31 AM ET", or "Fri, Oct 30, 7:59 PM ET" when the stamp is not on the read's own ET day (ref = fetched_at). */
export function stampET(iso, refIso) {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const ref = refIso ? new Date(refIso) : null
  const sameDay = ref && !Number.isNaN(ref.getTime()) && etDay(ref) === etDay(d)
  return sameDay ? `${etTime(d)} ET` : `${etDate(d)}, ${etTime(d)} ET`
}
/** A date-only ISO ("2026-07-31" or "2026-07-31T00:00:00Z") → "Jul 31, 2026". */
export const dayOf = (iso) => {
  if (!iso) return null
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00Z`)
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}
const daysBetween = (aIso, bIso) => {
  const a = new Date(aIso); const b = new Date(bIso)
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null
  return Math.floor((b.getTime() - a.getTime()) / 86400000)
}
const researchLink = (sym) => ({ href: `/research/${encodeURIComponent(sym)}`, label: `Open ${sym} in Research` })

// ── quote / quotes (C-04: the legacy reads' replacement) ──────────────────────────────────────────────────────────────

/** One row of a quote/quotes read → { price, changePct, when, live } (pure). */
export function quoteRowFacts(env, row) {
  if (!row || num(row.last) == null) return null
  const live = env.freshness === 'live' && !env.stale && LIVE_SOURCES.has(row.last_source)
  return { price: row.last, changePct: num(row.change_pct), when: stampET(row.as_of || env.as_of, env.fetched_at), live }
}

/** stock.profile's price: ONE `quote` read for the open turn → { price, changePct, when, live } | null (no number). */
export async function readQuoteRow(symbol) {
  if (!kindServed('quote')) return null
  const turnId = currentTurnId()
  if (!turnId) return null
  const env = await readData('quote', { symbol }, { purpose: 'answer', turnId })
  if (!usable(env)) return null
  return quoteRowFacts(env, env.data.quote)
}

/** alert.create's check: ONE `quotes` read → { SYM: last } for the rows that carry a price; {} when nothing can be read. */
export async function readQuoteMap(symbols) {
  if (!symbols.length || !kindServed('quotes')) return {}
  const turnId = currentTurnId()
  if (!turnId) return {}
  const env = await readData('quotes', { symbols }, { purpose: 'answer', turnId })
  if (!usable(env)) return {}
  const out = {}
  for (const r of Array.isArray(env.data.quotes) ? env.data.quotes : []) {
    if (r && typeof r.symbol === 'string' && num(r.last) != null && r.last > 0) out[r.symbol] = r.last
  }
  return out
}

/** The price line stock.profile prints from a gateway quote (pure): "live" only for a live, non-stale trade. */
export function quoteLine(q) {
  const chg = q.changePct != null ? `, ${signedPct(q.changePct)} vs the previous close` : ''
  return q.live
    ? `Price ${money(q.price)}${chg} — live${q.when ? `, as of ${q.when}` : ''}`
    : `Price ${money(q.price)}${chg}${q.when ? ` — as of ${q.when}` : ''}, not a real-time price`
}

// ── fundamentals → stock.profile ─────────────────────────────────────────────────────────────────────────────────────

const STATEMENTS = [['income', 'Income statement'], ['balance', 'Balance sheet'], ['cashflow', 'Cash flow']]
// the lines shown per statement: [value key, label, format, aka words for present.js]
const LINES = {
  income: [['revenue', 'Revenue', big, ['revenue', 'sales']], ['gross_profit', 'Gross profit', big, ['gross profit']],
    ['operating_income', 'Operating income', big, ['operating income']], ['net_income', 'Net income', big, ['net income', 'profit', 'earnings']],
    ['eps_diluted', 'EPS (diluted)', (v) => (num(v) == null ? null : `$${v.toFixed(2)}`), ['eps', 'earnings per share']]],
  balance: [['cash', 'Cash', big, ['cash']], ['total_assets', 'Total assets', big, ['assets']], ['total_debt', 'Total debt', big, ['debt']],
    ['equity', 'Shareholder equity', big, ['equity', 'book value']]],
  cashflow: [['operating_cf', 'Operating cash flow', big, ['operating cash flow', 'cash flow']], ['free_cash_flow', 'Free cash flow', big, ['free cash flow', 'fcf']],
    ['capex', 'Capital expenditure', big, ['capex']]],
}
const NO_FUNDAMENTALS = {
  refused: "that request wasn't allowed for this question, so its financial statements are not available",
  unavailable: "its financial statements are not available from UCT's market data",
}

/**
 * A `fundamentals` envelope → the FACTS BLOCK stock.profile appends under the member's profile (integrator decision
 * 2026-11-02: the profile is never degraded — the legacy snapshot fields stay, the gateway's statements are added with
 * MD-1 wording on the gateway part only). Pure; exported for tests. → { lines, items, source }
 */
export function fundamentalsFacts(env, symbol) {
  const sym = String(symbol || '').toUpperCase()
  if (!usable(env)) return { lines: [`Financial statements: ${NO_FUNDAMENTALS[env?.status] || NO_FUNDAMENTALS.unavailable}; no statement figure is stated.`], items: [], source: null }
  const d = env.data
  const period = d.period === 'annual' ? 'annual' : 'quarterly'
  const newest = dayOf(env.as_of)
  const lines = [`Financial statements (${period}, newest period ending ${newest || 'an undated period'}):`]
  const items = []
  const missing = []
  for (const [key, label] of STATEMENTS) {
    const rows = Array.isArray(d.statements?.[key]) ? d.statements[key] : []
    const latest = rows[0]
    if (!latest || !latest.values) { missing.push(label.toLowerCase()); continue }
    const parts = []
    for (const [k, lbl, fmt, aka] of LINES[key]) {
      const v = fmt(latest.values[k])
      if (v == null) continue
      parts.push(`${lbl} ${v}`)
      items.push({ label: lbl, value: v, note: `period ending ${dayOf(latest.period_end)}`, aka })
    }
    lines.push(`• ${label} (period ending ${dayOf(latest.period_end)}): ${parts.length ? parts.join(' · ') : 'no figures carried'}`)
  }
  if (missing.length) lines.push(`No ${missing.join(' or ')} data is carried for ${sym}.`)
  const age = env.as_of && env.fetched_at ? daysBetween(env.as_of, env.fetched_at) : null
  lines.push(`Periodic disclosures${d.currency && d.currency !== 'USD' ? ` in ${d.currency}` : ''}: the statement figures describe the reporting period ending ${newest || 'the period named above'}, not today.${env.stale && age != null ? ` Note: that period ended ${age} days ago, so a newer quarter may have been reported.` : ''}`)
  return { lines, items, source: 'statements from Yahoo Finance through the UCT data gateway' }
}

/** stock.profile's gateway facts: ONE `fundamentals` read for the open turn → fundamentalsFacts, or null when the kind
 *  is not served / no turn is open (the profile then carries its legacy fields alone, as before). */
export async function readFundamentalsFacts(symbol) {
  const sym = String(symbol || '').toUpperCase()
  if (!kindServed('fundamentals')) return null
  const turnId = currentTurnId()
  if (!turnId) return null
  const env = await readData('fundamentals', { symbol: sym, period: 'quarterly', periods: 4 }, { purpose: 'answer', turnId })
  return fundamentalsFacts(env, sym)
}
/** TERM-033: stock.profile's statements block when the read itself FAILED (it threw). Said in the profile and logged
 *  with its cause, with no statement figure; distinct from `null` above (not served / no open turn), where the profile
 *  carries its snapshot fields alone. -> { lines, items, source } like fundamentalsFacts. */
export function fundamentalsUnread(symbol, e) {
  const sym = String(symbol || '').toUpperCase()
  console.warn(`[uct-agent] stock.profile: the fundamentals read for ${sym} failed (${e?.message || 'error'}); the profile says so and states no statement figure`)
  return { lines: [`Financial statements: I couldn't read ${sym}'s financial statements from UCT's data gateway right now; no statement figure is stated.`], items: [], source: null }
}

// ── earnings → stock.earnings ────────────────────────────────────────────────────────────────────────────────────────

const NO_EARNINGS = {
  refused: "that request wasn't allowed for this question, so its earnings are not available",
  unavailable: "its reported earnings are not available from UCT's market data",
}
const eps = (v) => (num(v) == null ? null : `$${v.toFixed(2)}`)
/** the next report's own status word from the kind (`kind`: scheduled today; confirmed / estimated only if the gateway says so) */
const nextStatus = (n) => (['confirmed', 'estimated'].includes(String(n?.kind || '').toLowerCase()) ? String(n.kind).toLowerCase() : 'scheduled')

/** An `earnings` envelope → the member's answer (pure; exported for tests). */
export function answerFromEarnings(env, symbol) {
  const sym = String(symbol || '').toUpperCase()
  if (!usable(env)) return { text: `I couldn't read ${sym}'s earnings: ${NO_EARNINGS[env?.status] || NO_EARNINGS.unavailable}. No figure is stated.` }
  const d = env.data
  const reported = Array.isArray(d.reported) ? d.reported.filter(r => r && r.quarter) : []
  const q = reported[reported.length - 1]
  const n = d.next_report
  // W1.1 R-06 (live LT-12): "when does nvda report" showed the reported-figures card with the next date buried under
  // Details. The LEAD line (present.js shows lines[0] as the card's summary) carries the next report date whenever the
  // kind serves one: "<date> (<quarter>, scheduled)" — the kind's own `kind` word (scheduled; confirmed / estimated if
  // the gateway ever says so), never a status it does not carry.
  const nextLead = n && n.report_date ? `next report: ${dayOf(n.report_date)} (${[n.quarter, nextStatus(n)].filter(Boolean).join(', ')})` : null
  const lines = [nextLead ? `${sym} earnings — ${nextLead}` : `${sym} earnings (reported figures)`]
  if (!q) lines.push(`No reported quarter is available for ${sym}.`)
  else {
    lines.push(`Latest reported quarter: ${q.quarter}`)
    const rev = big(q.rev_actual); const revEst = big(q.rev_estimate)
    lines.push(`• Revenue ${rev || 'not available'}${revEst ? ` vs ${revEst} estimated${num(q.rev_surprise_pct) != null ? ` (${signedPct(q.rev_surprise_pct)} surprise)` : ''}` : ' (no comparable estimate)'}`)
    const e = eps(q.eps_actual); const eEst = eps(q.eps_estimate)
    lines.push(`• EPS ${e || 'not available'}${eEst ? ` vs ${eEst} estimated${num(q.eps_surprise_pct) != null ? ` (${signedPct(q.eps_surprise_pct)} surprise)` : ''}` : ' (no comparable estimate)'}`)
  }
  if (n && n.report_date) {
    const est = [eps(n.eps_estimate) ? `EPS est. ${eps(n.eps_estimate)}` : null, big(n.rev_estimate) ? `revenue est. ${big(n.rev_estimate)}` : null].filter(Boolean)
    lines.push(`Next report: scheduled for ${dayOf(n.report_date)}${n.quarter ? ` (${n.quarter})` : ''}${est.length ? ` · ${est.join(', ')}` : ''} — a scheduled event, not a result.`)
  } else lines.push("Next report date: not available in UCT's earnings data.")
  lines.push(`Reported quarters carry no report date in UCT's earnings data; reported through ${d.reported_through || (q ? q.quarter : 'no quarter')}.${env.stale ? ` Note: these results are ${num(d.quarters_behind) ?? 'two or more'} quarters behind what a typical filer has reported by now.` : ''}`)
  lines.push('Source: UCT earnings data through the UCT data gateway. Estimates are consensus figures; actuals are as reported.')
  return { text: lines.join('\n'), link: researchLink(sym), chart: { symbol: sym, label: sym } }
}

export async function answerEarningsServed(symbol) {
  const sym = String(symbol || '').toUpperCase()
  const turnId = currentTurnId()
  if (!turnId) return `I couldn't read ${sym}'s earnings: ${NO_TURN}.`
  const env = await readData('earnings', { symbol: sym }, { purpose: 'answer', turnId })
  return answerFromEarnings(env, sym)
}

// ── news.company → news.latest ───────────────────────────────────────────────────────────────────────────────────────

export const NEWS_MAX = 15
const NO_NEWS = {
  refused: "that request wasn't allowed for this question, so its news is not available",
  unavailable: "its stored news is not available from UCT's market data",
}
const clip = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t }

/** A `news.company` envelope → the member's answer (pure; exported for tests). */
export function answerFromNews(env, symbol) {
  const sym = String(symbol || '').toUpperCase()
  if (!usable(env)) return { text: `I couldn't read ${sym}'s news: ${NO_NEWS[env?.status] || NO_NEWS.unavailable}.` }
  const items = (Array.isArray(env.data.items) ? env.data.items : []).filter(i => i && i.headline)
  const ingest = env.stale ? " Note: UCT's news ingest hasn't succeeded for over an hour, so recent stories may be missing." : ''
  if (!items.length) return { text: `UCT has no stored news for ${sym} — that is not a sign of stale data.${ingest}`, link: researchLink(sym) }
  const rows = items.map(i => ({ when: stampET(i.as_of, env.fetched_at) || '—', headline: clip(i.headline, 140), source: i.source || '—', tone: i.sentiment || '—' }))
  const newest = stampET(env.as_of, env.fetched_at)
  const age = env.as_of && env.fetched_at ? daysBetween(env.as_of, env.fetched_at) : null
  const old = age != null && age > 3 ? ` — the newest is ${age} days old, so this is not breaking news.` : '.'
  const head = `Latest ${items.length} headline${items.length === 1 ? '' : 's'} UCT has stored for ${sym}${newest ? ` (newest published ${newest})` : ''}${old}${ingest}`
  return {
    text: `${head}\nSource: UCT's news store through the UCT data gateway (not a live web search); tone is UCT's rule-based tag.`,
    table: { columns: [{ key: 'when', label: 'Published' }, { key: 'headline', label: 'Headline' }, { key: 'source', label: 'Source' }, { key: 'tone', label: 'Tone' }], rows },
    link: researchLink(sym),
    present: {
      kind: 'headlines', title: `${sym} — latest headlines`,
      headlines: rows.map(r => ({ title: r.headline, meta: [r.when, r.source !== '—' ? r.source : null].filter(Boolean).join(' · ') })),
      source: `From UCT's news store (not a live web search)${age != null && age > 3 ? ` — the newest is ${age} days old` : ''}.`,
    },
  }
}

export async function answerNewsServed(symbol, limit) {
  const sym = String(symbol || '').toUpperCase()
  const turnId = currentTurnId()
  if (!turnId) return `I couldn't read ${sym}'s news: ${NO_TURN}.`
  const n = Math.min(Math.max(Number(limit) || 8, 1), NEWS_MAX)
  const env = await readData('news.company', { symbol: sym, limit: n }, { purpose: 'answer', turnId })
  return answerFromNews(env, sym)
}

// ── themes → stock.themes (server-gated capability) ─────────────────────────────────────────────────────────────────

const NO_THEMES = {
  refused: "that request wasn't allowed for this question, so theme returns are not available",
  unavailable: "theme returns are not available from UCT's market data right now (the theme data may still be warming)",
}

/** A `themes` envelope → the member's answer (pure; exported for tests). */
export function answerFromThemes(env, { period = '1d', order = 'leaders' } = {}) {
  if (!usable(env)) return { text: `I couldn't read UCT's theme returns: ${NO_THEMES[env?.status] || NO_THEMES.unavailable}. No figure is stated.` }
  const d = env.data
  const p = PERIODS.includes(d.period) ? d.period : period
  const o = d.order === 'laggards' ? 'laggards' : order
  const rows = (Array.isArray(d.themes) ? d.themes : []).filter(t => t && num(t.return_pct) != null).map(t => ({
    theme: t.name || t.ticker || '—', ret: signedPct(t.return_pct), sector: t.sector || '—', holdings: num(t.holdings) != null ? String(t.holdings) : '—',
  }))
  if (!rows.length) return { text: `No UCT theme has a ${PERIOD_WORDS[p]} return yet.` }
  const when = env.as_of ? `as of the ${dayOf(env.as_of)} close` : (d.live_applied_at ? `including intraday prices UCT applied at ${stampET(d.live_applied_at, env.fetched_at)} — not a live feed` : 'at an unstated time')
  const cov = env.coverage
  const partial = cov && num(cov.not_computable) > 0 ? ` ${cov.not_computable} theme${cov.not_computable === 1 ? ' has' : 's have'} no ${PERIOD_WORDS[p]} return yet.` : ''
  const stale = env.stale ? ' Note: these returns were computed before the last completed session, so they are behind.' : ''
  const head = `Theme ${o} over ${PERIOD_WORDS[p]} (${when}): equal-weight returns of UCT's curated themes, not live prices.${partial}${stale}`
  return {
    text: `${head}\n${rows.map(r => `${r.theme} ${r.ret}`).join(' · ')}\nSource: UCT Theme Tracker through the UCT data gateway.`,
    table: { columns: [{ key: 'theme', label: 'Theme' }, { key: 'ret', label: `Return (${p})` }, { key: 'sector', label: 'Sector' }, { key: 'holdings', label: 'Holdings' }], rows },
    link: { href: '/themes', label: 'Open the Theme Tracker' },
    present: { kind: 'metrics', title: `Theme ${o} — ${PERIOD_WORDS[p]}`, short: `${o} ${p}`, items: rows.slice(0, 10).map(r => ({ label: r.theme, value: r.ret, note: when, aka: [r.theme.toLowerCase()] })) },
  }
}

export async function answerThemes(args = {}) {
  const period = PERIODS.includes(args.period) ? args.period : '1d'
  const order = args.order === 'laggards' ? 'laggards' : 'leaders'
  const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 30)
  const turnId = currentTurnId()
  if (!turnId) return `I couldn't read UCT's theme returns: ${NO_TURN}.`
  const env = await readData('themes', { period, order, limit }, { purpose: 'answer', turnId })
  return answerFromThemes(env, { period, order })
}

let registered = false
let unregister = null
/** Idempotent; registers stock.themes ONLY while the server serves `themes` (builtins.registerServerGatedBuiltins).
 *  The other three kinds need no registration: stock.profile, stock.earnings and news.latest already exist and take the
 *  gateway path inside their own answers when their kind is served. Returns true when THIS call registered. */
export function registerMarketFactsCapabilities() {
  if (registered || !kindServed('themes')) return false
  registered = true
  unregister = registerCapability({
    name: THEMES_CAPABILITY,
    surfaces: ['*'],
    target: 'market', query: true,
    summary: 'Show which of UCT\'s curated themes are leading or lagging over a period (1d, 1w, 1m, 3m, 1y, ytd): equal-weight theme returns '
      + 'from UCT\'s Theme Tracker. Use this (disposition apply, research null) for "which themes are leading this week?", "worst themes this month".',
    hints: 'target = the ref of the stockData entry. period: 1d|1w|1m|3m|1y|ytd (null = 1d); order: leaders|laggards (null = leaders); limit: rows (null = 10, at most 30). '
      + 'Not for one stock\'s theme membership or for why a theme is moving (research).',
    args: {
      type: 'object',
      properties: { period: { type: ['string', 'null'], enum: [...PERIODS, null] }, order: { type: ['string', 'null'], enum: ['leaders', 'laggards', null] }, limit: { type: ['integer', 'null'] } },
      required: ['period', 'order', 'limit'], additionalProperties: false,
    },
    answer: (_snap, args) => answerThemes(args || {}),
  })
  return true
}
export const _resetFactsForTest = () => { if (unregister) unregister(); unregister = null; registered = false }
