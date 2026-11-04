// UCT Agent — `stock.relativeStrength` (Track D workflow "relativeStrength", DARK): how ONE stock has done against a
// benchmark (SPY unless the member names one — a sector ETF such as XLK or SMH, an index fund, another stock) over
// completed daily sessions.
//
// "NVDA relative strength vs SPY", "is AMD outperforming the market over the last 20 days", "relative strength of TSLA
// against QQQ over 3 months": answered DETERMINISTICALLY from TWO MD-1 `bars.daily` reads (the stock and the benchmark,
// one `instrument.resolve` first) through the gateway. No model call, no fetch of its own, no provider call (the kind
// reads UCT's canonical bars store), completed sessions only.
//
// The computation (pure, `relativeStrengthOf`): the two series are ALIGNED on the session dates both hold (a date one
// lacks is not used), and for each window of n sessions ending at the last common session:
//   stock %       close[last] / close[last − n] − 1                       (×100)
//   benchmark %   the same over the benchmark's closes on the same dates
//   difference    stock % − benchmark %                                    (percentage points)
//   ratio change  (stock / benchmark)[last] / (stock / benchmark)[last − n] − 1   (×100) — the RS line's change
// plus where the RS line (stock close ÷ benchmark close) sits against its own highest value over the longest window.
// Windows: the member's n, or 5 / 21 / 63 / 126 / 252 sessions (a week, a month, a quarter, half a year, a year) — a
// window the bars cannot cover is NOT given and is named as missing. Rounded to 2 dp; the text shows those numbers.
//
// Honesty rules: every figure names its sessions; the window actually covered is stated; a series that ends before the
// other is said plainly (the comparison runs through the last session BOTH hold); a benchmark the bars cannot serve,
// or no common sessions, answers in fixed words with no figure. UCT never picks "the sector" for a stock — the member
// names the ETF. Ends "Descriptive, not a recommendation." The overlay is offered through the canonical Compare
// Symbols capability (chart.compare) as a suggestion the member can say — this capability changes no chart.
//
// Isolation: the same contract as stock.dailyBars / chart.describeSetup (a served, NON-local market read; the server
// blanks the model's pre-read reply: turn.DATA_READ_ACTIONS). Dark: workflowGate (UCT_AGENT_WORKFLOWS) + the kinds.

import { registerCapability } from '../capabilities'
import { readData } from '../marketdata/client'
import { currentTurnId } from '../trace'
import { num, sessionDate } from './marketDataFormat'
import { RESOLVE_KIND, toCandidates, resolveInstruments, isFundLabel, FUND_NOTE } from './marketDataResolve'
import { workflowServed, armGroupWords, DESCRIPTIVE } from './workflowGate'

export const CAPABILITY = 'stock.relativeStrength'
export const WORKFLOW = 'relativeStrength'
export const KINDS = ['bars.daily', RESOLVE_KIND]
export const DEFAULT_BENCHMARK = 'SPY'
export const DEFAULT_WINDOWS = [5, 21, 63, 126, 252]
export const MAX_SESSIONS = 252
export const SOURCE = "UCT's daily bars (completed sessions only; today's session is not included)"
const WINDOW_WORDS = { 5: '1 week', 21: '1 month', 63: '3 months', 126: '6 months', 252: '1 year' }

export const relativeStrengthServed = () => workflowServed(WORKFLOW, KINDS)

const r2 = (v) => (num(v) == null ? null : Math.round(v * 100) / 100)
const sp = (v) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}%`
const pts = (v) => `${Math.abs(v).toFixed(2)} point${Math.abs(v) === 1 ? '' : 's'} ${v >= 0 ? 'ahead of' : 'behind'}`
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`

const usableBars = (env) => {
  const ok = env && (env.status === 'ok' || env.status === 'partial')
  const bars = ok ? env?.data?.bars : null
  return Array.isArray(bars) ? bars.filter(b => b && typeof b.date === 'string' && num(b.close) != null && b.close > 0) : []
}

/**
 * Pure: two `bars.daily` envelopes → { ok, rows, rsLine, through, ends, stale, missing } (or { ok: false, why }).
 * `windows` = session counts. Nothing is read; every number comes from the two envelopes' bars.
 */
export function relativeStrengthOf(stockEnv, benchEnv, { windows = DEFAULT_WINDOWS } = {}) {
  const s = usableBars(stockEnv)
  const b = usableBars(benchEnv)
  if (!s.length) return { ok: false, why: 'stock' }
  if (!b.length) return { ok: false, why: 'benchmark' }
  const bByDate = new Map(b.map(x => [x.date, x.close]))
  const common = s.filter(x => bByDate.has(x.date)).map(x => ({ date: x.date, s: x.close, b: bByDate.get(x.date) }))
  if (common.length < 2) return { ok: false, why: 'common' }
  const last = common.length - 1
  const rows = []
  const missing = []
  for (const n of windows) {
    if (n > last) { missing.push(n); continue }
    const a = common[last - n]
    const z = common[last]
    const sPct = (z.s / a.s - 1) * 100
    const bPct = (z.b / a.b - 1) * 100
    const ratio = ((z.s / z.b) / (a.s / a.b) - 1) * 100
    rows.push({ sessions: n, from: a.date, to: z.date, stockPct: r2(sPct), benchPct: r2(bPct), diff: r2(r2(sPct) - r2(bPct)), ratioPct: r2(ratio) })
  }
  // the RS line against its own high over the longest window measured (or every common session when none fits)
  const span = rows.length ? Math.max(...rows.map(r => r.sessions)) : last
  const win = common.slice(last - span)
  let hi = win[0]
  for (const x of win) if (x.s / x.b >= hi.s / hi.b) hi = x
  const now = common[last].s / common[last].b
  const offHigh = r2((now / (hi.s / hi.b) - 1) * 100)
  const rsLine = { sessions: span, from: win[0].date, to: common[last].date, atHigh: hi.date === common[last].date || offHigh === 0, highDate: hi.date, offHighPct: offHigh }
  const sEnd = s[s.length - 1].date
  const bEnd = b[b.length - 1].date
  const stale = [stockEnv, benchEnv].some(e => e?.stale && e?.data?.latest_completed_session && e.data.latest_completed_session !== (usableBars(e).at(-1)?.date))
  const latest = [stockEnv?.data?.latest_completed_session, benchEnv?.data?.latest_completed_session].filter(Boolean).sort().at(-1) || null
  return { ok: true, rows, missing, rsLine, through: common[last].date, ends: { stock: sEnd, bench: bEnd }, held: common.length, stale, latest }
}

const NO_BARS = {
  refused: "that request wasn't allowed for this question",
  unavailable: "its completed daily bars are not available from UCT's market data",
}
export function noRsSentence(why, { sym, bench, stockEnv, benchEnv }) {
  if (why === 'stock') return `I couldn't compare ${sym} with ${bench}: for ${sym}, ${NO_BARS[stockEnv?.status] || NO_BARS.unavailable}. No figure is stated.`
  if (why === 'benchmark') return `I couldn't compare ${sym} with ${bench}: for ${bench}, ${NO_BARS[benchEnv?.status] || NO_BARS.unavailable}. No figure is stated.`
  return `I couldn't compare ${sym} with ${bench}: UCT's daily bars for the two share fewer than two completed sessions. No figure is stated.`
}

/** The member's answer (pure; exported for tests). → { text, table, present, chart, rs } */
export function answerFromRelativeStrength(stockEnv, benchEnv, { symbol, benchmark, names = {}, sessions = null }) {
  const sym = String(symbol || '').toUpperCase()
  const bench = String(benchmark || DEFAULT_BENCHMARK).toUpperCase()
  const windows = sessions ? [sessions] : DEFAULT_WINDOWS
  const rs = relativeStrengthOf(stockEnv, benchEnv, { windows })
  if (!rs.ok) return { text: noRsSentence(rs.why, { sym, bench, stockEnv, benchEnv }) }
  const ref = rs.through
  const d = (ymd) => sessionDate(ymd, ref)
  const label = (x) => (names[x] ? `${x} (${names[x]})` : x)
  const lines = [`${label(sym)} vs ${label(bench)} — relative strength from completed daily closes through ${d(ref)}:`]
  if (!rs.rows.length) {
    const n = windows[0]
    lines.push(`Not measured: the two share only ${plural(rs.held, 'completed session')} (from ${d(rs.rsLine.from)}), fewer than the ${n + 1} a ${n}-session window needs.`)
  }
  for (const r of rs.rows) {
    const w = WINDOW_WORDS[r.sessions] && !sessions ? ` (${WINDOW_WORDS[r.sessions]})` : ''
    lines.push(`Over ${plural(r.sessions, 'session')}${w}, ${d(r.from)} to ${d(r.to)}: ${sym} ${sp(r.stockPct)}, ${bench} ${sp(r.benchPct)} — ${pts(r.diff)} ${bench}; the ${sym}/${bench} ratio ${r.ratioPct >= 0 ? 'rose' : 'fell'} ${Math.abs(r.ratioPct).toFixed(2)}%.`)
  }
  if (rs.rows.length && rs.missing.length) lines.push(`Not measured: the ${rs.missing.map(n => `${n}-session`).join(' and ')} window${rs.missing.length === 1 ? '' : 's'} — only ${plural(rs.held, 'common completed session')} held.`)
  const L = rs.rsLine
  lines.push(L.atHigh
    ? `RS line (${sym} close ÷ ${bench} close): at its highest of the ${plural(L.sessions, 'session')} ${d(L.from)} to ${d(L.to)}.`
    : `RS line (${sym} close ÷ ${bench} close): ${Math.abs(L.offHighPct).toFixed(2)}% below its highest of the ${plural(L.sessions, 'session')} ${d(L.from)} to ${d(L.to)}, set ${d(L.highDate)}.`)
  if (rs.ends.stock !== rs.ends.bench) {
    const early = rs.ends.stock < rs.ends.bench ? sym : bench
    lines.push(`Note: UCT's bars for ${early} end ${d(early === sym ? rs.ends.stock : rs.ends.bench)}, earlier than the other's, so the comparison runs through ${d(ref)} — the last session both hold.`)
  }
  if (rs.stale && rs.latest && rs.latest !== ref) lines.push(`Note: the most recent completed session was ${sessionDate(rs.latest, rs.latest)}; UCT's bars here end ${d(ref)}, so this is not the latest state.`)
  if (isFundLabel(names[sym]) || isFundLabel(names[bench])) lines.push(FUND_NOTE)
  lines.push(`To see it on the chart, say "compare ${bench} on this chart" (Compare Symbols).`)
  lines.push(DESCRIPTIVE, `From ${SOURCE}.`)
  const table = {
    columns: ['Window', `${sym} %`, `${bench} %`, 'Difference (pts)', 'Ratio change %'],
    rows: rs.rows.map(r => [`${r.sessions} sessions (${d(r.from)} – ${d(r.to)})`, r.stockPct.toFixed(2), r.benchPct.toFixed(2), r.diff.toFixed(2), r.ratioPct.toFixed(2)]),
  }
  return {
    text: lines.join('\n'),
    ...(rs.rows.length ? { table } : {}),
    present: { kind: 'table', title: `${sym} vs ${bench} — relative strength`, short: sym, ...(rs.rows.length ? { table } : {}), text: `${lines[0]}\n${DESCRIPTIVE}` },
    chart: { symbol: sym, label: sym },
    rs: { symbol: sym, benchmark: bench, asOf: ref, source: 'bars.daily', rows: rs.rows, rsLine: rs.rsLine, missing: rs.missing, stale: rs.stale },
  }
}

function cleanArgs(args) {
  const symbol = typeof args?.symbol === 'string' && args.symbol.trim() ? args.symbol.trim() : ''
  const benchmark = typeof args?.benchmark === 'string' && args.benchmark.trim() ? args.benchmark.trim() : null
  const sessions = Number.isInteger(args?.sessions) && args.sessions >= 1 ? Math.min(args.sessions, MAX_SESSIONS) : null
  return { symbol, benchmark, sessions }
}

export async function answerRelativeStrength(args) {
  const a = cleanArgs(args)
  if (!relativeStrengthServed()) return "UCT's relative-strength comparison isn't available to the Agent here."
  const words = toCandidates([a.symbol])
  if (words.length !== 1) return "Which ticker? I couldn't find a symbol in that."
  if (a.benchmark && /^(?:the )?(?:sector|industry|group)$/i.test(a.benchmark)) return `Which sector fund? UCT doesn't pick a sector for a stock — name the ETF, for example "${a.symbol.toUpperCase()} relative strength vs XLK".`
  const benchWords = toCandidates([a.benchmark || DEFAULT_BENCHMARK])
  if (benchWords.length !== 1) return "Which benchmark? I couldn't find a symbol in that."
  if (benchWords[0].text.toUpperCase().replace(/^\$/, '') === words[0].text.toUpperCase().replace(/^\$/, '')) return 'Compare it against a different symbol — that is the same one.'
  // MD-1 §4.7: both words are resolved against UCT's symbol index (ONE read) BEFORE any bars are read
  const r = await resolveInstruments([...words, ...benchWords])
  if (!r.ok) return r.text
  const [sym, bench] = r.symbols
  if (sym === bench) return 'Compare it against a different symbol — that is the same one.'
  const turnId = currentTurnId()
  if (!turnId) return "I couldn't read the daily bars: this needs the Agent's turn, which wasn't available."
  const bars = (a.sessions || Math.max(...DEFAULT_WINDOWS)) + 1
  // TWO reads, each a string LITERAL kind (agent-qa's isolation rail checks every readData kind statically)
  const stockEnv = await readData('bars.daily', { symbol: sym, bars }, { purpose: 'answer', turnId })
  const benchEnv = await readData('bars.daily', { symbol: bench, bars }, { purpose: 'answer', turnId })
  return answerFromRelativeStrength(stockEnv, benchEnv, { symbol: sym, benchmark: bench, names: r.names || {}, sessions: a.sessions })
}

// ── fast path (pure, fail-closed) ───────────────────────────────────────────────────────────────────────────────
const SYM = '(\\$?[A-Za-z][A-Za-z0-9.]{0,5})'
const VS = '(?:vs\\.?|versus|against|relative to|compared (?:to|with)|over)'
const BENCH = `(?:the (market|s ?& ?p(?: 500)?|s and p(?: 500)?)|${SYM})`
const PERIOD = '(?: (?:over|for|in|during) (?:the )?(?:last|past) (?:(\\d{1,3}|a|one) )?(sessions?|days?|trading days?|weeks?|months?|years?))?'
const RS_WORD = '(?:relative strength|rs(?: line)?|relative performance)'
const P1 = new RegExp(`^(?:show(?: me)? |what(?:'s| is) |how(?:'s| is) |check )?(?:the )?${RS_WORD} (?:of|for|on) ${SYM}(?: ${VS} ${BENCH})?${PERIOD}$`, 'i')
const P2 = new RegExp(`^(?:show(?: me)? |what(?:'s| is) |how(?:'s| is) |check )?${SYM}(?:'s)? ${RS_WORD}(?: ${VS} ${BENCH})?${PERIOD}$`, 'i')
const P3 = new RegExp(`^(?:is|has|was) ${SYM} (?:been )?(outperforming|underperforming|beating|lagging|trailing|leading) ${BENCH}${PERIOD}$`, 'i')
const NOT_TICKER = new Set(['it', 'this', 'that', 'the', 'my', 'its', 'them', 'me', 'a', 'an', 'sector', 'industry', 'group', 'market', 'stock', 'chart', 'line'])

function sessionsOf(nRaw, unitRaw) {
  if (!unitRaw) return null
  const n = !nRaw || /^(a|one)$/i.test(nRaw) ? 1 : Number(nRaw)
  const u = unitRaw.toLowerCase()
  const per = u.startsWith('week') ? 5 : u.startsWith('month') ? 21 : u.startsWith('year') ? 252 : 1
  const s = n * per
  return s >= 1 && s <= MAX_SESSIONS ? s : NaN
}
/** "NVDA relative strength vs SPY over 20 days" → { action, params: { symbol (as typed), benchmark, sessions } } | null */
export function match(text) {
  if (!relativeStrengthServed()) return null
  const s = String(text || '').replace(/[’`]/g, "'").trim().replace(/[?!.]+$/, '').replace(/\s+/g, ' ').trim()
  if (!s || s.length > 120) return null
  let m
  let sym = null; let market = null; let bench = null; let nRaw = null; let unit = null
  if ((m = P1.exec(s)) || (m = P2.exec(s))) { [, sym, market, bench, nRaw, unit] = m } else if ((m = P3.exec(s))) { [, sym, , market, bench, nRaw, unit] = m } else return null
  if (!sym || NOT_TICKER.has(sym.toLowerCase().replace(/^\$/, ''))) return null
  if (bench && NOT_TICKER.has(bench.toLowerCase().replace(/^\$/, ''))) return null
  const sessions = sessionsOf(nRaw, unit)
  if (Number.isNaN(sessions)) return null
  return { action: CAPABILITY, params: { symbol: sym, benchmark: market ? DEFAULT_BENCHMARK : (bench || null), sessions } }
}

// the data group's extra words while this is registered ("outperforming the market" names no data word of its own)
export const RS_WORDS = [/\b(?:relative strength|rs line|relative performance|(?:out|under)perform(?:s|ed|ing|ance)?)\b/]

let registered = false
let unregister = null
/** Idempotent; registers nothing unless the workflow is switched on and `bars.daily` + `instrument.resolve` are served. */
export function registerRelativeStrengthCapability() {
  if (registered || !relativeStrengthServed()) return false
  registered = true
  unregister = registerCapability({
    name: 'stock.relativeStrength',   // a LITERAL: turn.DATA_READ_ACTIONS names it (the server blanks a pre-read reply)
    surfaces: ['*'],
    target: 'market', query: true,
    summary: 'RELATIVE STRENGTH of ONE stock against a benchmark from UCT\'s completed daily bars: its % change and the benchmark\'s over the same sessions, the difference in points, '
      + 'the change of the stock/benchmark ratio (the RS line) and where the RS line sits against its high — over the member\'s window, or 1 week / 1 month / 3 / 6 / 12 months. UCT computes and words every figure. '
      + 'Use this (disposition apply, research null) for "NVDA relative strength vs SPY", "is AMD outperforming the market over the last 20 days", "TSLA RS vs QQQ over 3 months". Descriptive, never a recommendation.',
    hints: 'target = the ref of the stockData entry. symbol = the stock as typed. benchmark = the ticker the member compares against (a sector ETF such as XLK or SMH, an index fund, another stock), uppercase; '
      + 'null = SPY ("the market", "the S&P"). UCT never picks a sector for a stock: for "vs its sector" with no fund named, ask which ETF (clarify). sessions = the window in sessions (days = sessions, weeks × 5, months × 21; at most 252) or null for 1w/1m/3m/6m/1y. reply: one short line, no figures.',
    args: {
      type: 'object',
      properties: { symbol: { type: 'string' }, benchmark: { type: ['string', 'null'] }, sessions: { type: ['integer', 'null'] } },
      required: ['symbol', 'benchmark', 'sessions'],
      additionalProperties: false,
    },
    fastWhole: true,
    fastCorrect: false,
    fast: ({ raw }) => { const m = match(raw); return m ? m.params : null },
    answer: (_snap, args) => answerRelativeStrength(args),
  })
  armGroupWords('data', RS_WORDS, true)
  return true
}
export const _resetRelativeStrengthForTest = () => { if (unregister) unregister(); unregister = null; registered = false; armGroupWords('data', RS_WORDS, false) }
