// UCT Agent — terminal data wave 1: four LOCAL-ONLY answers (the Agent half of the UPDG / HILO / LEAD / LVL panels).
//
//   stock.analystActions     analyst upgrades, downgrades and price-target changes from the morning wire (market-wide)
//   stock.sessionHighsLows   stocks making new highs and new lows OF THE SESSION, and how many times (not 52-week)
//   stock.longRunLeaders     one of UCT's long-run lists: 30 / 60 / 90-session gainers, volume records, new listings
//   stock.darkPoolLevels     one stock's dark pool price levels (zones where confirmed dark pool prints bunched up)
//
// DATA: ONE gateway read each (`analyst.actions`, `highsLows.session`, `leaders.longRun`, `levels.darkpool`;
// api/services/uct_agent/marketdata/). Every row is shaped by the matching terminal panel's own pure helper
// (pages/terminal/panels/: UpgradesPanel `analystActions`, HighsLowsPanel `highsLowsBoard`, longRunModel
// `longRunView`, levelsModel `darkPoolRead` / `levelRows`), so the panel and the Agent read one shape. The two .jsx
// panels are loaded when an answer is built, never with the Agent itself.
// HONESTY: each answer states the data's own time or says why there is none; none says live or now (MD-1 §3). The
// analyst list is never called today's. A failed read is never "nothing to show". Nothing is predicted.
// GROUNDING: the text is templated from `facts` (returned beside it): every number in it is a fact's.
// ⛔ LOCAL ONLY (turn.LOCAL_ONLY_ACTIONS; all four kinds are model-isolated, ADR-005): the model plans the lookup and
// never sees what came back. Every capability in THIS module is local-only: the isolation rail
// (qa/modelIsolation.test.jsx) holds the whole module to that, which is why the sector answer lives in terminalData.js.
//
// Dark by construction: each is registered only while the server serves its own kind (UCT_AGENT_DATA_KINDS, fail
// closed; an isolated kind also needs its own UCT_AGENT_ISOLATED_KINDS entry or every read is refused).
// ROUTING: the four ride in the stock `data` group (by domain). Each one's own words (TERMINAL_ROUTE_WORDS) are added to that
// group only while it is registered, so on a dark server routing is byte-identical to the base (as cot / rs / catalysts).
import { registerCapability } from '../capabilities'
import { readData } from '../marketdata/client'
import { currentTurnId } from '../trace'
import { GROUPS } from '../routing'
import { stampET } from './marketDataFacts'
import { LONG_RUN_LENSES, LONG_RUN_LENS_KEYS, longRunView } from '../../pages/terminal/panels/longRunModel'
import { darkPoolRead, levelRows, LEVEL_KINDS } from '../../pages/terminal/panels/levelsModel'
import { kindServed, usable, noRead, money, pct, whole, millions, plural, andList, dayText, etDayOf, NO_TURN } from './terminalDataFormat'

export const KINDS = Object.freeze({
  analyst: 'analyst.actions', highsLows: 'highsLows.session', leaders: 'leaders.longRun', darkPool: 'levels.darkpool',
})
export const CAPABILITIES = Object.freeze({
  analyst: 'stock.analystActions', highsLows: 'stock.sessionHighsLows', leaders: 'stock.longRunLeaders', darkPool: 'stock.darkPoolLevels',
})
const NONE_STATED = 'No figure is stated.'
const TEXT_ROWS = 10
const DESCRIPTIVE = 'Descriptive only: nothing here is a prediction.'

// ── stock.analystActions ───────────────────────────────────────────────────────────────────────────────────────────────
/** What the member may ask for; the panel's `UPGRADE_KINDS` maps each to the kind's `side`. */
export const ANALYST_SIDES = ['all', 'upgrades', 'downgrades', 'targets']
const WIRE_SOURCE = "Source: the UCT morning wire's analyst actions. These are third-party analysts' calls as relayed, not UCT's view."

/** The `analyst.actions` envelope → the member's answer + its facts (pure). `panel` = `{ analystActions, UPGRADE_KINDS }`. */
export function answerFromAnalystActions(envl, panel, { side = 'all' } = {}) {
  if (!usable(envl)) {
    return { text: noRead("the morning wire's analyst actions", envl, "they are not available from UCT's data at the moment (this server may hold no morning wire yet)", NONE_STATED) }
  }
  const view = panel.analystActions(envl.data)
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(envl.data.wire_date || '')) ? envl.data.wire_date : null
  const rows = view.rows.map(r => ({
    symbol: r.sym, kind: r.kind, action: r.action, firm: r.firm, rating: r.rating,
    target: r.target, target_text: r.target != null ? money(r.target) : r.targetText,
  }))
  const counts = { upgrades: view.counts.upgrades, downgrades: view.counts.downgrades, targets: view.counts.targets }
  const facts = { side, wire_date: day, wire_day: dayText(day), stale: !!envl.stale, counts, shown: Math.min(rows.length, TEXT_ROWS), more_in_table: Math.max(rows.length - TEXT_ROWS, 0), rows }
  const which = day ? `the morning wire of ${facts.wire_day}` : 'the last morning wire held on this server'
  const lines = []
  if (!rows.length) {
    const none = side === 'all' ? 'no analyst actions' : `no ${panel.UPGRADE_KINDS[side].plural}`
    lines.push(`Analyst actions from ${which}: ${none} are listed.`)
  } else {
    const parts = [counts.upgrades ? plural(counts.upgrades, 'upgrade or new coverage call', 'upgrades or new coverage calls') : null,
      counts.downgrades ? plural(counts.downgrades, 'downgrade') : null,
      counts.targets ? plural(counts.targets, 'price-target change') : null].filter(Boolean)
    lines.push(`Analyst actions from ${which}: ${andList(parts)}.`)
    for (const r of rows.slice(0, TEXT_ROWS)) {
      const detail = [r.rating, r.target_text ? `target ${r.target_text}` : null].filter(Boolean).join(', ')
      lines.push(`• ${r.symbol} — ${r.action}${r.firm ? ` by ${r.firm}` : ''}${detail ? `: ${detail}` : ''}.`)
    }
    if (rows.length > TEXT_ROWS) lines.push(`(${facts.more_in_table} more in the table.)`)
  }
  if (!day) lines.push('This list carries no date, so I cannot say which morning it is from.')
  else if (envl.stale) lines.push(`Stale: a newer morning wire was due after ${facts.wire_day}, so this is not the latest list.`)
  lines.push('The list is served unchanged until the next morning wire arrives.')
  lines.push(WIRE_SOURCE)
  const table = rows.length ? {
    columns: [{ key: 'symbol', label: 'Symbol' }, { key: 'action', label: 'Action' }, { key: 'firm', label: 'Firm' }, { key: 'rating', label: 'Rating' }, { key: 'target', label: 'Target' }],
    rows: rows.map(r => ({ symbol: r.symbol, action: r.action, firm: r.firm || '—', rating: r.rating || '—', target: r.target_text || '—' })),
  } : null
  return {
    text: lines.join('\n'),
    ...(table ? { table } : {}),
    ...(rows.length ? { present: {
      kind: 'metrics', title: `Analyst actions${facts.wire_day ? `, ${facts.wire_day} morning wire` : ''}`, short: 'Analyst actions',
      items: rows.slice(0, TEXT_ROWS).map(r => ({ label: r.symbol, value: r.action, note: [r.firm, r.rating, r.target_text ? `target ${r.target_text}` : null].filter(Boolean).join(' · '), aka: [r.symbol.toLowerCase()] })),
    } } : {}),
    facts,
  }
}

export async function answerAnalystActions(args = {}) {
  const side = ANALYST_SIDES.includes(args.side) ? args.side : 'all'
  const turnId = currentTurnId()
  if (!turnId) return { text: `I couldn't read the morning wire's analyst actions: ${NO_TURN}.` }
  const panel = await import('../../pages/terminal/panels/UpgradesPanel')
  const envl = await readData('analyst.actions', { side: panel.UPGRADE_KINDS[side].bucket || 'all' }, { purpose: 'answer', turnId })   // a LITERAL: qa/modelIsolation reads it
  return answerFromAnalystActions(envl, panel, { side })
}

// ── stock.sessionHighsLows ─────────────────────────────────────────────────────────────────────────────────────────────
export const HILO_SIDE_KEYS = ['both', 'highs', 'lows']
export const HILO_MAX_ROWS = 50
const HILO_DEFAULT_ROWS = 15
const HILO_TEXT_ROWS = 5
export const NOT_52_WEEK = 'These are highs and lows of the session, not 52-week highs and lows; the count is how many times a stock has made one this session.'

/** The `highsLows.session` envelope → the member's answer + its facts (pure). `panel` = `{ highsLowsBoard, HILO_SESSIONS }`. */
export function answerFromHighsLows(envl, panel, { side = 'both' } = {}) {
  if (!usable(envl)) {
    return { text: noRead("UCT's new highs and lows scanner", envl, "it has no counts available at the moment (the scanner may be switched off, or the market closed with no session held)", NONE_STATED) }
  }
  const board = panel.highsLowsBoard(envl.data)
  const session = panel.HILO_SESSIONS[board.window] || panel.HILO_SESSIONS.closed
  const closed = envl.freshness === 'historical' || board.window === 'closed'
  const shape = (r) => ({ symbol: r.sym, times: r.count, price: r.price, price_text: money(r.price), change_pct: r.pct, change: pct(r.pct) })
  const highs = side === 'lows' ? [] : board.highs.map(shape)
  const lows = side === 'highs' ? [] : board.lows.map(shape)
  const tick = stampET(envl.data.tick_at, envl.fetched_at)
  const facts = {
    side, window: board.window, session: session.badge, date: board.date, day: dayText(board.date), closed, stale: !!envl.stale, tick,
    highs_total: board.highsTotal, lows_total: board.lowsTotal, highs, lows,
  }
  const when = facts.day ? `, ${facts.day}` : ''
  const lines = [`New highs and new lows ${closed ? 'of the last tracked session' : session.of} (${closed ? 'market closed' : session.badge.toLowerCase()})${when}: `
    + `${plural(facts.highs_total, 'stock')} at a new high, ${plural(facts.lows_total, 'stock')} at a new low.`]
  const row = (r) => `${r.symbol} (${plural(r.times, 'time')}${r.price_text ? `, ${r.price_text}` : ''}${r.change ? `, ${r.change} vs the prior close` : ''})`
  if (highs.length) lines.push(`Most new highs: ${highs.slice(0, HILO_TEXT_ROWS).map(row).join('; ')}.`)
  if (lows.length) lines.push(`Most new lows: ${lows.slice(0, HILO_TEXT_ROWS).map(row).join('; ')}.`)
  if (highs.length > HILO_TEXT_ROWS || lows.length > HILO_TEXT_ROWS) lines.push('More are in the table.')
  lines.push(NOT_52_WEEK)
  if (closed) lines.push('The market is closed: these are the counts of the last tracked session, not a reading of an open session.')
  lines.push(`Counts as of the scanner's last reading${tick ? ` at ${tick}` : ''} (UCT's own polling time, not an exchange timestamp).`)
  if (envl.stale) lines.push("Stale: the scanner's last reading is more than a minute old, so newer highs and lows may be missing.")
  lines.push("Source: UCT's new highs and lows scanner.")
  const tableRows = [...highs.map(r => ({ side: 'New high', ...r })), ...lows.map(r => ({ side: 'New low', ...r }))]
  return {
    text: lines.join('\n'),
    ...(tableRows.length ? { table: {
      columns: [{ key: 'side', label: 'Side' }, { key: 'symbol', label: 'Symbol' }, { key: 'times', label: 'Times this session' }, { key: 'price', label: 'Price' }, { key: 'change', label: 'Change vs prior close' }],
      rows: tableRows.map(r => ({ side: r.side, symbol: r.symbol, times: r.times, price: r.price_text || '—', change: r.change || '—' })),
    } } : {}),
    present: {
      kind: 'metrics', title: `New highs and lows ${session.of}`, short: 'Highs and lows',
      items: [{ label: 'Stocks at a new high', value: String(facts.highs_total), note: session.badge, aka: ['new highs', 'highs'] },
        { label: 'Stocks at a new low', value: String(facts.lows_total), note: session.badge, aka: ['new lows', 'lows'] }],
    },
    facts,
  }
}

export async function answerHighsLows(args = {}) {
  const side = HILO_SIDE_KEYS.includes(args.side) ? args.side : 'both'
  const limit = Number.isInteger(args.limit) ? Math.min(Math.max(args.limit, 1), HILO_MAX_ROWS) : HILO_DEFAULT_ROWS
  const params = { limit }
  if (typeof args.min_price === 'number' && Number.isFinite(args.min_price) && args.min_price > 0) params.min_price = args.min_price
  const turnId = currentTurnId()
  if (!turnId) return { text: `I couldn't read UCT's new highs and lows scanner: ${NO_TURN}.` }
  const envl = await readData('highsLows.session', params, { purpose: 'answer', turnId })   // a LITERAL: qa/modelIsolation reads it
  const panel = await import('../../pages/terminal/panels/HighsLowsPanel')
  return answerFromHighsLows(envl, panel, { side })
}

// ── stock.longRunLeaders ───────────────────────────────────────────────────────────────────────────────────────────────
export const LEADERS_MAX_ROWS = 50
const LEADERS_DEFAULT_ROWS = 20
const listedText = (ymd) => (dayText(ymd) || '').replace(/^\w+, /, '') || null

/** The `leaders.longRun` envelope → the member's answer + its facts (pure). The rows come from longRunModel `longRunView`. */
export function answerFromLeaders(envl, lens) {
  const meta = LONG_RUN_LENSES[lens]
  if (!meta) return { text: `I couldn't tell which long-run list that is. ${NONE_STATED}` }
  if (!usable(envl)) {
    return { text: noRead(`UCT's list of ${meta.what.replace(/^the /, '')}`, envl, "it is not available from UCT's data at the moment (its reference may still be building, which takes a few minutes)", NONE_STATED) }
  }
  const view = longRunView(envl.data, lens)
  const total = Number.isInteger(envl.data.count) ? Math.max(envl.data.count, view.rows.length) : view.rows.length
  const rows = view.rows.map(r => ({
    symbol: r.sym, last: r.last, last_text: money(r.last), today_pct: r.todayPct, today: pct(r.todayPct),
    gain_pct: r.gainPct, gain: pct(r.gainPct), ref_close: r.refClose, ref_close_text: money(r.refClose),
    volume: r.volume, volume_text: whole(r.volume), record: r.record, record_text: whole(r.record),
    times_record: r.timesRecord, times_record_text: typeof r.timesRecord === 'number' ? r.timesRecord.toFixed(2) : null,
    listed: r.listed, listed_text: listedText(r.listed),
  }))
  const worked = stampET(envl.data.computed_at, envl.fetched_at)
  const facts = { list: lens, kind: meta.kind, sessions: meta.sessions ?? null, total, shown: Math.min(rows.length, TEXT_ROWS), more_in_table: Math.max(rows.length - TEXT_ROWS, 0), worked, rows }
  const lines = []
  if (!rows.length) {
    lines.push(`UCT's list of ${meta.what.replace(/^the /, '')} is empty. That can mean nothing qualifies, or that the market snapshot it is measured against was missing (before the open, or a feed miss): UCT's data cannot tell which.`)
  } else {
    lines.push(`UCT's ${meta.what.replace(/^the /, '')}: ${plural(total, 'name')}${rows.length < total ? `, the first ${rows.length} in the list's own order` : ''}.`)
    const line = {
      gain: (r) => `• ${r.symbol} ${r.gain || 'change not given'} over ${meta.sessions} sessions${r.ref_close_text ? ` (from a close of ${r.ref_close_text})` : ''}${r.last_text ? `, last ${r.last_text}` : ''}`,
      volume: (r) => `• ${r.symbol} ${r.volume_text || 'volume not given'} shares${r.times_record_text && r.record_text ? `, ${r.times_record_text} times its previous record of ${r.record_text} (${meta.span})` : ''}${r.last_text ? `, last ${r.last_text}` : ''}`,
      ipo: (r) => `• ${r.symbol} first traded ${r.listed_text || 'on a date not given'}${r.last_text ? `, last ${r.last_text}` : ''}`,
    }[meta.kind]
    for (const r of rows.slice(0, TEXT_ROWS)) lines.push(line(r))
    if (rows.length > TEXT_ROWS) lines.push(`(${facts.more_in_table} more in the table.)`)
  }
  lines.push(worked ? `Worked out by UCT at ${worked} from a market snapshot up to 30 seconds older (UCT's own time, not an exchange timestamp).`
    : 'The list carries no time, so I cannot say when it was worked out.')
  lines.push(`Source: UCT's scanner presets. ${DESCRIPTIVE}`)
  const cols = {
    gain: [{ key: 'gain', label: `Change, ${meta.sessions} sessions` }, { key: 'ref', label: 'From a close of' }],
    volume: [{ key: 'volume', label: 'Shares' }, { key: 'record', label: 'Previous record' }, { key: 'times', label: 'Times the record' }],
    ipo: [{ key: 'listed', label: 'First traded' }],
  }[meta.kind]
  return {
    text: lines.join('\n'),
    ...(rows.length ? { table: {
      columns: [{ key: 'symbol', label: 'Symbol' }, ...cols, { key: 'last', label: 'Last' }, { key: 'today', label: 'Change vs prior close' }],
      rows: rows.map(r => ({ symbol: r.symbol, gain: r.gain || '—', ref: r.ref_close_text || '—', volume: r.volume_text || '—', record: r.record_text || '—',
        times: r.times_record_text || '—', listed: r.listed_text || '—', last: r.last_text || '—', today: r.today || '—' })),
    }, present: {
      kind: 'metrics', title: `UCT ${meta.chip}`, short: meta.chip,
      items: rows.slice(0, TEXT_ROWS).map(r => ({ label: r.symbol, value: { gain: r.gain, volume: r.times_record_text ? `${r.times_record_text}x record` : r.volume_text, ipo: r.listed_text }[meta.kind] || '—', note: meta.chip, aka: [r.symbol.toLowerCase()] })),
    } } : {}),
    facts,
  }
}

export async function answerLeaders(args = {}) {
  const lens = LONG_RUN_LENS_KEYS.includes(args.list) ? args.list : null
  if (!lens) return { text: `Which list should I read: ${andList(LONG_RUN_LENS_KEYS.map(k => LONG_RUN_LENSES[k].chip.toLowerCase()))}? ${NONE_STATED}` }
  const limit = Number.isInteger(args.limit) ? Math.min(Math.max(args.limit, 1), LEADERS_MAX_ROWS) : LEADERS_DEFAULT_ROWS
  const turnId = currentTurnId()
  if (!turnId) return { text: `I couldn't read UCT's long-run lists: ${NO_TURN}.` }
  const envl = await readData('leaders.longRun', { list: lens, limit }, { purpose: 'answer', turnId })   // a LITERAL: qa/modelIsolation reads it
  return answerFromLeaders(envl, lens)
}

// ── stock.darkPoolLevels ───────────────────────────────────────────────────────────────────────────────────────────────
const TICKER = /^[A-Z][A-Z.-]{0,9}$/
const upper = (s) => String(s || '').trim().toUpperCase().replace(/^\$/, '')

/** The `levels.darkpool` envelope → the member's answer + its facts (pure). Rows: levelsModel `darkPoolRead` / `levelRows`. */
export function answerFromDarkPool(envl, symbol) {
  if (!usable(envl)) {
    return { text: noRead(`${symbol}'s dark pool levels`, envl, "they are not available from UCT's data at the moment", 'No level is stated, and that is not the same as no levels.') }
  }
  const read = darkPoolRead(envl.data)
  if (read.state !== 'ok') return { text: `I couldn't read ${symbol}'s dark pool levels: UCT's data did not answer cleanly. No level is stated, and that is not the same as no levels.` }
  const rows = levelRows({ darkPoolLevels: read.levels }).filter(r => r.kind === 'darkPool').map(r => ({
    price: r.price, price_text: money(r.price), lo: r.lo, hi: r.hi, zone: r.lo != null && r.hi != null ? `${money(r.lo)} to ${money(r.hi)}` : null,
    notional: r.notional, notional_text: millions(r.notional), prints: r.printCount, rank: r.rank, last_print: r.lastDate, last_print_text: listedText(r.lastDate),
  }))
  const newest = etDayOf(envl.as_of)
  const facts = { symbol, window_days: read.windowDays, dates_covered: read.datesCovered, levels: rows.length, newest_print: newest, newest_print_day: dayText(newest), rows }
  const span = read.windowDays ? `the last ${read.windowDays} sessions` : 'the look-back window'
  const lines = []
  if (!rows.length) {
    lines.push(`${symbol} has no dark pool level over ${span}: no cluster of confirmed dark pool prints was large enough. That is a normal answer, not a failed read.`)
  } else {
    lines.push(`${symbol} dark pool levels from confirmed prints over ${span}${read.datesCovered != null ? ` (${plural(read.datesCovered, 'session')} had prints)` : ''}, highest price first: ${plural(rows.length, 'level')}.`)
    for (const r of rows) {
      const bits = [r.zone ? `zone ${r.zone}` : null, r.notional_text ? `${r.notional_text}${r.prints != null ? ` across ${plural(r.prints, 'print')}` : ''}` : null,
        r.rank != null ? `rank ${r.rank} by dollar value` : null, r.last_print_text ? `last print ${r.last_print_text}` : null].filter(Boolean)
      lines.push(`• ${r.price_text}${bits.length ? ` — ${bits.join(', ')}` : ''}`)
    }
    lines.push(LEVEL_KINDS.darkPool.meaning)
    lines.push(facts.newest_print_day ? `As of the newest confirmed print among these levels, ${facts.newest_print_day}.` : 'These levels carry no full print date, so I cannot say how recent the newest print is.')
  }
  lines.push('Dark pool prints are confirmed overnight, so nothing from a session still open is included.')
  lines.push(`Source: UCT's dark pool levels (computed by UCT from confirmed prints). ${DESCRIPTIVE}`)
  return {
    text: lines.join('\n'),
    ...(rows.length ? { table: {
      columns: [{ key: 'price', label: 'Level' }, { key: 'zone', label: 'Zone' }, { key: 'notional', label: 'Dollar value' }, { key: 'prints', label: 'Prints' }, { key: 'rank', label: 'Rank' }, { key: 'last', label: 'Last print' }],
      rows: rows.map(r => ({ price: r.price_text, zone: r.zone || '—', notional: r.notional_text || '—', prints: r.prints ?? '—', rank: r.rank ?? '—', last: r.last_print_text || '—' })),
    }, present: {
      kind: 'metrics', title: `${symbol} dark pool levels`, short: symbol,
      items: rows.map(r => ({ label: `${LEVEL_KINDS.darkPool.label}${r.rank != null ? ` ${r.rank}` : ''}`, value: r.price_text, note: [r.notional_text, r.last_print_text ? `last print ${r.last_print_text}` : null].filter(Boolean).join(' · '), aka: ['dark pool'] })),
    } } : {}),
    link: { href: `/research/${encodeURIComponent(symbol)}`, label: `Open ${symbol} in Research` },
    facts,
  }
}

export async function answerDarkPool(args = {}) {
  const symbol = upper(args.symbol)
  if (!TICKER.test(symbol)) return { text: `Which stock's dark pool levels should I read? Give me one ticker. ${NONE_STATED}` }
  const turnId = currentTurnId()
  if (!turnId) return { text: `I couldn't read ${symbol}'s dark pool levels: ${NO_TURN}.` }
  const envl = await readData('levels.darkpool', { symbol }, { purpose: 'answer', turnId })   // a LITERAL: qa/modelIsolation reads it
  return answerFromDarkPool(envl, symbol)
}

// ── routing words (armed only while registered; routing.js's `data` group does not list them) ─────────────────────────
// Routing v2 already reaches the four by their summaries. v1 (the kill-switch fallback, and the router the capability-regression
// corpus runs) selects a group by its words, and none of these asks named the data group: "what got upgraded today" named
// nothing (the budget fill then cut the data group), "new highs today" only breadth, "top gainers over 60 days" only the
// workspace and the screener, "dark pool levels on NVDA" only drawings.
// Routing only ADDS a group (the other groups a message names still ride along), and each pattern is kept off another
// capability's own language:
//   analyst    never the member's own plan ("upgrade my subscription");
//   highsLows  needs a word for THIS session, and is never a 52-week / 20-day / net / how-many measure (breadth.show);
//   leaders    "top gainers" needs a 30 / 60 / 90-session or 1-3 month window (today's movers and a member's own filter stay
//              the Screener's); record volume; new listings named alone (never "recent IPOs that are …": a screen);
//   darkPool   never the chart's dark-pool display setting (chart.setSetting), a screen, the options-flow widget or a page.
// ⛔ no lookbehind (iOS 16 floor, src/noRegexLookbehind.test.js).
const NOT_OWN_PLAN = '^(?!.*\\b(?:plans?|subscription|membership|account|tier|billing|pro|premium|app|version|browser)\\b)'
const NOT_BREADTH = '^(?!.*\\b(?:52[\\s-]?w(?:ee)?ks?|52w|20[\\s-]?days?|year(?:ly)?|all[\\s-]time|net new|how many|number of|count of|percent|pct)\\b)(?!.*%)'
const THIS_SESSION = '(?:today|of the (?:day|session)|on the day|for the day|this (?:morning|session|afternoon)|so far|intraday|right now|pre-?market|after[\\s-]?hours)'
const LONG_WINDOW = '(?:\\b(?:30|60|90)[\\s-]?(?:d|days?|sessions?|trading days)\\b|\\b(?:last|past) (?:(?:1|one|2|two|3|three) )?(?:months?|quarter)\\b|\\b(?:1|one|2|two|3|three)[\\s-]months?\\b)'
const NOT_CHART_SETTING = '^(?!.*\\b(?:widgets?|page|tab|panel|window|charts?|turn (?:on|off)|enable|disable|toggle|hide|colou?rs?|bars?|labels?|lines?|screens?|scans?|screener|filters?|(?:stocks|names|tickers) with|options flow)\\b)'
export const TERMINAL_ROUTE_WORDS = Object.freeze({
  analyst: [
    new RegExp(`${NOT_OWN_PLAN}.*\\b(?:upgrades?|upgraded|downgrades?|downgraded)\\b`),
    /\banalysts?(?:'s?|’s?)? (?:\w+ ){0,3}?(?:actions?|calls?|rating changes?|ratings?|price[\s-]targets?|targets?|coverage|initiations?)\b/,
    /\bprice[\s-]targets? (?:changes?|raises?|raised|hikes?|hiked|cuts?|lowered|bumps?|increases?|moves?|updates?)\b|\b(?:raised|raises?|cut|cuts|lowered|hiked|changed) (?:\w+ ){0,2}?price[\s-]targets?\b/,
    /\b(?:new|initiated|initiates?|started) coverage\b|\bcoverage initiations?\b/,
  ],
  highsLows: [
    new RegExp(`${NOT_BREADTH}(?=.*\\b${THIS_SESSION}\\b).*\\bnew (?:highs?|lows?)\\b`),
    new RegExp(`${NOT_BREADTH}.*\\b(?:highs?|lows?) of the (?:day|session)\\b|\\b(?:session|intraday) (?:highs?|lows?)\\b`),
  ],
  leaders: [
    new RegExp(`\\b(?:top|biggest|best|largest|strongest) (?:\\w+ )?(?:gainers|winners|performers)\\b.*${LONG_WINDOW}|${LONG_WINDOW}.*\\b(?:gainers|winners|top performers)\\b`),
    /\b(?:record|all[\s-]time(?: high)?|highest[\s-]ever) volume\b|\bvolume (?:records?|all[\s-]time highs?)\b|\b(?:highest|most|biggest|heaviest) volume (?:ever|on record|in (?:a|1|one|the (?:last|past)) year|of the (?:last |past )?year|in (?:its|their) history)\b/,
    /\b(?:recent|new|latest|newest) (?:ipos?|listings)\b(?! (?:that|which|with|where|above|below|over|under|near|trading|acting|making|breaking|in an?)\b)|\bipos? (?:in|of|from|over|within) the (?:last|past) (?:year|12 months|twelve months)\b|\bnewly listed\b/,
  ],
  darkPool: [
    new RegExp(`${NOT_CHART_SETTING}.*\\bdark[\\s-]?pools?\\b`),
  ],
})
const dataGroup = () => GROUPS.find(g => g.id === 'data')
/** Adds (or takes back) ONE capability's words on the data group; the group's own words are never touched. */
function armRoutes(key, on) {
  const g = dataGroup()
  if (!g) return
  for (const re of TERMINAL_ROUTE_WORDS[key]) {
    const at = g.words.indexOf(re)
    if (on && at < 0) g.words.push(re)
    if (!on && at >= 0) g.words.splice(at, 1)
  }
}

// ── registration: each capability only while the server serves ITS kind ───────────────────────────────────────────────
const TARGET_HINT = 'target = the ref of the stockData entry.'
const NO_FIGURES = 'reply: one short line, no figures.'
const unregister = {}

/** Idempotent; registers each of the four ONLY while the server serves its kind. Returns the names registered by this call. */
export function registerTerminalLocalCapabilities() {
  const added = []
  if (!unregister.analyst && kindServed(KINDS.analyst)) {
    unregister.analyst = registerCapability({
      name: 'stock.analystActions',     // a LITERAL: the server's local-only mirror rail reads it (tests/test_uct_agent_breadth.py)
      surfaces: ['*'],
      target: 'market', query: true,
      localOnly: true,                  // ⛔ third-party analyst calls: shown to the member, never to a model (turn.LOCAL_ONLY_ACTIONS)
      summary: 'Analyst UPGRADES, DOWNGRADES, new coverage and PRICE-TARGET changes across the market, from the last UCT morning wire: ticker, firm, rating change, target. '
        + 'For "any upgrades this morning", "who got downgraded", "analyst price target changes".',
      hints: `${TARGET_HINT} side: all|upgrades|downgrades|targets (null = all). Market-wide and dated by its morning wire: it is not a live feed and not one stock's rating history `
        + `(UCT's own rating: stock.profile). ${NO_FIGURES}`,
      args: { type: 'object', properties: { side: { type: ['string', 'null'], enum: [...ANALYST_SIDES, null] } }, required: ['side'], additionalProperties: false },
      answer: (_snap, args) => answerAnalystActions(args || {}),
    })
    armRoutes('analyst', true)
    added.push(CAPABILITIES.analyst)
  }
  if (!unregister.highsLows && kindServed(KINDS.highsLows)) {
    unregister.highsLows = registerCapability({
      name: 'stock.sessionHighsLows',   // a LITERAL: the server's local-only mirror rail reads it
      surfaces: ['*'],
      target: 'market', query: true,
      localOnly: true,                  // ⛔ UCT's own scanner counts: shown to the member, never to a model
      summary: 'Stocks making NEW HIGHS and NEW LOWS OF THE DAY (the current pre-market, regular or after-hours session) and how many times each has, from UCT\'s intraday scanner. '
        + 'For "what is making new highs today", "stocks hitting new lows of the day". NOT 52-week highs and lows.',
      hints: `${TARGET_HINT} side: both|highs|lows (null = both); limit 1-${HILO_MAX_ROWS} rows a side (null = ${HILO_DEFAULT_ROWS}); min_price = a dollar floor the member named, else null. `
        + `52-week highs / lows are a breadth measure (breadth.show), not this. ${NO_FIGURES}`,
      args: {
        type: 'object',
        properties: { side: { type: ['string', 'null'], enum: [...HILO_SIDE_KEYS, null] }, limit: { type: ['integer', 'null'] }, min_price: { type: ['number', 'null'] } },
        required: ['side', 'limit', 'min_price'], additionalProperties: false,
      },
      answer: (_snap, args) => answerHighsLows(args || {}),
    })
    armRoutes('highsLows', true)
    added.push(CAPABILITIES.highsLows)
  }
  if (!unregister.leaders && kindServed(KINDS.leaders)) {
    unregister.leaders = registerCapability({
      name: 'stock.longRunLeaders',     // a LITERAL: the server's local-only mirror rail reads it
      surfaces: ['*'],
      target: 'market', query: true,
      localOnly: true,                  // ⛔ UCT's own selections: shown to the member, never to a model
      summary: 'UCT\'s LONG-RUN LEADER LISTS: the biggest gainers over 30, 60 or 90 sessions, stocks trading record volume (the most in a year, or ever), and new listings of the last year. '
        + 'For "top gainers over the last 3 months", "stocks at all-time volume highs", "recent IPOs".',
      hints: `${TARGET_HINT} list: 30D|60D|90D (gainers over that many sessions) | VOL1Y (most volume in a year) | VOLMAX (most volume on record) | IPO (first traded in the last year); `
        + `limit 1-${LEADERS_MAX_ROWS} (null = ${LEADERS_DEFAULT_ROWS}). A member's own filter is the Screener (screener.run), not this. ${NO_FIGURES}`,
      args: {
        type: 'object',
        properties: { list: { type: 'string', enum: [...LONG_RUN_LENS_KEYS] }, limit: { type: ['integer', 'null'] } },
        required: ['list', 'limit'], additionalProperties: false,
      },
      answer: (_snap, args) => answerLeaders(args || {}),
    })
    armRoutes('leaders', true)
    added.push(CAPABILITIES.leaders)
  }
  if (!unregister.darkPool && kindServed(KINDS.darkPool)) {
    unregister.darkPool = registerCapability({
      name: 'stock.darkPoolLevels',     // a LITERAL: the server's local-only mirror rail reads it
      surfaces: ['*'],
      target: 'market', query: true,
      localOnly: true,                  // ⛔ UCT-computed levels: shown to the member, never to a model
      summary: 'One stock\'s DARK POOL LEVELS: the price zones where large confirmed off-exchange (dark pool) trades bunched up over the last few weeks, with dollar value, print count and last print date. '
        + 'For "dark pool levels for NVDA", "where are the big dark pool prints in AAPL".',
      hints: `${TARGET_HINT} symbol = the one ticker named (or the open chart's symbol). Confirmed prints only, never the current session. `
        + `Not options levels (gamma walls are not available here) and not the options flow tape. ${NO_FIGURES}`,
      args: { type: 'object', properties: { symbol: { type: 'string' } }, required: ['symbol'], additionalProperties: false },
      answer: (_snap, args) => answerDarkPool(args || {}),
    })
    armRoutes('darkPool', true)
    added.push(CAPABILITIES.darkPool)
  }
  return added
}
export const _resetTerminalLocalForTest = () => {
  for (const k of Object.keys(unregister)) { unregister[k]?.(); delete unregister[k] }
  for (const k of Object.keys(TERMINAL_ROUTE_WORDS)) armRoutes(k, false)
}
