// UCT Agent — relative strength + leadership (Phase 2 market intelligence), one generalized capability.
//
//   rs.compare  a stock's or ETF's UCT RS Rating and how it changed over 5 / 20 sessions, its return vs SPY over the
//               SAME window, its rank inside its own industry; several tickers side by side; the 11 SPDR sector ETFs
//               ranked over 1W / 1M / 3M / 6M; one industry group's rating distribution and whether it rose or fell;
//               or the market backdrop (index ETFs + sector leadership + the breadth reading, each with its own date).
//
// DATA: ONE `rs.leadership` gateway read (api/services/uct_agent/marketdata/rs_leadership.py — the nightly RS Rating
// table, the bars store and the industry map, every figure computed there), plus, for the backdrop only, the existing
// `breadth.current` reads (% of US stocks above the 50- and 200-day SMA) when the server serves that kind.
// GROUNDING: the member's answer is templated from `facts` (returned beside it): every number in the text is a fact's
// number, or part of a date / label of one. Nothing here derives a new statistic beyond a difference the text states.
// ⛔ LOCAL ONLY (`localOnly: true`, turn.LOCAL_ONLY_ACTIONS): the RS Rating is UCT-derived and `rs.leadership` is
// model-isolated (ADR-005), so the model plans the lookup and never sees what came back.
//
// Dark by construction: registered only while the server serves the `rs.leadership` kind (UCT_AGENT_DATA_KINDS,
// fail-closed). Its routing group's words are armed only while it is registered (routing.js keeps them empty), so a
// dark server routes exactly as before.

import { registerCapability } from '../capabilities'
import * as agentClient from '../agentClient'
import { readData } from '../marketdata/client'
import { currentTurnId } from '../trace'
import { GROUPS } from '../routing'

export const CAPABILITY = 'rs.compare'
export const KIND = 'rs.leadership'
export const SCOPES = ['symbols', 'sectors', 'industry', 'backdrop']
export const PERIODS = ['1W', '1M', '3M', '6M']
const PERIOD_WORD = { '1W': '1-week', '1M': '1-month', '3M': '3-month', '6M': '6-month' }
const PERIOD_N = { '1W': 1, '1M': 1, '3M': 3, '6M': 6 }
export const MAX_SYMBOLS = 6
const BREADTH_METRICS = [['pct_above_50sma', 50], ['pct_above_200sma', 200]]

export const METHOD = 'UCT RS Rating: a nightly 1-99 rating of weighted 3-, 6-, 9- and 12-month price performance (the latest quarter counts double) '
  + 'ranked against every rated US stock; ETFs are placed on the same scale. Returns are from completed daily sessions in UCT\'s bars store.'
export const LIMITS = 'Limits: ratings are nightly (no intraday RS); industry groups are the Finviz taxonomy in UCT\'s group map and industry figures use '
  + 'ratings only; sectors are the 11 SPDR Select Sector ETFs. This is a historical observation of stored data, not a forecast or a trading signal.'
const NO_TURN = "this needs the Agent's turn, which wasn't available"
const NO_READ = {
  refused: "that request wasn't allowed for this question, so no RS data was read",
  unavailable: "UCT's RS data could not answer it right now",
}

export function rsServed() {
  if (!agentClient.serverServesData()) return false
  const kinds = typeof agentClient.serverDataKinds === 'function' ? agentClient.serverDataKinds() : null
  return Array.isArray(kinds) && kinds.includes(KIND)
}
const breadthServed = () => {
  const kinds = typeof agentClient.serverDataKinds === 'function' ? agentClient.serverDataKinds() : null
  return Array.isArray(kinds) && kinds.includes('breadth.current')
}

// ── formatting (pure) ──────────────────────────────────────────────────────────────────────────────────────────────────
/** "2026-11-12" → "Nov 12, 2026" (a calendar date: noon UTC, so no zone moves it). */
export function dayText(ymd) {
  if (typeof ymd !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(`${ymd}T12:00:00Z`))
}
const fin = (v) => typeof v === 'number' && Number.isFinite(v)
const sgn = (v, d = 2) => (fin(v) ? `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(d)}` : 'n/a')
const sgnInt = (v) => (fin(v) ? `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v)}` : 'n/a')
const ordinal = (n) => { const s = ['th', 'st', 'nd', 'rd']; const v = n % 100; return `${n}${s[(v - 20) % 10] || s[v] || s[0]}` }
const nameOf = (r) => (r.label ? `${r.label} (${r.symbol})` : r.symbol)

// ── the facts (pure; exported for tests) ──────────────────────────────────────────────────────────────────────────────
/** one row's facts: the server's figures, plus the two prior ratings the text states (rating − d5, rating − d20) */
export function rowFacts(r) {
  if (!r || typeof r !== 'object') return null
  return {
    symbol: r.symbol, label: r.label || null, is_etf: !!r.is_etf, rated: !!r.rated,
    rating: fin(r.rating) ? r.rating : null, d5: fin(r.d5) ? r.d5 : null, d20: fin(r.d20) ? r.d20 : null,
    rating_5_ago: fin(r.rating) && fin(r.d5) ? r.rating - r.d5 : null, rating_20_ago: fin(r.rating) && fin(r.d20) ? r.rating - r.d20 : null,
    components: { m1: r.m1 ?? null, m3: r.m3 ?? null, m6: r.m6 ?? null, m12: r.m12 ?? null },
    return: r.return && fin(r.return.pct) ? { pct: r.return.pct, from: r.return.from, to: r.return.to } : null,
    vs_spy: fin(r.vs_spy) ? r.vs_spy : null, bars_through: r.bars_through || null, bars_stale: !!r.bars_stale,
    sector: r.sector || null, industry: r.industry || null,
    industry_context: r.industry_context || null,
  }
}

function ratingLine(f) {
  if (!f.rated) return `${f.symbol}: no UCT RS Rating is stored`
  const parts = [`UCT RS Rating ${f.rating}`]
  if (f.rating_5_ago != null) parts.push(`5 sessions earlier ${f.rating_5_ago} (${sgnInt(f.d5)})`)
  if (f.rating_20_ago != null) parts.push(`20 sessions earlier ${f.rating_20_ago} (${sgnInt(f.d20)})`)
  return parts.join('; ')
}
function returnText(f, period) {
  if (!f.return) return `${PERIOD_WORD[period]} return n/a (not enough completed sessions held)`
  const vs = f.vs_spy != null ? `, ${sgn(f.vs_spy)} pts vs SPY over the same window` : f.symbol === 'SPY' ? '' : ' (no SPY comparison: different window)'
  return `${PERIOD_WORD[period]} return ${sgn(f.return.pct)}% (${dayText(f.return.from)} → ${dayText(f.return.to)})${vs}`
}
function componentsText(c) {
  const p = [['m1', '1M'], ['m3', '3M'], ['m6', '6M'], ['m12', '12M']].filter(([k]) => fin(c[k])).map(([k, l]) => `${l} ${c[k]}`)
  return p.length ? `RS components (percentile): ${p.join(', ')}` : ''
}
function industryText(f) {
  const c = f.industry_context
  if (!f.industry) return f.is_etf ? '' : 'Industry: not in UCT\'s group map'
  if (!c || !c.rated) return `Industry: ${f.industry} (no rated members stored)`
  const rank = c.focus ? `ranks ${ordinal(c.focus.rank)} of ${c.rated} rated members` : `is not rated among its ${c.rated} rated members`
  const move = c.median_paired_20_ago != null
    ? `; over the ${c.paired_20} members rated both now and 20 sessions earlier, the median went from ${c.median_paired_20_ago} to ${c.median_paired_now}`
    : ''
  return `Industry: ${f.industry} — ${f.symbol} ${rank}; industry median rating ${c.median}${move}`
}
function trendWord(change) {
  if (!fin(change)) return null
  return change > 0 ? 'higher than' : change < 0 ? 'lower than' : 'unchanged from'
}

/** The `rs.leadership` envelope (+ optional breadth envelopes) → the member's answer + its facts (pure; exported for tests). */
export function answerFromRs(envl, { breadth = [] } = {}) {
  const usable = !!envl && (envl.status === 'ok' || envl.status === 'partial') && envl.data && typeof envl.data === 'object'
  if (!usable) return { text: `I couldn't read UCT's relative-strength data: ${NO_READ[envl?.status] || NO_READ.unavailable}. No figure is stated.` }
  const d = envl.data
  const period = PERIODS.includes(d.period) ? d.period : '1M'
  const session = d.rating_session || null
  // the method's own constants, so the grounding rail can tell every number in the text (METHOD / LIMITS included) from a fact
  const method = { change_sessions: [5, 20], leader_rating: d.leader_rating ?? 80, period_n: PERIOD_N[period], sessions: d.sessions, components: [1, 3, 6, 12],
    scale: [1, 99], terms_months: [3, 6, 9, 12], sector_etfs: 11 }
  const lines = []
  const facts = { scope: d.scope, period, rating_session: session, ratings_stale: !!d.ratings_stale, stale: !!envl.stale,
    latest_completed_session: d.latest_completed_session || null, method }
  const asOf = session ? `UCT RS Rating session ${dayText(session)}` : 'no stored RS Rating'
  const link = { href: '/screener', label: 'Open the Screener' }

  if (d.scope === 'industry') {
    if (!d.industry) {
      const cands = Array.isArray(d.candidates) ? d.candidates : []
      facts.industry = null; facts.candidates = cands
      lines.push(cands.length
        ? `"${d.asked}" matches several industries in UCT's group map: ${cands.join('; ')}. Which one? No figure is stated.`
        : `UCT's group map has no industry matching "${d.asked}", so no figure is stated.`)
      return { text: lines.join('\n'), facts }
    }
    const c = d.cohort || {}
    facts.industry = d.industry; facts.cohort = c
    if (!c.rated) {
      lines.push(`${d.industry}: none of its ${c.members ?? 0} mapped members carries a stored UCT RS Rating, so no figure is stated.`)
      return { text: lines.join('\n'), facts }
    }
    lines.push(`${d.industry} (UCT industry group, ${asOf}): ${c.rated} of ${c.members} mapped members carry a rating; median ${c.median}; ${c.at_or_above_80} rated ${method.leader_rating}+.`)
    if (c.median_paired_20_ago != null) {
      lines.push(`Over the ${c.paired_20} members rated both now and 20 sessions earlier, the median rating is ${c.median_paired_now}, ${trendWord(c.median_change_20)} ${c.median_paired_20_ago} then (${sgn(c.median_change_20, 1)}); ${c.rising_20} rose, ${c.falling_20} fell.`)
    } else lines.push('No rating 20 sessions earlier is stored for its members, so no change is stated.')
    if (Array.isArray(c.top) && c.top.length) lines.push(`Highest rated: ${c.top.map(t => `${t.symbol} ${t.rating}`).join(', ')}.`)
  } else if (d.scope === 'symbols') {
    const rows = (Array.isArray(d.rows) ? d.rows : []).map(rowFacts).filter(Boolean)
    facts.rows = rows
    for (const f of rows) {
      const segs = [ratingLine(f)]
      if (f.rated) { const comp = componentsText(f.components); if (comp) segs.push(comp) }
      segs.push(returnText(f, period))
      const ind = industryText(f)
      if (ind) segs.push(ind)
      if (f.bars_stale) segs.push(`bars only through ${dayText(f.bars_through)}`)
      lines.push(`• ${f.symbol} (${asOf}): ${segs.join('. ')}.`)
    }
  } else {
    // sectors / backdrop
    const sect = (Array.isArray(d.sectors) ? d.sectors : []).map(rowFacts).filter(Boolean)
    const idx = (Array.isArray(d.indices) ? d.indices : []).map(rowFacts).filter(Boolean)
    facts.sectors = sect.map((f, i) => ({ ...f, rank: i + 1 }))
    facts.indices = idx
    const win = sect.find(f => f.return)?.return || idx.find(f => f.return)?.return
    const winText = win ? ` (${dayText(win.from)} → ${dayText(win.to)}, completed sessions)` : ''
    if (d.scope === 'backdrop') {
      lines.push(`Market backdrop — historical, ${PERIOD_WORD[period]} window${winText}:`)
      if (idx.length) lines.push(`• Index ETFs: ${idx.map(f => `${f.symbol} ${f.return ? `${sgn(f.return.pct)}%` : 'n/a'}${f.vs_spy != null ? ` (${sgn(f.vs_spy)} pts vs SPY)` : ''}${f.rated ? `, RS ${f.rating}` : ''}`).join('; ')}.`)
      const ranked = sect.filter(f => f.return)
      const lag = ranked.slice(Math.max(3, ranked.length - 3)).reverse()          // never a leader listed again as a laggard
      if (ranked.length) {
        lines.push(`• Sector leaders: ${ranked.slice(0, 3).map(f => `${nameOf(f)} ${sgn(f.return.pct)}%`).join(', ')}; laggards: ${lag.length ? lag.map(f => `${nameOf(f)} ${sgn(f.return.pct)}%`).join(', ') : 'none beyond the leaders'} (SPDR sector ETFs, ${asOf} for ratings).`)
      } else lines.push('• Sector leadership: no sector returns are held for this window.')
    } else {
      lines.push(`Sector leadership — the ${sect.length} SPDR sector ETFs ranked by ${PERIOD_WORD[period]} return${winText}, with their UCT RS Rating (${asOf}):`)
      sect.forEach((f, i) => {
        const ret = f.return ? `${sgn(f.return.pct)}%${f.vs_spy != null ? ` (${sgn(f.vs_spy)} pts vs SPY)` : ''}` : 'return n/a'
        const rs = f.rated ? `RS ${f.rating}${f.d20 != null ? ` (${sgnInt(f.d20)} over 20 sessions)` : ''}` : 'no RS Rating'
        lines.push(`${i + 1}. ${nameOf(f)}: ${ret}; ${rs}.`)
      })
    }
    const bench = rowFacts(d.benchmark_row)
    if (bench && bench.return && d.scope === 'sectors') lines.push(`SPY over the same window: ${sgn(bench.return.pct)}%.`)
    facts.benchmark = bench
    facts.table = null
  }

  // the breadth backdrop (breadth.current, its own source and label)
  if (d.scope === 'backdrop') {
    const b = []
    for (const [metric, days] of BREADTH_METRICS) {
      const e = breadth.find(x => x?.data?.metric === metric)
      if (e && (e.status === 'ok' || e.status === 'partial') && fin(e.data?.value)) b.push({ metric, days, value: e.data.value, label: e.data.label || null, session: e.data.session || null, current: !!e.data.current })
    }
    facts.breadth = b
    if (b.length) lines.push(`• US breadth (UCT breadth): ${b.map(x => `${x.value}% of stocks above their ${x.days}-day SMA${x.label ? ` (${x.label})` : ''}`).join('; ')}${b.some(x => !x.current) ? ' — not a current reading' : ''}.`)
    else lines.push('• US breadth: not available to the Agent right now, so no breadth figure is stated.')
  }

  if (envl.stale) {
    lines.push(d.ratings_stale
      ? `Stale: the newest stored RS Rating session is ${dayText(session)}, older than the ratings' freshness rule allows; the latest completed session is ${dayText(d.latest_completed_session)}.`
      : `Stale: some bars end before the latest completed session (${dayText(d.latest_completed_session)}).`)
  }
  const missing = (facts.rows || []).filter(f => !f.rated && !f.return).map(f => f.symbol)
  if (missing.length) lines.push(`Not covered by UCT's stored RS or bars data: ${missing.join(', ')}.`)
  lines.push(`Source: UCT RS Rating table, UCT bars store${d.scope === 'symbols' || d.scope === 'industry' ? ', UCT industry group map' : ''}. ${METHOD} ${LIMITS}`)
  const table = tableFor(facts, period)
  return { text: lines.filter(Boolean).join('\n'), ...(table ? { table } : {}), facts, link }
}

function tableFor(facts, period) {
  const rows = facts.scope === 'symbols' ? facts.rows : facts.scope === 'sectors' ? facts.sectors : null
  if (!rows || rows.length < 2) return null
  return {
    columns: [{ key: 'name', label: facts.scope === 'sectors' ? 'Sector ETF' : 'Ticker' }, { key: 'ret', label: `${period} return` }, { key: 'vs', label: 'vs SPY (pts)' },
      { key: 'rs', label: 'RS Rating' }, { key: 'd20', label: 'RS chg 20s' }],
    rows: rows.map(f => ({ name: nameOf(f), ret: f.return ? `${sgn(f.return.pct)}%` : 'n/a', vs: f.vs_spy != null ? sgn(f.vs_spy) : 'n/a',
      rs: f.rated ? String(f.rating) : '—', d20: f.d20 != null ? sgnInt(f.d20) : '—' })),
  }
}

export async function answerRs(args = {}) {
  const scope = SCOPES.includes(args.scope) ? args.scope : null
  if (!scope) return { text: 'Which do you want: a ticker\'s RS (vs its industry or other tickers), the sector ranking, one industry group, or the market backdrop? No figure is stated.' }
  const period = PERIODS.includes(args.period) ? args.period : '1M'
  const params = { scope, period }
  if (scope === 'symbols') {
    const syms = (Array.isArray(args.symbols) ? args.symbols : []).map(s => String(s || '').trim().toUpperCase().replace(/^\$/, '')).filter(Boolean)
    if (!syms.length) return { text: 'Which ticker should I read the RS for? No figure is stated.' }
    params.symbols = [...new Set(syms)].slice(0, MAX_SYMBOLS)
  }
  if (scope === 'industry') {
    const ind = String(args.industry || '').trim()
    if (!ind) return { text: 'Which industry group should I read (for example semiconductors or regional banks)? No figure is stated.' }
    params.industry = ind.slice(0, 60)
  }
  const turnId = currentTurnId()
  if (!turnId) return { text: `I couldn't read UCT's relative-strength data: ${NO_TURN}.` }
  const envl = await readData('rs.leadership', params, { purpose: 'answer', turnId })   // a LITERAL: qa/modelIsolation reads it
  const breadth = []
  if (scope === 'backdrop' && breadthServed()) {
    for (const [metric] of BREADTH_METRICS) breadth.push(await readData('breadth.current', { universe: 'us', metric }, { purpose: 'answer', turnId }))
  }
  return answerFromRs(envl, { breadth })
}

// ── routing words (armed only while registered; routing.js keeps the group's words empty) ──────────────────────────────
// Never the RS INDICATOR on a chart (its pane, line, dots, view, rotation map) and never RSI.
const NOT_INDICATOR = '^(?!.*\\b(?:indicator|pane|line|dots?|rrg|rotation|colou?r|overlay)\\b)'
const RS = '\\b(?:rs|relative strength)\\b(?!\\s*index)'
const SECTOR_ETF = '(?:xlk|xlf|xle|xlv|xli|xly|xlp|xlb|xlre|xlu|xlc)'
const LEAD_ALT = 'lead|leads|leading|leaders?|leadership|lagging|laggards?|strongest|weakest|outperform\\w*|underperform\\w*'
export const RS_ROUTE_WORDS = [
  new RegExp(`${NOT_INDICATOR}.*${RS}.*\\b(?:rating|ratings|rank|ranks|ranking|compare[sd]?|comparison|vs\\.?|versus|against|industry|sector|peers|group|improving|improve[sd]?|rising|falling|deteriorating|weakening|strengthening|${LEAD_ALT})\\b`),
  new RegExp(`${NOT_INDICATOR}.*\\b(?:rating|rank|compare|how)\\b.*${RS}`),
  new RegExp(`\\bsectors?\\b.*\\b(?:${LEAD_ALT}|best|worst|strength)\\b|\\b(?:${LEAD_ALT}|best|worst)\\b.*\\bsectors?\\b`),
  new RegExp(`\\bindustr(?:y|ies)\\b.*\\b(?:${LEAD_ALT}|best|worst|improving|rs|relative strength)\\b|\\b(?:${LEAD_ALT}|best|worst)\\b.*\\b(?:industr(?:y|ies)|groups)\\b`),
  /\bmarket (?:backdrop|conditions?|environment|context|health)\b|\bbackdrop\b/,
  new RegExp(`\\b(?:compare|vs|versus|against|outperform\\w*|performance|performed|relative)\\b.*\\b${SECTOR_ETF}\\b|\\b${SECTOR_ETF}\\b.*\\b(?:vs|versus|compare[sd]?|outperform\\w*|performance|performed)\\b`),
]
const rsGroup = () => GROUPS.find(g => g.id === 'rs')
function armRoutes(on) {
  const g = rsGroup()
  if (g) g.words.splice(0, g.words.length, ...(on ? RS_ROUTE_WORDS : []))
}

let registered = false
let unregister = null
/** Idempotent; registers rs.compare ONLY while the server serves `rs.leadership` (builtins.registerServerGatedBuiltins). */
export function registerRsCapability() {
  if (registered || !rsServed()) return false
  registered = true
  armRoutes(true)
  const un = registerCapability({
    name: 'rs.compare',               // a LITERAL: the server's local-only mirror rail reads it (tests/test_uct_agent_breadth.py)
    surfaces: ['*'],
    target: 'market', query: true,
    localOnly: true,                  // ⛔ shown to the member; the model never sees a rating or a return (turn.LOCAL_ONLY_ACTIONS)
    summary: 'RELATIVE STRENGTH + LEADERSHIP from UCT\'s stored data: a ticker\'s UCT RS Rating and its 5/20-session change, return vs SPY, rank in its industry; '
      + 'several tickers side by side; the 11 SPDR sector ETFs ranked; one industry group\'s RS trend; or the market backdrop (index ETFs, sectors, breadth). Historical, no forecasts.',
    hints: 'target = the ref of the stockData entry. scope: symbols (1–6 tickers; a sector named alone = its SPDR ETF, e.g. tech XLK, energy XLE) | sectors '
      + '("which sectors are leading") | industry (industry = the member\'s words, e.g. "semis") | backdrop ("market backdrop / conditions"). '
      + 'period 1W|1M|3M|6M (null = 1M; "this month" = 1M). symbols / industry null when not that scope. Not for the RS indicator on a chart. reply: one short line, no figures.',
    args: {
      type: 'object',
      properties: {
        scope: { type: 'string', enum: SCOPES },
        symbols: { type: ['array', 'null'], items: { type: 'string' } },
        industry: { type: ['string', 'null'] },
        period: { type: ['string', 'null'], enum: [...PERIODS, null] },
      },
      required: ['scope', 'symbols', 'industry', 'period'], additionalProperties: false,
    },
    answer: (_snap, args) => answerRs(args || {}),
  })
  unregister = () => { un?.(); armRoutes(false) }
  return true
}
export const _resetRsForTest = () => { if (unregister) unregister(); else armRoutes(false); unregister = null; registered = false }
