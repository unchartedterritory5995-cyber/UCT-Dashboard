// Terminal data wave 10 — six LOCAL-ONLY capabilities over six model-isolated data kinds (MD-1 §4.19):
//   stock.riskProfile      stock.stats            one stock's statistics: volatility and range, beta, returns, its own declines,
//                                                 how it fell against the S&P 500 in the index's corrections (STAT)
//   stock.volumeFootprint  stock.volumeFootprint  accumulation and distribution, up/down volume, pocket pivots, gaps (VFP)
//   stock.factorExposure   stock.factorExposure   the factor loadings with their t, R-squared, the largest VIF, the plain reading (FCTX)
//   stock.setupHistory     stock.setupHistory     the setups that fired on one stock and the universe line per setup and phase (SETH)
//   stock.companyRecord    company.publicRecords  federal contracts, clinical trials, FDA approvals, lobbying (PUBR)
//   stock.ownershipReport   ownership.funds        the registered funds holding one stock, from the SEC's N-PORT data sets (OWN)
//
// Each answer is built in the browser from ONE read of its own kind and shown to the MEMBER ONLY: every capability is
// `localOnly` (its name is in turn.LOCAL_ONLY_ACTIONS on the server), every kind is model-isolated, and nothing the read
// returns reaches a model provider. All six were isolated as the builder's default, from the licensing register's rows
// (quoted in each adapter and in MD-1 §4.19); nobody decided otherwise and nobody was asked.
//
// What every answer keeps to:
//   • the date is the DATA'S OWN (the newest session's close, a fund's report period, each record section's read time),
//     never the time of the ask; the time UCT worked the data out or read it rides beside it;
//   • a number that does not exist is never 0: a statistic the history is too short for, a beta not stated, a loading left
//     out, a return the history cannot reach, a figure an agency or a filing did not give;
//   • a list that is cut says so, and from which end;
//   • nothing held and a read that failed are never said as "no statistics", "no signal", "no records" or "no fund", a
//     section of the public records that matched nothing says "no record matched", never that none exist, and a stock no
//     fund holding could be matched to is never "no fund holds it";
//   • an envelope's notes are never echoed (each agency's own required words come from the read's data);
//   • the price studies' vendor is not named;
//   • what a kind leaves out is said, with the panel that shows it.
//
// The panels' own models read the data (each kind keeps its route's field names) and give the words, so an answer and
// its panel say the same thing.
//
// Dark by construction: each is registered only while the server serves its own kind (UCT_AGENT_DATA_KINDS, fail closed; an
// isolated kind also needs its own UCT_AGENT_ISOLATED_KINDS entry or every read is refused). Nothing here arms anything.
// ROUTING: the six share ONE words-only group of their own, `stockStudies` (routing.js lists them by action). It is the
// 52nd group of the 56 the server keeps (turn.MAX_GROUPS). Each capability's own words (WAVE10_ROUTE_WORDS) are added to
// that group only while it is registered, so on a dark server the group has no words and no registered action, and
// routing is byte-identical to the base.
import { registerCapability } from '../capabilities'
import { readData } from '../marketdata/client'
import { currentTurnId } from '../trace'
import { GROUPS } from '../routing'
import { stampET } from './marketDataFacts'
import { kindServed, usable, noRead, plural, andList, dayText, NO_TURN } from './terminalDataFormat'
import { formatCompactTerminal, formatNumber } from '../../lib/presentation/presentationPrimitives'
import {
  statRead, atrText, realizedText, adrText, range52Text, avgVolumeText, daysText, betaText, captureText, drawdownsLine, deepestLine,
  correctionsLine, changeText as statChange,
} from '../../pages/terminal/panels/stockStatsModel'
import { vfpRead, windowText, updownText, pivotsLine, gapsLine, fillCell, earningsNote, pivotCells, sharesText } from '../../pages/terminal/panels/volumeFootprintModel'
import { fctxRead, loadingCell, factorName, fitRows, unstableText, fundsNote, windowText as fctxWindowText } from '../../pages/terminal/panels/factorExposureModel'
import { sethStockRead, signalPhaseText, phaseShort, changeText as sethChange, hitText, tooFewText, stockLine } from '../../pages/terminal/panels/setupHistoryModel'
import { pubrRead, contractsLede, trialsLede, fdaLede, lobbyingLede, noMatchWords, notCountedWords, moneyWords, companyLabel } from '../../pages/terminal/panels/publicRecordsModel'
import {
  NPORT_SOURCE, nportRows, changeText as nportChange, nportSummaryLines, nportPeriodLine, nportMatchLine, nportCoverageLine, nportCheckLine,
  quarterWords,
} from '../../pages/terminal/panels/fundNportModel'

export const KINDS = Object.freeze({
  stats: 'stock.stats', footprint: 'stock.volumeFootprint', factors: 'stock.factorExposure', setups: 'stock.setupHistory',
  records: 'company.publicRecords', funds: 'ownership.funds',
})
export const CAPABILITIES = Object.freeze({
  stats: 'stock.riskProfile', footprint: 'stock.volumeFootprint', factors: 'stock.factorExposure', setups: 'stock.setupHistory',
  records: 'stock.companyRecord', funds: 'stock.ownershipReport',
})
export const NOT_ADVICE = 'not a forecast and not advice'
export const PANELS = Object.freeze({ stats: 'STAT', footprint: 'VFP', factors: 'FCTX', setups: 'SETH', records: 'PUBR', funds: 'OWN' })
const TEXT_ROWS = 5
const PRESENT_ROWS = 12
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
const TICKER = /^[A-Z0-9]{1,10}(?:-[A-Z0-9]{1,4}){0,2}$/
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const int = (v) => (Number.isInteger(v) ? v : null)
const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null)
const list = (v) => (Array.isArray(v) ? v.filter(r => r && typeof r === 'object') : [])
const isoDay = (v) => (typeof v === 'string' && ISO_DAY.test(v) ? v : null)
const clamp = (v, max, fallback) => (Number.isInteger(v) ? Math.min(Math.max(v, 1), max) : fallback)
/** "Fri, Nov 13, 2026" → "Nov 13, 2026" */
const shortDay = (ymd) => (dayText(ymd) || '').replace(/^\w+, /, '') || null
/** a ticker the way UCT writes it (BRK.B -> BRK-B), or null */
const tickerOf = (s) => { const t = String(s || '').trim().toUpperCase().replace(/^\$/, '').replace(/\./g, '-'); return TICKER.test(t) ? t : null }
const unclean = (what, none) => ({ text: `I couldn't read ${what}: UCT's data did not answer cleanly. ${none}` })
const more = (n) => `${n} more ${n === 1 ? 'is' : 'are'} in the table.`
const ask = (what, none) => ({ text: `Which stock's ${what} should I read? Give me one ticker. ${none}` })
const workedAt = (read, what) => (read ? `UCT worked ${what} out at ${read} (UCT's own time), and this answer never works ${what} out again.`
  : `The answer carries no time UCT worked ${what} out, so I cannot say how old ${what === 'it' ? 'it is' : 'they are'}.`)
/** the staleness codes a price study's data carries (`stale_for`), in words: never read from a note */
function staleLines(d, sym, code, what) {
  const codes = Array.isArray(d.stale_for) ? d.stale_for : []
  const out = []
  if (codes.includes('earlier_session')) {
    out.push(`Stale: UCT worked ${what} out for the session of ${dayText(d.session) || 'an earlier day'}, and a newer session has closed since. This answer never works ${what} out again: open ${code} for ${sym} in UCT, then ask again.`)
  }
  if (codes.includes('closes_short')) {
    out.push(`Stale: the newest close UCT held for ${sym} (${dayText(d.data_through)}) stops short of the session ${what === 'it' ? 'it was' : 'they were'} worked out for: the store had not caught up, or the stock did not trade.`)
  }
  return out
}

// ── stock.riskProfile ← stock.stats ──────────────────────────────────────────────────────────────────────────────────
export const STATS_DEFAULT_ROWS = 5
export const STATS_MAX_ROWS = 40
export const STATS_RECORD = `Price returns (split-adjusted, not dividend-adjusted) from UCT's stored daily prices: a record of the past, ${NOT_ADVICE}.`
export const STATS_LEFT_OUT = 'Each correction\'s own row is not in this answer: the STAT panel in UCT shows it.'
export const CORRECTION_STATE_WORDS = Object.freeze({
  computing: 'the S&P 500\'s declines were still being worked out when UCT worked these statistics out, so the corrections summary is not stated.',
  not_held: 'the S&P 500\'s declines were not held when UCT worked these statistics out, so the corrections summary is not stated.',
  unavailable: 'the S&P 500\'s declines could not be read when UCT worked these statistics out, so the corrections summary is not stated.',
})
const STATS_NONE = 'No statistic is stated. That is not the same as no statistics.'
const sectorName = (p) => (p.symbol ? (p.sector ? `${p.sector} (${p.symbol})` : p.symbol) : 'its sector fund')

/** Pure: a `stock.stats` envelope → the answer. */
export function answerFromStats(envl, symbol) {
  const sym = symbol || str(envl?.data?.symbol) || 'the stock'
  const what = `${sym}'s statistics`
  if (!usable(envl)) {
    return { text: noRead(what, envl, `none are held on the server yet (this answer never works them out), or the read failed. Open STAT for ${sym} in UCT, then ask again`, STATS_NONE) }
  }
  const d = envl.data
  const v = statRead({ ...d, status: 'ok' })
  if (v.state !== 'ok' || !v.dataThrough || !Array.isArray(d.returns?.periods) || !obj(d.beta) || !obj(d.drawdowns) || !obj(d.corrections)) return unclean(what, STATS_NONE)
  const vol = v.volatility
  const { spy, sector } = v.beta
  const dd = v.drawdowns
  const c = v.corrections
  const read = stampET(d.read_at, envl.fetched_at)
  const lines = [`${sym}'s statistics as UCT holds them, from its stored daily prices (${v.sessions ?? 0} sessions, ${dayText(v.first) || 'a start it does not give'} to ${dayText(v.dataThrough)}):`]
  lines.push('Volatility and range:')
  lines.push(`• ATR (14): ${atrText(vol.atr)}`)
  lines.push(`• Realized volatility: ${realizedText(vol.realized)}`)
  lines.push(`• Average daily range: ${adrText(vol.adr)}`)
  lines.push(`• 52-week range: ${range52Text(vol.range52)}`)
  lines.push(`• Average volume: ${avgVolumeText(vol.volume)}`)
  lines.push(`• Up and down days over the last year: ${daysText(vol.days)}`)
  lines.push(`Beta and correlation over the newest ${v.beta.window} daily returns:`)
  lines.push(`• Against SPY: ${betaText(spy)}${spy.state === 'ok' ? `; up capture ${captureText(spy, 'up')}, down capture ${captureText(spy, 'down')}` : ''}`)
  lines.push(`• Against ${sectorName(sector)}: ${betaText(sector)}`)
  const periods = v.returns.periods
  lines.push(`Returns: ${periods.map(p => `${p.label} ${p.state === 'ok' ? `${statChange(p.returnPct)}${p.yearlyPct != null ? ` (${statChange(p.yearlyPct)} a year)` : ''}` : 'n/a'}`).join(', ')}.`)
  const short = periods.filter(p => p.state !== 'ok').map(p => p.label)
  if (short.length) lines.push(`${andList(short)} ${short.length === 1 ? 'reaches' : 'reach'} back past the prices UCT holds, so ${short.length === 1 ? 'it is' : 'they are'} not stated: that is not a return of 0.`)
  lines.push(`Its own declines: ${drawdownsLine(dd, sym)}${deepestLine(dd) ? ` ${deepestLine(dd)}` : ''}`)
  if (dd.total > dd.episodes.length && dd.episodes.length) lines.push(`${dd.total} declines are held and the newest ${dd.episodes.length} are in this answer: the list is cut from the old end.`)
  lines.push(c.state === 'ok' ? `In the S&P 500's corrections: ${correctionsLine(c, sym)}` : `In the S&P 500's corrections: ${CORRECTION_STATE_WORDS[c.state] || CORRECTION_STATE_WORDS.unavailable}`)
  const jumps = Array.isArray(d.suspect_jumps) ? d.suspect_jumps.filter(isoDay) : []
  if (jumps.length) lines.push(`${plural(jumps.length, 'session')} moved more than ${v.jumpPct}% in one close (${andList(jumps.slice(0, 3).map(shortDay))}${jumps.length > 3 ? ' and others' : ''}), which can be a split the history did not adjust: check the chart.`)
  lines.push(...staleLines(d, sym, 'STAT', 'these'))
  lines.push(STATS_RECORD)
  lines.push(STATS_LEFT_OUT)
  lines.push(workedAt(read, 'these'))
  const facts = {
    symbol: sym, as_of: v.dataThrough, session: isoDay(d.session), sessions: v.sessions, read, stale: !!envl.stale, stale_for: Array.isArray(d.stale_for) ? d.stale_for : [],
    beta: { spy: spy.state === 'ok' ? spy.beta : null, spy_state: spy.state, sector: sector.state === 'ok' ? sector.beta : null, sector_state: sector.state, sector_symbol: sector.symbol || null },
    returns: Object.fromEntries(periods.map(p => [p.key, p.state === 'ok' ? p.returnPct : null])),
    drawdowns: { total: dd.total, shown: dd.episodes.length, deepest_pct: dd.deepest?.depthPct ?? null },
    corrections: c.state === 'ok' ? { state: 'ok', ...c.summary } : { state: c.state },
  }
  const rows = periods.map(p => ({ period: p.label, value: p.state === 'ok' ? statChange(p.returnPct) : 'n/a', note: p.state === 'ok' ? (p.from ? `from ${shortDay(p.from)}` : '') : 'not enough history' }))
  return {
    text: lines.join('\n'),
    table: { columns: [{ key: 'period', label: 'Period' }, { key: 'value', label: 'Return' }, { key: 'note', label: 'Note' }], rows },
    present: {
      kind: 'metrics', title: `${sym} statistics`, short: 'Stock statistics',
      items: [
        { label: 'Beta vs SPY', value: spy.state === 'ok' && spy.beta != null ? formatNumber(spy.beta, { decimals: 2 }) : 'n/a', note: 'newest year of daily returns', aka: ['beta'] },
        { label: 'ATR (14)', value: atrText(vol.atr), note: 'average true range', aka: ['atr'] },
        ...periods.filter(p => p.state === 'ok').map(p => ({ label: p.label, value: statChange(p.returnPct), note: 'price return', aka: [p.key.toLowerCase()] })),
      ].slice(0, PRESENT_ROWS),
    },
    facts,
  }
}

export async function answerStats(args = {}) {
  const sym = tickerOf(args.symbol)
  if (!sym) return ask('statistics', STATS_NONE)
  const turnId = currentTurnId()
  if (!turnId) return { text: `I couldn't read ${sym}'s statistics: ${NO_TURN}.` }
  const params = { symbol: sym, rows: clamp(args.rows, STATS_MAX_ROWS, STATS_DEFAULT_ROWS) }
  const envl = await readData('stock.stats', params, { purpose: 'answer', turnId })   // a LITERAL: qa/modelIsolation reads it
  return answerFromStats(envl, sym)
}

// ── stock.volumeFootprint ← stock.volumeFootprint ────────────────────────────────────────────────────────────────────
export const FOOTPRINT_DEFAULT_ROWS = 5
export const FOOTPRINT_MAX_ROWS = 60
export const FOOTPRINT_RECORD = `Counts from UCT's stored daily prices and volumes (split-adjusted): a record of the past, ${NOT_ADVICE}.`
export const FOOTPRINT_LEFT_OUT = 'The biggest volume days of the year and each accumulation and distribution day are not in this answer: the VFP panel in UCT shows them.'
const FOOTPRINT_NONE = 'No count is stated. That is not the same as no accumulation and no gaps.'

/** Pure: a `stock.volumeFootprint` envelope → the answer. */
export function answerFromFootprint(envl, symbol) {
  const sym = symbol || str(envl?.data?.symbol) || 'the stock'
  const what = `${sym}'s volume footprint`
  if (!usable(envl)) {
    return { text: noRead(what, envl, `it is not held on the server yet (this answer never works it out), or the read failed. Open VFP for ${sym} in UCT, then ask again`, FOOTPRINT_NONE) }
  }
  const d = envl.data
  const v = vfpRead({ ...d, status: 'ok' })
  if (v.state !== 'ok' || !v.dataThrough || !obj(d.accumulation) || !obj(d.pivots) || !obj(d.gaps)) return unclean(what, FOOTPRINT_NONE)
  const a = v.accumulation
  const p = v.pivots
  const g = v.gaps
  const read = stampET(d.read_at, envl.fetched_at)
  const lines = [`${sym}'s volume footprint as UCT holds it, from its stored daily bars through ${dayText(v.dataThrough)} (a close at least ${formatNumber(a.minMovePct, { decimals: 1 })}% up or down on more volume than the session before):`]
  for (const w of a.windows) lines.push(`• Last ${w.sessions ?? '?'} sessions: ${windowText(w)}`)
  lines.push(`• Up/down volume over ${a.updown.sessions} sessions: ${updownText(a.updown)}`)
  lines.push(`• Pocket pivots: ${pivotsLine(p, sym)}`)
  for (const r of p.rows.slice(0, TEXT_ROWS)) lines.push(`  ${shortDay(r.date)}: ${statChange(r.changePct)} on ${sharesText(r.volume)} shares, ${pivotCells(r).volume}`)
  const pivTotal = p.state === 'ok' ? p.count : 0
  if (pivTotal > p.rows.length && p.rows.length) lines.push(`  ${pivTotal} pocket pivots are held for the last year and the newest ${p.rows.length} are in this answer: the list is cut from the old end.`)
  lines.push(`• Gaps: ${gapsLine(g, sym)}`)
  if (g.state === 'ok' && g.total) {
    const w5 = fillCell(g.summary.all.within5)
    const w20 = fillCell(g.summary.all.within20)
    lines.push(`  Filled within 5 sessions: ${w5.main} (${w5.sub}); within 20 sessions: ${w20.main} (${w20.sub}).`)
    for (const r of g.rows.slice(0, TEXT_ROWS)) {
      lines.push(`  ${shortDay(r.date)}: ${r.up ? 'up' : 'down'} ${r.gapPct == null ? 'n/a' : `${formatNumber(Math.abs(r.gapPct), { decimals: 1 })}%`}, ${r.filled ? (r.sessionsToFill === 0 ? 'filled the same session' : `filled ${shortDay(r.filled)}`) : 'not filled yet'}${r.check ? ' (check the chart: a split may not be adjusted)' : ''}`)
    }
    if (g.total > g.rows.length && g.rows.length) lines.push(`  ${g.total} gaps are held and the newest ${g.rows.length} are in this answer: the list is cut from the old end.`)
  }
  lines.push(`Earnings marks: ${earningsNote(v.earnings, sym)}`)
  lines.push(...staleLines(d, sym, 'VFP', 'it'))
  lines.push(FOOTPRINT_RECORD)
  lines.push(FOOTPRINT_LEFT_OUT)
  lines.push(workedAt(read, 'it'))
  const facts = {
    symbol: sym, as_of: v.dataThrough, session: isoDay(d.session), read, stale: !!envl.stale, stale_for: Array.isArray(d.stale_for) ? d.stale_for : [],
    windows: a.windows.map(w => ({ sessions: w.sessions, state: w.state, accumulation: w.state === 'ok' ? w.accumulation : null, distribution: w.state === 'ok' ? w.distribution : null, net: w.state === 'ok' ? w.net : null })),
    updown_ratio: a.updown.state === 'ok' ? a.updown.ratio : null,
    pivots: { state: p.state, count: p.state === 'ok' ? p.count : null, last: isoDay(d.pivots?.last) },
    gaps: g.state === 'ok' ? { total: g.total, up: g.summary.up.count, down: g.summary.down.count, open: g.summary.all.open, within_5_pct: g.summary.all.within5.pct, within_20_pct: g.summary.all.within20.pct } : { state: g.state },
    earnings: v.earnings.state,
  }
  const rows = [...a.windows.filter(w => w.state === 'ok').map(w => ({ item: `Last ${w.sessions} sessions`, value: `net ${w.net > 0 ? '+' : ''}${w.net}`, note: `${w.accumulation} accumulation, ${w.distribution} distribution` })),
    ...p.rows.map(r => ({ item: 'Pocket pivot', value: shortDay(r.date), note: statChange(r.changePct) })),
    ...g.rows.map(r => ({ item: r.up ? 'Gap up' : 'Gap down', value: shortDay(r.date), note: r.filled ? `filled ${shortDay(r.filled)}` : 'not filled yet' }))]
  return {
    text: lines.join('\n'),
    table: { columns: [{ key: 'item', label: 'Item' }, { key: 'value', label: 'Value' }, { key: 'note', label: 'Note' }], rows },
    present: { kind: 'metrics', title: `${sym} volume footprint`, short: 'Volume footprint', items: rows.slice(0, PRESENT_ROWS).map(r => ({ label: r.item, value: r.value, note: r.note, aka: [r.item.toLowerCase()] })) },
    facts,
  }
}

export async function answerFootprint(args = {}) {
  const sym = tickerOf(args.symbol)
  if (!sym) return ask('volume footprint', FOOTPRINT_NONE)
  const turnId = currentTurnId()
  if (!turnId) return { text: `I couldn't read ${sym}'s volume footprint: ${NO_TURN}.` }
  const params = { symbol: sym, rows: clamp(args.rows, FOOTPRINT_MAX_ROWS, FOOTPRINT_DEFAULT_ROWS) }
  const envl = await readData('stock.volumeFootprint', params, { purpose: 'answer', turnId })   // a LITERAL: qa/modelIsolation reads it
  return answerFromFootprint(envl, sym)
}

// ── stock.factorExposure ← stock.factorExposure ──────────────────────────────────────────────────────────────────────
export const FACTORS_RECORD = `How the stock traded over the window, from UCT's stored daily prices: ${NOT_ADVICE}.`
export const FACTORS_LEFT_OUT = 'The year-earlier window and the change in each loading since then are not in this answer: the FCTX panel in UCT shows them.'
const FACTORS_NONE = 'No loading is stated. That is not the same as no exposure.'

/** Pure: a `stock.factorExposure` envelope → the answer. */
export function answerFromFactors(envl, symbol) {
  const sym = symbol || str(envl?.data?.symbol) || 'the stock'
  const what = `${sym}'s factor exposure`
  if (!usable(envl)) {
    return { text: noRead(what, envl, `it is not held on the server yet (this answer never works it out), or the read failed. Open FCTX for ${sym} in UCT, then ask again`, FACTORS_NONE) }
  }
  const d = envl.data
  const v = fctxRead({ ...d, status: 'ok' })
  if (v.state !== 'ok' || !v.dataThrough || !obj(d.now)) return unclean(what, FACTORS_NONE)
  const w = v.now
  const m = v.method
  const read = stampET(d.read_at, envl.fetched_at)
  const lines = [`How ${sym} traded against six fund spreads (the market, size, growth vs value, momentum, quality, low volatility), as UCT holds it, over ${fctxWindowText(w, m)}:`]
  if (w.state === 'ok') {
    if (v.reading) lines.push(`The server's reading: ${v.reading.text}`)
    lines.push(`Loadings (a t above ${formatNumber(m.tBar)} clears the bar; one under it is too uncertain to read):`)
    for (const r of w.loadings) { const cell = loadingCell(r, m.tBar); lines.push(`• ${factorName(r.key)}: ${cell.main} (${cell.sub})`) }
    const fit = Object.fromEntries(fitRows(w, m).map(([label, value, key]) => [key, [label, value]]))
    for (const k of ['explained', 'own', 'vif']) if (fit[k]) lines.push(`${fit[k][0]}: ${fit[k][1]}.`)
    const warn = unstableText(w, m)
    if (warn) lines.push(warn)
  } else {
    lines.push('The newest window was not fitted, so no loading, R-squared or reading is stated: that is not a loading of 0.')
  }
  const note = fundsNote(v)
  if (note) lines.push(note)
  lines.push(...staleLines(d, sym, 'FCTX', 'it'))
  lines.push(FACTORS_RECORD)
  lines.push(FACTORS_LEFT_OUT)
  lines.push(workedAt(read, 'it'))
  const facts = {
    symbol: sym, as_of: v.dataThrough, session: isoDay(d.session), read, stale: !!envl.stale, stale_for: Array.isArray(d.stale_for) ? d.stale_for : [],
    window: w.state === 'ok' ? { returns: w.returns, from: w.from, to: w.to } : { state: w.state },
    reading: v.reading ? v.reading.text : null,
    loadings: w.state === 'ok' ? w.loadings.map(r => ({ key: r.key, loading: r.loading, t: r.t, clears: r.clears })) : [],
    r2: w.state === 'ok' ? w.r2 : null, max_vif: w.state === 'ok' ? w.maxVif : null, unstable: w.state === 'ok' ? w.unstable : null,
    factors: v.factors.map(f => ({ key: f.key, state: f.state })),
  }
  if (w.state !== 'ok') return { text: lines.join('\n'), facts }
  const rows = w.loadings.map(r => { const cell = loadingCell(r, m.tBar); return { factor: factorName(r.key), loading: cell.main, note: cell.sub } })
  return {
    text: lines.join('\n'),
    table: { columns: [{ key: 'factor', label: 'Factor' }, { key: 'loading', label: 'Loading' }, { key: 'note', label: 'Note' }], rows },
    present: { kind: 'metrics', title: `${sym} factor exposure`, short: 'Factor exposure', items: rows.slice(0, PRESENT_ROWS).map(r => ({ label: r.factor, value: r.loading, note: r.note, aka: [r.factor.toLowerCase()] })) },
    facts,
  }
}

export async function answerFactors(args = {}) {
  const sym = tickerOf(args.symbol)
  if (!sym) return ask('factor exposure', FACTORS_NONE)
  const turnId = currentTurnId()
  if (!turnId) return { text: `I couldn't read ${sym}'s factor exposure: ${NO_TURN}.` }
  const params = { symbol: sym }
  const envl = await readData('stock.factorExposure', params, { purpose: 'answer', turnId })   // a LITERAL: qa/modelIsolation reads it
  return answerFromFactors(envl, sym)
}

// ── stock.setupHistory ← stock.setupHistory ──────────────────────────────────────────────────────────────────────────
export const SETUPS_DEFAULT_ROWS = 3
export const SETUPS_MAX_ROWS = 20
export const SETUPS_RECORD = `Signals worked out from UCT's stored daily prices: a record of the past, ${NOT_ADVICE}.`
export const SETUPS_HINDSIGHT = 'The market phase is assigned with hindsight: read a phase as how a setup did in what turned out to be a correction, never as something a trader could have known on the day.'
export const UNIVERSE_STATE_WORDS = Object.freeze({
  not_held: 'the weekly study of every setup across UCT\'s stock universe is not held on the server yet, so no universe line is stated.',
  computing: 'the weekly study of every setup was still being worked out, so no universe line is stated.',
  waiting: 'the weekly study of every setup had not been worked out yet, so no universe line is stated.',
  unavailable: 'the weekly study held could not be read, so no universe line is stated.',
})
const SETUPS_NONE = 'No signal is stated. That is not the same as no signal.'
const UNIVERSE_HORIZON = 20

/** Pure: a `stock.setupHistory` envelope → the answer. */
export function answerFromSetups(envl, symbol) {
  const sym = symbol || str(envl?.data?.symbol) || 'the stock'
  const what = `${sym}'s setup history`
  if (!usable(envl)) {
    return { text: noRead(what, envl, `it is not held on the server yet (this answer never works it out), or the read failed. Open SETH for ${sym} in UCT, then ask again`, SETUPS_NONE) }
  }
  const d = envl.data
  const v = sethStockRead({ ...d, status: 'ok', cut: null })
  if (v.state !== 'ok' || !v.dataThrough || !Array.isArray(d.library)) return unclean(what, SETUPS_NONE)
  const read = stampET(d.read_at, envl.fetched_at)
  const total = int(d.total) ?? v.signals.length
  const lines = [`${sym} ${stockLine({ ...v, total })}`]
  if (v.signals.length) {
    lines.push('Newest signals of each setup (returns from the next session\'s open, 5 / 20 / 60 sessions on):')
    for (const s of v.signals.slice(0, TEXT_ROWS * 2)) {
      lines.push(`• ${shortDay(s.date)}: ${s.name} (${signalPhaseText(s.phase)}): ${[5, 20, 60].map(h => sethChange(s.returns[h])).join(' / ')}`)
    }
    if (v.signals.length > TEXT_ROWS * 2) lines.push(more(v.signals.length - TEXT_ROWS * 2))
    if (total > v.signals.length) lines.push(`${total} signals are held for ${sym} and the newest of each setup are in this answer (${v.signals.length} in all): each setup's list is cut from the old end.`)
  }
  const u = v.universe
  if (u.state === 'ok' && u.pairs.length) {
    lines.push(`Across UCT's stock universe in the same phase, ${UNIVERSE_HORIZON} sessions on (the weekly study${u.from && u.to ? `, ${shortDay(u.from)} to ${shortDay(u.to)}` : ''}):`)
    for (const pr of u.pairs.slice(0, TEXT_ROWS)) {
      const hz = pr.horizons[UNIVERSE_HORIZON]
      lines.push(`• ${pr.name}, ${phaseShort(pr.phase).toLowerCase()}: ${hz.below || hz.winRate == null ? tooFewText(hz.n, u.minSignals) : `up ${hitText(hz.winRate)} of the time over ${formatNumber(hz.n)} signals, average ${sethChange(hz.avgPct)}`}`)
    }
    if (u.pairs.length > TEXT_ROWS) lines.push(more(u.pairs.length - TEXT_ROWS))
  } else if (u.state !== 'ok') {
    const ustate = obj(d.universe)?.state
    lines.push(`Universe lines: ${UNIVERSE_STATE_WORDS[ustate] || UNIVERSE_STATE_WORDS.unavailable}`)
  }
  if (v.phases.state !== 'ok') lines.push('The S&P 500\'s declines were not held when UCT worked this out, so no signal carries a market phase.')
  else lines.push(SETUPS_HINDSIGHT)
  lines.push(...staleLines(d, sym, 'SETH', 'it'))
  lines.push(SETUPS_RECORD)
  lines.push(workedAt(read, 'it'))
  const facts = {
    symbol: sym, as_of: v.dataThrough, session: isoDay(d.session), read, stale: !!envl.stale, stale_for: Array.isArray(d.stale_for) ? d.stale_for : [],
    total, shown: v.signals.length, per_setup: obj(d.per_setup) || {}, universe: u.state, phases: v.phases.state,
    signals: v.signals.map(s => ({ date: s.date, setup: s.setup, phase: s.phase, returns: s.returns })),
  }
  if (!v.signals.length) return { text: lines.join('\n'), facts }
  const rows = v.signals.map(s => ({ date: shortDay(s.date), setup: s.name, phase: signalPhaseText(s.phase), returns: [5, 20, 60].map(h => sethChange(s.returns[h])).join(' / ') }))
  return {
    text: lines.join('\n'),
    table: { columns: [{ key: 'date', label: 'Date' }, { key: 'setup', label: 'Setup' }, { key: 'phase', label: 'Phase' }, { key: 'returns', label: '5 / 20 / 60 sessions' }], rows },
    present: { kind: 'metrics', title: `${sym} setup history`, short: 'Setup history', items: rows.slice(0, PRESENT_ROWS).map(r => ({ label: r.date, value: r.setup, note: r.returns, aka: [r.setup.toLowerCase()] })) },
    facts,
  }
}

export async function answerSetups(args = {}) {
  const sym = tickerOf(args.symbol)
  if (!sym) return ask('setup history', SETUPS_NONE)
  const turnId = currentTurnId()
  if (!turnId) return { text: `I couldn't read ${sym}'s setup history: ${NO_TURN}.` }
  const params = { symbol: sym, rows: clamp(args.rows, SETUPS_MAX_ROWS, SETUPS_DEFAULT_ROWS) }
  const envl = await readData('stock.setupHistory', params, { purpose: 'answer', turnId })   // a LITERAL: qa/modelIsolation reads it
  return answerFromSetups(envl, sym)
}

// ── stock.companyRecord ← company.publicRecords ──────────────────────────────────────────────────────────────────────
export const RECORDS_DEFAULT_ROWS = 5
export const RECORDS_MAX_ROWS = 25
export const RECORD_SECTIONS = Object.freeze(['contracts', 'trials', 'fda', 'lobbying'])
export const RECORD_TITLES = Object.freeze({ contracts: 'Federal contracts (USAspending.gov)', trials: 'Clinical trials it leads (ClinicalTrials.gov)',
  fda: 'FDA drug approvals (openFDA, Drugs@FDA)', lobbying: 'Lobbying (LDA.gov)' })
export const RECORDS_RECORD = 'Government records, not advice. A record counts only when its name matches one of the company\'s names: a subsidiary that reports under its own name is not matched.'
export const RECORD_NOT_HELD = 'not held on the server yet (this answer never asks the agency). That is not the same as no record.'
const RECORDS_NONE = 'No record is stated. That is not the same as no records.'

/** Pure: a `company.publicRecords` envelope → the answer. */
export function answerFromRecords(envl, symbol) {
  const sym = symbol || str(envl?.data?.symbol) || 'the company'
  const what = `${sym}'s public records`
  if (!usable(envl)) {
    return { text: noRead(what, envl, `none are held on the server yet (this answer never asks an agency), or the read failed. Open PUBR for ${sym} in UCT, then ask again`, RECORDS_NONE) }
  }
  const d = envl.data
  if (RECORD_SECTIONS.some(k => !obj(d[k]) || typeof d[k].state !== 'string')) return unclean(what, RECORDS_NONE)
  const company = obj(d.company) || {}
  const body = { status: 'ok', sym, company: { ...company, status: company.state === 'ok' ? 'ok' : 'computing' } }
  for (const k of RECORD_SECTIONS) body[k] = d[k].state === 'not_held' ? { status: 'computing' } : { ...d[k], status: 'ok' }
  const r = pubrRead(body)
  if (r.state !== 'ok') return unclean(what, RECORDS_NONE)
  const name = companyLabel(r, sym)
  const lines = [`${name}'s public records as UCT holds them (${sym}), section by section:`]
  const facts = { symbol: sym, as_of: null, states: {}, partial: envl.status === 'partial', stale: !!envl.stale }
  const rows = []
  for (const k of RECORD_SECTIONS) {
    const raw = d[k]
    const s = r.sections[k]
    facts.states[k] = raw.state
    if (raw.state === 'not_held') { lines.push(`${RECORD_TITLES[k]}: ${RECORD_NOT_HELD}`); continue }
    const at = stampET(raw.read_at, envl.fetched_at)
    if (s.state !== 'matched') {
      lines.push(`${RECORD_TITLES[k]}: ${noMatchWords(s, name)}${s.state === 'no_match' ? ' No record matched, which is not the same as no record existing.' : ''}`)
    } else {
      const lede = { contracts: contractsLede, trials: trialsLede, fda: fdaLede, lobbying: lobbyingLede }[k](s)
      lines.push(`${RECORD_TITLES[k]}: ${lede}`)
      const counted = s.counted.map(n => n.name)
      if (counted.length) lines.push(`  Matched names: ${counted.join('; ')}${int(raw.counted_total) > counted.length ? ` and ${raw.counted_total - counted.length} more` : ''}.${notCountedWords(s) ? ` ${notCountedWords(s)}` : ''}`)
      const items = k === 'contracts' ? s.awards.map(a => ({ date: a.date, detail: `${a.agency || 'agency not given'}, ${moneyWords(a.amount)}${a.recipient ? ` to ${a.recipient}` : ''}${a.description ? `: ${a.description}` : ''}` }))
        : k === 'trials' ? s.active.map(t => ({ date: t.primaryCompletion.date && ISO_DAY.test(t.primaryCompletion.date) ? t.primaryCompletion.date : null, detail: `${t.nctId}: ${t.title || 'untitled'} (${t.status ? t.status.toLowerCase().replace(/_/g, ' ') : 'status not given'})` }))
          : k === 'fda' ? s.actions.map(x => ({ date: x.date, detail: `${x.drug || x.application}${x.ingredients ? ` (${x.ingredients})` : ''}: ${x.action === 'new_use' ? 'new use' : x.action === 'tentative' ? 'tentative approval' : 'approval'}` }))
            : s.quarters.filter(q => q.filings).map(q => ({ date: null, detail: `${q.label}: ${moneyWords(q.own, 'no figure')} in its own reports, ${moneyWords(q.firms, 'no figure')} reported by outside firms` }))
      for (const it of items.slice(0, TEXT_ROWS)) lines.push(`  • ${it.date ? `${shortDay(it.date)}: ` : ''}${it.detail}`)
      const held = k === 'lobbying' ? items.length : int(raw[{ contracts: 'awards_held', trials: 'active_held', fda: 'actions_held' }[k]]) ?? items.length
      if (held > items.length && items.length) lines.push(`  ${held} matched and the first ${items.length} are in this answer: the list is cut from the ${k === 'trials' ? 'far' : 'old'} end.`)
      for (const it of items) rows.push({ section: RECORD_TITLES[k].replace(/ \(.*$/, ''), date: it.date ? shortDay(it.date) : '', detail: it.detail })
    }
    // each agency's own required words, from the read's data (licensing register rows T-100 to T-103)
    const credit = str(raw.credit)
    if (k === 'trials') lines.push(`  ${credit || ''}${str(raw.data_processed) ? ` Data processed by ClinicalTrials.gov ${raw.data_processed.replace('T', ' at ')}.` : ' The date ClinicalTrials.gov processed the data was not given.'}`.replace(/^ {2} /, '  '))
    else if (k === 'fda') lines.push(`  ${credit || ''}${str(raw.notice) ? ` openFDA's note: ${raw.notice}` : ''}`)
    else if (k === 'lobbying') lines.push(`  ${credit || ''}${at ? ` Accessed by UCT at ${at} (UCT's own time).` : ''}`)
    else if (credit) lines.push(`  ${credit}`)
    if (raw.check) lines.push(`  UCT's last look at this agency did not go well: this is the answer it read before${at ? ` (${at})` : ''}.`)
  }
  if (company.state !== 'ok') lines.push('The company\'s names are not held yet, so a section cannot say which names it searched with.')
  lines.push(RECORDS_RECORD)
  if (!rows.length) return { text: lines.join('\n'), facts }
  return {
    text: lines.join('\n'),
    table: { columns: [{ key: 'section', label: 'Section' }, { key: 'date', label: 'Date' }, { key: 'detail', label: 'Detail' }], rows },
    present: { kind: 'metrics', title: `${sym} public records`, short: 'Public records',
      items: RECORD_SECTIONS.map(k => ({ label: RECORD_TITLES[k].replace(/ \(.*$/, ''), value: d[k].state === 'matched' ? 'matched' : d[k].state === 'not_held' ? 'not held' : 'no record matched', note: '', aka: [k] })) },
    facts,
  }
}

export async function answerRecords(args = {}) {
  const sym = tickerOf(args.symbol)
  if (!sym) return ask('public records', RECORDS_NONE)
  const turnId = currentTurnId()
  if (!turnId) return { text: `I couldn't read ${sym}'s public records: ${NO_TURN}.` }
  const params = { symbol: sym, rows: clamp(args.rows, RECORDS_MAX_ROWS, RECORDS_DEFAULT_ROWS) }
  const envl = await readData('company.publicRecords', params, { purpose: 'answer', turnId })   // a LITERAL: qa/modelIsolation reads it
  return answerFromRecords(envl, sym)
}

// ── stock.ownershipReport ← ownership.funds ───────────────────────────────────────────────────────────────────────────
export const FUNDS_DEFAULT_ROWS = 10
export const FUNDS_MAX_ROWS = 50
export const FUNDS_RECORD = `Source: ${NPORT_SOURCE}. Filings, not advice: a report says what a fund held on its period's last day, not what it did or when.`
export const FUNDS_STATE_WORDS = Object.freeze({
  not_matched: (q, sym) => `No fund holding in the newest N-PORT data set${q ? ` (${q})` : ''} could be matched to ${sym}. That is not the same as no fund holding it.`,
  none_now: (_q, sym) => `No fund's current report holds ${sym}; the funds below held it at their previous report.`,
})
const FUNDS_NONE = 'No fund is stated. That is not the same as no fund holding it.'

/** Pure: an `ownership.funds` envelope → the answer. */
export function answerFromFunds(envl, symbol) {
  const sym = symbol || str(envl?.data?.symbol) || 'the stock'
  const what = `the funds holding ${sym}`
  if (!usable(envl)) {
    return { text: noRead(what, envl, 'the SEC\'s Form N-PORT data sets have not been read on the server yet (this answer never downloads them), or the read failed', FUNDS_NONE) }
  }
  const d = envl.data
  if (!['ok', 'none_now', 'not_matched'].includes(d.state) || !obj(d.data_set)) return unclean(what, FUNDS_NONE)
  const q = quarterWords(d.data_set.quarter)
  const lines = [`The registered funds (mutual funds and ETFs) holding ${sym}, from the SEC's Form N-PORT data sets as UCT holds them${q ? ` (the ${q} data set)` : ''}:`]
  const holders = nportRows(d)
  if (d.state !== 'ok') lines.push(FUNDS_STATE_WORDS[d.state](q, sym))
  lines.push(...nportSummaryLines(d))
  if (holders.length) {
    lines.push('Largest holders by value:')
    for (const h of holders.slice(0, TEXT_ROWS)) {
      lines.push(`• ${h.name || 'Name not reported'}: ${h.shares == null ? 'shares not reported' : `${formatCompactTerminal(h.shares)} shares`}${h.value == null ? '' : ` (${formatCompactTerminal(h.value, { money: true })})`}, ${nportChange(h)} since its previous report${h.period ? ` (period ending ${shortDay(h.period)})` : ''}`)
    }
    if (holders.length > TEXT_ROWS) lines.push(more(holders.length - TEXT_ROWS))
    const total = int(d.holders_total) ?? holders.length
    if (total > holders.length) lines.push(`${total} funds hold it and the top ${holders.length} by value are in this answer: the list is cut from the small end.`)
  }
  const sold = list(d.sold_out)
  if (sold.length) lines.push(`Sold out since their previous report: ${sold.slice(0, TEXT_ROWS).map(x => str(x.name) || 'name not reported').join('; ')}${(int(d.sold_out_total) ?? sold.length) > Math.min(sold.length, TEXT_ROWS) ? ` and ${(int(d.sold_out_total) ?? sold.length) - Math.min(sold.length, TEXT_ROWS)} more` : ''}.`)
  const match = nportMatchLine(d, sym)
  if (match) lines.push(match)
  lines.push(nportCoverageLine(d))
  lines.push(nportPeriodLine(d))
  const check = nportCheckLine(d)
  if (check) lines.push(check)
  lines.push(FUNDS_RECORD)
  const s = obj(d.summary) || {}
  const facts = {
    symbol: sym, state: d.state, as_of: isoDay(s.period_to) || isoDay(d.data_set.periods?.to), quarter: str(d.data_set.quarter), stale: !!envl.stale,
    funds: int(s.funds), added: int(s.added), cut: int(s.cut), new: int(s.new), sold_out: int(s.sold_out), not_comparable: int(s.not_comparable),
    shares_now: num(s.both_now), shares_before: num(s.both_prior), matched_value_pct: num(d.coverage?.matched_value_pct),
    holders: holders.map(h => ({ name: h.name, shares: h.shares, change_shares: h.changeShares, state: h.state })),
  }
  if (!holders.length) return { text: lines.join('\n'), facts }
  const rows = holders.map(h => ({ fund: h.name || 'Name not reported', shares: h.shares == null ? 'not reported' : formatCompactTerminal(h.shares), change: nportChange(h), period: h.period ? shortDay(h.period) : 'not reported' }))
  return {
    text: lines.join('\n'),
    table: { columns: [{ key: 'fund', label: 'Fund' }, { key: 'shares', label: 'Shares' }, { key: 'change', label: 'Change' }, { key: 'period', label: 'Period' }], rows },
    present: { kind: 'metrics', title: `${sym} fund holders`, short: 'Fund holders', items: rows.slice(0, PRESENT_ROWS).map(r => ({ label: r.fund, value: r.shares, note: r.change, aka: [r.fund.toLowerCase()] })) },
    facts,
  }
}

export async function answerFunds(args = {}) {
  const sym = tickerOf(args.symbol)
  if (!sym) return ask('fund holders', FUNDS_NONE)
  const turnId = currentTurnId()
  if (!turnId) return { text: `I couldn't read the funds holding ${sym}: ${NO_TURN}.` }
  const params = { symbol: sym, rows: clamp(args.rows, FUNDS_MAX_ROWS, FUNDS_DEFAULT_ROWS) }
  const envl = await readData('ownership.funds', params, { purpose: 'answer', turnId })   // a LITERAL: qa/modelIsolation reads it
  return answerFromFunds(envl, sym)
}

// ── routing words (armed only while registered; routing.js's `stockStudies` group lists none) ────────────────────────
// Routing v2 reaches the six by their summaries. v1 (the kill-switch fallback, and the router the capability-regression
// corpus runs) selects a group by its words, and `stockStudies` is words-only: these words are the only way v1 sends it.
// Routing only ADDS a group (the other groups a message names still ride along), and each pattern is kept off another
// capability's own language:
//   stats      a stock's stats or statistics, its beta or its correlation with SPY or the market, its realized or historical
//              volatility, how volatile it is, its up or down capture, its 1, 3 or 5 year or year-to-date return, how it
//              held up in corrections or bear markets. Never implied volatility or IV (wave 7), never its drawdowns or its
//              distance off a high alone (the data group's price history), never the member's own stats;
//   footprint  its volume footprint, its accumulation or distribution days, its up/down volume, its pocket pivots, its gap
//              fills or open gaps. Never the market's distribution days, never a screen for pocket pivots, never what
//              happens after a gap (the data group's event study);
//   factors    its factor exposure, loadings, tilts or model, its style tilt, its exposure to a named factor, whether it
//              trades like a growth or value stock. Never the chart's style, never "factor in";
//   setups     its setup history, the setups that fired on it, its past signals, how its setups did. Never the setups the
//              chart judge confirmed (wave 7), never a setup's rules or record in the playbook, never the chart in view;
//   records    its federal, government or defense contracts and contract awards, clinical or drug trials, FDA approvals,
//              lobbying, public records. Never options contracts, a free trial, FDA news or a PDUFA date;
//   funds      the funds, mutual funds or ETFs that hold or own it, its fund holders, N-PORT, the funds that added or cut it.
//              Never hedge funds (13F), never what a fund itself holds, never fund flows or the member's own funds;
//   not ours   a screen or its condition, an alert, a watchlist, the member's own lists, a page or a panel, or what a term
//              MEANS (the guide).
// ⛔ no lookbehind (iOS 16 floor, src/noRegexLookbehind.test.js).
const NOT_A_SCREEN = '^(?!.*\\b(?:scans?|screens?|screener|filters?|find|alerts?|notify|widgets?|page|tab|panel|watchlists?|my|portfolio|positions?)\\b)(?!.*(?:\\b(?:over|above|under|below|at least|more than|less than|greater than)\\b|[<>])\\s*\\$?\\d)'
const NOT_A_MEANING = '(?!.*\\b(?:explain|define|definition|meaning|means?|difference between|how (?:is|are|do|does) .* (?:calculated|worked out|computed|work|works))\\b)'
  + '(?!what(?:\'s|’s| is| are) (?:an? |the )?(?:beta|stock stats|statistics|volatility|realized volatility|up capture|down capture|volume footprint|accumulation days?|distribution days?|pocket pivots?|gap fills?|factor exposure|factor loadings?|style tilts?|setup history|public records?|lobbying|clinical trials?|n-?port|fund holders)\\W*$)'
const OURS = `${NOT_A_SCREEN}${NOT_A_MEANING}`
const NOT_MANY = '(?!.*\\b(?:stocks|names|tickers|equities|universe|sectors?|industr(?:y|ies)|themes?)\\b)'
const NOT_THE_MARKET = '(?!.*\\b(?:the market|nasdaq|s&p|spx|qqq|ndx|nyse|composite|indexes|indices|the index)\\b)'
const NOT_OTHER_STATS = '(?!.*\\b(?:breadth|flow|journal|trades?|trading|win rate|playbook|team|community|usage|agent)\\b)'
const NOT_IMPLIED = '(?!.*\\b(?:iv|implied)\\b)'
const NOT_FLOW = '(?!.*\\b(?:flow|options?|calls?|puts?|unusual)\\b)'
const NOT_NEWS = '(?!.*\\b(?:news|headlines?|calendar|pdufa|catalysts?|dates?)\\b)'
const NOT_13F = '(?!.*\\b(?:hedge funds?|13f|institutions?|institutional|flows?)\\b)'
export const WAVE10_ROUTE_WORDS = Object.freeze({
  stats: [
    new RegExp(`${OURS}${NOT_OTHER_STATS}.*\\b(?:stock|price) stat(?:s|istics)\\b`),
    new RegExp(`${OURS}${NOT_OTHER_STATS}${NOT_MANY}.*\\bstat(?:s|istics) (?:on|for|of)\\b`),
    new RegExp(`${OURS}${NOT_MANY}.*\\bbeta (?:to|vs\\.?|versus|against|with|of|on|for)\\b`),
    new RegExp(`${OURS}${NOT_MANY}.*\\b[a-z]{1,5}(?:'s|’s) beta\\b`),
    new RegExp(`${OURS}${NOT_MANY}.*\\bcorrelation (?:to|with|vs\\.?|versus|against) (?:the )?(?:spy|s&p(?: 500)?|market|sector)\\b`),
    new RegExp(`${OURS}${NOT_IMPLIED}${NOT_MANY}.*\\b(?:realized|historical|annuali[sz]ed) vol(?:atility)?\\b`),
    new RegExp(`${OURS}${NOT_IMPLIED}${NOT_MANY}.*\\bhow volatile (?:is|was|has)\\b`),
    new RegExp(`${OURS}${NOT_MANY}.*\\b(?:up|down)[- ]capture\\b`),
    new RegExp(`${OURS}${NOT_MANY}.*\\b(?:1|3|5|one|three|five)[- ]?(?:year|yr) returns?\\b`),
    new RegExp(`${OURS}${NOT_MANY}${NOT_THE_MARKET}.*\\b(?:hold|held|holds) up in (?:the )?(?:last |past )?(?:market )?(?:corrections?|bear markets?|sell-?offs?)\\b`),
    new RegExp(`${OURS}${NOT_MANY}${NOT_THE_MARKET}.*\\bhow (?:did|does|has) \\S+ (?:do|done|fare|fared|act|acted) in (?:the )?(?:market )?(?:corrections|bear markets)\\b`),
  ],
  footprint: [
    new RegExp(`${OURS}.*\\bvolume footprint\\b`),
    new RegExp(`${OURS}${NOT_MANY}${NOT_THE_MARKET}.*\\b(?:accumulation|distribution) days?\\b`),
    new RegExp(`${OURS}${NOT_MANY}${NOT_THE_MARKET}.*\\baccumulation(?: ?/ ?| | and | or | vs\\.? |-)distribution\\b`),
    new RegExp(`${OURS}${NOT_MANY}${NOT_THE_MARKET}.*\\bup[ /-]?(?:and[ /-]?)?down volume\\b`),
    new RegExp(`${OURS}${NOT_MANY}.*\\bpocket pivots?\\b`),
    new RegExp(`${OURS}${NOT_MANY}.*\\b(?:unfilled|open) gaps?\\b|^${NOT_A_SCREEN.slice(1)}${NOT_MANY}.*\\bgap(?:s)? (?:fill rate|fills|filled|history)\\b`),
  ],
  factors: [
    new RegExp(`${OURS}${NOT_MANY}.*\\bfactor (?:exposures?|loadings?|model|tilts?|betas?|profile|regression)\\b`),
    new RegExp(`${OURS}${NOT_MANY}.*\\bstyle (?:tilts?|exposures?|factors?)\\b`),
    new RegExp(`${OURS}${NOT_MANY}.*\\b(?:exposure|exposed|loading|tilt) (?:to|on) (?:the )?(?:momentum|quality|size|value|growth|low[- ]vol(?:atility)?|small[- ]caps?)(?: factor)?\\b`),
    new RegExp(`${OURS}${NOT_MANY}.*\\b(?:momentum|quality|low[- ]vol(?:atility)?) factor\\b`),
    new RegExp(`${OURS}${NOT_MANY}.*\\btrades? like an? (?:growth|value|momentum|quality|small[- ]cap|large[- ]cap|low[- ]volatility|defensive) stock\\b`),
    new RegExp(`${OURS}${NOT_MANY}.*\\b(?:growth or (?:a )?value|value or (?:a )?growth) stock\\b`),
  ],
  setups: [
    new RegExp(`${OURS}${NOT_MANY}.*\\bsetup history\\b`),
    new RegExp(`${OURS}${NOT_MANY}.*\\bhistory of (?:its |the |\\S+(?:'s|’s) )?setups\\b`),
    new RegExp(`${OURS}${NOT_MANY}.*\\bsetups (?:that )?(?:fired|triggered|flashed) (?:on|for|in)\\b`),
    new RegExp(`${OURS}${NOT_MANY}${NOT_FLOW}.*\\b(?:past|previous|historical) (?:setup )?signals (?:on|for|in)\\b`),
    new RegExp(`${OURS}${NOT_MANY}.*\\bhow (?:have|did|do|does) (?:its |the |\\S+(?:'s|’s) )?setups (?:do|done|work|worked|act|acted|played out|perform|performed|fare|fared)\\b`),
  ],
  records: [
    new RegExp(`${OURS}${NOT_MANY}.*\\b(?:federal|government|defen[cs]e|pentagon|military) contracts?\\b`),
    new RegExp(`${OURS}${NOT_MANY}.*\\bcontract awards?\\b|^${NOT_A_SCREEN.slice(1)}.*\\busaspending\\b`),
    new RegExp(`${OURS}${NOT_MANY}.*\\b(?:clinical|drug) trials?\\b`),
    new RegExp(`${OURS}${NOT_MANY}${NOT_NEWS}.*\\b(?:fda (?:approvals?|actions)|drug approvals?|approved by the fda)\\b`),
    new RegExp(`${OURS}${NOT_MANY}.*\\b(?:lobbying|lobbyists?)\\b`),
    new RegExp(`${OURS}${NOT_MANY}.*\\bpublic records?\\b`),
  ],
  funds: [
    new RegExp(`${OURS}${NOT_13F}.*\\b(?:mutual |index )?funds (?:that )?(?:hold|holding|own|owning)\\b`),
    new RegExp(`${OURS}${NOT_13F}.*\\b(?:etfs|mutual funds|index funds) (?:that )?(?:hold|holds|holding|own|owns|owning)\\b`),
    new RegExp(`${OURS}${NOT_13F}.*\\bfund (?:holders|ownership|owners)\\b`),
    new RegExp(`${OURS}.*\\bn-?port\\b`),
    new RegExp(`${OURS}${NOT_13F}.*\\bfunds (?:that )?(?:added|cut|trimmed|sold out of|exited)\\b`),
  ],
})
export const ROUTE_GROUP = 'stockStudies'
const ownGroup = () => GROUPS.find(g => g.id === ROUTE_GROUP)
/** Adds (or takes back) ONE capability's words on the wave's own group. */
function armRoutes(key, on) {
  const g = ownGroup()
  if (!g) return
  for (const re of WAVE10_ROUTE_WORDS[key]) {
    const at = g.words.indexOf(re)
    if (on && at < 0) g.words.push(re)
    if (!on && at >= 0) g.words.splice(at, 1)
  }
}

// ── registration: each capability only while the server serves ITS kind ───────────────────────────────────────────────
// ⚠️ THE WORDS OF A NAME, A SUMMARY AND ITS HINTS JOIN THE TYPO LEXICON (nl/lexicon.js: every lowercase word of three letters
// or more; a word in CAPITALS does not). A new known word changes what a nearby word in ANY member message may be
// "corrected" to, so the text below is worded to leave every existing capability-regression phrasing's corrections exactly
// as they were (pinned in agentTerminalDataWave10.test.js, "the typo lexicon"). The names were chosen for that:
// `stock.riskProfile`, `stock.setupHistory` and `stock.ownershipReport` add no word, `stock.companyRecord` none either
// (`stock.publicRecords` would add "records", one edit from "record", which a phrasing's "records" is corrected to today;
// `stock.fundsOwnership` would add "funds", which the production catalog does not know, and two corpus phrasings' "fund"
// would be corrected to it as well as to "find"),
// and `stock.volumeFootprint` and `stock.factorExposure` add "footprint", "factor" and "exposure", which that test shows
// change no correction.
const TARGET_HINT = 'target = the ref of the stockData entry.'
const SYMBOL_HINT = 'symbol = the one ticker named (or the open chart\'s symbol).'
const NO_FIGURES = 'reply: one short line, no figures.'
const HELD_ONLY = 'Answered only from what the SERVER already HOLDS, so it may say none is held.'
const symbolRows = { type: 'object', properties: { symbol: { type: 'string' }, rows: { type: ['integer', 'null'] } }, required: ['symbol', 'rows'], additionalProperties: false }
const symbolOnly = { type: 'object', properties: { symbol: { type: 'string' } }, required: ['symbol'], additionalProperties: false }
const unregister = {}

/** Idempotent; registers each of the six ONLY while the server serves its kind. Returns the names registered by this call. */
export function registerTerminalWave10Capabilities() {
  const added = []
  if (!unregister.stats && kindServed(KINDS.stats)) {
    unregister.stats = registerCapability({
      name: 'stock.riskProfile',         // a LITERAL: the server's local-only mirror rail reads it (tests/test_uct_agent_breadth.py)
      surfaces: ['*'], target: 'market', query: true,
      localOnly: true,                   // ⛔ figures from the vendor's daily history, which no register row clears for a model
      summary: 'One stock\'s STATISTICS as UCT HOLDS them from its STORED DAILY PRICES: VOLATILITY and RANGE (ATR, REALIZED VOLATILITY, ADR, 52-WEEK RANGE), BETA and CORRELATION AGAINST SPY and its SECTOR FUND, RETURNS 1 WEEK to 5 YEARS, its OWN DECLINES, and HOW it FELL AGAINST the S&P 500 in CORRECTIONS. '
        + 'For "NVDA STOCK STATS", "WHAT is AMD\'s BETA", "HOW VOLATILE is TSLA", "HOW did NVDA HOLD UP in CORRECTIONS".',
      hints: `${TARGET_HINT} ${SYMBOL_HINT} ROWS 1-${STATS_MAX_ROWS} DECLINES (null = ${STATS_DEFAULT_ROWS}). The date is the NEWEST SESSION's CLOSE: never today. A RECORD, not a FORECAST and not ADVICE. ${HELD_ONLY} `
        + `IMPLIED VOLATILITY and IV are not this answer. ${NO_FIGURES}`,
      args: symbolRows,
      answer: (_snap, args) => answerStats(args || {}),
    })
    armRoutes('stats', true)
    added.push(CAPABILITIES.stats)
  }
  if (!unregister.footprint && kindServed(KINDS.footprint)) {
    unregister.footprint = registerCapability({
      name: 'stock.volumeFootprint',     // a LITERAL: the server's local-only mirror rail reads it
      surfaces: ['*'], target: 'market', query: true,
      localOnly: true,                   // ⛔ counts from the vendor's daily history, which no register row clears for a model
      summary: 'One stock\'s VOLUME FOOTPRINT as UCT HOLDS it: ACCUMULATION and DISTRIBUTION DAYS over 25 and 50 SESSIONS with the NET, UP/DOWN VOLUME, its POCKET PIVOTS of the LAST YEAR (COUNT, the LAST ONE\'s DATE), and its GAPS of 3% or MORE (COUNTS, OPEN GAPS, SHARE FILLED within 5 and 20 SESSIONS). '
        + 'For "NVDA VOLUME FOOTPRINT", "ACCUMULATION DAYS in AMD", "POCKET PIVOTS on TSLA".',
      hints: `${TARGET_HINT} ${SYMBOL_HINT} ROWS 1-${FOOTPRINT_MAX_ROWS} PIVOTS and GAPS (null = ${FOOTPRINT_DEFAULT_ROWS}). The date is the NEWEST SESSION's CLOSE: never today. A RECORD, not a FORECAST and not ADVICE. ${HELD_ONLY} `
        + `The MARKET's DISTRIBUTION DAYS are not this answer. ${NO_FIGURES}`,
      args: symbolRows,
      answer: (_snap, args) => answerFootprint(args || {}),
    })
    armRoutes('footprint', true)
    added.push(CAPABILITIES.footprint)
  }
  if (!unregister.factors && kindServed(KINDS.factors)) {
    unregister.factors = registerCapability({
      name: 'stock.factorExposure',      // a LITERAL: the server's local-only mirror rail reads it
      surfaces: ['*'], target: 'market', query: true,
      localOnly: true,                   // ⛔ a regression on the vendor's daily history, which no register row clears for a model
      summary: 'One stock\'s FACTOR EXPOSURE as UCT HOLDS it: its LOADINGS on SIX FUND SPREADS (MARKET, SIZE, GROWTH VS VALUE, MOMENTUM, QUALITY, LOW VOLATILITY) with their T-STATISTICS, R-SQUARED, the LARGEST VIF and its WARNING, and the SERVER\'s PLAIN READING. '
        + 'For "NVDA FACTOR EXPOSURE", "is TSLA a GROWTH or VALUE STOCK", "FACTOR LOADINGS for AMD".',
      hints: `${TARGET_HINT} ${SYMBOL_HINT} The date is the NEWEST SESSION's CLOSE: never today. HOW the STOCK TRADED, not a FORECAST and not ADVICE. ${HELD_ONLY} `
        + `The CHART's STYLE is not this answer. ${NO_FIGURES}`,
      args: symbolOnly,
      answer: (_snap, args) => answerFactors(args || {}),
    })
    armRoutes('factors', true)
    added.push(CAPABILITIES.factors)
  }
  if (!unregister.setups && kindServed(KINDS.setups)) {
    unregister.setups = registerCapability({
      name: 'stock.setupHistory',        // a LITERAL: the server's local-only mirror rail reads it
      surfaces: ['*'], target: 'market', query: true,
      localOnly: true,                   // ⛔ signals from the vendor's daily history, which no register row clears for a model
      summary: 'The SETUPS that FIRED on one stock as UCT HOLDS them: EACH SETUP\'s NEWEST SIGNALS with their RETURNS 5, 20 and 60 SESSIONS ON and the MARKET PHASE, and BESIDE EACH SETUP and PHASE HOW it DID ACROSS UCT\'s STOCK UNIVERSE. '
        + 'For "NVDA SETUP HISTORY", "SETUPS that FIRED on AMD", "PAST SIGNALS on TSLA".',
      hints: `${TARGET_HINT} ${SYMBOL_HINT} ROWS 1-${SETUPS_MAX_ROWS} SIGNALS PER SETUP (null = ${SETUPS_DEFAULT_ROWS}). The date is the NEWEST SESSION's CLOSE: never today. A RECORD, not a FORECAST and not ADVICE. ${HELD_ONLY} `
        + `SETUPS the CHART JUDGE CONFIRMED are not this answer. ${NO_FIGURES}`,
      args: symbolRows,
      answer: (_snap, args) => answerSetups(args || {}),
    })
    armRoutes('setups', true)
    added.push(CAPABILITIES.setups)
  }
  if (!unregister.records && kindServed(KINDS.records)) {
    unregister.records = registerCapability({
      name: 'stock.companyRecord',       // a LITERAL: the server's local-only mirror rail reads it
      surfaces: ['*'], target: 'market', query: true,
      localOnly: true,                   // ⛔ government records whose register rows name no AI lane
      summary: 'One company\'s PUBLIC RECORDS as UCT HOLDS them, FOUR SECTIONS: FEDERAL CONTRACTS (OBLIGATIONS in the LAST 12 MONTHS and the 12 BEFORE), CLINICAL TRIALS it LEADS by PHASE and STATUS, FDA APPROVALS, and LOBBYING by QUARTER, with the NAMES MATCHED. '
        + 'For "NVDA GOVERNMENT CONTRACTS", "CLINICAL TRIALS for LLY", "LOBBYING by AMZN".',
      hints: `${TARGET_HINT} ${SYMBOL_HINT} ROWS 1-${RECORDS_MAX_ROWS} PER LIST (null = ${RECORDS_DEFAULT_ROWS}). EACH SECTION HAS its own READ TIME: never today. RECORDS, not ADVICE. ${HELD_ONLY} `
        + `OPTIONS CONTRACTS and FDA NEWS are not this answer. ${NO_FIGURES}`,
      args: symbolRows,
      answer: (_snap, args) => answerRecords(args || {}),
    })
    armRoutes('records', true)
    added.push(CAPABILITIES.records)
  }
  if (!unregister.funds && kindServed(KINDS.funds)) {
    unregister.funds = registerCapability({
      name: 'stock.ownershipReport',      // a LITERAL: the server's local-only mirror rail reads it
      surfaces: ['*'], target: 'market', query: true,
      localOnly: true,                   // ⛔ SEC N-PORT holdings, whose register row names no AI lane
      summary: 'The REGISTERED FUNDS (MUTUAL FUNDS and ETFS) HOLDING one stock, from the SEC\'s N-PORT DATA SETS as UCT HOLDS them: HOW MANY FUNDS HOLD it, HOW MANY ADDED, CUT, OPENED or SOLD OUT, the LARGEST HOLDERS and the DATA SET\'s QUARTER. '
        + 'For "WHICH FUNDS HOLD NVDA", "MUTUAL FUNDS HOLDING AMD", "NVDA FUND HOLDERS".',
      hints: `${TARGET_HINT} ${SYMBOL_HINT} ROWS 1-${FUNDS_MAX_ROWS} FUNDS (null = ${FUNDS_DEFAULT_ROWS}). The date is the NEWEST FUND REPORT PERIOD: never today. FILINGS, not ADVICE. ${HELD_ONLY} `
        + `HEDGE FUNDS (13F) and FUND FLOWS are not this answer. ${NO_FIGURES}`,
      args: symbolRows,
      answer: (_snap, args) => answerFunds(args || {}),
    })
    armRoutes('funds', true)
    added.push(CAPABILITIES.funds)
  }
  return added
}
export const _resetTerminalWave10ForTest = () => {
  for (const k of Object.keys(unregister)) { unregister[k]?.(); delete unregister[k] }
  for (const k of Object.keys(WAVE10_ROUTE_WORDS)) armRoutes(k, false)
}
