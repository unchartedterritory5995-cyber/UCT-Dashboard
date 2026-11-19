// UCT Agent — terminal data wave 3: four LOCAL-ONLY answers (the Agent half of the LVL panel's options levels, the TOPF
// panel, the Flow Record page and the EMOV panel).
//
//   stock.gammaLevels        one stock's gamma walls: the call wall, the put wall and the zero gamma level
//   stock.topFlowPicks       UCT's Top Flow picks, one by one, with how each option contract has done since it was flagged
//   stock.flowRecord         the Flow Record: aggregate results of every Top Flow pick (win rates, the same by grade)
//   stock.earningsReactions  one day's earnings reporters, each with its result against expectations and the stock's move
//
// DATA: ONE gateway read each (`levels.gamma`, `flow.topPicks`, `flow.record`, `earnings.reactions`;
// api/services/uct_agent/marketdata/, MD-1 §4.12). No read of this wave starts a build or spends a provider call: gamma
// levels and earnings reactions are answered only from what the server already holds, and both flow answers from the pick
// record the server keeps in memory. Rows are shaped by the matching panel's own pure helpers where one exists
// (pages/terminal/panels/: levelsModel `gexRead` / `levelRows`, topFlowModel's own keys and order words,
// earningsReactionsModel `epsSurprisePct` / `SESSION_TEXT`), so the panel and the Agent read one shape. The earnings model
// pulls the market calendar in, so it is loaded when an answer is built, never with the Agent itself.
// HONESTY: each answer states the data's own time or says why there is none; none says live or now (MD-1 §3). A failed read
// is never "nothing to show": levels that are not held, a record that could not be read and a day that is not held are each
// said in their own words. A pick with fewer than two daily prices is "too new to score", never 0%. The flow answers say
// where their numbers come from. Nothing is predicted.
// GROUNDING: the text is templated from `facts` (returned beside it): every number in it is a fact's.
// ⛔ LOCAL ONLY (turn.LOCAL_ONLY_ACTIONS; all four kinds are model-isolated, ADR-005): the model plans the lookup and never
// sees what came back. Every capability in THIS module is local-only: the isolation rail (qa/modelIsolation.test.jsx) holds
// the whole module to that.
//
// Dark by construction: each is registered only while the server serves its own kind (UCT_AGENT_DATA_KINDS, fail closed; an
// isolated kind also needs its own UCT_AGENT_ISOLATED_KINDS entry or every read is refused).
// ROUTING: the four have their OWN words-only group, `marketBoards` (routing.js lists them by action: the stock `data` group
// their domain names has no room for four more under the routing budget). Each one's own words (WAVE3_ROUTE_WORDS) are added
// to that group only while it is registered, so on a dark server the group has no words and no registered action, and
// routing is byte-identical to the base.
import { registerCapability } from '../capabilities'
import { readData } from '../marketdata/client'
import { currentTurnId } from '../trace'
import { GROUPS } from '../routing'
import { stampET } from './marketDataFacts'
import { gexRead, levelRows, LEVEL_KINDS, REGIME_TEXT, GEX_BAND_PCT } from '../../pages/terminal/panels/levelsModel'
import { TOP_FLOW_STATUSES, TOP_FLOW_DIRECTIONS, TOP_FLOW_SORTS, OI_RISE_FACTOR } from '../../pages/terminal/panels/topFlowModel'
import { kindServed, usable, noRead, money, pct, whole, plural, dayText, NO_TURN } from './terminalDataFormat'
import { formatCompact } from '../../lib/presentation/presentationPrimitives'

export const KINDS = Object.freeze({
  gamma: 'levels.gamma', topPicks: 'flow.topPicks', record: 'flow.record', reactions: 'earnings.reactions',
})
export const CAPABILITIES = Object.freeze({
  gamma: 'stock.gammaLevels', topPicks: 'stock.topFlowPicks', record: 'stock.flowRecord', reactions: 'stock.earningsReactions',
})
const NONE_STATED = 'No figure is stated.'
const TEXT_ROWS = 5
const DESCRIPTIVE = 'Descriptive only: nothing here is a prediction.'
const TICKER = /^[A-Z][A-Z.-]{0,9}$/
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
const upper = (s) => String(s || '').trim().toUpperCase().replace(/^\$/, '')
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const int = (v) => (Number.isInteger(v) ? v : null)
const clamp = (v, max, fallback) => (Number.isInteger(v) ? Math.min(Math.max(v, 1), max) : fallback)
const isoDay = (v) => (typeof v === 'string' && ISO_DAY.test(v) ? v : null)
/** "Fri, Nov 13, 2026" → "Nov 13, 2026" */
const shortDay = (ymd) => (dayText(ymd) || '').replace(/^\w+, /, '') || null
/** A gain or a rate to ONE decimal, as the Flow Record rounds it: "+50.0%" / "−12.5%" / "0.0%", or null. */
export const gain1 = (v) => (num(v) == null ? null : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}%`)
const rate1 = (v) => (num(v) == null ? null : `${v.toFixed(1)}%`)

// ── stock.gammaLevels ──────────────────────────────────────────────────────────────────────────────────────────────────
// The option chain a gamma read names. One chain since 2026-11-17 (Schwab was retired); any other value is not named.
const CHAIN_VENDORS = { massive: 'Massive' }
// The `src` labels a Top Flow row can carry. Nothing reads Schwab any more: 'schwab' labels the daily prices recorded
// before November 2026, which stay as recorded.
const PRICE_VENDORS = { massive: 'Massive', schwab: 'Schwab' }
export const ZERO_GAMMA_CAVEAT = 'The zero gamma level is an estimate: this read does not say how it was found, and for some stocks it is a stand-in rather than a true flip.'

/** The `levels.gamma` envelope → the member's answer + its facts (pure). Rows: levelsModel `gexRead` / `levelRows`. */
export function answerFromGamma(envl, symbol) {
  if (!usable(envl)) {
    return { text: noRead(`${symbol}'s gamma levels`, envl, "none are held on the server at the moment (they are kept for a few minutes after a chart or the Levels panel reads them, and this answer never starts an option chain read). Open the stock's Levels panel, then ask again", 'No level is stated, and that is not the same as no levels.') }
  }
  const d = envl.data
  const read = gexRead(d)
  if (read.state !== 'ok') return { text: `I couldn't read ${symbol}'s gamma levels: UCT's data did not answer cleanly. No level is stated, and that is not the same as no levels.` }
  const rows = levelRows({ gexLevels: read.levels, price: read.spot }).filter(r => r.kind !== 'price').map(r => ({
    kind: r.kind, label: r.label, price: r.price, price_text: money(r.price), distance_pct: r.distPct, side: r.side,
    distance_text: r.side === 'at' ? 'at that price' : r.side ? `${Math.abs(r.distPct).toFixed(2)}% ${r.side} that price` : null,
  }))
  const band = int(d.band_pct) ?? GEX_BAND_PCT
  const computed = stampET(d.computed_at, envl.fetched_at)
  const vendor = CHAIN_VENDORS[d.chain_source] || null
  const lastGood = d.held === 'last_good'
  const facts = {
    symbol, spot: read.spot, spot_text: money(read.spot), regime: read.regime, levels: rows.length, band_pct: band, held: d.held || null,
    stale: !!envl.stale, computed, chain_source: vendor ? d.chain_source : null, kept_minutes: int(d.kept_minutes), rows,
  }
  const lines = []
  if (!rows.length) {
    lines.push(`${symbol} has no gamma level within ${band}% of its stock price (${facts.spot_text}), from options expiring within a week. That is a normal answer, not a failed read.`)
  } else {
    lines.push(`${symbol} gamma levels from options expiring within a week, against a stock price of ${facts.spot_text}: ${plural(rows.length, 'level')}, highest first.`)
    for (const r of rows) lines.push(`• ${r.label} ${r.price_text}${r.distance_text ? ` (${r.distance_text})` : ''}`)
    for (const kind of Object.keys(LEVEL_KINDS)) if (rows.some(r => r.kind === kind)) lines.push(`${LEVEL_KINDS[kind].label}: ${LEVEL_KINDS[kind].meaning}`)
    if (read.regime) lines.push(REGIME_TEXT[read.regime])
    if (rows.some(r => r.kind === 'zeroGamma')) lines.push(ZERO_GAMMA_CAVEAT)
  }
  lines.push(computed ? `Worked out by UCT at ${computed}${vendor ? ` from ${vendor}'s option chain` : ''} (UCT's own time, not an exchange timestamp). The stock price is the one that option chain carried, not a quote of the moment.`
    : 'The levels carry no build time, so I cannot say how old they are.')
  if (lastGood) lines.push(`Stale: these are the last good levels, older than the ${facts.kept_minutes ? `${facts.kept_minutes} minutes` : 'few minutes'} they are normally kept, so they may be behind the option market.`)
  lines.push(`Source: UCT's gamma levels (UCT's own arithmetic on an option chain). ${DESCRIPTIVE}`)
  return {
    text: lines.join('\n'),
    ...(rows.length ? { table: {
      columns: [{ key: 'level', label: 'Level' }, { key: 'price', label: 'Price' }, { key: 'distance', label: 'Distance from the stock price' }],
      rows: rows.map(r => ({ level: r.label, price: r.price_text, distance: r.distance_text || '—' })),
    }, present: {
      kind: 'metrics', title: `${symbol} gamma levels`, short: symbol,
      items: rows.map(r => ({ label: r.label, value: r.price_text, note: r.distance_text || '', aka: [r.label.toLowerCase()] })),
    } } : {}),
    link: { href: `/research/${encodeURIComponent(symbol)}`, label: `Open ${symbol} in Research` },
    facts,
  }
}

export async function answerGamma(args = {}) {
  const symbol = upper(args.symbol)
  if (!TICKER.test(symbol)) return { text: `Which stock's gamma levels should I read? Give me one ticker. ${NONE_STATED}` }
  const turnId = currentTurnId()
  if (!turnId) return { text: `I couldn't read ${symbol}'s gamma levels: ${NO_TURN}.` }
  const envl = await readData('levels.gamma', { symbol }, { purpose: 'answer', turnId })   // a LITERAL: qa/modelIsolation reads it
  return answerFromGamma(envl, symbol)
}

// ── the two flow answers: what they share ──────────────────────────────────────────────────────────────────────────────
export const GAIN_MEANING = "A gain is the option contract's own price change since the pick was flagged, not the stock's move."
export const FLOW_SOURCES = "Picks and entry prices come from UCT's options flow tape. Daily contract prices are recorded each weekday after the close, from Massive (prices recorded before November 2026 came from Schwab and stay as recorded)."
/** What the Flow Record calls "OI confirmed" (flow_scoreboard OI_RISE_FACTOR, by the TOPF panel's own constant), in plain words. */
export const OI_ROSE = `open interest later rose more than ${Math.round((OI_RISE_FACTOR - 1) * 100)}% above its first reading`
const contractText = (r) => [num(r.strike) > 0 ? money(r.strike) : null, r.cp === 'C' ? 'call' : r.cp === 'P' ? 'put' : null, r.exp ? `expiring ${r.exp}` : null].filter(Boolean).join(' ') || 'contract not given'
/** The lines both flow answers end on: the newest daily price, whether it is old, and when the newest pick was flagged. */
function flowTimeLines(d, stale) {
  const priceDay = isoDay(d.newest_price_date)
  const pickDay = isoDay(d.newest_pick_date)
  const lines = [priceDay ? `As of the close of ${dayText(priceDay)}, the newest daily price on record.` : 'No pick carries a daily price yet, so there is no price date to state.']
  if (stale && priceDay) lines.push(`Stale: no daily price has been recorded since ${shortDay(priceDay)}.`)
  if (d.no_new_picks === true && pickDay) lines.push(`The newest pick on record was flagged ${shortDay(pickDay)}; none has been added since.`)
  return lines
}

// ── stock.topFlowPicks ─────────────────────────────────────────────────────────────────────────────────────────────────
export const PICK_STATUS_KEYS = Object.keys(TOP_FLOW_STATUSES)          // all | open | expired: the TOPF panel's own
export const PICK_DIRECTION_KEYS = Object.keys(TOP_FLOW_DIRECTIONS)     // any | bullish | bearish
export const PICK_SORT_KEYS = Object.keys(TOP_FLOW_SORTS)               // gain | loss | peak | newest
export const PICKS_MAX_ROWS = 50
const PICKS_DEFAULT_ROWS = 20
const LEAN_WORDS = { BULL: 'bullish', BEAR: 'bearish' }

function pickRow(r) {
  const scored = r.scored === true
  const saved = isoDay(r.saved_date)
  return {
    symbol: String(r.sym || '').trim().toUpperCase(), contract: contractText(r), grade: r.grade || null, direction: LEAN_WORDS[r.dir] || null,
    status: r.status === 'open' ? 'open' : r.stopped === true ? 'stopped early' : 'expired', flagged: saved, flagged_text: shortDay(saved),
    scored, prices: int(r.prices) ?? 0, entry: num(r.entry), entry_text: money(num(r.entry)), latest: num(r.latest_price), latest_text: money(num(r.latest_price)),
    // a pick that is not scored has NO gain: null, never 0
    gain_pct: scored ? num(r.current_gain_pct) : null, gain_text: scored ? gain1(r.current_gain_pct) : null,
    peak_pct: scored ? num(r.max_gain_pct) : null, peak_text: scored ? gain1(r.max_gain_pct) : null,
    days_tracked: scored ? int(r.days_tracked) : null, oi_confirmed: scored && r.oi_confirmed === true,
    priced_by: (Array.isArray(r.src) ? r.src : []).map(s => PRICE_VENDORS[s]).filter(Boolean),
  }
}

/** The `flow.topPicks` envelope → the member's answer + its facts (pure). */
export function answerFromTopPicks(envl) {
  if (!usable(envl)) {
    return { text: noRead("UCT's Top Flow picks", envl, "the pick record could not be read from UCT's data at the moment. That is not the same as no picks", NONE_STATED) }
  }
  const d = envl.data
  const rows = (Array.isArray(d.rows) ? d.rows : []).filter(r => r && typeof r === 'object' && r.sym).map(pickRow)
  const c = d.counts && typeof d.counts === 'object' ? d.counts : {}
  const total = int(c.total) ?? rows.length
  const matching = int(d.count) != null ? Math.max(d.count, rows.length) : rows.length
  const status = PICK_STATUS_KEYS.includes(d.status) ? d.status : 'all'
  const direction = PICK_DIRECTION_KEYS.includes(d.direction) ? d.direction : 'any'
  const sort = PICK_SORT_KEYS.includes(d.sort) ? d.sort : 'gain'
  const symbol = d.symbol ? String(d.symbol).toUpperCase() : null
  const minPrices = int(d.min_prices) ?? 2
  const facts = {
    status, direction, sort, symbol, total, open: int(c.open), expired: int(c.expired), scored: int(c.scored), too_new: int(c.too_new), never_scored: int(c.never_scored),
    matching, shown: rows.length, matching_too_new: int(d.matching_too_new) ?? 0, unread: int(d.unread) ?? 0, min_prices: minPrices, stale: !!envl.stale,
    newest_price_date: isoDay(d.newest_price_date), newest_pick_date: isoDay(d.newest_pick_date), no_new_picks: d.no_new_picks === true, rows,
  }
  const lines = []
  if (!total) {
    lines.push('No Top Flow pick is on record on this server. A record that could not be loaded reads the same way, so this is not proof that none was ever flagged.')
  } else {
    const parts = [facts.open != null ? `${facts.open} open` : null, facts.expired != null ? `${facts.expired} expired` : null].filter(Boolean)
    const scoring = [facts.scored != null ? `${facts.scored} scored` : null, facts.too_new ? `${facts.too_new} too new to score` : null,
      facts.never_scored ? `${facts.never_scored} expired before they could be scored` : null].filter(Boolean)
    lines.push(`UCT Top Flow picks: ${plural(total, 'pick')} on record${parts.length ? ` (${parts.join(', ')})` : ''}${scoring.length ? `; ${scoring.join(', ')}` : ''}.`)
    const which = [status !== 'all' ? status : null, direction !== 'any' ? direction : null].filter(Boolean).join(' ')
    const named = `${which ? `${which} ` : ''}${matching === 1 ? 'pick' : 'picks'}${symbol ? ` on ${symbol}` : ''}`
    if (!rows.length) lines.push(`None of them is ${which ? `an ${which} pick`.replace(/^an (?=[^aeiou])/, 'a ') : 'a pick'}${symbol ? ` on ${symbol}` : ''}.`)
    else {
      lines.push(`${rows.length < matching ? `The first ${rows.length} of the ${matching}` : matching === 1 ? 'The 1' : `All ${matching}`} ${named}, ${TOP_FLOW_SORTS[sort].words}:`)
      for (const r of rows.slice(0, TEXT_ROWS)) {
        const tag = [r.grade ? `grade ${r.grade}` : null, r.direction, r.status].filter(Boolean).join(', ')
        const result = r.scored
          ? `${r.gain_text} since flagged${r.entry_text && r.latest_text ? ` (${r.entry_text} to ${r.latest_text})` : ''}, best ${r.peak_text}${r.oi_confirmed ? `; ${OI_ROSE}` : ''}`
          : `too new to score (${plural(r.prices, 'daily price')} so far)`
        lines.push(`• ${r.symbol} ${r.contract}${tag ? ` (${tag})` : ''}${r.flagged_text ? `, flagged ${r.flagged_text}` : ''}: ${result}`)
      }
      if (rows.length > TEXT_ROWS) lines.push(`(${rows.length - TEXT_ROWS} more in the table.)`)
      if (facts.matching_too_new) lines.push(`A pick with fewer than ${minPrices} daily prices is too new to score: no gain is stated for it, which is not the same as 0%.`)
      lines.push(GAIN_MEANING)
    }
    if (facts.unread) lines.push(`${plural(facts.unread, 'stored pick')} could not be read and ${facts.unread === 1 ? 'is' : 'are'} left out.`)
    lines.push(FLOW_SOURCES)
    lines.push(...flowTimeLines(d, envl.stale))
  }
  lines.push(`Source: UCT's Top Flow record (UCT's own picks). ${DESCRIPTIVE} It is not a recommendation.`)
  return {
    text: lines.join('\n'),
    ...(rows.length ? { table: {
      columns: [{ key: 'symbol', label: 'Symbol' }, { key: 'contract', label: 'Contract' }, { key: 'grade', label: 'Grade' }, { key: 'direction', label: 'Direction' }, { key: 'status', label: 'Status' },
        { key: 'flagged', label: 'Flagged' }, { key: 'entry', label: 'Price when flagged' }, { key: 'latest', label: 'Latest daily price' }, { key: 'gain', label: 'Gain since flagged' },
        { key: 'peak', label: 'Best gain' }, { key: 'days', label: 'Days tracked' }],
      rows: rows.map(r => ({ symbol: r.symbol, contract: r.contract, grade: r.grade || '—', direction: r.direction || '—', status: r.status, flagged: r.flagged_text || '—', entry: r.entry_text || '—',
        latest: r.latest_text || '—', gain: r.scored ? r.gain_text : 'too new to score', peak: r.scored ? r.peak_text : '—', days: r.days_tracked ?? '—' })),
    }, present: {
      kind: 'metrics', title: 'UCT Top Flow picks', short: 'Top Flow',
      items: rows.slice(0, TEXT_ROWS * 2).map(r => ({ label: `${r.symbol} ${r.contract}`, value: r.scored ? r.gain_text : 'too new to score', note: [r.grade ? `grade ${r.grade}` : null, r.status].filter(Boolean).join(' · '), aka: [r.symbol.toLowerCase()] })),
    } } : {}),
    link: { href: '/flow-scoreboard', label: 'Open the Flow Record' },
    facts,
  }
}

export async function answerTopPicks(args = {}) {
  const params = {
    status: PICK_STATUS_KEYS.includes(args.status) ? args.status : 'all',
    direction: PICK_DIRECTION_KEYS.includes(args.direction) ? args.direction : 'any',
    sort: PICK_SORT_KEYS.includes(args.sort) ? args.sort : 'gain',
    limit: clamp(args.limit, PICKS_MAX_ROWS, PICKS_DEFAULT_ROWS),
  }
  const symbol = upper(args.symbol)
  if (TICKER.test(symbol)) params.symbol = symbol
  const turnId = currentTurnId()
  if (!turnId) return { text: `I couldn't read UCT's Top Flow picks: ${NO_TURN}.` }
  const envl = await readData('flow.topPicks', params, { purpose: 'answer', turnId })   // a LITERAL: qa/modelIsolation reads it
  return answerFromTopPicks(envl)
}

// ── stock.flowRecord ───────────────────────────────────────────────────────────────────────────────────────────────────
export const RECORD_RULE = 'Losers are in every rate. Picks too new to score are in none: they are counted apart, never as 0%.'

/** The `flow.record` envelope → the member's answer + its facts (pure). */
export function answerFromRecord(envl) {
  if (!usable(envl)) {
    return { text: noRead("UCT's Flow Record", envl, "it could not be read from UCT's data at the moment. That is a gap in what could be read, not a statement about the picks", NONE_STATED) }
  }
  const d = envl.data
  const bucket = (b) => {
    const o = b && typeof b === 'object' ? b : {}
    return { picks: int(o.picks) ?? 0, win_10: num(o.win_rate_10), win_25: num(o.win_rate_25), win_50: num(o.win_rate_50), doubled: num(o.pct_doubled),
      avg_best: num(o.avg_max_gain), median_best: num(o.median_max_gain), oi_rate: num(o.oi_confirmed_rate), oi_checked: int(o.oi_evaluated) ?? 0 }
  }
  const overall = bucket(d.overall)
  const grades = (Array.isArray(d.by_grade) ? d.by_grade : []).filter(g => g && typeof g === 'object' && g.grade).map(g => ({ grade: String(g.grade), ...bucket(g) }))
  const recent = (Array.isArray(d.recent_picks) ? d.recent_picks : []).filter(p => p && typeof p === 'object' && p.sym).map(p => ({
    symbol: String(p.sym).toUpperCase(), contract: contractText(p), grade: p.grade || null, flagged_text: shortDay(isoDay(String(p.dateSaved || '').slice(0, 10))) || (p.dateSaved ? String(p.dateSaved) : null),
    gain_text: gain1(p.current_gain_pct), peak_text: gain1(p.max_gain_pct),
  }))
  const flagged = int(d.flagged) ?? 0
  const tracked = int(d.picks_tracked) ?? 0
  const tooNew = int(d.too_new) ?? 0
  const computed = stampET(d.computed_at, envl.fetched_at)
  const facts = { flagged, scored: tracked, too_new: tooNew, overall, grades, recent, stale: !!envl.stale, computed,
    newest_price_date: isoDay(d.newest_price_date), newest_pick_date: isoDay(d.newest_pick_date), no_new_picks: d.no_new_picks === true }
  const lines = []
  if (!flagged) {
    lines.push('The Flow Record holds no pick on this server. A record that could not be loaded reads the same way, so this is not a statement about the picks.')
  } else {
    lines.push(`UCT Flow Record: ${plural(flagged, 'Top Flow pick')} flagged; ${tracked} scored, ${tooNew} too new to score.`)
    if (tracked) {
      lines.push(`Of the ${plural(tracked, 'scored pick')}, at the best daily price each reached: ${rate1(overall.win_10) ?? 'no figure'} gained 10% or more, ${rate1(overall.win_25) ?? 'no figure'} gained 25% or more, ${rate1(overall.win_50) ?? 'no figure'} gained 50% or more and ${rate1(overall.doubled) ?? 'no figure'} at least doubled.`)
      if (overall.avg_best != null) lines.push(`Average best gain ${gain1(overall.avg_best)}${overall.median_best != null ? `, median ${gain1(overall.median_best)}` : ''}.`)
      if (overall.oi_checked && overall.oi_rate != null) lines.push(`On ${rate1(overall.oi_rate)} of the ${plural(overall.oi_checked, 'pick')} it could be checked on, ${OI_ROSE}.`)
      lines.push('By grade:')
      for (const g of grades) {
        lines.push(g.picks ? `• ${g.grade}: ${plural(g.picks, 'scored pick')}, ${rate1(g.win_25) ?? 'no figure'} gained 25% or more, ${rate1(g.win_50) ?? 'no figure'} gained 50% or more, average best gain ${gain1(g.avg_best) ?? 'not given'}`
          : `• ${g.grade}: no scored pick`)
      }
      if (recent.length) {
        lines.push(`The last ${plural(recent.length, 'scored pick')}, whatever the result${recent.length > TEXT_ROWS ? ` (the first ${TEXT_ROWS} here)` : ''}:`)
        for (const p of recent.slice(0, TEXT_ROWS)) lines.push(`• ${p.symbol} ${p.contract}${p.grade ? ` (grade ${p.grade})` : ''}${p.flagged_text ? `, flagged ${p.flagged_text}` : ''}: ${p.gain_text ?? 'no gain given'} since flagged, best ${p.peak_text ?? 'not given'}`)
      }
    } else {
      lines.push('No pick has enough daily prices to be scored yet, so there is no rate to state.')
    }
    lines.push(RECORD_RULE)
    lines.push(GAIN_MEANING)
    lines.push(FLOW_SOURCES)
    lines.push(...flowTimeLines(d, envl.stale))
    if (computed) lines.push(`Worked out by UCT at ${computed} (UCT's own time).`)
  }
  lines.push("Source: UCT's Flow Record (UCT's own measurement of its own picks). Past results, not a forecast.")
  const scoredGrades = grades.filter(g => g.picks)
  return {
    text: lines.join('\n'),
    ...(scoredGrades.length ? { table: {
      columns: [{ key: 'grade', label: 'Grade' }, { key: 'picks', label: 'Scored picks' }, { key: 'w10', label: 'Gained 10%+' }, { key: 'w25', label: 'Gained 25%+' }, { key: 'w50', label: 'Gained 50%+' },
        { key: 'dbl', label: 'Doubled' }, { key: 'avg', label: 'Average best gain' }, { key: 'med', label: 'Median best gain' }],
      rows: scoredGrades.map(g => ({ grade: g.grade, picks: whole(g.picks), w10: rate1(g.win_10) ?? '—', w25: rate1(g.win_25) ?? '—', w50: rate1(g.win_50) ?? '—', dbl: rate1(g.doubled) ?? '—', avg: gain1(g.avg_best) ?? '—', med: gain1(g.median_best) ?? '—' })),
    } } : {}),
    ...(tracked ? { present: {
      kind: 'metrics', title: 'UCT Flow Record', short: 'Flow Record',
      items: [['Gained 25% or more', overall.win_25], ['Gained 50% or more', overall.win_50], ['At least doubled', overall.doubled]].filter(([, v]) => v != null)
        .map(([label, v]) => ({ label, value: rate1(v), note: `${plural(tracked, 'scored pick')}`, aka: ['win rate'] })),
    } } : {}),
    link: { href: '/flow-scoreboard', label: 'Open the Flow Record' },
    facts,
  }
}

export async function answerRecord() {
  const turnId = currentTurnId()
  if (!turnId) return { text: `I couldn't read UCT's Flow Record: ${NO_TURN}.` }
  const envl = await readData('flow.record', {}, { purpose: 'answer', turnId })   // a LITERAL: qa/modelIsolation reads it
  return answerFromRecord(envl)
}

// ── stock.earningsReactions ────────────────────────────────────────────────────────────────────────────────────────────
export const REACTIONS_MAX_ROWS = 50
const REACTIONS_DEFAULT_ROWS = 25
export const MOVE_MEANING_PAST = "A move is the stock's close-to-close change around the report: for a report before the open or with no confirmed time, that day's close against the prior close; for a report after the close, the next session's close against that day's close."
export const MOVE_MEANING_TODAY = "For a day still in session a move is the stock's change on the day in one market snapshot, not the settled close-to-close move."
const epsText = (v) => (num(v) == null ? null : `${v < 0 ? '−' : ''}$${Math.abs(v).toFixed(2)}`)
/** Revenue arrives in MILLIONS (the calendar route's own unit), so the ladder's thresholds are in millions too:
 *  1,000 and up reads in B at two decimals ("$52.00B"), below it in M at one ("$520.0M", "$0.4M"). TERM-066: the
 *  suffix is decided by the shared formatter; `promote: false` keeps "$1000.0M" for 999.96 as it always read. */
const REVENUE_MILLIONS_TIERS = Object.freeze([
  Object.freeze({ at: 1000, suffix: 'B', decimals: 2 }),
  Object.freeze({ at: 1, suffix: 'M', decimals: 1 }),
])
export const revenueText = (v) => (num(v) == null || v <= 0 ? null
  : formatCompact(v, { tiers: REVENUE_MILLIONS_TIERS, prefix: '$', fixedUnit: true, promote: false, absent: null }))
const weekday = (ymd) => { const d = new Date(`${ymd}T12:00:00Z`); return Number.isNaN(d.getTime()) ? null : d.getUTCDay() }

/** The `earnings.reactions` envelope → the member's answer + its facts (pure). `model` = earningsReactionsModel's exports. */
export function answerFromReactions(envl, model, askedDay = null) {
  if (!usable(envl)) {
    const day = dayText(askedDay)
    return { text: noRead(`the earnings reactions${day ? ` for ${day}` : ''}`, envl, "that day's calendar is not held on the server at the moment, and this answer never builds a calendar week. That is not the same as nobody reporting", NONE_STATED) }
  }
  const d = envl.data
  const date = isoDay(d.date)
  const day = dayText(date) || 'a day whose date is not given'
  const rows = (Array.isArray(d.reporters) ? d.reporters : []).filter(r => r && typeof r === 'object' && r.sym).map(r => {
    const surprise = model.epsSurprisePct(r.eps_act, r.eps_est)
    return {
      symbol: String(r.sym).toUpperCase(), name: r.name ? String(r.name) : null, session: model.SESSION_TEXT[r.session] || null,
      eps: num(r.eps_act), eps_text: epsText(r.eps_act), eps_expected: num(r.eps_est), eps_expected_text: epsText(r.eps_est),
      surprise_pct: surprise, surprise_text: gain1(surprise), revenue_text: revenueText(r.rev_act), revenue_expected_text: revenueText(r.rev_est),
      // a reporter with no move on record has NO move: null, never 0
      move: num(r.move), move_text: pct(num(r.move)),
    }
  })
  const count = int(d.count) != null ? Math.max(d.count, rows.length) : rows.length
  const moves = ['held', 'none_worked_out', 'not_cached'].includes(d.moves) ? d.moves : null
  const facts = {
    date, day: dayText(date), day_kind: d.day_kind || null, scheduled: int(d.scheduled), count, shown: rows.length, moves, moved: int(d.moved) ?? 0,
    up: int(d.up) ?? 0, down: int(d.down) ?? 0, flat: int(d.flat) ?? 0, no_move: int(d.no_move) ?? 0, rows,
  }
  const lines = []
  if (!count) {
    lines.push(`No company on UCT's earnings calendar for ${day} has a reported result on record${facts.scheduled != null ? ` (${plural(facts.scheduled, 'company', 'companies')} on the calendar that day)` : ''}. That is a normal answer, not a failed read.`)
  } else {
    lines.push(`Earnings reactions for ${day}: ${plural(count, 'company', 'companies')} with a reported result on record${facts.scheduled != null ? ` (${facts.scheduled} on the calendar that day)` : ''}.`)
    if (moves === 'held') lines.push(`Of the ${facts.moved} with a stock move on record: ${facts.up} up, ${facts.down} down${facts.flat ? `, ${facts.flat} unchanged` : ''}.`)
    if (rows.length < count) lines.push(`The table holds the first ${rows.length} of the ${count}, biggest move first.`)
    for (const r of rows.slice(0, TEXT_ROWS)) {
      const who = [r.name, r.session ? r.session.toLowerCase() : null].filter(Boolean).join(', ')
      const eps = r.eps_text ? `EPS ${r.eps_text}${r.eps_expected_text ? ` against ${r.eps_expected_text} expected${r.surprise_text ? ` (${r.surprise_text})` : ''}` : ''}` : null
      const rev = r.revenue_text ? `revenue ${r.revenue_text}${r.revenue_expected_text ? ` against ${r.revenue_expected_text} expected` : ''}` : null
      lines.push(`• ${r.symbol}${who ? ` (${who})` : ''}: ${[eps, rev, r.move_text ? `stock ${r.move_text}` : 'no stock move on record'].filter(Boolean).join('; ')}`)
    }
    if (rows.length > TEXT_ROWS) lines.push(`(${rows.length - TEXT_ROWS} more in the table.)`)
    if (moves === 'not_cached') lines.push('The stock moves for that day are not held on the server at the moment, and this answer never starts price reads, so no move is stated. That is not the same as no move.')
    else if (moves === 'none_worked_out') lines.push('No stock move is on record for these companies: the price source did not answer, or the session a move is measured to has not closed. That is not the same as no move.')
    else if (facts.no_move) lines.push(`${plural(facts.no_move, 'company', 'companies')} ${facts.no_move === 1 ? 'has' : 'have'} no stock move on record (no price bar for the day, or the session it is measured to has not closed).`)
    if (moves === 'held') lines.push(facts.day_kind === 'today' ? MOVE_MEANING_TODAY : MOVE_MEANING_PAST)
  }
  lines.push('The calendar and the moves carry no data time, only the day they are for.')
  lines.push(`Source: UCT's earnings calendar (third-party results and estimates as UCT holds them) and UCT's own move arithmetic. ${DESCRIPTIVE}`)
  return {
    text: lines.join('\n'),
    ...(rows.length ? { table: {
      columns: [{ key: 'symbol', label: 'Symbol' }, { key: 'name', label: 'Company' }, { key: 'session', label: 'Reported' }, { key: 'eps', label: 'EPS' }, { key: 'eps_expected', label: 'EPS expected' },
        { key: 'surprise', label: 'EPS against expected' }, { key: 'revenue', label: 'Revenue' }, { key: 'revenue_expected', label: 'Revenue expected' }, { key: 'move', label: 'Stock move' }],
      rows: rows.map(r => ({ symbol: r.symbol, name: r.name || '—', session: r.session || '—', eps: r.eps_text || '—', eps_expected: r.eps_expected_text || '—', surprise: r.surprise_text || '—',
        revenue: r.revenue_text || '—', revenue_expected: r.revenue_expected_text || '—', move: r.move_text || 'not on record' })),
    } } : {}),
    ...(rows.some(r => r.move_text) ? { present: {
      kind: 'metrics', title: `Earnings reactions, ${facts.day || 'day not given'}`, short: 'Earnings reactions',
      items: rows.filter(r => r.move_text).slice(0, TEXT_ROWS * 2).map(r => ({ label: r.symbol, value: r.move_text, note: r.surprise_text ? `EPS ${r.surprise_text} against expected` : '', aka: [r.symbol.toLowerCase()] })),
    } } : {}),
    link: { href: '/calendar', label: 'Open the Calendar' },
    facts,
  }
}

export async function answerReactions(args = {}) {
  const params = { limit: clamp(args.limit, REACTIONS_MAX_ROWS, REACTIONS_DEFAULT_ROWS) }
  if (args.date != null && args.date !== '') {
    const model = await import('../../pages/terminal/panels/earningsReactionsModel')
    if (typeof args.date !== 'string' || !model.isIsoDate(args.date)) return { text: `Which day's earnings reactions should I read? Give me the date as YYYY-MM-DD. ${NONE_STATED}` }
    if ([0, 6].includes(weekday(args.date))) return { text: `${dayText(args.date)} is a weekend day: the earnings calendar has none. Give me a weekday. ${NONE_STATED}` }
    params.date = args.date
  }
  const turnId = currentTurnId()
  if (!turnId) return { text: `I couldn't read the earnings reactions: ${NO_TURN}.` }
  const envl = await readData('earnings.reactions', params, { purpose: 'answer', turnId })   // a LITERAL: qa/modelIsolation reads it
  const model = await import('../../pages/terminal/panels/earningsReactionsModel')
  return answerFromReactions(envl, model, params.date || null)
}

// ── routing words (armed only while registered; routing.js's `marketBoards` group lists none) ─────────────────────────
// Routing v2 reaches the four by their summaries. v1 (the kill-switch fallback, and the router the capability-regression
// corpus runs) selects a group by its words, and `marketBoards` is words-only: these words are the only way v1 sends it.
// Routing only ADDS a group (the other groups a message names still ride along: "earnings" still names the data group), and
// each pattern is kept off another capability's own language:
//   gamma      gamma / GEX levels, walls and the zero gamma level of a stock: never the chart's GEX Walls indicator or
//              overlay (indicators, chart settings), a drawing, an alert, a screen, or "what is a call wall" (the guide);
//   topPicks   "top flow" by name: never the Options Flow page, a widget or a tab;
//   record     the Flow Record / scoreboard by name, or a win rate asked of the flow: never opening its page, never a
//              member's own win rate (the journal);
//   reactions  how a day's reporters moved: never who reports (calendar.day), a screen, an alert, or one stock's own
//              history after earnings (stock.earnings, history.afterEvent).
// ⛔ no lookbehind (iOS 16 floor, src/noRegexLookbehind.test.js).
const NOT_CHART_OR_CONCEPT = '^(?!(?:what(?:\'s| is| are) an? |explain\\b|define\\b))(?!.*\\b(?:turn (?:on|off)|enable|disable|toggle|hide|indicators?|charts?|widgets?|page|tab|window|add|remove|colou?rs?|signature|overlays?|draw|lines?|alerts?|notify|scans?|screens?|screener|filters?|find)\\b)'
const NOT_A_PAGE = '^(?!.*\\b(?:page|tab|widgets?|panel|window|go to|navigate|take me)\\b)'
const NOT_NAVIGATION = '^(?!.*\\b(?:open|go to|navigate|take me|page|tab|widgets?|panel|window|my|mine|journal)\\b)'
const NOT_A_SCREEN_OR_CALENDAR = '^(?!.*\\b(?:scans?|screens?|screener|filters?|find|alerts?|notify|widgets?|page|tab|calendar|watchlists?)\\b)'
export const WAVE3_ROUTE_WORDS = Object.freeze({
  gamma: [
    new RegExp(`${NOT_CHART_OR_CONCEPT}.*\\b(?:gamma|gex) (?:walls?|levels?|flip|exposure levels?)\\b`),
    new RegExp(`${NOT_CHART_OR_CONCEPT}.*(?:\\bzero[\\s-]gamma\\b|\\b(?:call|put) walls?\\b)`),
  ],
  topPicks: [
    new RegExp(`${NOT_A_PAGE}.*\\btop[\\s-]flow\\b`),
  ],
  record: [
    new RegExp(`${NOT_NAVIGATION}.*\\bflow (?:record|scoreboard)\\b`),
    new RegExp(`${NOT_NAVIGATION}.*(?:\\b(?:win|hit|success) rates?\\b.*\\bflow\\b|\\bflow\\b.*\\b(?:win|hit|success) rates?\\b)`),
  ],
  reactions: [
    new RegExp(`${NOT_A_SCREEN_OR_CALENDAR}.*\\b(?:post[\\s-]earnings|earnings) (?:reactions?|moves?|movers|winners|losers)\\b`),
    new RegExp(`${NOT_A_SCREEN_OR_CALENDAR}.*\\b(?:reporters|reported)\\b.*\\b(?:mov(?:e|ed|es|ing)|react(?:ed|ing|ions?)?|gap(?:ped|s)?|trad(?:e|ed|ing)|do|did|fared?)\\b`),
  ],
})
export const ROUTE_GROUP = 'marketBoards'
const ownGroup = () => GROUPS.find(g => g.id === ROUTE_GROUP)
/** Adds (or takes back) ONE capability's words on the wave's own group. */
function armRoutes(key, on) {
  const g = ownGroup()
  if (!g) return
  for (const re of WAVE3_ROUTE_WORDS[key]) {
    const at = g.words.indexOf(re)
    if (on && at < 0) g.words.push(re)
    if (!on && at >= 0) g.words.splice(at, 1)
  }
}

// ── registration: each capability only while the server serves ITS kind ───────────────────────────────────────────────
// ⚠️ THE WORDS OF A SUMMARY AND OF ITS HINTS JOIN THE TYPO LEXICON (nl/lexicon.js: every lowercase word of three letters or
// more; a word in CAPITALS does not). A new known word changes what a nearby word in ANY member message may be "corrected" to:
// a lowercase "wall" here offered "wall me through the setup" for "walk me through the setup". So the text below is worded to
// leave every existing capability-regression phrasing's corrections exactly as they were (pinned in
// agentTerminalDataWave3.test.js, "the typo lexicon"): measured culprits were wall, distance, wide, done, best, react, expected.
const TARGET_HINT = 'target = the ref of the stockData entry.'
const NO_FIGURES = 'reply: one short line, no figures.'
const unregister = {}

/** Idempotent; registers each of the four ONLY while the server serves its kind. Returns the names registered by this call. */
export function registerTerminalWave3Capabilities() {
  const added = []
  if (!unregister.gamma && kindServed(KINDS.gamma)) {
    unregister.gamma = registerCapability({
      name: 'stock.gammaLevels',        // a LITERAL: the server's local-only mirror rail reads it (tests/test_uct_agent_breadth.py)
      surfaces: ['*'],
      target: 'market', query: true,
      localOnly: true,                  // ⛔ UCT-computed from an option chain: shown to the member, never to a model (turn.LOCAL_ONLY_ACTIONS)
      summary: 'One stock\'s GAMMA LEVELS: the CALL WALL, the PUT WALL and the ZERO GAMMA level UCT works out from its options expiring within a week, each with how far it sits from the stock price. '
        + 'For "gamma levels for NVDA", "SPY gamma walls", "TSLA zero gamma".',
      hints: `${TARGET_HINT} symbol = the one ticker named (or the open chart's symbol). Answered only from levels the server already holds: it never starts an option chain read, so it may say none are held. `
        + `Dark pool levels are stock.darkPoolLevels; turning the GEX Walls indicator on or off on a chart is a chart change, not this; what the options market prices for earnings is stock.expectedMove. ${NO_FIGURES}`,
      args: { type: 'object', properties: { symbol: { type: 'string' } }, required: ['symbol'], additionalProperties: false },
      answer: (_snap, args) => answerGamma(args || {}),
    })
    armRoutes('gamma', true)
    added.push(CAPABILITIES.gamma)
  }
  if (!unregister.topPicks && kindServed(KINDS.topPicks)) {
    unregister.topPicks = registerCapability({
      name: 'stock.topFlowPicks',       // a LITERAL: the server's local-only mirror rail reads it
      surfaces: ['*'],
      target: 'market', query: true,
      localOnly: true,                  // ⛔ UCT's own picks and their option results: shown to the member, never to a model
      summary: 'UCT\'s TOP FLOW PICKS one by one: each option contract UCT flagged on its options flow tape, with the CONTRACT\'s gain since it was flagged and its peak gain, open or expired. '
        + 'For "show me the top flow picks", "how are the top flow picks doing", "top flow picks on NVDA".',
      hints: `${TARGET_HINT} status: ${PICK_STATUS_KEYS.join('|')} (null = all); direction: ${PICK_DIRECTION_KEYS.join('|')} (null = any); sort: ${PICK_SORT_KEYS.join('|')} (null = gain: biggest gain since flagged first; `
        + `loss = biggest loss first; peak = biggest peak gain; newest = newest pick). limit 1-${PICKS_MAX_ROWS} (null = ${PICKS_DEFAULT_ROWS}); symbol = one ticker to keep, else null. `
        + `The record's overall WIN RATES are stock.flowRecord; the options flow tape itself and its widgets are not this. ${NO_FIGURES}`,
      args: {
        type: 'object',
        properties: { status: { type: ['string', 'null'], enum: [...PICK_STATUS_KEYS, null] }, direction: { type: ['string', 'null'], enum: [...PICK_DIRECTION_KEYS, null] },
          sort: { type: ['string', 'null'], enum: [...PICK_SORT_KEYS, null] }, limit: { type: ['integer', 'null'] }, symbol: { type: ['string', 'null'] } },
        required: ['status', 'direction', 'sort', 'limit', 'symbol'], additionalProperties: false,
      },
      answer: (_snap, args) => answerTopPicks(args || {}),
    })
    armRoutes('topPicks', true)
    added.push(CAPABILITIES.topPicks)
  }
  if (!unregister.record && kindServed(KINDS.record)) {
    unregister.record = registerCapability({
      name: 'stock.flowRecord',         // a LITERAL: the server's local-only mirror rail reads it
      surfaces: ['*'],
      target: 'market', query: true,
      localOnly: true,                  // ⛔ UCT's own measurement of its own picks: shown to the member, never to a model
      summary: 'UCT\'s FLOW RECORD: the aggregate results of every Top Flow pick. WIN RATES (the share of picks whose option contract gained 10%, 25%, 50% or doubled), the same BY GRADE, and the last scored picks whatever their result. '
        + 'For "what is the flow record\'s win rate", "flow record by grade", "flow scoreboard".',
      hints: `${TARGET_HINT} No arguments: it is one board. The picks one by one (a list, a ticker's picks, the biggest gainers) are stock.topFlowPicks; opening the Flow Record page is navigation, not this; `
        + `a member's own trading win rate is their journal, not this. ${NO_FIGURES}`,
      args: { type: 'object', properties: {}, required: [], additionalProperties: false },
      answer: () => answerRecord(),
    })
    armRoutes('record', true)
    added.push(CAPABILITIES.record)
  }
  if (!unregister.reactions && kindServed(KINDS.reactions)) {
    unregister.reactions = registerCapability({
      name: 'stock.earningsReactions',  // a LITERAL: the server's local-only mirror rail reads it
      surfaces: ['*'],
      target: 'market', query: true,
      localOnly: true,                  // ⛔ UCT's calendar with third-party results and estimates: shown to the member, never to a model
      summary: 'EARNINGS REACTIONS for ONE DAY: the companies that reported that day, each with its EPS and revenue against the estimates and how the STOCK MOVED after the report, biggest move first. '
        + 'For "how did yesterday\'s earnings reporters move", "earnings reactions for 2026-11-12", "post-earnings moves on Thursday".',
      hints: `${TARGET_HINT} date = the day as YYYY-MM-DD (a weekday) when the member named one ("yesterday", "Thursday"), else null = the last finished session. limit 1-${REACTIONS_MAX_ROWS} companies (null = ${REACTIONS_DEFAULT_ROWS}). `
        + `The whole market, one day. WHO reports on a day (tickers only) is calendar.day; WHEN one stock reports and its own past results are stock.earnings; how one stock tends to trade after earnings is history.afterEvent. ${NO_FIGURES}`,
      args: {
        type: 'object',
        properties: { date: { type: ['string', 'null'] }, limit: { type: ['integer', 'null'] } },
        required: ['date', 'limit'], additionalProperties: false,
      },
      answer: (_snap, args) => answerReactions(args || {}),
    })
    armRoutes('reactions', true)
    added.push(CAPABILITIES.reactions)
  }
  return added
}
export const _resetTerminalWave3ForTest = () => {
  for (const k of Object.keys(unregister)) { unregister[k]?.(); delete unregister[k] }
  for (const k of Object.keys(WAVE3_ROUTE_WORDS)) armRoutes(k, false)
}
