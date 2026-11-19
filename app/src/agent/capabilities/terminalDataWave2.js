// UCT Agent — terminal data wave 2: five LOCAL-ONLY answers (the Agent half of the H52 / TROT / CONFL / EXMV / TSRC panels).
//
//   stock.yearlyHighsLows   the stocks at new 52-WEEK highs and new 52-week lows (the names behind the Breadth Monitor's counts)
//   stock.themeRotation     which of UCT's themes are rotating in and out (1-week rank against 1-month rank)
//   stock.confluenceBoard   UCT's confluence board: a large dark pool size and aligned long-dated options flow, lined up
//   stock.expectedMove      what the options market prices for one stock's earnings report, and what it priced before past ones
//   stock.callSearch        search the indexed earnings calls for a word or a phrase
//
// DATA: ONE gateway read each (`highsLows.yearly`, `themes.rotation`, `confluence.board`, `earnings.expectedMove`,
// `earnings.callSearch`; api/services/uct_agent/marketdata/, MD-1 §4.11). No read of this wave starts a build on the server:
// each answers from what its service already holds, or says why it cannot. The 52-week rows are shaped by the H52 panel's own
// pure helper (pages/terminal/panels/highs52Model `drillRead`), so the panel and the Agent read one shape.
// ⚠️ The TROT / CONFL / EXMV / TSRC panel models (themeRotationModel, confluenceModel, expectedMoveModel, callSearchModel) are
// on master since #1653 and not on the branch this was written on, so those four answers shape their rows here, by the same
// rules the models document (whole percentile ranks; the long-dated share is a fraction turned into a percent once; an excerpt
// is split on <mark> and never set as HTML). When both are on one branch, hand the rows to the models instead.
// HONESTY: each answer states the data's own time or says why there is none; none says live or now (MD-1 §3). A failed read is
// never "nothing to show": a list that could not be read, a board still building, a straddle that is not held and an empty
// index are each said in their own words. Nothing is predicted.
// GROUNDING: the text is templated from `facts` (returned beside it): every number in it is a fact's.
// ⛔ LOCAL ONLY (turn.LOCAL_ONLY_ACTIONS; all five kinds are model-isolated, ADR-005): the model plans the lookup and never
// sees what came back. An earnings-call excerpt is third-party transcript text: it is shown to the member exactly as the
// server cut it, and never enters a model request, a replay or a title. Every capability in THIS module is local-only: the
// isolation rail (qa/modelIsolation.test.jsx) holds the whole module to that.
//
// Dark by construction: each is registered only while the server serves its own kind (UCT_AGENT_DATA_KINDS, fail closed; an
// isolated kind also needs its own UCT_AGENT_ISOLATED_KINDS entry or every read is refused).
// ROUTING: the five ride in the stock `data` group (by domain). Each one's own words (WAVE2_ROUTE_WORDS) are added to that
// group only while it is registered, so on a dark server routing is byte-identical to the base.
import { registerCapability } from '../capabilities'
import { readData } from '../marketdata/client'
import { currentTurnId } from '../trace'
import { GROUPS } from '../routing'
import { stampET } from './marketDataFacts'
import { HIGHS52_SIDES, drillRead } from '../../pages/terminal/panels/highs52Model'
import { kindServed, usable, noRead, money, pct, whole, millions, plural, andList, dayText, etDayOf, NO_TURN } from './terminalDataFormat'

export const KINDS = Object.freeze({
  yearly: 'highsLows.yearly', rotation: 'themes.rotation', confluence: 'confluence.board', expectedMove: 'earnings.expectedMove', callSearch: 'earnings.callSearch',
})
export const CAPABILITIES = Object.freeze({
  yearly: 'stock.yearlyHighsLows', rotation: 'stock.themeRotation', confluence: 'stock.confluenceBoard', expectedMove: 'stock.expectedMove', callSearch: 'stock.callSearch',
})
const NONE_STATED = 'No figure is stated.'
const TEXT_ROWS = 5
const DESCRIPTIVE = 'Descriptive only: nothing here is a prediction.'
const TICKER = /^[A-Z][A-Z.-]{0,9}$/
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
const upper = (s) => String(s || '').trim().toUpperCase().replace(/^\$/, '')
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const clamp = (v, max, fallback) => (Number.isInteger(v) ? Math.min(Math.max(v, 1), max) : fallback)
/** "Fri, Nov 13, 2026" → "Nov 13, 2026" */
const shortDay = (ymd) => (dayText(ymd) || '').replace(/^\w+, /, '') || null

// ── stock.yearlyHighsLows ──────────────────────────────────────────────────────────────────────────────────────────────
export const YEARLY_SIDE_KEYS = Object.keys(HIGHS52_SIDES)         // both | highs | lows: the H52 panel's own
export const YEARLY_MAX_ROWS = 50
const YEARLY_DEFAULT_ROWS = 25
export const NOT_THE_DAY = 'These are 52-week highs and lows, not highs and lows of the day.'
const YEARLY_WHY = {
  finished: 'The session has finished: these are its stored lists.',
  thin: 'The breadth read of the session under way covers too few stocks to trust, so these are the lists of the last finished session.',
  closed: 'The market is not in session, so these are the lists of the last finished session.',
  no_read: 'No breadth read of a session under way was available to this answer, so these are the lists of the last finished session. A session may be under way.',
}

/** The `highsLows.yearly` envelope → the member's answer + its facts (pure). Rows: highs52Model `drillRead`. */
export function answerFromYearly(envl) {
  if (!usable(envl)) {
    return { text: noRead("UCT's new 52-week high and low lists", envl, "they are not available from UCT's data at the moment (no breadth read is held and no finished session is stored, or the lists could not be read)", NONE_STATED) }
  }
  const d = envl.data
  const inSession = d.mode === 'live'                               // the session is under way (the kind's own word for it)
  const day = ISO_DAY.test(String(d.session_date || '')) ? d.session_date : null
  const side = (s) => {
    const part = d[s]
    if (!part || typeof part !== 'object') return null             // not asked for
    if (part.state !== 'ok' || !Array.isArray(part.items)) return { state: 'missing', rows: [], total: 0 }
    const read = drillRead(inSession ? { ok: true, items: part.items, as_of: d.computed_at } : { date: day, items: part.items }, { side: s, live: inSession })
    if (read.state !== 'ok') return { state: 'missing', rows: [], total: 0 }
    const rows = read.rows.map(r => ({
      symbol: r.sym, name: r.name, price: r.price, price_text: money(r.price), change_pct: r.pct, change: pct(r.pct),
      rvol: r.rvol, rvol_text: r.rvol != null ? `${r.rvol.toFixed(1)}x` : null, volume: r.volume, volume_text: whole(r.volume),
    }))
    return { state: 'ok', rows, total: Number.isInteger(part.count) ? Math.max(part.count, rows.length) : rows.length }
  }
  const highs = side('highs')
  const lows = side('lows')
  const asOf = stampET(envl.as_of, envl.fetched_at)
  const counted = stampET(d.computed_at, envl.fetched_at)
  const facts = {
    side: d.side, in_session: inSession, why: d.why || null, session_date: day, day: dayText(day), stale: !!envl.stale,
    as_of: inSession ? asOf : null, counted_at: inSession ? counted : null, exchange_convention: d.basis === 'intraday',
    highs_total: highs?.state === 'ok' ? highs.total : null, lows_total: lows?.state === 'ok' ? lows.total : null,
    highs: highs?.rows || [], lows: lows?.rows || [], missing: [highs?.state === 'missing' ? 'highs' : null, lows?.state === 'missing' ? 'lows' : null].filter(Boolean),
  }
  const counts = [facts.highs_total != null ? `${plural(facts.highs_total, 'stock')} at a new 52-week high` : null,
    facts.lows_total != null ? `${plural(facts.lows_total, 'stock')} at a new 52-week low` : null].filter(Boolean)
  const when = facts.day || 'a session whose date is not given'
  const lines = [inSession ? `New 52-week highs and lows in the session of ${when}, so far: ${counts.join(', ')}.`
    : `New 52-week highs and lows of the finished session ${when}: ${counts.join(', ')}.`]
  const row = (r) => `${r.symbol} (${[r.price_text, r.change ? `${r.change} vs the prior close` : null].filter(Boolean).join(', ') || 'no price given'})`
  if (highs?.rows.length) lines.push(`New highs, biggest gain first: ${highs.rows.slice(0, TEXT_ROWS).map(row).join('; ')}.`)
  if (lows?.rows.length) lines.push(`New lows, biggest fall first: ${lows.rows.slice(0, TEXT_ROWS).map(row).join('; ')}.`)
  for (const [key, part] of [['high', highs], ['low', lows]]) {
    if (part?.state === 'missing') lines.push(`The new 52-week ${key} list could not be read for this session. That is not the same as no new ${key}s.`)
    else if (part && part.rows.length < part.total) lines.push(`The table holds the first ${part.rows.length} of the ${part.total} new ${key}s, in the list's own order.`)
    else if (part && part.rows.length > TEXT_ROWS) lines.push(`All ${part.rows.length} new ${key}s are in the table.`)
  }
  lines.push(NOT_THE_DAY)
  if (!inSession && YEARLY_WHY[d.why]) lines.push(YEARLY_WHY[d.why])
  if (inSession) {
    lines.push(asOf ? `Counted from the market snapshot of ${asOf}; the lists are recomputed about once a minute.`
      : `Counted by UCT${counted ? ` at ${counted}` : ''} (UCT's own time; the market snapshot's time is not carried).`)
    if (facts.exchange_convention) lines.push('Counted on the exchange convention: a trade above the prior 52-week high, or below the prior 52-week low.')
    if (envl.stale) lines.push('Stale: the breadth read behind these lists is more than five minutes old, so newer highs and lows may be missing.')
  } else {
    lines.push(`As of the close of ${when}.`)
    if (envl.stale) lines.push(`Stale: a more recent session has finished since ${when}, and its lists are not stored yet.`)
  }
  lines.push("Source: UCT's Breadth Monitor (UCT's own stock universe, not every listed stock).")
  const tableRows = [...(highs?.rows || []).map(r => ({ side: HIGHS52_SIDES.highs.caption, ...r })), ...(lows?.rows || []).map(r => ({ side: HIGHS52_SIDES.lows.caption, ...r }))]
  const items = [facts.highs_total != null ? { label: 'Stocks at a new 52-week high', value: String(facts.highs_total), note: facts.day || '', aka: ['52-week highs', 'new highs'] } : null,
    facts.lows_total != null ? { label: 'Stocks at a new 52-week low', value: String(facts.lows_total), note: facts.day || '', aka: ['52-week lows', 'new lows'] } : null].filter(Boolean)
  return {
    text: lines.join('\n'),
    ...(tableRows.length ? { table: {
      columns: [{ key: 'side', label: 'List' }, { key: 'symbol', label: 'Symbol' }, { key: 'name', label: 'Company' }, { key: 'price', label: 'Price' },
        { key: 'change', label: 'Change vs prior close' }, { key: 'rvol', label: 'Volume vs 20-day average' }, { key: 'volume', label: 'Shares' }],
      rows: tableRows.map(r => ({ side: r.side, symbol: r.symbol, name: r.name || '—', price: r.price_text || '—', change: r.change || '—', rvol: r.rvol_text || '—', volume: r.volume_text || '—' })),
    } } : {}),
    ...(items.length ? { present: { kind: 'metrics', title: `New 52-week highs and lows${facts.day ? `, ${facts.day}` : ''}`, short: '52-week highs and lows', items } } : {}),
    facts,
  }
}

export async function answerYearly(args = {}) {
  const side = YEARLY_SIDE_KEYS.includes(args.side) ? args.side : 'both'
  const limit = clamp(args.limit, YEARLY_MAX_ROWS, YEARLY_DEFAULT_ROWS)
  const turnId = currentTurnId()
  if (!turnId) return { text: `I couldn't read UCT's new 52-week high and low lists: ${NO_TURN}.` }
  const envl = await readData('highsLows.yearly', { side, limit }, { purpose: 'answer', turnId })   // a LITERAL: qa/modelIsolation reads it
  return answerFromYearly(envl)
}

// ── stock.themeRotation ────────────────────────────────────────────────────────────────────────────────────────────────
export const ROTATION_SIDE_KEYS = ['both', 'in', 'out']
export const ROTATION_MAX_ROWS = 50
const ROTATION_DEFAULT_ROWS = 20
const signedWhole = (d) => (d > 0 ? `+${d}` : d < 0 ? `−${Math.abs(d)}` : '0')

/** One rotation row, by themeRotationModel's rules: whole ranks, and a change that is the difference of the two shown. */
function rotationRow(e) {
  const from = num(e['1m_rank']) != null ? Math.round(e['1m_rank']) : null
  const to = num(e['1w_rank']) != null ? Math.round(e['1w_rank']) : null
  const delta = from != null && to != null ? to - from : num(e.momentum_delta) != null ? Math.round(e.momentum_delta) : null
  return {
    theme: String(e.name || e.ticker || '').trim(), key: String(e.ticker || '').trim(), rank_1m: from, rank_1w: to, rank_change: delta,
    rank_change_text: delta != null ? signedWhole(delta) : null, return_1w: num(e['1w_return']), return_1w_text: pct(num(e['1w_return'])),
    return_1m: num(e['1m_return']), return_1m_text: pct(num(e['1m_return'])), return_3m: num(e['3m_return']), return_3m_text: pct(num(e['3m_return'])),
  }
}

/** The `themes.rotation` envelope → the member's answer + its facts (pure). */
export function answerFromRotation(envl) {
  if (!usable(envl)) {
    return { text: noRead("UCT's theme rotation ranking", envl, "it is not held on the server at the moment (it is kept for 15 minutes after it is worked out, and this answer never starts that computation). Ask again shortly", NONE_STATED) }
  }
  const d = envl.data
  const side = ROTATION_SIDE_KEYS.includes(d.side) ? d.side : 'both'
  const rowsOf = (list) => (Array.isArray(list) ? list : []).filter(e => e && typeof e === 'object').map(rotationRow).filter(r => r.theme && r.rank_change != null)
  const into = side === 'out' ? [] : rowsOf(d.rotating_in)
  const out = side === 'in' ? [] : rowsOf(d.rotating_out)
  const count = (v, rows) => (Number.isInteger(v) ? Math.max(v, rows.length) : rows.length)
  const threshold = Number.isInteger(d.threshold) ? d.threshold : null
  const worked = stampET(d.computed_at, envl.fetched_at)
  const facts = { side, ranked: Number.isInteger(d.ranked) ? d.ranked : null, threshold, in_total: side === 'out' ? null : count(d.in_count, into), out_total: side === 'in' ? null : count(d.out_count, out), worked, rotating_in: into, rotating_out: out }
  const parts = [facts.in_total != null ? `${plural(facts.in_total, 'theme')} rotating in` : null, facts.out_total != null ? `${plural(facts.out_total, 'theme')} rotating out` : null].filter(Boolean)
  const lines = [`UCT theme rotation${facts.ranked != null ? `, ${plural(facts.ranked, 'theme')} ranked` : ''}: ${parts.join(', ')}.`]
  const line = (r) => `• ${r.theme}: rank ${r.rank_1m != null && r.rank_1w != null ? `${r.rank_1m} to ${r.rank_1w}` : 'change'} (${r.rank_change_text})${r.return_1w_text ? `, 1-week return ${r.return_1w_text}` : ''}${r.return_1m_text ? `, 1-month ${r.return_1m_text}` : ''}`
  for (const [label, rows, total] of [['Rotating in', into, facts.in_total], ['Rotating out', out, facts.out_total]]) {
    if (total == null) continue
    if (!rows.length) { lines.push(`${label}: no theme${threshold != null ? ` by ${threshold} points or more` : ''}.`); continue }
    lines.push(`${label}, biggest rank change first:`)
    for (const r of rows.slice(0, TEXT_ROWS)) lines.push(line(r))
    if (rows.length < total) lines.push(`(The table holds the first ${rows.length} of ${total}.)`)
    else if (rows.length > TEXT_ROWS) lines.push(`(${rows.length - TEXT_ROWS} more in the table.)`)
  }
  lines.push(`A rank is a theme's percentile among all of UCT's themes for that period (0 weakest, 100 strongest), shown as its 1-month rank then its 1-week rank.${threshold != null ? ` A theme is rotating in when its 1-week rank is ${threshold} or more points above its 1-month rank, and rotating out when it is ${threshold} or more below.` : ''}`)
  lines.push(worked ? `Worked out by UCT at ${worked} from its theme returns, and kept for up to 15 minutes (UCT's own time, not an exchange timestamp).`
    : 'The ranking carries no time, so I cannot say when it was worked out.')
  lines.push(`Source: UCT's theme rotation ranking (UCT's own themes). ${DESCRIPTIVE}`)
  const tableRows = [...into.map(r => ({ side: 'Rotating in', ...r })), ...out.map(r => ({ side: 'Rotating out', ...r }))]
  return {
    text: lines.join('\n'),
    ...(tableRows.length ? { table: {
      columns: [{ key: 'side', label: 'Side' }, { key: 'theme', label: 'Theme' }, { key: 'rank_1m', label: '1-month rank' }, { key: 'rank_1w', label: '1-week rank' },
        { key: 'change', label: 'Rank change' }, { key: 'r1w', label: '1-week return' }, { key: 'r1m', label: '1-month return' }, { key: 'r3m', label: '3-month return' }],
      rows: tableRows.map(r => ({ side: r.side, theme: r.theme, rank_1m: r.rank_1m ?? '—', rank_1w: r.rank_1w ?? '—', change: r.rank_change_text || '—', r1w: r.return_1w_text || '—', r1m: r.return_1m_text || '—', r3m: r.return_3m_text || '—' })),
    }, present: {
      kind: 'metrics', title: 'UCT theme rotation', short: 'Theme rotation',
      items: tableRows.slice(0, TEXT_ROWS * 2).map(r => ({ label: r.theme, value: `${r.rank_change_text} rank`, note: r.side, aka: [r.theme.toLowerCase()] })),
    } } : {}),
    facts,
  }
}

export async function answerRotation(args = {}) {
  const side = ROTATION_SIDE_KEYS.includes(args.side) ? args.side : 'both'
  const limit = clamp(args.limit, ROTATION_MAX_ROWS, ROTATION_DEFAULT_ROWS)
  const turnId = currentTurnId()
  if (!turnId) return { text: `I couldn't read UCT's theme rotation ranking: ${NO_TURN}.` }
  const envl = await readData('themes.rotation', { side, limit }, { purpose: 'answer', turnId })   // a LITERAL: qa/modelIsolation reads it
  return answerFromRotation(envl)
}

// ── stock.confluenceBoard ──────────────────────────────────────────────────────────────────────────────────────────────
/** What the member may ask for → the kind's `direction`. */
export const CONFLUENCE_LEANS = Object.freeze({ all: 'all', bullish: 'bull', bearish: 'bear' })
export const CONFLUENCE_MAX_ROWS = 50
const CONFLUENCE_DEFAULT_ROWS = 20
const BAND_WORDS = { L: 'Large cap', M: 'Mid cap', S: 'Small cap' }
const STATUS_WORDS = { BUILDING: 'building', STEADY: 'steady', ESTABLISHED: 'established' }
/** The flow store's `M/D/YYYY` → `YYYY-MM-DD`, or null. Never a time. */
function expiryDay(raw) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(raw ?? '').trim())
  if (!m || +m[1] < 1 || +m[1] > 12 || +m[2] < 1 || +m[2] > 31) return null
  return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
}
const windowWords = (raw) => String(raw ?? '').trim().replace(/\s*[–—]\s*|\s+-\s+/g, ' to ')

function confluenceRow(r) {
  const top = r.top && typeof r.top === 'object' ? r.top : {}
  const cp = String(top.cp ?? '').toUpperCase().charAt(0)
  const share = num(r.leapShare)
  const net = num(r.net)
  const expiry = expiryDay(top.exp)
  const strike = num(top.strike) > 0 ? top.strike : null
  const contract = cp === 'C' || cp === 'P' ? [shortDay(expiry), strike != null ? money(strike) : null, cp === 'C' ? 'call' : 'put'].filter(Boolean).join(' ') : null
  return {
    symbol: String(r.sym || '').trim().toUpperCase(), band: BAND_WORDS[r.band] || null, direction: r.dir === 'BULL' ? 'bullish' : 'bearish',
    status: STATUS_WORDS[String(r.status || '').toUpperCase()] || null, sector: r.sector ? String(r.sector) : null,
    dark_pool: num(r.dpn), dark_pool_text: millions(num(r.dpn)), avg_price: num(r.dpAvg) > 0 ? r.dpAvg : null, avg_price_text: num(r.dpAvg) > 0 ? money(r.dpAvg) : null,
    net_premium: net, net_premium_text: net != null ? millions(Math.abs(net)) : null,
    // the one place the server's fraction (0 to 1) becomes a percent
    long_dated_pct: share != null ? Math.round(share * 100) : null,
    top_contract: contract, top_premium: num(top.prem) > 0 ? top.prem : null, top_premium_text: num(top.prem) > 0 ? millions(top.prem) : null,
  }
}

/** The `confluence.board` envelope → the member's answer + its facts (pure). */
export function answerFromConfluence(envl, { lean = 'all' } = {}) {
  if (!usable(envl)) {
    return { text: noRead("UCT's confluence board", envl, "it is not available from UCT's data at the moment (the board may still be building on the server, which takes a few minutes)", NONE_STATED) }
  }
  const d = envl.data
  const rows = (Array.isArray(d.rows) ? d.rows : []).filter(r => r && typeof r === 'object' && r.sym && (r.dir === 'BULL' || r.dir === 'BEAR')).map(confluenceRow)
  const c = d.counts && typeof d.counts === 'object' ? d.counts : {}
  const total = Number.isInteger(c.total) ? c.total : rows.length
  const matching = Number.isInteger(d.count) ? Math.max(d.count, rows.length) : rows.length
  const built = stampET(d.built_at, envl.fetched_at)
  const span = windowWords(d.window)
  const facts = {
    lean, days: Number.isInteger(d.days) ? d.days : null, window: span || null, total, bullish: Number.isInteger(c.bull) ? c.bull : null, bearish: Number.isInteger(c.bear) ? c.bear : null,
    building: Number.isInteger(c.building) ? c.building : null, matching, shown: rows.length, built, refresh_minutes: Number.isInteger(d.refresh_minutes) ? d.refresh_minutes : null,
    stale: !!envl.stale, incomplete: d.incomplete === true || envl.status === 'partial', rows,
  }
  const over = `${span ? `dark pool window ${span}` : 'its dark pool window'}${facts.days != null ? ` (${facts.days} trading days)` : ''}`
  const lines = []
  if (!total) {
    lines.push(`UCT's confluence board has no stock on it for ${over}: nothing passes its gate. That is a normal answer, not a failed read.`)
  } else {
    const mix = [facts.bullish != null ? `${facts.bullish} bullish` : null, facts.bearish != null ? `${facts.bearish} bearish` : null].filter(Boolean)
    lines.push(`UCT confluence board, ${over}: ${plural(total, 'stock')}${mix.length ? `, ${andList(mix)}` : ''}${facts.building ? `; ${facts.building} still building` : ''}.`)
    if (!rows.length) lines.push(`None of them is ${lean === 'all' ? 'listed' : lean}.`)
    else {
      if (rows.length < matching) lines.push(`Showing the first ${rows.length} of the ${matching}${lean === 'all' ? '' : ` ${lean}`} names, best ranked first.`)
      else if (lean !== 'all') lines.push(`The ${plural(matching, `${lean} name`)}, best ranked first:`)
      for (const r of rows.slice(0, TEXT_ROWS)) {
        const tag = [r.band, r.direction, r.status].filter(Boolean).join(', ')
        const bits = [r.dark_pool_text ? `${r.dark_pool_text} traded in the dark pool${r.avg_price_text ? ` at an average of ${r.avg_price_text}` : ''}` : null,
          r.net_premium_text ? `net ${r.direction} option premium ${r.net_premium_text}${r.long_dated_pct != null ? `, ${r.long_dated_pct}% of the open premium long-dated` : ''}` : null,
          r.top_contract ? `largest position the ${r.top_contract}${r.top_premium_text ? ` (${r.top_premium_text})` : ''}` : null].filter(Boolean)
        lines.push(`• ${r.symbol} (${tag})${bits.length ? `: ${bits.join('; ')}` : ''}`)
      }
      if (rows.length > TEXT_ROWS) lines.push(`(${rows.length - TEXT_ROWS} more in the table.)`)
      lines.push('Building: the last 5 trading days added a large part of the window\'s net premium, the same way. Steady: still adding, more slowly. Established: in place, not adding.')
      lines.push('The direction comes from the options flow: a dark pool print names a price, not a buyer. Dark pool prices are from dark pool sessions, never a quote of the moment.')
    }
  }
  if (facts.incomplete) lines.push('One options-flow leg could not be read when this board was built, so some names may be missing.')
  lines.push(built ? `Built by UCT at ${built}${facts.refresh_minutes ? ` and rebuilt about every ${facts.refresh_minutes} minutes` : ''}; the board carries no data time (UCT's own build time, not an exchange timestamp).`
    : 'The board carries no build time, so I cannot say how old it is.')
  if (envl.stale && built) lines.push('Stale: the board is older than its usual refresh, so it may be behind the latest options flow.')
  lines.push(`Source: UCT's confluence board (UCT's own screen of dark pool size and options flow). ${DESCRIPTIVE} It is not a recommendation.`)
  return {
    text: lines.join('\n'),
    ...(rows.length ? { table: {
      columns: [{ key: 'symbol', label: 'Symbol' }, { key: 'band', label: 'Size' }, { key: 'direction', label: 'Direction' }, { key: 'status', label: 'Status' }, { key: 'dark', label: 'Dark pool dollars' },
        { key: 'avg', label: 'Average dark pool price' }, { key: 'net', label: 'Net option premium' }, { key: 'long', label: 'Long-dated share' }, { key: 'top', label: 'Largest position' }],
      rows: rows.map(r => ({ symbol: r.symbol, band: r.band || '—', direction: r.direction, status: r.status || '—', dark: r.dark_pool_text || '—', avg: r.avg_price_text || '—',
        net: r.net_premium_text || '—', long: r.long_dated_pct != null ? `${r.long_dated_pct}%` : '—', top: r.top_contract || '—' })),
    }, present: {
      kind: 'metrics', title: 'UCT confluence board', short: 'Confluence',
      items: rows.slice(0, TEXT_ROWS * 2).map(r => ({ label: r.symbol, value: [r.direction, r.status].filter(Boolean).join(', '), note: [r.band, r.dark_pool_text ? `${r.dark_pool_text} dark pool` : null].filter(Boolean).join(' · '), aka: [r.symbol.toLowerCase()] })),
    } } : {}),
    facts,
  }
}

export async function answerConfluence(args = {}) {
  const lean = Object.prototype.hasOwnProperty.call(CONFLUENCE_LEANS, args.direction) ? args.direction : 'all'
  const limit = clamp(args.limit, CONFLUENCE_MAX_ROWS, CONFLUENCE_DEFAULT_ROWS)
  const turnId = currentTurnId()
  if (!turnId) return { text: `I couldn't read UCT's confluence board: ${NO_TURN}.` }
  const envl = await readData('confluence.board', { direction: CONFLUENCE_LEANS[lean], limit }, { purpose: 'answer', turnId })   // a LITERAL: qa/modelIsolation reads it
  return answerFromConfluence(envl, { lean })
}

// ── stock.expectedMove ─────────────────────────────────────────────────────────────────────────────────────────────────
const plusMinus = (v) => (num(v) != null && v > 0 ? `±${v.toFixed(2)}%` : null)
const isoDay = (v) => { const s = String(v ?? '').slice(0, 10); return ISO_DAY.test(s) ? s : null }

/** The `earnings.expectedMove` envelope → the member's answer + its facts (pure). */
export function answerFromExpectedMove(envl, symbol) {
  if (!usable(envl)) {
    return { text: noRead(`${symbol}'s expected move`, envl, "nothing is held for it at the moment: no straddle is on the server and no capture is stored. That is not the same as no move being priced", NONE_STATED) }
  }
  const d = envl.data
  const reportDay = isoDay(d.report_date)
  const l = d.live && typeof d.live === 'object' && num(d.live.pct) > 0 ? d.live : null
  const spot = l && num(l.spot) > 0 ? l.spot : null
  const dollars = l && num(l.dollar) > 0 ? l.dollar : null
  const priced = l ? {
    pct: l.pct, pct_text: plusMinus(l.pct), dollars, dollars_text: money(dollars), spot, spot_text: money(spot), strike: num(l.strike) > 0 ? l.strike : null,
    strike_text: num(l.strike) > 0 ? money(l.strike) : null, expiry: isoDay(l.expiry), expiry_text: shortDay(isoDay(l.expiry)),
    low: spot != null && dollars != null && spot > dollars ? spot - dollars : null, high: spot != null && dollars != null ? spot + dollars : null,
    read_at: stampET(d.read_at, envl.fetched_at), last_good: d.live_state === 'last_good',
  } : null
  if (priced) { priced.low_text = money(priced.low); priced.high_text = money(priced.high) }
  const today = etDayOf(envl.fetched_at)                           // the read's own Eastern day, never the browser clock
  const history = (Array.isArray(d.history) ? d.history : []).filter(h => h && typeof h === 'object' && isoDay(h.report_date) && num(h.pct) > 0).map(h => {
    const fq = Number.isInteger(h.fiscal_quarter) && h.fiscal_quarter >= 1 && h.fiscal_quarter <= 4 ? h.fiscal_quarter : null
    const day = isoDay(h.report_date)
    return {
      report_date: day, report_day: shortDay(day), ahead: !!today && day >= today, quarter: fq && Number.isInteger(h.fiscal_year) ? `Q${fq} ${h.fiscal_year}` : null,
      pct: h.pct, pct_text: plusMinus(h.pct), dollars: num(h.dollar) > 0 ? h.dollar : null, dollars_text: num(h.dollar) > 0 ? money(h.dollar) : null,
      captured: isoDay(h.captured_at), captured_text: shortDay(isoDay(h.captured_at)),
    }
  })
  const facts = { symbol, report_date: reportDay, report_day: shortDay(reportDay), priced, stale: !!envl.stale, history, history_since: isoDay(d.history_since), store_read: d.store_read !== false }
  const lines = []
  if (priced) {
    const on = [priced.dollars_text ? `about ${priced.dollars_text}` : null, priced.spot_text ? `on a ${priced.spot_text} stock price` : null].filter(Boolean).join(' ')
    lines.push(`${symbol} expected move: ${priced.pct_text}${on ? ` (${on})` : ''}, the price of the at-the-money straddle${priced.strike_text ? ` at the ${priced.strike_text} strike` : ''}${priced.expiry_text ? `, through the ${priced.expiry_text} expiry` : ''}.`)
    if (priced.low_text && priced.high_text) lines.push(`That puts the break-even prices near ${priced.low_text} and ${priced.high_text}.`)
    if (facts.report_day) {
      lines.push(`It is the first expiry on or after the report date of ${facts.report_day}.`)
      if (priced.expiry && priced.expiry === reportDay) lines.push('That expiry is the report day itself: for a report after the close, these options settle before the result is out.')
    } else {
      lines.push('No report date was given or stored, so this is the nearest expiry: it spans the next earnings report only if the report falls before it.')
    }
    lines.push(priced.read_at ? `Read by UCT from its option chain at ${priced.read_at} (UCT's own read time, not an exchange timestamp).` : 'The read carries no time, so I cannot say when the option chain was read.')
    if (priced.last_good) lines.push('Stale: this is the last good read, older than the 15 minutes it is normally kept, so it may be behind the option market.')
  } else {
    lines.push(`No expected move for ${symbol} is held on the server at the moment, and this answer never starts an option chain read, so no straddle price is stated. Open ${symbol} in Research to read it.`)
  }
  if (history.length) {
    lines.push('What the straddle priced before each report, captured once by UCT ahead of it:')
    for (const h of history) lines.push(`• ${[h.quarter, `report of ${h.report_day}`].filter(Boolean).join(', ')}${h.ahead ? ' (still ahead)' : ''}: ${h.pct_text}${h.dollars_text ? ` (${h.dollars_text})` : ''}${h.captured_text ? `, captured ${h.captured_text}` : ''}`)
  } else {
    lines.push(facts.store_read ? `No stored capture is held for ${symbol}: the capture store began recently and many stocks have none.`
      : 'The stored captures could not be read, which is not the same as none being held.')
  }
  lines.push('The expected move is what the options market prices, not a forecast, and it runs to the option expiry, not only the session after the report. What the stock did after past reports is not part of this answer.')
  lines.push("Source: UCT's expected-move read (its own option chain) and its capture store.")
  const items = [priced ? { label: `${symbol} expected move`, value: priced.pct_text, note: [priced.dollars_text, priced.expiry_text ? `through ${priced.expiry_text}` : null].filter(Boolean).join(' · '), aka: ['expected move', 'implied move'] } : null,
    ...history.slice(0, TEXT_ROWS).map(h => ({ label: `Priced before ${h.report_day}`, value: h.pct_text, note: h.ahead ? 'report still ahead' : h.quarter || '', aka: [] }))].filter(Boolean)
  return {
    text: lines.join('\n'),
    ...(history.length ? { table: {
      columns: [{ key: 'report', label: 'Report date' }, { key: 'quarter', label: 'Quarter' }, { key: 'move', label: 'Priced move' }, { key: 'dollars', label: 'In dollars' }, { key: 'captured', label: 'Captured' }],
      rows: history.map(h => ({ report: `${h.report_day}${h.ahead ? ' (ahead)' : ''}`, quarter: h.quarter || '—', move: h.pct_text, dollars: h.dollars_text || '—', captured: h.captured_text || '—' })),
    } } : {}),
    ...(items.length ? { present: { kind: 'metrics', title: `${symbol} expected move`, short: symbol, items } } : {}),
    link: { href: `/research/${encodeURIComponent(symbol)}`, label: `Open ${symbol} in Research` },
    facts,
  }
}

export async function answerExpectedMove(args = {}) {
  const symbol = upper(args.symbol)
  if (!TICKER.test(symbol)) return { text: `Which stock's expected move should I read? Give me one ticker. ${NONE_STATED}` }
  const params = { symbol }
  if (typeof args.report_date === 'string' && ISO_DAY.test(args.report_date)) params.report_date = args.report_date
  const turnId = currentTurnId()
  if (!turnId) return { text: `I couldn't read ${symbol}'s expected move: ${NO_TURN}.` }
  const envl = await readData('earnings.expectedMove', params, { purpose: 'answer', turnId })   // a LITERAL: qa/modelIsolation reads it
  return answerFromExpectedMove(envl, symbol)
}

// ── stock.callSearch ───────────────────────────────────────────────────────────────────────────────────────────────────
export const CALL_SEARCH_MIN_QUERY = 2
export const CALL_SEARCH_MAX_QUERY = 120
export const CALL_SEARCH_MAX_ROWS = 40
const CALL_SEARCH_DEFAULT_ROWS = 10
/** An excerpt as plain text: the index's <mark> tags are dropped and nothing else is touched (third-party text, never HTML). */
export const excerptText = (snippet) => String(snippet ?? '').replace(/<\/?mark>/g, '').replace(/\s+/g, ' ').trim()
/** What the member typed as a query the kind will take, or null. */
export function callQuery(raw) {
  const q = String(raw ?? '').replace(/\s+/g, ' ').trim()
  return q.length >= CALL_SEARCH_MIN_QUERY && q.length <= CALL_SEARCH_MAX_QUERY && /[\p{L}\p{N}]/u.test(q) ? q : null
}

/** The `earnings.callSearch` envelope → the member's answer + its facts (pure). */
export function answerFromCallSearch(envl, query) {
  if (!usable(envl)) {
    return { text: noRead('the earnings call search', envl, "it could not be run on UCT's index at the moment (the index may hold no calls yet, or the search could not be run as typed). That is not the same as no call mentioning it", 'No excerpt is quoted.') }
  }
  const d = envl.data
  const q = String(d.query || query || '')
  const hits = (Array.isArray(d.hits) ? d.hits : []).filter(h => h && typeof h === 'object' && h.symbol).map(h => {
    const fq = Number.isInteger(h.quarter) && h.quarter >= 1 && h.quarter <= 4 ? h.quarter : null
    const day = isoDay(h.date)
    return { symbol: String(h.symbol).toUpperCase(), call: fq && Number.isInteger(h.year) ? `Q${fq} ${h.year}` : null, date: day, date_text: shortDay(day), excerpt: excerptText(h.snippet) }
  })
  const total = Number.isInteger(d.total) ? Math.max(d.total, hits.length) : hits.length
  const ix = d.index && typeof d.index === 'object' ? d.index : {}
  const held = { calls: Number.isInteger(ix.calls) ? ix.calls : null, oldest: isoDay(ix.oldest), newest: isoDay(ix.newest) }
  const widened = d.expanded && typeof d.expanded === 'object' ? Object.entries(d.expanded).filter(([, v]) => Array.isArray(v) && v.length).map(([word, also]) => ({ word, also: also.map(String) })) : []
  const facts = { query: q, symbol: d.symbol || null, since: isoDay(d.since), total, total_wider: d.total_wider === true, shown: hits.length, index_calls: held.calls, index_oldest: held.oldest, index_newest: held.newest, widened, hits }
  const span = held.calls != null ? `UCT's index holds ${whole(held.calls)} recent earnings calls${held.oldest && held.newest ? `, dated ${shortDay(held.oldest)} to ${shortDay(held.newest)}` : ''}` : null
  const scope = [facts.symbol ? `for ${facts.symbol}` : null, facts.since ? `since ${shortDay(facts.since)}` : null].filter(Boolean).join(' ')
  const lines = []
  if (!hits.length && !total) {
    lines.push(`No indexed earnings call${scope ? ` ${scope}` : ''} mentions "${q}".${span ? ` ${span}, so that is a finding about those calls only.` : ''}`)
  } else {
    lines.push(`Earnings calls mentioning "${q}"${scope ? ` ${scope}` : ''}: ${plural(total, 'call')} ${total === 1 ? 'matches' : 'match'}${hits.length < total && d.total_wider !== true ? `; the ${hits.length} best matches are shown` : ''}.`)
    for (const h of hits.slice(0, TEXT_ROWS)) lines.push(`• ${h.symbol}${h.call ? `, ${h.call} call` : ''}${h.date_text ? ` (${h.date_text})` : ''}: "${h.excerpt}"`)
    if (hits.length > TEXT_ROWS) lines.push(`(${hits.length - TEXT_ROWS} more in the table.)`)
    if (d.total_wider === true) lines.push('The count is of calls that match the words in some form; exact words and quoted phrases were checked only for the calls shown.')
    if (hits.length) lines.push("Each excerpt is quoted from the call's transcript as indexed. The index does not record who was speaking.")
    if (span) lines.push(`${span}.`)
  }
  for (const w of widened) lines.push(`The search was widened: "${w.word}" also matched ${andList(w.also.map(s => `"${s}"`))}.`)
  lines.push("Source: UCT's earnings-call transcript index (third-party transcript text).")
  return {
    text: lines.join('\n'),
    ...(hits.length ? { table: {
      columns: [{ key: 'symbol', label: 'Symbol' }, { key: 'call', label: 'Call' }, { key: 'date', label: 'Date' }, { key: 'excerpt', label: 'Excerpt' }],
      rows: hits.map(h => ({ symbol: h.symbol, call: h.call || '—', date: h.date_text || '—', excerpt: h.excerpt })),
    } } : {}),
    facts,
  }
}

export async function answerCallSearch(args = {}) {
  const q = callQuery(args.q)
  if (!q) return { text: `What word or phrase should I search the earnings calls for? Give me ${CALL_SEARCH_MIN_QUERY} to ${CALL_SEARCH_MAX_QUERY} characters. No excerpt is quoted.` }
  const params = { q, limit: clamp(args.limit, CALL_SEARCH_MAX_ROWS, CALL_SEARCH_DEFAULT_ROWS) }
  const symbol = upper(args.symbol)
  if (TICKER.test(symbol)) params.symbol = symbol
  if (typeof args.since === 'string' && ISO_DAY.test(args.since)) params.since = args.since
  const turnId = currentTurnId()
  if (!turnId) return { text: `I couldn't run the earnings call search: ${NO_TURN}.` }
  const envl = await readData('earnings.callSearch', params, { purpose: 'answer', turnId })   // a LITERAL: qa/modelIsolation reads it
  return answerFromCallSearch(envl, q)
}

// ── routing words (armed only while registered; routing.js's `data` group does not list them) ─────────────────────────
// Routing v2 reaches the five by their summaries. v1 (the kill-switch fallback, and the router the capability-regression
// corpus runs) selects a group by its words. `earnings` already names the data group, so the expected-move and call-search
// asks that say "earnings" route today; these words cover the asks that do not, and the three market-wide lists.
// Routing only ADDS a group (the other groups a message names still ride along), and each pattern is kept off another
// capability's own language:
//   yearly      the NAMES at a new 52-week high or low: never a count, a share or a net measure (breadth.show), never
//               "near / within / off the 52-week high" (the Screener's filters, stock.dailyBars' distance), never an alert,
//               a drawing or a chart setting. ("list the new 52-week highs" also names the watchlists group, and v1's
//               budget can then cut this one: routing v2 reaches it by its summary.)
//   rotation    needs "theme" beside "rotat…": never the Compare panel's rotation map (RRG), a chart or app theme;
//   confluence  the board by name, never a chart indicator or setting, a widget or a page;
//   expectedMove  "expected / implied move" and "what options are pricing": never a screen, an order or an alert;
//   callSearch  earnings / conference calls and call transcripts: never an option "call", never a page or a widget.
// ⛔ no lookbehind (iOS 16 floor, src/noRegexLookbehind.test.js).
const W52 = '(?:52[\\s-]?w(?:ee)?ks?|52w|one[\\s-]year|1[\\s-]year|yearly)'
const NOT_COUNT_OR_FILTER = '^(?!.*\\b(?:how many|number of|count of|net new|net|percent|percentage|pct|ratio|share of|near|nearing|close to|within|off|below|above|under|away|distance|from (?:its|their|the)|alerts?|notify|draw|lines?|levels?|charts?|plot|mark|indicators?|scans?|screens?|screener|filters?|find|watchlists?|widgets?)\\b)(?!.*%)'
const NOT_COMPARE_OR_SETTING = '^(?!.*\\b(?:map|graph|rrg|relative rotation|tab|panel|compare|charts?|app|dark|light|colou?rs?|widgets?|page)\\b)'
const NOT_A_SETTING = '^(?!.*\\b(?:turn (?:on|off)|enable|disable|toggle|hide|indicators?|charts?|widgets?|page|tab|window|add|remove|colou?rs?|signature)\\b)'
const NOT_A_SCREEN_OR_ORDER = '^(?!.*\\b(?:scans?|screens?|screener|filters?|find|alerts?|notify|buy|sell|order|trade|widgets?|page|tab|chain)\\b)'
export const WAVE2_ROUTE_WORDS = Object.freeze({
  yearly: [
    new RegExp(`${NOT_COUNT_OR_FILTER}.*\\bnew ${W52} (?:highs?|lows?)\\b`),
    new RegExp(`${NOT_COUNT_OR_FILTER}.*\\b(?:at|hit|hits|hitting|made|making|make|reached|reaching|set|setting|printing) (?:a |an |new |fresh |their |its ){0,2}${W52} (?:highs?|lows?)\\b`),
  ],
  rotation: [
    new RegExp(`${NOT_COMPARE_OR_SETTING}.*(?:\\bthemes? (?:\\w+ ){0,3}?rotat(?:ion|ing|e|es|ed)\\b|\\brotat(?:ion|ing|e|es|ed) (?:\\w+ ){0,3}?themes?\\b)`),
  ],
  confluence: [
    new RegExp(`${NOT_A_SETTING}.*\\bconfluence (?:board|radar|list|names|screen|stocks|setups?)\\b`),
    new RegExp(`${NOT_A_SETTING}.*\\bconfluence\\b.*\\b(?:bullish|bearish|dark[\\s-]?pool|options? flow|leaps?)\\b|${NOT_A_SETTING}.*\\b(?:bullish|bearish|dark[\\s-]?pool|options? flow|leaps?)\\b.*\\bconfluence\\b`),
  ],
  expectedMove: [
    new RegExp(`${NOT_A_SCREEN_OR_ORDER}.*\\b(?:expected|implied) (?:\\w+ )?moves?\\b`),
    new RegExp(`${NOT_A_SCREEN_OR_ORDER}.*\\b(?:options?|option market|options market|straddle) (?:\\w+ ){0,2}?pric(?:e|es|ing|ed)\\b`),
    new RegExp(`${NOT_A_SCREEN_OR_ORDER}.*\\bhow (?:much|big|large) (?:\\w+ ){0,5}?expected to move\\b`),
  ],
  callSearch: [
    /\b(?:earnings|conference) calls?\b(?!.*\b(?:widgets?|page|tab|calendar)\b)/,
    /\bcall transcripts?\b|\btranscripts?\b(?=.*\b(?:earnings|calls?|compan(?:y|ies)|management|ceos?|cfos?)\b)/,
    /\b(?:said|say|says|mention(?:ed|s|ing)?|talk(?:ed|s|ing)? about|discuss(?:ed|es|ing)?) (?:\w+ ){0,6}?(?:on|in|during) (?:the|their|its|a|recent|last|latest) (?:\w+ ){0,2}?calls?\b/,
  ],
})
const dataGroup = () => GROUPS.find(g => g.id === 'data')
/** Adds (or takes back) ONE capability's words on the data group; the group's own words are never touched. */
function armRoutes(key, on) {
  const g = dataGroup()
  if (!g) return
  for (const re of WAVE2_ROUTE_WORDS[key]) {
    const at = g.words.indexOf(re)
    if (on && at < 0) g.words.push(re)
    if (!on && at >= 0) g.words.splice(at, 1)
  }
}

// ── registration: each capability only while the server serves ITS kind ───────────────────────────────────────────────
const TARGET_HINT = 'target = the ref of the stockData entry.'
const NO_FIGURES = 'reply: one short line, no figures.'
const unregister = {}

/** Idempotent; registers each of the five ONLY while the server serves its kind. Returns the names registered by this call. */
export function registerTerminalWave2Capabilities() {
  const added = []
  if (!unregister.yearly && kindServed(KINDS.yearly)) {
    unregister.yearly = registerCapability({
      name: 'stock.yearlyHighsLows',    // a LITERAL: the server's local-only mirror rail reads it (tests/test_uct_agent_breadth.py)
      surfaces: ['*'],
      target: 'market', query: true,
      localOnly: true,                  // ⛔ UCT breadth lists: shown to the member, never to a model (turn.LOCAL_ONLY_ACTIONS)
      summary: 'The STOCKS at new 52-WEEK HIGHS and new 52-week lows: the names behind UCT\'s Breadth Monitor counts, for the session under way or the last finished session. '
        + 'For "which stocks made new 52-week highs", "list the new 52 week lows", "what is at a 52-week high".',
      hints: `${TARGET_HINT} side: both|highs|lows (null = both); limit 1-${YEARLY_MAX_ROWS} names a side (null = ${YEARLY_DEFAULT_ROWS}). The NAMES, market-wide. `
        + `HOW MANY stocks are at new highs / lows is a breadth measure (breadth.show); highs and lows of the DAY are a different list, not this; one stock's own 52-week range is stock.dailyBars; `
        + `a member's own filter ("near 52-week highs with volume") is the Screener (screener.run). ${NO_FIGURES}`,
      args: {
        type: 'object',
        properties: { side: { type: ['string', 'null'], enum: [...YEARLY_SIDE_KEYS, null] }, limit: { type: ['integer', 'null'] } },
        required: ['side', 'limit'], additionalProperties: false,
      },
      answer: (_snap, args) => answerYearly(args || {}),
    })
    armRoutes('yearly', true)
    added.push(CAPABILITIES.yearly)
  }
  if (!unregister.rotation && kindServed(KINDS.rotation)) {
    unregister.rotation = registerCapability({
      name: 'stock.themeRotation',      // a LITERAL: the server's local-only mirror rail reads it
      surfaces: ['*'],
      target: 'market', query: true,
      localOnly: true,                  // ⛔ UCT's own selection: shown to the member, never to a model
      summary: 'THEME ROTATION: which of UCT\'s themes are ROTATING IN (their 1-week rank well above their 1-month rank) and which are rotating out, with each theme\'s ranks and returns. '
        + 'For "which themes are rotating in", "theme rotation", "themes rotating out".',
      hints: `${TARGET_HINT} side: both|in|out (null = both); limit 1-${ROTATION_MAX_ROWS} themes a side (null = ${ROTATION_DEFAULT_ROWS}). A change of RANK between two periods, market-wide. `
        + `Plain theme returns ("best themes this month", "which themes are leading") are stock.themes; the rotation MAP / RRG chart is the Compare panel (compare.openView). ${NO_FIGURES}`,
      args: {
        type: 'object',
        properties: { side: { type: ['string', 'null'], enum: [...ROTATION_SIDE_KEYS, null] }, limit: { type: ['integer', 'null'] } },
        required: ['side', 'limit'], additionalProperties: false,
      },
      answer: (_snap, args) => answerRotation(args || {}),
    })
    armRoutes('rotation', true)
    added.push(CAPABILITIES.rotation)
  }
  if (!unregister.confluence && kindServed(KINDS.confluence)) {
    unregister.confluence = registerCapability({
      name: 'stock.confluenceBoard',    // a LITERAL: the server's local-only mirror rail reads it
      surfaces: ['*'],
      target: 'market', query: true,
      localOnly: true,                  // ⛔ UCT's own screen: shown to the member, never to a model
      summary: 'UCT\'s CONFLUENCE BOARD: the stocks where a large DARK POOL dollar size and aligned LONG-DATED OPTIONS FLOW line up over the last several weeks, bullish or bearish, '
        + 'with whether the flow is still building. For "what is on the confluence board", "bullish confluence names", "confluence radar".',
      hints: `${TARGET_HINT} direction: all|bullish|bearish (null = all); limit 1-${CONFLUENCE_MAX_ROWS} (null = ${CONFLUENCE_DEFAULT_ROWS}). One fixed window, market-wide; it cannot be filtered by ticker or sector here. `
        + `One stock's own dark pool levels, the options flow tape and a chart's Signature indicators are not this. ${NO_FIGURES}`,
      args: {
        type: 'object',
        properties: { direction: { type: ['string', 'null'], enum: [...Object.keys(CONFLUENCE_LEANS), null] }, limit: { type: ['integer', 'null'] } },
        required: ['direction', 'limit'], additionalProperties: false,
      },
      answer: (_snap, args) => answerConfluence(args || {}),
    })
    armRoutes('confluence', true)
    added.push(CAPABILITIES.confluence)
  }
  if (!unregister.expectedMove && kindServed(KINDS.expectedMove)) {
    unregister.expectedMove = registerCapability({
      name: 'stock.expectedMove',       // a LITERAL: the server's local-only mirror rail reads it
      surfaces: ['*'],
      target: 'market', query: true,
      localOnly: true,                  // ⛔ UCT-computed from an option chain: shown to the member, never to a model
      summary: 'One stock\'s EXPECTED MOVE around earnings: what the options market prices (the at-the-money straddle, as a percent of the stock price), and what it priced before each past report. '
        + 'For "expected move for NVDA earnings", "implied move on TSLA", "what are options pricing in for AAPL".',
      hints: `${TARGET_HINT} symbol = the one ticker named (or the open chart's symbol). report_date = the report's date as YYYY-MM-DD only when the member gave one, else null. `
        + `WHEN a stock reports and its past results are stock.earnings; who reports this week is the calendar. This reads no option chain itself and places no trade. ${NO_FIGURES}`,
      args: {
        type: 'object',
        properties: { symbol: { type: 'string' }, report_date: { type: ['string', 'null'] } },
        required: ['symbol', 'report_date'], additionalProperties: false,
      },
      answer: (_snap, args) => answerExpectedMove(args || {}),
    })
    armRoutes('expectedMove', true)
    added.push(CAPABILITIES.expectedMove)
  }
  if (!unregister.callSearch && kindServed(KINDS.callSearch)) {
    unregister.callSearch = registerCapability({
      name: 'stock.callSearch',         // a LITERAL: the server's local-only mirror rail reads it
      surfaces: ['*'],
      target: 'market', query: true,
      localOnly: true,                  // ⛔ third-party transcript excerpts: shown to the member, never to a model
      summary: 'SEARCH recent EARNINGS CALL transcripts for a word or a phrase, across every company or within one: which calls mention it, with a short excerpt from each. '
        + 'For "which companies mentioned tariffs on their earnings call", "search earnings calls for pricing power", "did NVDA talk about supply on its call".',
      hints: `${TARGET_HINT} q = the word or phrase to search for, in the member's own words (${CALL_SEARCH_MIN_QUERY}-${CALL_SEARCH_MAX_QUERY} characters; a quoted phrase stays quoted), never a whole question. `
        + `symbol = one ticker to search within, else null; since = YYYY-MM-DD only when the member gave a start date, else null; limit 1-${CALL_SEARCH_MAX_ROWS} calls (null = ${CALL_SEARCH_DEFAULT_ROWS}). `
        + `It finds mentions; it does not summarise a call or judge its tone. ${NO_FIGURES}`,
      args: {
        type: 'object',
        properties: { q: { type: 'string' }, symbol: { type: ['string', 'null'] }, since: { type: ['string', 'null'] }, limit: { type: ['integer', 'null'] } },
        required: ['q', 'symbol', 'since', 'limit'], additionalProperties: false,
      },
      answer: (_snap, args) => answerCallSearch(args || {}),
    })
    armRoutes('callSearch', true)
    added.push(CAPABILITIES.callSearch)
  }
  return added
}
export const _resetTerminalWave2ForTest = () => {
  for (const k of Object.keys(unregister)) { unregister[k]?.(); delete unregister[k] }
  for (const k of Object.keys(WAVE2_ROUTE_WORDS)) armRoutes(k, false)
}
