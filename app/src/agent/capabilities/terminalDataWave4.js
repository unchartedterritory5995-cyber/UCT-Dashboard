// UCT Agent — terminal data wave 4: three LOCAL-ONLY answers (the Agent half of the ERNS, CEOS and GRP terminal panels).
//
//   stock.earningsSeason  one day's earnings reporters: what options priced before each report, its past earnings moves,
//                         and the result and the stock's move once it lands
//   stock.callThemes      the phrases new and rising across a month of earnings calls
//   stock.groupDrill      one sector, industry or UCT theme and its stocks: each one's change over a range, its RS rank and
//                         whether it is on UCT's confluence board
//
// DATA: gateway reads of `earnings.season`, `earnings.callThemes` and `group.drill` (api/services/uct_agent/marketdata/,
// MD-1 §4.13). No read of this wave starts a build or spends a provider call: each is answered only from what the server
// already holds, so each can say "not held". The first two make ONE read. A group makes up to TWO reads of its one kind:
// the names of the ranked groups, which the GRP panel's own resolver (`resolveGroup`) reads here in the browser, then the
// group it resolved. There is one resolver, the panel's, and none on the server.
// Rows are shaped by the matching panel's own pure helpers (pages/terminal/panels/: earningsSeasonModel
// `earningsSeasonRead`, callThemesModel `callThemesRead`, groupDrillModel `parseGroupQuery` / `resolveGroup` /
// `flowWords`), so the panel and the Agent read one shape. The earnings and the group models pull the market calendar and
// the grid sorter in, so they are loaded when an answer is built, never with the Agent itself.
// HONESTY: each answer states the data's own time or says why there is none; none says live or now (MD-1 §3). A failed
// read is never "nothing to show": a day, lists or a ranking that are not held are each said in their own words. A number
// that does not exist is never 0: no priced move, no past move, no stock move, no RS rank and no place on the board are
// each said as missing. Nothing is predicted.
// GROUNDING: the text is templated from `facts` (returned beside it): every number in it is a fact's.
// ⛔ LOCAL ONLY (turn.LOCAL_ONLY_ACTIONS; all three kinds are model-isolated, ADR-005): the model plans the lookup and
// never sees what came back. Every capability in THIS module is local-only: the isolation rail (qa/modelIsolation.test.jsx)
// holds the whole module to that.
//
// Dark by construction: each is registered only while the server serves its own kind (UCT_AGENT_DATA_KINDS, fail closed; an
// isolated kind also needs its own UCT_AGENT_ISOLATED_KINDS entry or every read is refused).
// ROUTING: the three have their OWN words-only group, `marketViews` (routing.js lists them by action: the stock `data`
// group their domain names has no room under the routing budget, and wave 3's own group is held at its four). Each one's
// own words (WAVE4_ROUTE_WORDS) are added to that group only while it is registered, so on a dark server the group has no
// words and no registered action, and routing is byte-identical to the base.
import { registerCapability } from '../capabilities'
import { readData } from '../marketdata/client'
import { currentTurnId } from '../trace'
import { GROUPS } from '../routing'
import { stampET } from './marketDataFacts'
import { CALL_THEME_LISTS, BOTH_ROWS, callThemesRead, monthLabel, parseCallThemesMonth } from '../../pages/terminal/panels/callThemesModel'
import { PERIOD_RANGES, DEFAULT_PERIOD_RANGE } from '../../pages/terminal/panels/periodChangeModel'
import { kindServed, usable, noRead, money, pct, plural, dayText, NO_TURN } from './terminalDataFormat'

export const KINDS = Object.freeze({ season: 'earnings.season', themes: 'earnings.callThemes', drill: 'group.drill' })
export const CAPABILITIES = Object.freeze({ season: 'stock.earningsSeason', themes: 'stock.callThemes', drill: 'stock.groupDrill' })
const NONE_STATED = 'No figure is stated.'
const TEXT_ROWS = 5
const DESCRIPTIVE = 'Descriptive only: nothing here is a prediction.'
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const int = (v) => (Number.isInteger(v) ? v : null)
const clamp = (v, max, fallback) => (Number.isInteger(v) ? Math.min(Math.max(v, 1), max) : fallback)
const isoDay = (v) => (typeof v === 'string' && ISO_DAY.test(v) ? v : null)
/** "Fri, Nov 13, 2026" → "Nov 13, 2026" */
const shortDay = (ymd) => (dayText(ymd) || '').replace(/^\w+, /, '') || null
/** A size with no sign: "6.20%", or null. */
const size2 = (v) => (num(v) == null ? null : `${Math.abs(v).toFixed(2)}%`)
/** A share to ONE decimal, as the call themes round it: "13.3%", or null. */
const share1 = (v) => (num(v) == null ? null : `${v.toFixed(1)}%`)
const weekday = (ymd) => { const d = new Date(`${ymd}T12:00:00Z`); return Number.isNaN(d.getTime()) ? null : d.getUTCDay() }

// ── stock.earningsSeason ───────────────────────────────────────────────────────────────────────────────────────────────
export const SEASON_SESSION_KEYS = Object.freeze(['all', 'bmo', 'amc'])            // the ERNS panel's own (EARNINGS_SESSIONS)
export const SEASON_MAX_ROWS = 50
const SEASON_DEFAULT_ROWS = 25
export const PRICED_MEANING = "A priced move is what the at-the-money straddle priced before the report, as a percent of the stock price, stored once by UCT's weekday capture. A company with none stored has none here, which is not the same as 0%."
export const PAST_MEANING = 'A past move is the close-to-close move of the session that first traded each past result, given only where the server already holds it.'
export const SEASON_MOVE_TODAY = "A stock move for a day still in session is the regular session's change up to UCT's last read, for a report before the open or with no confirmed time. A report after the close has no move until the next close."
export const SEASON_MOVE_PAST = "A stock move for a past day is the Calendar's own settled close-to-close move, stated only when the server already holds it."
const epsText = (v) => (num(v) == null ? null : `${v < 0 ? '−' : ''}$${Math.abs(v).toFixed(2)}`)
const VERDICT_WORDS = { beat: 'a beat', miss: 'a miss', mixed: 'mixed' }
const MOVE_WORDS = {
  next_close: 'its move is measured at the next close', not_held: 'its move is not held', failed: 'its move could not be read', none: 'no stock move on record',
}

function seasonRow(r, model, dayKind) {
  const priced = r.priced ? { pct: r.priced.pct, text: size2(r.priced.pct), dollars: r.priced.dollars, dollars_text: money(r.priced.dollars), captured: r.priced.capturedDay } : null
  const past = r.past ? { n: r.past.n, average_size: r.past.avgAbs, average_text: size2(r.past.avgAbs), moves: r.past.moves.map(m => ({ day: m.day, pct: m.pct, text: pct(m.pct) })) } : null
  return {
    symbol: r.sym, name: r.name, session: r.session, session_text: model.SESSION_HEADINGS[r.session] || null, market_cap_billions: r.capB,
    reported: r.reported, eps: r.epsAct, eps_text: epsText(r.epsAct), eps_expected: r.epsEst, eps_expected_text: epsText(r.epsEst), verdict: r.verdict,
    priced, past, past_state: past ? 'ok' : r.pastState,
    // a company with no move on record has NO move: null, never 0
    move: r.move, move_text: pct(r.move), move_state: r.moveState, against: r.against,
    move_words: r.move != null ? `stock ${pct(r.move)}${r.moveState === 'live' && dayKind === 'today' ? ' so far in the session' : ''}` : (r.reported ? MOVE_WORDS[r.moveState] || MOVE_WORDS.none : null),
  }
}

/** The `earnings.season` envelope → the member's answer + its facts (pure). `model` = earningsSeasonModel's exports. */
export function answerFromSeason(envl, model, askedDay = null) {
  if (!usable(envl)) {
    const day = dayText(askedDay)
    return { text: noRead(`the earnings season${day ? ` for ${day}` : ''}`, envl, 'no answer for that day is held on the server at the moment (the Earnings season panel works it out when a member opens that day, and this answer never starts that work). Open the Earnings season panel on that day, then ask again', `${NONE_STATED} That is not the same as nobody reporting.`) }
  }
  const d = envl.data
  const date = isoDay(d.date)
  const day = dayText(date) || 'a day whose date is not given'
  if (d.no_day === true) {
    const weekend = [0, 6].includes(weekday(date))
    return { text: `${day} is ${weekend ? 'a weekend day, so no company reports' : "not a day UCT's earnings calendar carries in the week it holds (a market holiday)"}. That is a normal answer, not a failed read.`, facts: { date, day: dayText(date), no_day: true, scheduled: 0, rows: [] } }
  }
  // the kind's data keeps the route's own names, so the ERNS panel's reader takes it as the route's answer
  const view = model.earningsSeasonRead({ ...d, status: 'ok' })
  if (view.state !== 'ok') return { text: `I couldn't read the earnings season for ${day}: UCT's data did not answer cleanly. ${NONE_STATED} That is not the same as nobody reporting.` }
  const session = SEASON_SESSION_KEYS.includes(d.session) ? d.session : 'all'
  const rows = model.SESSION_ORDER.flatMap(s => view.groups[s]).map(r => seasonRow(r, model, view.dayKind))
  const scheduled = int(d.scheduled) ?? rows.length
  const count = int(d.count) != null ? Math.max(d.count, rows.length) : rows.length
  const c = d.counts && typeof d.counts === 'object' ? d.counts : {}
  const built = stampET(d.built_at, envl.fetched_at)
  const facts = {
    date, day: dayText(date), day_kind: view.dayKind, default: d.default === true, session, scheduled, count, shown: rows.length,
    reported: int(c.reported), priced: int(c.priced), priced_withheld: int(c.priced_withheld) ?? 0, with_past: int(c.with_past), past_not_held: int(c.past_not_held) ?? 0,
    priced_state: view.pricedState, moves_state: view.movesState, held: d.held || null, stale: !!envl.stale, built, capture_clock: view.captureClock, rows,
  }
  const lines = []
  const when = session === 'bmo' ? ' before the open' : session === 'amc' ? ' after the close' : ''
  if (!scheduled) {
    lines.push(`No company is on UCT's earnings calendar for ${day}. That is a normal answer, not a failed read.`)
  } else if (!count) {
    lines.push(`${plural(scheduled, 'company', 'companies')} ${scheduled === 1 ? 'is' : 'are'} on UCT's earnings calendar for ${day}, none of them reporting${when}.`)
  } else {
    const parts = [facts.reported != null ? `${facts.reported} with a result on record` : null, facts.priced != null ? `${facts.priced} with a priced move stored` : null].filter(Boolean)
    lines.push(`Earnings season for ${day}${facts.default ? ' (the next day with a reporter)' : ''}: ${plural(scheduled, 'company', 'companies')} on UCT's earnings calendar${parts.length ? `; ${parts.join(', ')}` : ''}.`)
    lines.push(`${rows.length < count ? `The ${rows.length} biggest of the ${count}` : count === 1 ? 'The 1 company' : `All ${count}`}${when ? ` reporting${when}` : ''}${rows.length < count ? ' by market cap' : ', biggest company first in each part of the day'}:`)
    for (const r of rows.slice(0, TEXT_ROWS)) {
      const who = [r.name, r.session_text ? r.session_text.toLowerCase() : null].filter(Boolean).join(', ')
      const priced = r.priced ? `options priced a move of ${r.priced.text}${r.priced.dollars_text ? ` (${r.priced.dollars_text})` : ''}` : 'no priced move stored'
      const result = r.reported ? `EPS ${r.eps_text}${r.eps_expected_text ? ` against ${r.eps_expected_text} expected` : ''}${r.verdict ? `, ${VERDICT_WORDS[r.verdict]}` : ''}` : 'no result on record yet'
      const against = r.against === 'beyond' ? ', more than was priced' : r.against === 'within' ? ', within what was priced' : ''
      const past = r.past ? `${plural(r.past.n, 'past report')} measured, average size ${r.past.average_text}` : r.past_state === 'not_held' ? 'past moves not held' : 'no past move measured'
      lines.push(`• ${r.symbol}${who ? ` (${who})` : ''}: ${[priced, result, r.move_words ? `${r.move_words}${against}` : null, past].filter(Boolean).join('; ')}`)
    }
    if (rows.length > TEXT_ROWS) lines.push(`(${rows.length - TEXT_ROWS} more in the table.)`)
    lines.push(PRICED_MEANING)
    if (facts.priced_state === 'failed') lines.push('The stored priced moves could not be read when this answer was put together, so none is stated. That is not the same as none priced.')
    else if (facts.priced_withheld) lines.push(`${plural(facts.priced_withheld, 'stored priced move')} ${facts.priced_withheld === 1 ? 'is' : 'are'} left out: not from UCT's own option chain read, or without a usable percent.`)
    lines.push(PAST_MEANING)
    if (facts.past_not_held) lines.push(`${plural(facts.past_not_held, 'company', 'companies')} of the ${scheduled} ${facts.past_not_held === 1 ? 'has' : 'have'} no past moves held on the server. That is not the same as no past report.`)
    if (facts.reported) {
      lines.push(view.dayKind === 'today' ? SEASON_MOVE_TODAY : SEASON_MOVE_PAST)
      if (facts.moves_state === 'not_held') lines.push('The stock moves for that day are not held on the server at the moment, and this answer never starts price reads, so no move is stated. That is not the same as no move.')
      else if (facts.moves_state === 'failed') lines.push('The price read for the stock moves failed when this answer was put together, so no move is stated. That is not the same as no move.')
    }
  }
  if (scheduled) {
    lines.push(built ? `Put together by UCT at ${built} (UCT's own time; the calendar carries only the day it is for).` : 'The answer carries no build time, so I cannot say how old it is.')
    if (d.held === 'last_good') lines.push('Stale: this is the last good answer for that day, so a result or a move that landed since is missing.')
  }
  lines.push(`Source: UCT's earnings calendar (third-party results and estimates as UCT holds them), UCT's stored option captures and UCT's own move arithmetic. ${DESCRIPTIVE}`)
  return {
    text: lines.join('\n'),
    ...(rows.length ? { table: {
      columns: [{ key: 'symbol', label: 'Symbol' }, { key: 'name', label: 'Company' }, { key: 'session', label: 'Reports' }, { key: 'priced', label: 'Priced move' }, { key: 'eps', label: 'EPS' },
        { key: 'eps_expected', label: 'EPS expected' }, { key: 'result', label: 'Result' }, { key: 'move', label: 'Stock move' }, { key: 'past', label: 'Past reports' }],
      rows: rows.map(r => ({ symbol: r.symbol, name: r.name || '—', session: r.session_text || '—', priced: r.priced ? r.priced.text : 'none stored', eps: r.eps_text || '—', eps_expected: r.eps_expected_text || '—',
        result: r.verdict ? VERDICT_WORDS[r.verdict] : r.reported ? 'reported' : 'not on record', move: r.move_text || (r.reported ? MOVE_WORDS[r.move_state] || MOVE_WORDS.none : '—'),
        past: r.past ? `${r.past.n} measured, average size ${r.past.average_text}` : r.past_state === 'not_held' ? 'not held' : 'none measured' })),
    } } : {}),
    ...(rows.some(r => r.priced) ? { present: {
      kind: 'metrics', title: `Earnings season, ${facts.day || 'day not given'}`, short: 'Earnings season',
      items: rows.filter(r => r.priced).slice(0, TEXT_ROWS * 2).map(r => ({ label: r.symbol, value: r.priced.text, note: `priced move${r.session_text ? ` · ${r.session_text.toLowerCase()}` : ''}`, aka: [r.symbol.toLowerCase()] })),
    } } : {}),
    link: { href: '/calendar', label: 'Open the Calendar' },
    facts,
  }
}

export async function answerSeason(args = {}) {
  const params = { session: SEASON_SESSION_KEYS.includes(args.session) ? args.session : 'all', limit: clamp(args.limit, SEASON_MAX_ROWS, SEASON_DEFAULT_ROWS) }
  const model = await import('../../pages/terminal/panels/earningsSeasonModel')
  if (args.date != null && args.date !== '') {
    if (typeof args.date !== 'string' || !model.isIsoDate(args.date)) return { text: `Which day's earnings season should I read? Give me the date as YYYY-MM-DD. ${NONE_STATED}` }
    if ([0, 6].includes(weekday(args.date))) return { text: `${dayText(args.date)} is a weekend day: no company reports. Give me a weekday. ${NONE_STATED}` }
    params.date = args.date
  }
  const turnId = currentTurnId()
  if (!turnId) return { text: `I couldn't read the earnings season: ${NO_TURN}.` }
  const envl = await readData('earnings.season', params, { purpose: 'answer', turnId })   // a LITERAL: qa/modelIsolation reads it
  return answerFromSeason(envl, model, params.date || null)
}

// ── stock.callThemes ───────────────────────────────────────────────────────────────────────────────────────────────────
export const THEME_LIST_KEYS = Object.keys(CALL_THEME_LISTS)             // both | new | rising: the CEOS panel's own
export const THEMES_MAX_ROWS = 30
const THEMES_DEFAULT_ROWS = BOTH_ROWS
export const THEMES_COUNTING = 'A call counts once however often it says a phrase.'
export const THEMES_NO_TEXT = 'No transcript text is shown: a row is a phrase with its counts and a few example tickers. To read what was said, search the earnings calls for the phrase.'
const LIST_HEADS = { new: 'New this month (near absent before), most-said first', rising: 'Rising (said before, clearly more this month), biggest rise first' }

function themeRow(r) {
  return {
    phrase: r.phrase, calls: r.calls, share: r.share, share_text: share1(r.share), companies: r.companies, earlier_share: r.base, earlier_share_text: share1(r.base),
    rise_points: r.rise, rise_text: num(r.rise) == null ? null : `${r.rise > 0 ? '+' : r.rise < 0 ? '−' : ''}${Math.abs(r.rise).toFixed(1)} points`,
    // nothing earlier said it: there is no ratio, which is not 0 times
    times: r.ratio, times_text: num(r.ratio) == null ? null : `${r.ratio.toFixed(1)} times`, related: r.related, examples: r.examples,
  }
}

/** The `earnings.callThemes` envelope → the member's answer + its facts (pure). Rows: callThemesModel `callThemesRead`. */
export function answerFromThemes(envl, askedMonth = null) {
  if (!usable(envl)) {
    const label = monthLabel(askedMonth)
    // an envelope's note is never echoed, so a month with no list is covered in this answer's own words
    return { text: noRead(`the call themes${label ? ` for ${label}` : ''}`, envl, `${label ? 'there is no list for that month, or ' : ''}none are held on the server at the moment (they are worked out once a day after the call index updates, and this answer never starts that work), or the call index does not hold enough calls to compare`, `${NONE_STATED} That is not the same as no phrase rising.`) }
  }
  const d = envl.data
  const view = callThemesRead({ ...d, status: 'ok' })                 // the kind's data keeps the route's own names
  if (view.state !== 'ok') return { text: `I couldn't read the call themes: UCT's data did not answer cleanly. ${NONE_STATED} That is not the same as no phrase rising.` }
  const which = THEME_LIST_KEYS.includes(d.list) ? d.list : 'both'
  const names = which === 'both' ? ['new', 'rising'] : [which]
  const lists = Object.fromEntries(names.map(n => [n, { rows: view.lists[n].rows.map(themeRow), passed: view.lists[n].qualified }]))
  const built = stampET(d.built_at, envl.fetched_at)
  const newest = isoDay(d.corpus?.newest)
  const facts = {
    month: view.month, month_text: view.label, months: view.months.map(m => m.month), list: which, calls: view.calls, companies: view.companies,
    earlier_calls: view.baseline?.calls ?? null, earlier_from: view.baseline?.from ?? null, earlier_to: view.baseline?.to ?? null, matched_pct: view.baseline?.matched ?? null,
    newest_call_date: newest, built, stale: !!envl.stale, lists,
  }
  const lines = []
  const span = facts.earlier_from ? (facts.earlier_from === facts.earlier_to ? facts.earlier_from : `${facts.earlier_from} to ${facts.earlier_to}`) : null
  lines.push(`What was said on earnings calls in ${view.label}: phrases whose share of calls rose the most${view.calls != null ? `, across ${plural(view.calls, 'call')}` : ''}${view.companies != null ? ` from ${plural(view.companies, 'company', 'companies')}` : ''}${facts.earlier_calls != null ? `, against ${plural(facts.earlier_calls, 'earlier call')}${span ? ` (${span})` : ''}` : ''}.`)
  for (const n of names) {
    const { rows, passed } = lists[n]
    if (!rows.length) { lines.push(`${LIST_HEADS[n]}: no phrase passed the rules. That is a finding about the calls UCT holds, not a failed read.`); continue }
    lines.push(`${LIST_HEADS[n]}${rows.length < passed ? ` (the first ${rows.length} of the ${passed} that passed; the weakest are left out)` : ''}:`)
    for (const r of rows.slice(0, TEXT_ROWS)) {
      const said = n === 'new'
        ? `${plural(r.calls, 'call')}${r.share_text ? ` (${r.share_text} of the month's)` : ''}${r.companies != null ? `, ${plural(r.companies, 'company', 'companies')}` : ''}`
        : `${r.share_text ?? 'a share not given'} of calls, up from ${r.earlier_share_text ?? 'a share not given'}${r.rise_text ? ` (${r.rise_text}${r.times_text ? `, ${r.times_text}` : ''})` : ''}; ${plural(r.calls, 'call')}`
      lines.push(`• "${r.phrase}": ${said}${r.examples.length ? `; said most by ${r.examples.join(', ')}` : ''}${r.related.length ? `; with it: ${r.related.join(', ')}` : ''}`)
    }
    if (rows.length > TEXT_ROWS) lines.push(`(${rows.length - TEXT_ROWS} more in the table.)`)
  }
  lines.push(THEMES_COUNTING)
  if (facts.matched_pct) lines.push(`The earlier share is like for like: the earlier calls are weighted to this month's mix of industries (${share1(facts.matched_pct)} of this month's calls could be matched).`)
  else lines.push('The earlier share is a plain comparison: no industry weighting could be applied.')
  lines.push(THEMES_NO_TEXT)
  lines.push(newest ? `As of calls through ${dayText(newest)}, the newest call these lists were worked out from.` : 'The lists do not say which calls they were worked out from, so there is no call date to state.')
  if (built) lines.push(`Worked out by UCT at ${built} (UCT's own time), once a day after the call index updates.`)
  if (envl.stale) lines.push('Stale: these lists are older than a day and a half, so calls indexed since then are not in them.')
  lines.push(`Source: UCT's call themes (UCT's own counting over third-party earnings call transcripts). ${DESCRIPTIVE}`)
  const tabled = names.flatMap(n => lists[n].rows.map(r => ({ n, r })))
  return {
    text: lines.join('\n'),
    ...(tabled.length ? { table: {
      columns: [{ key: 'list', label: 'List' }, { key: 'phrase', label: 'Phrase' }, { key: 'calls', label: 'Calls' }, { key: 'share', label: 'Share of calls' }, { key: 'earlier', label: 'Earlier share' },
        { key: 'rise', label: 'Rise' }, { key: 'companies', label: 'Companies' }, { key: 'examples', label: 'Said most by' }],
      rows: tabled.map(({ n, r }) => ({ list: n === 'new' ? 'New' : 'Rising', phrase: r.phrase, calls: r.calls, share: r.share_text || '—', earlier: r.earlier_share_text || '—', rise: r.rise_text || '—',
        companies: r.companies ?? '—', examples: r.examples.join(', ') || '—' })),
    }, present: {
      kind: 'metrics', title: `Call themes, ${view.label}`, short: 'Call themes',
      items: tabled.slice(0, TEXT_ROWS * 2).map(({ n, r }) => ({ label: r.phrase, value: n === 'new' ? plural(r.calls, 'call') : (r.rise_text || plural(r.calls, 'call')), note: n === 'new' ? 'new this month' : 'rising', aka: [r.phrase.toLowerCase()] })),
    } } : {}),
    facts,
  }
}

export async function answerThemes(args = {}) {
  const params = { list: THEME_LIST_KEYS.includes(args.list) ? args.list : 'both', limit: clamp(args.limit, THEMES_MAX_ROWS, THEMES_DEFAULT_ROWS) }
  if (args.month != null && args.month !== '') {
    const month = parseCallThemesMonth(args.month)
    if (!month) return { text: `Which month's call themes should I read? Give me the month as YYYY-MM. ${NONE_STATED}` }
    params.month = month
  }
  const turnId = currentTurnId()
  if (!turnId) return { text: `I couldn't read the call themes: ${NO_TURN}.` }
  const envl = await readData('earnings.callThemes', params, { purpose: 'answer', turnId })   // a LITERAL: qa/modelIsolation reads it
  return answerFromThemes(envl, params.month || null)
}

// ── stock.groupDrill ───────────────────────────────────────────────────────────────────────────────────────────────────
export const GROUP_KIND_KEYS = Object.freeze(['sector', 'industry', 'theme'])      // the GRP panel's own order (GROUP_KIND_ORDER)
export const GROUP_RANGE_KEYS = Object.keys(PERIOD_RANGES)                         // mtd | qtd | ytd | m1 | m3 | m6 | y1
export const GROUP_SORT_KEYS = Object.freeze(['pct', 'rs'])                        // the GRP panel's own (GROUP_SORTS)
export const GROUP_DIR_KEYS = Object.freeze(['desc', 'asc'])
export const GROUP_MAX_ROWS = 50
const GROUP_DEFAULT_ROWS = 25
export const GROUP_PCT_MEANING = "The group's own change is UCT's average of its ranked stocks with the biggest gains capped, so one outsized gainer cannot carry it. Each stock's change is its own."
export const RS_MEANING = "An RS rank is UCT's 1 to 99 rating of a stock against the market. A stock with none has no rank, which is not a rank of 0."
export const FLOW_MEANING = "The flow column says only whether a stock is on UCT's confluence board (a large dark pool dollar size with aligned long-dated options flow) and on which side."
const FLOW_DIRECTION = { BULL: 'bullish', BEAR: 'bearish' }
const FLOW_STATUS = { BUILDING: 'building', STEADY: 'steady', ESTABLISHED: 'established' }
const NO_GROUP_TAIL = 'No figure is stated, and that is not the same as the group having no stocks.'
const rangeWords = (key) => PERIOD_RANGES[key]?.words || PERIOD_RANGES[DEFAULT_PERIOD_RANGE].words
const kindWords = (model, kind) => model.GROUP_KINDS[kind]?.one || 'group'
const optionText = (model, o) => `${o.name} (${kindWords(model, o.kind)})`
const notHeld = (words) => `the ranking for ${words} is not held on the server at the moment (the server keeps the one-click ranges built, and this answer never starts that work). Open the Group drill-down panel on that range, then ask again`

/** The `group.drill` list read → the lists the GRP panel's resolver takes (`{ sector, industry, theme }` of rows). */
export function groupLists(envl) {
  const lists = {}
  const sent = envl?.data?.lists && typeof envl.data.lists === 'object' ? envl.data.lists : {}
  for (const kind of GROUP_KIND_KEYS) {
    if (!Array.isArray(sent[kind])) continue
    lists[kind] = sent[kind].filter(g => g && typeof g === 'object' && g.name).map(g => ({ name: String(g.name), pct: num(g.pct), count: int(g.count), members: [] }))
  }
  return lists
}

/** "the technology sector" → "sector technology": the GRP panel's parser reads a kind word only when it LEADS the name, and a
 *  member says it last. Pure; the same words otherwise ("group" is dropped: it names no kind). */
export function kindFirst(raw, model) {
  const words = String(raw || '').trim().split(/\s+/).filter(Boolean)
  if (words.length > 1 && words[0].toUpperCase() === 'THE') words.shift()
  if (words.length < 2) return words.join(' ')
  const last = words[words.length - 1].toUpperCase()
  if (last === 'GROUP') return words.slice(0, -1).join(' ')
  const lead = words[0].toUpperCase()
  return Object.prototype.hasOwnProperty.call(model.GROUP_KIND_ARG_WORDS, last) && !Object.prototype.hasOwnProperty.call(model.GROUP_KIND_ARG_WORDS, lead)
    ? [words[words.length - 1], ...words.slice(0, -1)].join(' ') : words.join(' ')
}

/** Which group a member's words mean, by the GRP panel's own parser and resolver over the lists read (pure). The words are
 *  tried as said; only when nothing fits are they tried with a trailing kind word moved to the front. */
export function resolveAsked(lists, raw, kind, model) {
  const pin = (q) => (!q.kind && GROUP_KIND_KEYS.includes(kind) ? { ...q, kind } : q)
  const first = model.resolveGroup(lists, pin(model.parseGroupQuery(typeof raw === 'string' ? raw : '')))
  if (first.status !== 'unknown' && first.status !== 'empty') return first
  const again = kindFirst(raw, model)
  if (again === String(raw || '').trim()) return first
  const second = model.resolveGroup(lists, pin(model.parseGroupQuery(again)))
  return second.status === 'unknown' || second.status === 'empty' ? first : second
}

/** What a name the lists do not settle says (pure): which one, did you mean, or nothing names a group. Null when settled. */
export function groupAsk(res, model, words) {
  if (res.status === 'ok') return null
  if (res.status === 'empty') return `Which sector, industry or UCT theme should I open? Give me its name, or a sector fund's ticker. ${NONE_STATED}`
  if (res.status === 'ambiguous') {
    return [`"${res.query}" fits ${plural(res.total, 'ranked group')} over ${words}. Which one?`, ...res.options.map(o => `• ${optionText(model, o)}`),
      res.total > res.options.length ? `(${res.total - res.options.length} more fit. Say more of the name.)` : null, NONE_STATED].filter(Boolean).join('\n')
  }
  const near = res.suggestions || []
  return [`I found no sector, industry or UCT theme called "${res.query}" in the ranking for ${words}.`,
    near.length ? `The nearest names: ${near.map(o => optionText(model, o)).join(', ')}.` : null,
    'A UCT theme with no ranked stock is not listed, so this is not proof that no such theme exists.', NONE_STATED].filter(Boolean).join('\n')
}

/** The `group.drill` group read → the member's answer + its facts (pure). `model` = groupDrillModel's exports. */
export function answerFromGroup(envl, model, asked = {}) {
  const words = rangeWords(asked.range)
  if (!usable(envl)) return { text: noRead(asked.name ? `the stocks of ${asked.name}` : 'that group', envl, notHeld(words), NO_GROUP_TAIL) }
  const d = envl.data
  const kind = GROUP_KIND_KEYS.includes(d.kind) ? d.kind : null
  const name = String(d.name || asked.name || '').trim()
  const range = GROUP_RANGE_KEYS.includes(d.range) ? d.range : DEFAULT_PERIOD_RANGE
  if (d.found !== true || !kind) {
    return { text: `The ranking for ${rangeWords(range)} holds no ${kind ? kindWords(model, kind) : 'group'} called ${name || 'that'}. ${NO_GROUP_TAIL}` }
  }
  const rows = (Array.isArray(d.rows) ? d.rows : []).filter(r => r && typeof r === 'object' && r.sym).map(r => {
    const flow = r.flow && FLOW_DIRECTION[r.flow.dir] ? { direction: FLOW_DIRECTION[r.flow.dir], status: FLOW_STATUS[r.flow.status] || null } : null
    return {
      symbol: String(r.sym).toUpperCase(), change_pct: num(r.pct), change_text: pct(num(r.pct)), start_close: num(r.start_close), end_close: num(r.end_close),
      closes_text: num(r.start_close) != null && num(r.end_close) != null ? `${money(r.start_close)} to ${money(r.end_close)}` : null,
      industry: r.industry || null, sector: r.sector || null,
      // a stock with no rank has NO rank and one off the board has NO flow signal: null, never 0
      rs: num(r.rs), flow, flow_text: flow ? model.flowWords(flow) : null,
    }
  })
  const count = int(d.count) != null ? Math.max(d.count, rows.length) : rows.length
  const sort = GROUP_SORT_KEYS.includes(d.sort) ? d.sort : 'pct'
  const dir = GROUP_DIR_KEYS.includes(d.dir) ? d.dir : 'desc'
  const order = model.groupSortWords({ key: sort, dir })
  const built = stampET(d.built_at, envl.fetched_at)
  const start = isoDay(d.start_day)
  const end = isoDay(d.end_day)
  const facts = {
    kind, name, range, range_words: rangeWords(range), start_day: start, end_day: end, group_change_pct: num(d.group_pct), group_change_text: pct(num(d.group_pct)),
    count, shown: rows.length, with_change: int(d.known) ?? rows.filter(r => r.change_pct != null).length, with_rs: int(d.ranked) ?? 0, on_board: int(d.on_board) ?? 0,
    sort, dir, rs_state: d.rs_state || null, flow_state: d.flow_state || null, held: d.held || null, stale: !!envl.stale, built, rows,
  }
  const lines = []
  const span = start && end ? ` (${shortDay(start)} to ${shortDay(end)})` : ''
  lines.push(`${name} (${kindWords(model, kind)}), ${facts.range_words}${span}: ${facts.group_change_text ? `the group's change is ${facts.group_change_text}` : "the group's change is not given"}; ${plural(count, 'stock')} ranked.`)
  if (rows.length) {
    lines.push(`${rows.length < count ? `The first ${rows.length} of the ${count}` : count === 1 ? 'The 1 stock' : `All ${count} stocks`}, ${order}:`)
    for (const r of rows.slice(0, TEXT_ROWS)) {
      const rs = facts.rs_state === 'not_held' ? null : r.rs != null ? `RS rank ${r.rs}` : 'no RS rank'
      const flow = facts.flow_state === 'not_held' ? null : r.flow_text ? `on the confluence board: ${r.flow_text}` : null
      lines.push(`• ${r.symbol} ${r.change_text ?? 'no change in the ranking'}${r.closes_text ? ` (${r.closes_text})` : ''}${[rs, flow].filter(Boolean).map(s => `, ${s}`).join('')}`)
    }
    if (rows.length > TEXT_ROWS) lines.push(`(${rows.length - TEXT_ROWS} more in the table.)`)
    if (facts.rs_state === 'not_held') lines.push('The RS ranking is not held on the server at the moment, and this answer never starts that work, so no RS rank is stated. That is not the same as no rank.')
    else lines.push(`${facts.with_rs} of the ${count} ${count === 1 ? 'has' : 'have'} an RS rank${facts.rs_state === 'last_stored' ? ' (from the last ranking the server stored, so the ranks may be behind)' : ''}.`)
    if (facts.flow_state === 'not_held') lines.push('The confluence board is not held on the server at the moment, and this answer never starts that work, so no flow signal is stated. That is not the same as no stock being on the board.')
    else lines.push(`${facts.on_board} of the ${count} ${facts.on_board === 1 ? 'is' : 'are'} on the confluence board.`)
    lines.push(GROUP_PCT_MEANING)
    if (facts.rs_state !== 'not_held') lines.push(RS_MEANING)
    if (facts.flow_state !== 'not_held') lines.push(FLOW_MEANING)
  }
  lines.push(start && end ? `A change is measured between the closes of ${dayText(start)} and ${dayText(end)}.` : 'The ranking does not say which two days it measures between.')
  lines.push(built ? `The ranking was built by UCT at ${built} (UCT's own time).` : 'The ranking carries no build time, so I cannot say how old it is.')
  if (d.held === 'last_good') lines.push('Stale: this is the last good ranking for the range, so it may be behind the market.')
  lines.push(`Source: UCT's period ranking, RS ranking and confluence board (UCT's own ranking and grouping). ${DESCRIPTIVE} It is not a recommendation.`)
  return {
    text: lines.join('\n'),
    ...(rows.length ? { table: {
      columns: [{ key: 'symbol', label: 'Symbol' }, { key: 'change', label: 'Change' }, { key: 'closes', label: 'Closes' }, { key: 'rs', label: 'RS rank' }, { key: 'flow', label: 'Confluence board' }, { key: 'industry', label: 'Industry' }],
      rows: rows.map(r => ({ symbol: r.symbol, change: r.change_text || 'not in the ranking', closes: r.closes_text || '—', rs: facts.rs_state === 'not_held' ? 'not held' : r.rs ?? 'none',
        flow: facts.flow_state === 'not_held' ? 'not held' : r.flow_text || 'not on it', industry: r.industry || '—' })),
    }, present: {
      kind: 'metrics', title: `${name}, ${facts.range_words}`, short: name,
      items: rows.filter(r => r.change_text).slice(0, TEXT_ROWS * 2).map(r => ({ label: r.symbol, value: r.change_text, note: r.rs != null ? `RS rank ${r.rs}` : '', aka: [r.symbol.toLowerCase()] })),
    } } : {}),
    facts,
  }
}

export async function answerGroup(args = {}) {
  const range = GROUP_RANGE_KEYS.includes(args.range) ? args.range : DEFAULT_PERIOD_RANGE
  const words = rangeWords(range)
  const model = await import('../../pages/terminal/panels/groupDrillModel')
  let query = model.parseGroupQuery(typeof args.group === 'string' ? args.group : '')
  if (!query.kind && GROUP_KIND_KEYS.includes(args.kind)) query = { ...query, kind: args.kind }
  if (!query.text) return { text: groupAsk({ status: 'empty' }, model, words) }
  const turnId = currentTurnId()
  if (!turnId) return { text: `I couldn't read that group: ${NO_TURN}.` }
  // read 1: the names a group is resolved against (one kind when the request pins it, else all three)
  const listed = await readData('group.drill', { range, ...(query.kind ? { kind: query.kind } : {}) }, { purpose: 'answer', turnId })   // a LITERAL: qa/modelIsolation reads it
  if (!usable(listed)) return { text: noRead(`the groups ranked over ${words}`, listed, notHeld(words), NO_GROUP_TAIL) }
  const res = resolveAsked(groupLists(listed), args.group, args.kind, model)
  const ask = groupAsk(res, model, words)
  if (ask) return { text: ask }
  // read 2: the group the panel's resolver settled on, by its exact name
  const params = { range, kind: res.group.kind, group: res.group.name, sort: GROUP_SORT_KEYS.includes(args.sort) ? args.sort : 'pct',
    dir: GROUP_DIR_KEYS.includes(args.dir) ? args.dir : 'desc', limit: clamp(args.limit, GROUP_MAX_ROWS, GROUP_DEFAULT_ROWS) }
  const envl = await readData('group.drill', params, { purpose: 'answer', turnId })   // a LITERAL: qa/modelIsolation reads it
  const a = answerFromGroup(envl, model, { name: res.group.name, range })
  const also = (res.also || []).map(o => optionText(model, o))
  return also.length && a.facts ? { ...a, text: `${a.text}\nThe same name is also ${also.join(' and ')}: name the kind to open that one.` } : a
}

// ── routing words (armed only while registered; routing.js's `marketViews` group lists none) ─────────────────────────
// Routing v2 reaches the three by their summaries. v1 (the kill-switch fallback, and the router the capability-regression
// corpus runs) selects a group by its words, and `marketViews` is words-only: these words are the only way v1 sends it.
// Routing only ADDS a group (the other groups a message names still ride along: "earnings" still names the data group, and
// "earnings calls" the call search), and each pattern is kept off another capability's own language:
//   season   the earnings season by name, or the moves priced for a day's reporters: never who reports (calendar.day), one
//            stock's own expected move (stock.expectedMove), how a day's reporters moved (stock.earningsReactions), a
//            screen, an alert or the Calendar page;
//   themes   what was said ACROSS earnings calls (the phrases new or rising): never one phrase searched for
//            (stock.callSearch), never UCT's stock themes (stock.themes, stock.themeRotation), a page or a widget;
//   drill    the stocks INSIDE one named sector, industry or theme: never a screen ("find stocks in ..."), a watchlist, an
//            alert, a chart, the sector ranking itself (stock.sectorPerformance) or the theme ranking (stock.themes).
// ⛔ no lookbehind (iOS 16 floor, src/noRegexLookbehind.test.js).
const NOT_A_SCREEN_OR_PAGE = '^(?!.*\\b(?:scans?|screens?|screener|filters?|find|alerts?|notify|widgets?|page|tab|calendar|watchlists?)\\b)'
const NOT_STOCK_THEMES = '^(?!.*\\b(?:scans?|screens?|screener|filters?|find|alerts?|notify|widgets?|page|tab|rotat(?:ion|ing|e|es|ed)|uct themes?|option|options)\\b)'
const NOT_A_LIST_OR_CHART = '^(?!.*\\b(?:scans?|screens?|screener|filters?|find|alerts?|notify|widgets?|page|tab|watchlists?|lists?|my|charts?|add|remove|compare|versus|vs)\\b)'
export const WAVE4_ROUTE_WORDS = Object.freeze({
  season: [
    new RegExp(`${NOT_A_SCREEN_OR_PAGE}.*\\bearnings season\\b`),
    new RegExp(`${NOT_A_SCREEN_OR_PAGE}.*\\bpriced (?:in )?moves?\\b.*\\b(?:reporters|(?:today|tonight|tomorrow)(?:'s|’s)? earnings)\\b`),
  ],
  themes: [
    new RegExp(`${NOT_STOCK_THEMES}.*\\bwhat (?:are|were|have) (?:the )?(?:ceos?|executives|management teams?) (?:been )?(?:saying|talking about)\\b`),
    new RegExp(`${NOT_STOCK_THEMES}.*\\bcall themes\\b`),
    new RegExp(`${NOT_STOCK_THEMES}.*(?:\\b(?:rising|new|trending|emerging) (?:phrases|themes|topics|buzzwords)\\b.*\\bcalls?\\b|\\bcalls?\\b.*\\b(?:rising|trending|emerging) (?:phrases|themes|topics|buzzwords)\\b)`),
  ],
  drill: [
    new RegExp(`${NOT_A_LIST_OR_CHART}.*\\bdrill(?:[\\s-]?down)? (?:into|on|in)\\b`),
    new RegExp(`${NOT_A_LIST_OR_CHART}.*\\b(?:stocks|names|members|constituents|components) (?:in|of|inside) (?:the )?(?:[\\w&/.-]+ ){1,5}?(?:sector|industry|theme|group)\\b`),
    new RegExp(`${NOT_A_LIST_OR_CHART}.*\\bwhat(?:'s|’s| is) (?:in|inside) (?:the )?(?:[\\w&/.-]+ ){1,5}?(?:sector|industry|theme|group)\\b`),
  ],
})
export const ROUTE_GROUP = 'marketViews'
const ownGroup = () => GROUPS.find(g => g.id === ROUTE_GROUP)
/** Adds (or takes back) ONE capability's words on the wave's own group. */
function armRoutes(key, on) {
  const g = ownGroup()
  if (!g) return
  for (const re of WAVE4_ROUTE_WORDS[key]) {
    const at = g.words.indexOf(re)
    if (on && at < 0) g.words.push(re)
    if (!on && at >= 0) g.words.splice(at, 1)
  }
}

// ── registration: each capability only while the server serves ITS kind ───────────────────────────────────────────────
// ⚠️ THE WORDS OF A SUMMARY AND OF ITS HINTS JOIN THE TYPO LEXICON (nl/lexicon.js: every lowercase word of three letters or
// more; a word in CAPITALS does not). A new known word changes what a nearby word in ANY member message may be "corrected"
// to, so the text below is worded to leave every existing capability-regression phrasing's corrections exactly as they
// were (pinned in agentTerminalDataWave4.test.js, "the typo lexicon"): measured culprits were month, fund, reporter and
// reporters (each is in CAPITALS or reworded below).
const TARGET_HINT = 'target = the ref of the stockData entry.'
const NO_FIGURES = 'reply: one short line, no figures.'
const unregister = {}

/** Idempotent; registers each of the three ONLY while the server serves its kind. Returns the names registered by this call. */
export function registerTerminalWave4Capabilities() {
  const added = []
  if (!unregister.season && kindServed(KINDS.season)) {
    unregister.season = registerCapability({
      name: 'stock.earningsSeason',     // a LITERAL: the server's local-only mirror rail reads it (tests/test_uct_agent_breadth.py)
      surfaces: ['*'],
      target: 'market', query: true,
      localOnly: true,                  // ⛔ UCT's calendar with third-party results and estimates, and UCT's priced and past moves: shown to the member, never to a model
      summary: 'The EARNINGS SEASON for ONE DAY: the companies reporting that day (before the open, after the close), biggest first, each with the MOVE OPTIONS PRICED before the report, its PAST earnings moves, and the result and stock move once it lands. '
        + 'For "earnings season today", "earnings season for tomorrow", "priced moves for tonight\'s earnings".',
      hints: `${TARGET_HINT} date = the day as YYYY-MM-DD (a weekday) when the member named one ("today", "tomorrow", "Thursday"), else null = the next day with a report due. session: ${SEASON_SESSION_KEYS.join('|')} `
        + `(bmo = before the open, amc = after the close; "tonight" = today + amc; null = all). limit 1-${SEASON_MAX_ROWS} companies (null = ${SEASON_DEFAULT_ROWS}). Answered only from a day the server already holds, so it may say none is held. `
        + `WHO reports (tickers only) is calendar.day; how stocks MOVED after a past day's reports is stock.earningsReactions; one stock's own priced move is stock.expectedMove. ${NO_FIGURES}`,
      args: {
        type: 'object',
        properties: { date: { type: ['string', 'null'] }, session: { type: ['string', 'null'], enum: [...SEASON_SESSION_KEYS, null] }, limit: { type: ['integer', 'null'] } },
        required: ['date', 'session', 'limit'], additionalProperties: false,
      },
      answer: (_snap, args) => answerSeason(args || {}),
    })
    armRoutes('season', true)
    added.push(CAPABILITIES.season)
  }
  if (!unregister.themes && kindServed(KINDS.themes)) {
    unregister.themes = registerCapability({
      name: 'stock.callThemes',         // a LITERAL: the server's local-only mirror rail reads it
      surfaces: ['*'],
      target: 'market', query: true,
      localOnly: true,                  // ⛔ phrases taken from third-party transcripts: shown to the member, never to a model
      summary: 'CALL THEMES: the PHRASES NEW and RISING across a MONTH of EARNINGS CALLS, each with how many calls say it, the earlier share it is set against and a few example tickers. No transcript text. '
        + 'For "what are CEOs saying", "call themes", "rising phrases on earnings calls".',
      hints: `${TARGET_HINT} MONTH = YYYY-MM when the member named one, else null = the newest one with lists. list: ${THEME_LIST_KEYS.join('|')} (null = both). limit 1-${THEMES_MAX_ROWS} rows of each list (null = ${THEMES_DEFAULT_ROWS}). `
        + `It ranks phrases ACROSS calls. Searching the calls for ONE word or phrase a member names is stock.callSearch; UCT's stock themes are stock.themes and stock.themeRotation. ${NO_FIGURES}`,
      args: {
        type: 'object',
        properties: { month: { type: ['string', 'null'] }, list: { type: ['string', 'null'], enum: [...THEME_LIST_KEYS, null] }, limit: { type: ['integer', 'null'] } },
        required: ['month', 'list', 'limit'], additionalProperties: false,
      },
      answer: (_snap, args) => answerThemes(args || {}),
    })
    armRoutes('themes', true)
    added.push(CAPABILITIES.themes)
  }
  if (!unregister.drill && kindServed(KINDS.drill)) {
    unregister.drill = registerCapability({
      name: 'stock.groupDrill',         // a LITERAL: the server's local-only mirror rail reads it
      surfaces: ['*'],
      target: 'market', query: true,
      localOnly: true,                  // ⛔ UCT's RS rank, confluence board and themes: shown to the member, never to a model
      summary: 'The STOCKS INSIDE ONE GROUP: one SECTOR, INDUSTRY or UCT THEME, with each stock\'s percent change over a range (this MONTH up to one year), its RS RANK and whether it is on the confluence board. '
        + 'For "stocks in the semiconductors industry", "drill into XLK", "what is in the AI theme this quarter".',
      hints: `${TARGET_HINT} group = the group's name as the member said it, or a sector FUND's ticker (XLK). kind: ${GROUP_KIND_KEYS.join('|')} when the member said which, else null. range: ${GROUP_RANGE_KEYS.join('|')} `
        + `(null = ${DEFAULT_PERIOD_RANGE}: this year). sort: ${GROUP_SORT_KEYS.join('|')} (null = pct); dir: ${GROUP_DIR_KEYS.join('|')} (null = desc: biggest first). limit 1-${GROUP_MAX_ROWS} (null = ${GROUP_DEFAULT_ROWS}). `
        + `Answered only from a ranking the server already holds. Ranking the sectors themselves is stock.sectorPerformance; ranking themes is stock.themes; a screen with conditions is the Screener. ${NO_FIGURES}`,
      args: {
        type: 'object',
        properties: { group: { type: 'string' }, kind: { type: ['string', 'null'], enum: [...GROUP_KIND_KEYS, null] }, range: { type: ['string', 'null'], enum: [...GROUP_RANGE_KEYS, null] },
          sort: { type: ['string', 'null'], enum: [...GROUP_SORT_KEYS, null] }, dir: { type: ['string', 'null'], enum: [...GROUP_DIR_KEYS, null] }, limit: { type: ['integer', 'null'] } },
        required: ['group', 'kind', 'range', 'sort', 'dir', 'limit'], additionalProperties: false,
      },
      answer: (_snap, args) => answerGroup(args || {}),
    })
    armRoutes('drill', true)
    added.push(CAPABILITIES.drill)
  }
  return added
}
export const _resetTerminalWave4ForTest = () => {
  for (const k of Object.keys(unregister)) { unregister[k]?.(); delete unregister[k] }
  for (const k of Object.keys(WAVE4_ROUTE_WORDS)) armRoutes(k, false)
}
