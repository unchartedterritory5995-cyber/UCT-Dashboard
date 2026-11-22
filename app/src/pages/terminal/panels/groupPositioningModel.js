// GRPS CROWDING (2026-11-22): short interest, insider buying and fund holdings by sector and industry. The pure
// half: the answer read into rows, each column's cell and words, the coverage and as-of lines, and one group's
// members. No React, so the Agent can reuse it. groupStatsModel.js registers the view and its columns from here.
//
// ONE paid route, the group figures' own (api/routers/group_stats.py), with `part=positioning`:
//   GET /api/research/group-stats?kind=sector|industry&part=positioning             every group (the table)
//   GET /api/research/group-stats?kind=sector|industry&name=NAME&part=positioning   one group's members, each with
//                                                                                   its own figures
// The server works it out once each evening inside the group figures' build, from three stores it already holds
// (api/services/group_positioning.py): the FINRA short interest list SHRTS ranks, the SEC Form 4 open-market
// purchases INS CLUSTER keeps (purchases only, the last 30 days of filings: the store keeps no sales), and the SEC
// Form N-PORT index OWN reads. 13F institutional holdings are left out: the server keeps no whole-market store of
// them (OWN reads one stock's from the vendor when it opens). Each part has its own as-of, said in words.
//   sources.positioning  {state 'ok' | 'pending' (built before positioning existed), short, insider, funds,
//                         institutions: each {state 'ok' | 'not_held' | 'not_built' | 'unavailable' | 'failed' |
//                         'pending', its as-of dates and coverage}}
//   a group's positioning {short {reported, pct_float, days_to_cover, change: each {n, median, q1, q3}, top [{sym,
//                         pct_float, days_to_cover}]}, insider {members, buyers {n, count, share}, purchases, value,
//                         unpriced, top [{sym, value, date, role}]}, funds {held, known, adding {n, count, share},
//                         net {n, median, q1, q3}}}; a part not on hand is null
//
// ⛔ A MISSING NUMBER IS NEVER 0: a median with fewer than five stocks gives the count; a purchase with no stated
//    price is counted, never priced at $0; a part not on hand says why. Every number goes through the shared
//    formatters (presentationPrimitives.js).
import { formatCompactTerminal, formatNumber, formatPercent } from '../../../lib/presentation/presentationPrimitives'
import { sortRows } from '../../../lib/presentation/dataGrid/gridSort'
import { dateText } from './fundMetricsModel'

export const POSITIONING_PART = 'positioning'
export const POSITIONING_WHAT = "The group's stocks"

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const int = (v) => (Number.isInteger(v) && v >= 0 ? v : null)
const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)
const day = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null)
const count = (n) => formatNumber(n, { decimals: 0 })
const stocks = (n) => `${count(n)} ${n === 1 ? 'stock' : 'stocks'}`
const sym = (v) => (typeof v === 'string' && /^[A-Z][A-Z0-9.-]{0,9}$/.test(v.trim().toUpperCase()) ? v.trim().toUpperCase() : null)

/** 'Nov 14, 2031' for an ISO day, or null. */
export const dayWords = (iso) => (day(iso) ? dateText(iso) : null)
/** A percent of float or a share: '12.4%'. */
export const pctText = (v) => formatPercent(v, { decimals: 1, absent: null })
/** A change: '+4.2%'. */
export const changeText = (v) => formatPercent(v, { decimals: 1, signed: true, absent: null })
/** Days to cover: '3.2'. */
export const daysText = (v) => formatNumber(v, { decimals: 1, absent: null })
/** Dollars: '$1.2M'. */
export const dollarsText = (v) => (num(v) === null ? null : formatCompactTerminal(v, { money: true }))

/** The role of the insider who filed a purchase, in words. */
export const ROLE_WORDS = Object.freeze({
  ceo: 'CEO', cfo: 'CFO', officer: 'officer', director: 'director', ten_percent: '10% owner', other: 'other insider',
  not_stated: 'role not stated',
})

// ── the answer ──────────────────────────────────────────────────────────────────────────────────

const summary = (s) => (isObj(s) ? { n: int(s.n) ?? 0, median: num(s.median), q1: num(s.q1), q3: num(s.q3) } : { n: 0, median: null, q1: null, q3: null })
const share = (s) => (isObj(s) ? { n: int(s.n) ?? 0, count: int(s.count) ?? 0, share: num(s.share) } : { n: 0, count: 0, share: null })

function readShort(p) {
  if (!isObj(p)) return null
  const top = (Array.isArray(p.top) ? p.top : []).filter(isObj).map((t) => ({ sym: sym(t.sym), pctFloat: num(t.pct_float), dtc: num(t.days_to_cover) }))
    .filter((t) => t.sym && t.pctFloat !== null)
  return { reported: int(p.reported) ?? 0, pctFloat: summary(p.pct_float), dtc: summary(p.days_to_cover), change: summary(p.change), top }
}

function readInsider(p) {
  if (!isObj(p)) return null
  const top = (Array.isArray(p.top) ? p.top : []).filter(isObj)
    .map((t) => ({ sym: sym(t.sym), value: num(t.value), date: day(t.date), role: Object.prototype.hasOwnProperty.call(ROLE_WORDS, t.role) ? t.role : 'not_stated' }))
    .filter((t) => t.sym && t.value !== null)
  return { members: int(p.members) ?? 0, buyers: share(p.buyers), purchases: int(p.purchases) ?? 0, value: num(p.value), unpriced: int(p.unpriced) ?? 0, top }
}

function readFunds(p) {
  if (!isObj(p)) return null
  return { held: int(p.held) ?? 0, known: int(p.known) ?? 0, adding: share(p.adding), net: summary(p.net) }
}

/** A group's `positioning` -> `{ short, insider, funds }` (each null when that part is not on hand), or null. */
export function readPositioning(p) {
  if (!isObj(p)) return null
  return { short: readShort(p.short), insider: readInsider(p.insider), funds: readFunds(p.funds) }
}

const PART_STATES = ['ok', 'not_held', 'not_built', 'unavailable', 'failed', 'pending']
const partState = (p) => (isObj(p) && PART_STATES.includes(p.state) ? p.state : 'failed')

/** `sources.positioning` -> `{ state, short, insider, funds, institutions }`, each part `{ state, ...as-of }`. */
export function readPositioningSources(src) {
  if (!isObj(src) || src.state !== 'ok') {
    const pending = { state: 'pending' }
    return { state: 'pending', short: pending, insider: pending, funds: pending, institutions: pending }
  }
  const s = isObj(src.short) ? src.short : {}
  const i = isObj(src.insider) ? src.insider : {}
  const f = isObj(src.funds) ? src.funds : {}
  return {
    state: 'ok',
    short: { state: partState(src.short), settlement: day(s.settlement_date), previous: day(s.previous_settlement_date),
      published: day(s.publication_estimate), covered: int(s.covered), universe: int(s.universe), reason: str(s.reason) },
    insider: { state: partState(src.insider), from: day(i.from), to: day(i.to), keepDays: int(i.keep_days), complete: i.complete === true,
      matched: int(i.matched), universe: int(i.universe) },
    funds: { state: partState(src.funds), quarter: str(f.quarter), priorQuarter: str(f.prior_quarter), periodFrom: day(f.period_from),
      periodTo: day(f.period_to), covered: int(f.covered), known: int(f.known), universe: int(f.universe) },
    institutions: { state: partState(src.institutions) },
  }
}

// ── the columns ─────────────────────────────────────────────────────────────────────────────────

const col = (key, part, id) => Object.freeze({ key, kind: 'pos', part, id })
/** The view's columns, in order: short interest, insider buying, funds. Every one sorts (a list by its first name). Eight,
 *  GRPS's most for a column set: the insider dollars and the largest buys share one two-line cell (builder rule 6). */
export const POSITIONING_COLUMNS = Object.freeze([
  col('p:short_pct', 'short', 'pct_float'), col('p:short_dtc', 'short', 'days_to_cover'), col('p:short_chg', 'short', 'change'),
  col('p:short_top', 'short', 'top'),
  col('p:ins_buyers', 'insider', 'buyers'), col('p:ins_value', 'insider', 'value'),
  col('p:funds_adding', 'funds', 'adding'), col('p:funds_net', 'funds', 'net'),
])

const HEADS = Object.freeze({
  'p:short_pct': { label: 'Short % float', title: "Short interest as a share of each stock's float: the group's median, and how many stocks it rests on" },
  'p:short_dtc': { label: 'Days to cover', title: "Days to cover (shares short over average daily volume): the group's median" },
  'p:short_chg': { label: 'Short change', title: "The change in shares short since the previous report: the group's median" },
  'p:short_top': { label: 'Most shorted', title: 'Its three stocks with the highest short interest as a share of float' },
  'p:ins_buyers': { label: 'Insider buyers', title: 'How many of its stocks had an open-market insider purchase filed in the window' },
  'p:ins_value': { label: 'Insider buying', title: 'The dollars of those purchases that state a price, how many, and its three largest' },
  'p:funds_adding': { label: 'Funds adding', title: 'The share of its stocks where more funds added or opened a position than cut or sold out (N-PORT)' },
  'p:funds_net': { label: 'Fund shares', title: "The change in shares held by the funds with both reports: the group's median (N-PORT)" },
})

/** A column's header and its title (hover). */
export const positioningHead = (c) => HEADS[c.key] || { label: c.key, title: c.key }

const PART_WHAT = { short: 'Short interest', insider: 'Insider buying', funds: 'Fund holdings' }

/** A median cell: the figure with how many stocks it rests on, or the count when there are too few. */
function medianCell(s, fmt, what, minMembers) {
  if (s.median === null) {
    return { value: null, text: `${count(s.n)} with data`, sub: null, few: true,
      words: `${count(s.n)} with data: fewer than ${minMembers} stocks have a figure, so there is no median.` }
  }
  return { value: s.median, text: fmt(s.median), sub: `of ${count(s.n)}`, words: `Median ${what} ${fmt(s.median)} across ${stocks(s.n)}.` }
}

/**
 * One positioning cell: `{ value (what it sorts by, null when blank), text, sub, words, few?, list? }`. A list cell
 * (`list`: [{ sym, text, words }]) names stocks; a part not on hand is blank with its words.
 */
export function positioningCell(row, c, { minMembers, sources = null } = {}) {
  const part = row?.positioning?.[c.part] ?? null
  if (!part) {
    const state = sources?.[c.part]?.state
    const why = state === 'pending' ? 'appears after the next evening build' : 'not on hand'
    return { value: null, text: null, sub: null, words: `${PART_WHAT[c.part]}: ${why}.` }
  }
  if (c.part === 'short') {
    if (c.id === 'top') {
      if (!part.top.length) return { value: null, text: null, sub: null, words: 'No stock with a short interest share of float.' }
      return { value: part.top[0].pctFloat, list: part.top.map((t) => ({ sym: t.sym, text: pctText(t.pctFloat),
        words: `${t.sym} ${pctText(t.pctFloat)} of float${t.dtc !== null ? `, ${daysText(t.dtc)} days to cover` : ''}` })),
      words: `Most shorted: ${part.top.map((t) => `${t.sym} ${pctText(t.pctFloat)}`).join(', ')}.` }
    }
    if (c.id === 'pct_float') return medianCell(part.pctFloat, pctText, 'short interest of', minMembers)
    if (c.id === 'days_to_cover') return medianCell(part.dtc, daysText, 'days to cover', minMembers)
    return medianCell(part.change, changeText, 'change in shares short', minMembers)
  }
  if (c.part === 'insider') {
    if (c.id === 'buyers') {
      const b = part.buyers
      const pct = b.share !== null ? `, ${pctText(b.share)}` : ''
      return { value: b.count, text: count(b.count), sub: `of ${count(b.n)}${pct}`,
        words: `${stocks(b.count)} of ${count(b.n)} had an open-market insider purchase${pct ? ` (${pctText(b.share)})` : ''}.` }
    }
    if (c.id === 'value') {
      const buys = `${count(part.purchases)} ${part.purchases === 1 ? 'buy' : 'buys'}`
      if (!part.purchases) return { value: 0, text: 'None', sub: null, words: 'No open-market insider purchase was filed for its stocks in the window.' }
      const unpriced = part.unpriced ? `; ${count(part.unpriced)} without a price` : ''
      if (part.value === null) {
        return { value: null, text: 'No price', sub: buys, few: true, words: `${buys}, none of them with a stated price, so no dollar total.` }
      }
      const largest = part.top.length ? ` Largest: ${part.top.map((t) => `${t.sym} ${dollarsText(t.value)}`).join(', ')}.` : ''
      return { value: part.value, text: dollarsText(part.value), sub: `${buys}${part.unpriced ? ', some unpriced' : ''}`,
        words: `${dollarsText(part.value)} bought across ${buys}${unpriced}.${largest}`,
        ...(part.top.length ? { list: part.top.map((t) => ({ sym: t.sym, text: dollarsText(t.value),
          words: `${t.sym} ${dollarsText(t.value)} by a ${ROLE_WORDS[t.role]}${t.date ? ` on ${dayWords(t.date)}` : ''}` })) } : {}) }
    }
  }
  if (c.id === 'adding') {
    const a = part.adding
    if (a.share === null) {
      return { value: null, text: `${count(a.n)} with data`, sub: null, few: true,
        words: `${count(a.n)} with a known fund change: fewer than ${minMembers}, so there is no share.` }
    }
    return { value: a.share, text: pctText(a.share), sub: `of ${count(a.n)}`, words: `More funds added than cut in ${count(a.count)} of ${stocks(a.n)} (${pctText(a.share)}).` }
  }
  return medianCell(part.net, changeText, 'change in fund shares', minMembers)
}

// ── coverage and as-of, in words ────────────────────────────────────────────────────────────────

const coverWords = (covered, universe, what) => (covered !== null && universe ? `${count(covered)} of ${stocks(universe)} ${what}.` : '')

/** The one line above the table: each part's date and reach, plain, in a few words (the notes below say the rest). */
export function positioningAsOfLine(src) {
  const s = src || readPositioningSources(null)
  if (s.state !== 'ok') return 'Positioning appears after the next evening build.'
  const reach = (n, u) => (n !== null && u ? ` (${count(n)} of ${stocks(u)})` : '')
  const sh = s.short.state === 'ok' && dayWords(s.short.settlement)
    ? `short interest, FINRA settlement ${dayWords(s.short.settlement)}${reach(s.short.covered, s.short.universe)}` : 'short interest not on hand'
  const ins = s.insider.state === 'ok' && dayWords(s.insider.from) && dayWords(s.insider.to)
    ? `insider purchases filed ${dayWords(s.insider.from)} to ${dayWords(s.insider.to)} (no sales kept)` : 'insider buying not on hand'
  const f = s.funds.state === 'ok' && s.funds.quarter ? `funds, N-PORT ${s.funds.quarter}${reach(s.funds.covered, s.funds.universe)}` : 'funds not on hand'
  return `As of: ${sh}; ${ins}; ${f}; 13F not shown.`
}

/** The lines that say where each part comes from, how far it reaches and how old it is: `[{ key, text }]`. */
export function positioningNotes(src) {
  const s = src || readPositioningSources(null)
  if (s.state !== 'ok') return [{ key: 'pending', text: 'Positioning appears after the next evening build: the figures held now were worked out before it was added.' }]
  const out = []
  const sh = s.short
  if (sh.state === 'ok') {
    const pub = dayWords(sh.published) ? ` (published about ${dayWords(sh.published)})` : ''
    const prev = dayWords(sh.previous) ? `, against the one for ${dayWords(sh.previous)}` : ', with no earlier report to compare'
    out.push({ key: 'short', text: `Short interest: FINRA's report for settlement ${dayWords(sh.settlement) || 'date not given'}${pub}${prev}; `
      + `${coverWords(sh.covered, sh.universe, 'in the report')} Reported twice a month; percent of float uses today's float.` })
  } else {
    out.push({ key: 'short', text: `Short interest: ${sh.state === 'unavailable' ? 'the data plan did not answer for the FINRA report' : sh.state === 'not_held' ? 'the server has not read the FINRA report yet' : 'the FINRA report could not be read at the last evening build'}, so it is not shown.` })
  }
  const ins = s.insider
  if (ins.state === 'ok') {
    const span = dayWords(ins.from) && dayWords(ins.to) ? `filed ${dayWords(ins.from)} to ${dayWords(ins.to)}` : 'filed in the window'
    const keep = ins.keepDays ? `, the ${count(ins.keepDays)} days of filings the server keeps` : ''
    out.push({ key: 'insider', text: `Insider buying: open-market purchases (SEC Form 4, code P) ${span}${keep}. The server keeps no insider sales, so there is `
      + `no sales total or net.${ins.complete ? '' : ' Some filings in that span were not read yet, so the counts may be short.'}` })
  } else {
    out.push({ key: 'insider', text: `Insider buying: ${ins.state === 'not_held' ? "the server's nightly read of SEC Form 4 filings has not run yet" : 'the filings could not be read at the last evening build'}, so it is not shown.` })
  }
  const f = s.funds
  if (f.state === 'ok') {
    const periods = dayWords(f.periodFrom) && dayWords(f.periodTo) ? `; reports for periods ending ${dayWords(f.periodFrom)} to ${dayWords(f.periodTo)}` : ''
    const prior = f.priorQuarter ? `, each fund's report against its previous one (the ${f.priorQuarter} data set or the same one)` : '; the data set before it could not be read, so no change is known'
    out.push({ key: 'funds', text: `Funds: SEC Form N-PORT data set ${f.quarter || ''}${prior}${periods}. Posted once a quarter, with funds filing within 60 days of their quarter's end, so a report can be months old. `
      + `${coverWords(f.covered, f.universe, 'matched to a fund holding')}` })
  } else {
    out.push({ key: 'funds', text: `Funds: ${f.state === 'not_built' ? 'the server has not built its N-PORT index yet' : 'the N-PORT index could not be read at the last evening build'}, so it is not shown.` })
  }
  out.push({ key: 'institutions', text: "Institutions (13F): not shown. 13F holdings are filed quarterly, up to 45 days after the quarter; the server reads a stock's only when OWN opens it and keeps no store of the whole market's to roll up." })
  return out
}

// ── one group's members ─────────────────────────────────────────────────────────────────────────

const FIELDS = ['short_interest', 'pct_float', 'days_to_cover', 'short_change_pct', 'buys', 'buy_value', 'buy_unpriced', 'last_buy',
  'funds', 'funds_added', 'funds_cut', 'fund_net_pct']

/**
 * One group's answer -> `{ state, ... }`. `state` 'ok' | 'not_found' | 'not_built' | 'computing' | 'bad_shape'.
 * On 'ok': `name`, `members`, `rows` [{ sym, ...each field (null when missing) }], `total`, `cut`, `limit`, `sources`.
 */
export function readMembers(body) {
  if (!isObj(body)) return { state: 'bad_shape' }
  if (body.status === 'not_built') return { state: 'not_built' }
  if (body.status === 'computing') return { state: 'computing' }
  if (body.status !== 'ok' || body.part !== POSITIONING_PART) return { state: 'bad_shape' }
  const sources = readPositioningSources(body.sources?.positioning)
  if (body.found === false) return { state: 'not_found', name: str(body.name), sources }
  if (body.found !== true || !Array.isArray(body.member_rows)) return { state: 'bad_shape' }
  const rows = []
  for (const r of body.member_rows) {
    if (!isObj(r) || !sym(r.sym)) continue
    const out = { sym: sym(r.sym) }
    for (const f of FIELDS) out[f] = f === 'last_buy' ? day(r[f]) : num(r[f])
    rows.push(out)
  }
  return { state: 'ok', name: str(body.name), members: int(body.members) ?? rows.length, rows, total: int(body.member_total) ?? rows.length,
    cut: body.member_cut === true, limit: int(body.member_limit), sources, positioning: readPositioning(body.positioning) }
}

/** The members table's columns. */
export const MEMBER_COLUMNS = Object.freeze([
  Object.freeze({ key: 'pct_float', label: 'Short % float', title: "Short interest as a share of the stock's float, and its days to cover", part: 'short' }),
  Object.freeze({ key: 'short_change_pct', label: 'Short change', title: 'The change in shares short since the previous report', part: 'short' }),
  Object.freeze({ key: 'buy_value', label: 'Insider buys', title: 'Open-market insider purchases filed in the window: dollars, how many, and the last', part: 'insider' }),
  Object.freeze({ key: 'funds_moves', label: 'Funds added / cut', title: 'Funds that added or opened a position, and funds that cut or sold out (N-PORT)', part: 'funds' }),
  Object.freeze({ key: 'fund_net_pct', label: 'Fund shares', title: 'The change in shares held by the funds with both reports (N-PORT)', part: 'funds' }),
])
export const DEFAULT_MEMBERS_SORT = Object.freeze({ key: 'pct_float', dir: 'desc' })

/** One member's cell: `{ value, text, sub, words, few? }`. A part not on hand, or a figure the store does not have, is words. */
export function memberCell(r, c, sources = null) {
  const state = sources?.[c.part]?.state
  if (state && state !== 'ok') return { value: null, text: null, sub: null, words: `${PART_WHAT[c.part]}: not on hand.` }
  if (c.key === 'pct_float') {
    if (r.short_interest === null) return { value: null, text: 'Not reported', sub: null, few: true, words: 'Not in the FINRA report.' }
    const dtc = r.days_to_cover !== null ? `${daysText(r.days_to_cover)} days` : null
    if (r.pct_float === null) return { value: null, text: 'No float', sub: dtc, few: true, words: `No percent of float (no float on hand, or the two figures do not match)${dtc ? `; ${dtc} to cover` : ''}.` }
    return { value: r.pct_float, text: pctText(r.pct_float), sub: dtc, words: `${pctText(r.pct_float)} of float${dtc ? `, ${dtc} to cover` : ''}.` }
  }
  if (c.key === 'short_change_pct') {
    if (r.short_interest === null) return { value: null, text: null, sub: null, words: 'Not in the FINRA report.' }
    if (r.short_change_pct === null) return { value: null, text: 'No change', sub: null, few: true, words: 'No change: no earlier report, or it was zero.' }
    return { value: r.short_change_pct, text: changeText(r.short_change_pct), sub: null, words: `${changeText(r.short_change_pct)} shares short since the previous report.` }
  }
  if (c.key === 'buy_value') {
    if (!r.buys) return { value: 0, text: 'None', sub: null, few: true, words: 'No open-market insider purchase filed in the window.' }
    const buys = `${count(r.buys)} ${r.buys === 1 ? 'buy' : 'buys'}`
    const last = dayWords(r.last_buy) ? `, last ${dayWords(r.last_buy)}` : ''
    if (r.buy_value === null) return { value: null, text: 'No price', sub: `${buys}${last}`, few: true, words: `${buys}${last}, with no stated price.` }
    return { value: r.buy_value, text: dollarsText(r.buy_value), sub: `${buys}${last}`,
      words: `${dollarsText(r.buy_value)} across ${buys}${last}${r.buy_unpriced ? `; ${count(r.buy_unpriced)} without a price` : ''}.` }
  }
  if (r.funds === null) return { value: null, text: c.key === 'funds_moves' ? 'No fund matched' : null, sub: null, few: true, words: 'No fund holding was matched to this stock.' }
  if (r.funds_added === null) return { value: null, text: c.key === 'funds_moves' ? 'No earlier report' : null, sub: null, few: true, words: 'No fund holding it has an earlier report, so no change is known.' }
  if (c.key === 'funds_moves') {
    return { value: r.funds_added - r.funds_cut, text: `${count(r.funds_added)} / ${count(r.funds_cut)}`, sub: `of ${count(r.funds)} holding`,
      words: `${count(r.funds_added)} funds added or opened, ${count(r.funds_cut)} cut or sold out; ${count(r.funds)} hold it now.` }
  }
  if (r.fund_net_pct === null) return { value: null, text: 'No base', sub: null, few: true, words: 'The funds with both reports held none before, so there is no percent.' }
  return { value: r.fund_net_pct, text: changeText(r.fund_net_pct), sub: null, words: `${changeText(r.fund_net_pct)} shares held by the funds with both reports.` }
}

/** The members in a sort's order: by symbol, or by a column's figure (a blank sinks to the end either way). */
export function sortMembers(rows, sort, sources = null) {
  const s = sort?.key ? sort : DEFAULT_MEMBERS_SORT
  const c = MEMBER_COLUMNS.find((x) => x.key === s.key)
  return sortRows(Array.isArray(rows) ? rows : [], { key: c ? s.key : 'sym', dir: s.dir === 'asc' ? 'asc' : 'desc' }, {
    valueOf: (key, r) => (key === 'sym' ? r.sym : memberCell(r, c, sources).value),
    isNumeric: (key) => key !== 'sym',
    tiebreak: (a, b) => a.sym.localeCompare(b.sym),
  })
}

/** The first click on a header: symbols A to Z, figures highest first. */
export const memberFirstDir = (key) => (key === 'sym' ? 'asc' : 'desc')

/** A members sort in words. */
export function membersSortWords(sort) {
  const s = sort?.key ? sort : DEFAULT_MEMBERS_SORT
  const c = MEMBER_COLUMNS.find((x) => x.key === s.key)
  if (!c) return s.dir === 'desc' ? 'by symbol, Z to A' : 'by symbol, A to Z'
  return `by ${c.label}, ${s.dir === 'asc' ? 'lowest' : 'highest'} first`
}
