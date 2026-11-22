// GRP: one sector, industry or UCT theme and its stocks, ranked. The pure half (no React, so an
// agent capability can reuse it; it imports only the other pure panel models).
//
// ⭐ NO NEW ROUTE. Everything is joined in the browser from answers the server already holds:
//
//   the group and its stocks   `GET /api/scans/period-change-groups?start=&end=&group=sector|industry|theme`
//                              (api/services/scan_period.py get_period_change_groups). Paid
//                              (401 signed out, 402 no paid plan), no flag. A row is
//                              `{ name, period_change (PERCENT), count, members }`. The server builds
//                              it from the stock ranking below, which it never builds on a request:
//                              it answers `computing` and the panel asks again. The seven one-click
//                              ranges are kept built (scan_period.warm_presets), and this panel asks
//                              for no other range. Engine-suggested theme members are left out by
//                              the server (`source == "engine"`), and a theme with no ranked member
//                              is not sent at all.
//   each stock's own change    `GET /api/scans/period-change?start=&end=` (same gate): the whole
//                              market, `{ sym, period_change, start_close, end_close, industry,
//                              sector }` per stock. periodChangeModel.js reads both.
//   RS                         `GET /api/rs-rankings` (paid): `[{ ticker, rs_rank (1 to 99), ... }]`
//                              for the cap universe, from the server's cache only. A cold cache is
//                              503 `{ status: 'warming' }`. A stock outside that universe has no rank.
//   flow                       `GET /api/confluence?days=30` (any signed-in session): the confluence
//                              board, served from the web server's own cache and never built on a
//                              request (confluenceModel.js). ONE signal per stock: it is on the board,
//                              bullish or bearish. No per-stock flow read exists that is cheap for a
//                              list, so there is no other flow column.
//   a theme the ranking lacks  `GET /api/theme-performance` (paid), read ONLY when a name matched no
//                              ranked group: it tells "no such group" from "a UCT theme with no
//                              ranked stocks". Its curated members come from imovModel `ownerSyms`,
//                              which leaves engine-suggested members out, as every member view does.
//
// ⛔ ONE RESOLVER (`resolveGroup`), WITH ONE ORDER: a sector fund ticker (XLK) is its sector; then an
// exact name, a sector before an industry before a UCT theme (the order PCHG lists them); then a
// prefix, but only when ONE group of the kinds read starts with it. Anything else is "which one?"
// or "no group called X; did you mean", never a guess. A name that is exact in two kinds opens the
// first and SAYS the other exists.
// ⛔ A MISSING NUMBER IS NEVER 0. A member the stock ranking does not hold keeps its row with no
// change; a stock with no RS rank says n/a; a failed RS or flow read empties that column and says so.

import {
  DEFAULT_PERIOD_RANGE, PERIOD_RANGES, groupMemberRows, parsePeriodRange,
} from './periodChangeModel'
import { CONFLUENCE_STATUS_WORDS } from './confluenceModel'
import { normSym, ownerSyms } from './imovModel'
import { sortRows } from '../../../lib/presentation/dataGrid/gridSort'

/** The terminal code this panel is registered under (the panel reads the live one from its frame). */
export const GROUP_DRILL_CODE = 'GRP'
/** The RS ranking read (the same route RSL reads; RsLeadersPanel `RS_URL`). */
export const GROUP_RS_URL = '/api/rs-rankings'

/** The three kinds of group, in the resolver's order. `token` is the word a command carries. */
export const GROUP_KINDS = Object.freeze({
  sector: Object.freeze({ token: 'SECTOR', label: 'Sector', one: 'sector', a: 'a sector', many: 'sectors' }),
  industry: Object.freeze({ token: 'INDUSTRY', label: 'Industry', one: 'industry', a: 'an industry', many: 'industries' }),
  theme: Object.freeze({ token: 'THEME', label: 'UCT theme', one: 'UCT theme', a: 'a UCT theme', many: 'UCT themes' }),
})
export const GROUP_KIND_ORDER = Object.freeze(['sector', 'industry', 'theme'])

/** The words that pin a kind when they LEAD the name (`GRP THEME SEMICONDUCTORS`). */
export const GROUP_KIND_ARG_WORDS = Object.freeze({
  SECTOR: 'sector', SECTORS: 'sector',
  INDUSTRY: 'industry', INDUSTRIES: 'industry',
  THEME: 'theme', THEMES: 'theme',
})

/**
 * The 11 SPDR sector funds and every name the app gives each sector. `name` is the one SCTR shows
 * (sector_strength.SECTOR_ETFS); `names` adds the spellings the company details use
 * (rs_benchmarks.SECTOR_ETF, terminal_grammar._SECTOR_ALIASES), because the ranking's sectors come
 * from those details ("Consumer Cyclical", "Financial Services"). groupDrillModel.test.js reads the
 * three server tables and pins this one to them.
 */
export const SECTOR_FUNDS = Object.freeze([
  { fund: 'XLK', name: 'Technology', names: ['Technology', 'Information Technology'] },
  { fund: 'XLF', name: 'Financials', names: ['Financials', 'Financial', 'Financial Services'] },
  { fund: 'XLE', name: 'Energy', names: ['Energy'] },
  { fund: 'XLV', name: 'Healthcare', names: ['Healthcare', 'Health Care'] },
  { fund: 'XLI', name: 'Industrials', names: ['Industrials'] },
  { fund: 'XLY', name: 'Consumer Discretionary', names: ['Consumer Discretionary', 'Consumer Cyclical'] },
  { fund: 'XLP', name: 'Consumer Staples', names: ['Consumer Staples', 'Consumer Defensive'] },
  { fund: 'XLB', name: 'Materials', names: ['Materials', 'Basic Materials'] },
  { fund: 'XLRE', name: 'Real Estate', names: ['Real Estate'] },
  { fund: 'XLU', name: 'Utilities', names: ['Utilities'] },
  { fund: 'XLC', name: 'Communication Services', names: ['Communication Services'] },
].map((f) => Object.freeze({ ...f, names: Object.freeze(f.names) })))

/** How many names a "which one?" or a "did you mean" offers at most. */
export const GROUP_SUGGESTIONS = 6
/** Rows drawn at first, and added by each "Show more". */
export const GROUP_PAGE_ROWS = 50
/** The most rows the panel draws (a sector can hold a thousand stocks). */
export const GROUP_MAX_ROWS = 250

const own = (map, key) => (Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null)
const text = (v) => (v === null || v === undefined ? '' : String(v).trim())
const num = (v) => (v === null || v === undefined || v === '' || typeof v === 'boolean' || !Number.isFinite(Number(v)) ? null : Number(v))

/**
 * Pure: the comparable form of a group name. Case, spacing and punctuation do not count, and `&`
 * is "and": `AI / GPU Chips`, `ai gpu chips` and `AI_GPU_CHIPS` are one key, as are
 * `Aerospace & Defense` and `AEROSPACE AND DEFENSE`. The command line upper-cases what is typed
 * and drops commas, so a name only ever comes back in this form.
 */
export const groupKey = (s) => String(s ?? '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]/g, '')

const FUND_BY_TICKER = Object.freeze(Object.fromEntries(SECTOR_FUNDS.map((f) => [f.fund, f])))
/** Pure: the sector fund a ticker names (`xlk` -> the XLK entry), or null. */
export const sectorFundOf = (token) => own(FUND_BY_TICKER, text(token).replace(/^\$/, '').toUpperCase())
/** Pure: the sector fund whose sector goes by `name` in any of the app's spellings, or null. */
export function sectorFundForName(name) {
  const k = groupKey(name)
  return k ? SECTOR_FUNDS.find((f) => f.names.some((n) => groupKey(n) === k)) || null : null
}

/** The words of a name as a command carries them: upper case, commas and quotes gone. */
const nameWords = (name) => text(name).toUpperCase().replace(/[,"“”]/g, ' ').split(/\s+/).filter(Boolean)

/**
 * Pure: what was typed after the code, as a query.
 *   { kind, text, fund }
 *   kind   'sector' | 'industry' | 'theme' when a kind word leads the name (`THEME SEMICONDUCTORS`)
 *          or the one word is a sector fund; null when every kind is to be searched
 *   text   the name as typed, without the kind word ('' when nothing names a group)
 *   fund   the sector fund ticker when the one word typed is one (`XLK`, `$XLK`), else null
 * A kind word ALONE (`GRP SECTORS`) names no group: the kind is kept and the text is empty.
 */
export function parseGroupQuery(raw) {
  const words = nameWords(raw).map((w) => w.replace(/^\$/, '')).filter(Boolean)
  if (!words.length) return { kind: null, text: '', fund: null }
  const lead = own(GROUP_KIND_ARG_WORDS, words[0])
  if (lead && words.length === 1) return { kind: lead, text: '', fund: null }
  const rest = lead ? words.slice(1) : words
  const fund = (!lead || lead === 'sector') && rest.length === 1 ? sectorFundOf(rest[0]) : null
  return { kind: fund ? 'sector' : lead, text: rest.join(' '), fund: fund ? fund.fund : null }
}

/** Pure: the group lists a query needs: its own kind, or all three when no kind is pinned. */
export function groupKindsToRead(query) {
  if (!query || !text(query.text)) return []
  return own(GROUP_KINDS, query.kind) ? [query.kind] : [...GROUP_KIND_ORDER]
}

/** Pure: the range key a prop or a typed word names; anything unknown is the default range (PCHG's). */
export const normGroupRange = (raw) => parsePeriodRange(raw) || (typeof raw === 'string' && own(PERIOD_RANGES, raw) ? raw : DEFAULT_PERIOD_RANGE)

/**
 * Pure: the arguments a group and a range write into the panel's command. A fund ticker is the
 * whole group (`XLK`); any other group leads with its kind word when one is known, so a reload
 * reads only that kind's list and a name two kinds share stays the one that was picked. The
 * default range is left out.
 */
export function groupDrillCommandArgs({ kind = null, name = '', fund = null, range = null } = {}) {
  const key = range === null || range === undefined || range === '' ? null : normGroupRange(range)
  const rangeTok = key && key !== DEFAULT_PERIOD_RANGE ? PERIOD_RANGES[key].token : null
  const f = sectorFundOf(fund)
  if (f) return [f.fund, rangeTok].filter(Boolean)
  const words = nameWords(name)
  if (!words.length) return [rangeTok].filter(Boolean)
  return [own(GROUP_KINDS, kind)?.token || null, ...words, rangeTok].filter(Boolean)
}

/** Pure: the command that opens this panel on a group: `GRP XLK`, `GRP THEME AI / GPU CHIPS 3M`. */
export const groupDrillCommand = (group = {}) => [GROUP_DRILL_CODE, ...groupDrillCommandArgs(group)].join(' ')

/**
 * Pure: the group lists a query needs, read together.
 *   parts   [{ kind, loading, error, view }]: one per list. `error` is the read's error only when
 *           it has NO answer to show; `view` is periodChangeModel `periodGroupsRead(body, kind)`.
 *   state   'idle' (no list asked for) | 'loading' | 'error' (with `error`) | 'computing' |
 *           'unavailable' | 'refused' | 'failed' | 'ok'
 * A name can only be resolved against every list it may sit in, so one list still loading, still
 * being worked out or failed is the state of them all. On 'ok': `lists` ({ kind: rows }) and the
 * days the server used (the same in every list: they come from one stock ranking).
 */
export function combineGroupLists(parts) {
  const all = (Array.isArray(parts) ? parts : []).filter((p) => p && own(GROUP_KINDS, p.kind))
  const none = { state: 'idle', error: null, lists: {}, startDay: null, endDay: null, sameDay: false, asOf: null }
  if (!all.length) return none
  if (all.some((p) => p.loading)) return { ...none, state: 'loading' }
  const failed = all.find((p) => p.error)
  if (failed) return { ...none, state: 'error', error: failed.error }
  for (const state of ['computing', 'unavailable', 'refused', 'failed']) {
    if (all.some((p) => p.view?.state === state)) return { ...none, state }
  }
  if (!all.every((p) => p.view?.state === 'ok')) return { ...none, state: 'failed' }
  const first = all[0].view
  return {
    state: 'ok',
    error: null,
    lists: Object.fromEntries(all.map((p) => [p.kind, p.view.rows])),
    startDay: first.startDay,
    endDay: first.endDay,
    sameDay: all.some((p) => p.view.sameDay),
    asOf: first.asOf,
  }
}

function candidatesOf(lists, kinds) {
  const out = []
  for (const kind of kinds) {
    for (const row of Array.isArray(lists?.[kind]) ? lists[kind] : []) {
      const fund = kind === 'sector' ? sectorFundForName(row.name) : null
      const keys = [...new Set([groupKey(row.name), ...(fund ? fund.names.map(groupKey) : [])].filter(Boolean))]
      out.push({ kind, name: row.name, pct: row.pct, count: row.count, members: row.members, fund: fund ? fund.fund : null, keys })
    }
  }
  return out
}

const asGroup = (c) => ({ kind: c.kind, name: c.name, pct: c.pct, count: c.count, members: c.members, fund: c.fund })
const asOption = (c) => ({ kind: c.kind, name: c.name, fund: c.fund })
const byKindThenName = (a, b) => GROUP_KIND_ORDER.indexOf(a.kind) - GROUP_KIND_ORDER.indexOf(b.kind) || String(a.name).localeCompare(String(b.name))

function editDistance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j]
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = cur
    }
  }
  return row[b.length]
}

/**
 * Pure: which group a query means, against the lists read for it (`{ sector, industry, theme }`,
 * each periodGroupsRead rows; a kind not read is simply absent).
 *   { status: 'ok', group, also }             `group` is { kind, name, pct, count, members, fund };
 *                                             `also` the groups of OTHER kinds with the same name
 *   { status: 'ambiguous', query, options, total }   the name or prefix fits several groups; `total`
 *                                             counts them all, `options` names the first six
 *   { status: 'unknown', query, fund, suggestions }   nothing fits; the nearest names, never a guess
 *   { status: 'empty' }                       nothing names a group
 * ORDER: a sector fund ticker; an exact name (sector, then industry, then UCT theme); a prefix only
 * when ONE group starts with it. A word INSIDE a name is only ever a suggestion.
 */
export function resolveGroup(lists, query) {
  const q = groupKey(query?.text)
  if (!q) return { status: 'empty' }
  const kinds = (own(GROUP_KINDS, query.kind) ? [query.kind] : GROUP_KIND_ORDER).filter((k) => Array.isArray(lists?.[k]))
  const cands = candidatesOf(lists, kinds)
  const asked = text(query.text)
  const fund = sectorFundOf(query.fund)
  if (fund) {
    const hit = cands.filter((c) => c.kind === 'sector' && c.fund === fund.fund)
    if (hit.length === 1) return { status: 'ok', group: asGroup(hit[0]), also: [] }
    if (hit.length > 1) return { status: 'ambiguous', query: asked, total: hit.length, options: hit.map(asOption).slice(0, GROUP_SUGGESTIONS) }
    return {
      status: 'unknown', query: asked, fund: fund.fund,
      suggestions: cands.filter((c) => c.kind === 'sector').sort(byKindThenName).map(asOption).slice(0, GROUP_SUGGESTIONS),
    }
  }
  const exact = cands.filter((c) => c.keys.includes(q))
  if (exact.length) {
    const firstKind = kinds.find((k) => exact.some((c) => c.kind === k))
    const inKind = exact.filter((c) => c.kind === firstKind)
    if (inKind.length === 1) return { status: 'ok', group: asGroup(inKind[0]), also: exact.filter((c) => c.kind !== firstKind).map(asOption) }
    return { status: 'ambiguous', query: asked, total: exact.length, options: exact.sort(byKindThenName).map(asOption).slice(0, GROUP_SUGGESTIONS) }
  }
  const prefix = cands.filter((c) => c.keys.some((k) => k.startsWith(q)))
  if (prefix.length === 1) return { status: 'ok', group: asGroup(prefix[0]), also: [] }
  if (prefix.length > 1) return { status: 'ambiguous', query: asked, total: prefix.length, options: prefix.sort(byKindThenName).map(asOption).slice(0, GROUP_SUGGESTIONS) }
  const inside = cands.filter((c) => c.keys.some((k) => k.includes(q)))
  const near = inside.length ? inside.sort(byKindThenName)
    : cands.map((c) => ({ c, d: Math.min(...c.keys.map((k) => editDistance(q, k.slice(0, q.length + 2)))) }))
      .filter((x) => x.d <= Math.max(2, Math.floor(q.length / 3)))
      .sort((a, b) => a.d - b.d || byKindThenName(a.c, b.c))
      .map((x) => x.c)
  return { status: 'unknown', query: asked, fund: null, suggestions: near.map(asOption).slice(0, GROUP_SUGGESTIONS) }
}

/**
 * Pure: a name the ranked lists do not hold, looked up in the UCT theme list (the
 * `/api/theme-performance` payload). Exact names only (a theme's name or its id), never a prefix.
 *   { status: 'ok', group }     a UCT theme with curated members; `group.pct` and `group.count` are
 *                               null (the ranking has no figure for it) and `group.listed` is true
 *   { status: 'none', name }    a UCT theme with NO curated member (engine-suggested members are
 *                               never counted or shown)
 *   { status: 'unknown' }       no UCT theme by that name, or the payload is not a theme list
 */
export function taxonomyTheme(payload, query) {
  const q = groupKey(query?.text)
  const list = Array.isArray(payload?.themes) ? payload.themes : []
  if (!q || !list.length) return { status: 'unknown' }
  const hits = list.filter((t) => t && text(t.name) && [t.name, t.theme_id].map(groupKey).includes(q))
  if (hits.length !== 1) return { status: 'unknown' }
  const name = text(hits[0].name)
  const members = [...ownerSyms(hits[0])].sort()
  if (!members.length) return { status: 'none', name }
  return { status: 'ok', group: { kind: 'theme', name, pct: null, count: null, members, fund: null, listed: true } }
}

/**
 * Pure: the RS ranking as a by-symbol lookup.
 *   state   'ok' (`ranks` is a Map of SYMBOL -> rank, 1 to 99) | 'failed' (not a ranking at all)
 * A stock the ranking does not hold is simply absent: it has no rank, which is not a rank of 0.
 */
export function rsRanks(body) {
  if (!Array.isArray(body)) return { state: 'failed', ranks: new Map() }
  const ranks = new Map()
  for (const it of body) {
    const sym = normSym(it?.ticker)
    const rank = num(it?.rs_rank)
    if (sym && rank !== null && !ranks.has(sym)) ranks.set(sym, rank)
  }
  return ranks.size ? { state: 'ok', ranks } : { state: 'failed', ranks }
}

/**
 * Pure: the confluence board as a by-symbol lookup, from confluenceModel `confluenceRead(body)`.
 * A Map of SYMBOL -> { direction ('bullish' | 'bearish'), status ('building' | 'steady' |
 * 'established' | null) }. A stock not on the board is absent.
 */
export function flowBoard(view) {
  const out = new Map()
  for (const r of Array.isArray(view?.rows) ? view.rows : []) {
    const sym = normSym(r?.sym)
    if (sym && (r.direction === 'bullish' || r.direction === 'bearish') && !out.has(sym)) {
      out.set(sym, { direction: r.direction, status: own(CONFLUENCE_STATUS_WORDS, r.status) ? r.status : null })
    }
  }
  return out
}

/** Pure: a flow signal as a member reads it: "Bullish, building". Null when the stock is not on the board. */
export function flowWords(flow) {
  if (flow?.direction !== 'bullish' && flow?.direction !== 'bearish') return null
  const word = flow.direction === 'bullish' ? 'Bullish' : 'Bearish'
  return flow.status ? `${word}, ${CONFLUENCE_STATUS_WORDS[flow.status]}` : word
}

/**
 * Pure: one group's stocks as rows, biggest gain first (the default order).
 *   group       { members } (resolveGroup / taxonomyTheme)
 *   stockRows   periodChangeModel `periodRead(body).rows`: the whole market's changes
 *   ranks       rsRanks(...).ranks, or null while RS is not on hand
 *   board       flowBoard(...), or null while the confluence board is not on hand
 * A row is { key, sym, pct, startClose, endClose, industry, sector, rs, flow, order }. `pct` is null
 * for a member the stock ranking does not hold (it sorts last, never as 0); `rs` is null with no
 * rank; `flow` is null off the board. Returns { rows, total, known (rows with a change), ranked
 * (rows with an RS rank), onBoard (rows with a flow signal) }.
 */
export function groupDrillRows(group, stockRows, { ranks = null, board = null } = {}) {
  const base = groupMemberRows({ members: (Array.isArray(group?.members) ? group.members : []).map(normSym).filter(Boolean) }, stockRows, 'gainers')
  const seen = new Set()
  const rows = []
  for (const r of base.rows) {
    if (seen.has(r.sym)) continue
    seen.add(r.sym)
    rows.push({
      key: `grp-${r.sym}`,
      sym: r.sym,
      pct: r.pct,
      startClose: r.startClose,
      endClose: r.endClose,
      industry: r.industry,
      sector: r.sector,
      rs: ranks ? ranks.get(r.sym) ?? null : null,
      flow: board ? board.get(r.sym) || null : null,
      order: rows.length,
    })
  }
  return {
    rows,
    total: rows.length,
    known: rows.filter((r) => r.pct !== null).length,
    ranked: rows.filter((r) => r.rs !== null).length,
    onBoard: rows.filter((r) => r.flow !== null).length,
  }
}

/** The columns a member can sort by. `first` is the direction the first click gives. */
export const GROUP_SORTS = Object.freeze({
  pct: Object.freeze({ first: 'desc', desc: 'biggest gain first', asc: 'biggest fall first' }),
  rs: Object.freeze({ first: 'desc', desc: 'highest RS rank first', asc: 'lowest RS rank first' }),
})
export const DEFAULT_GROUP_SORT = Object.freeze({ key: 'pct', dir: 'desc' })

/** Pure: a sort this panel can run; anything else is the default (the range's change, best first). */
export function normGroupSort(sort) {
  const key = own(GROUP_SORTS, sort?.key) ? sort.key : DEFAULT_GROUP_SORT.key
  return { key, dir: sort?.dir === 'asc' || sort?.dir === 'desc' ? sort.dir : GROUP_SORTS[key].first }
}

/** Pure: the rows in a sort's order. A row with no value for the column sinks to the end either way. */
export function sortGroupRows(rows, sort) {
  const s = normGroupSort(sort)
  return sortRows(Array.isArray(rows) ? rows : [], s, {
    valueOf: (key, r) => r[key],
    isNumeric: () => true,
    tiebreak: (a, b) => a.order - b.order,
  })
}

/** Pure: a sort in words, for the table's label and the "showing N of M" line. */
export const groupSortWords = (sort) => { const s = normGroupSort(sort); return GROUP_SORTS[s.key][s.dir] }
