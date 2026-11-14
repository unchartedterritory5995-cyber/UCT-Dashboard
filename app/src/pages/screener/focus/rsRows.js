// The RS screens' rows (unit U5, 2026-11-14): what a starter's optional `row` puts on each
// result row, the header line above the list and the fact notes in the why strip. Pure
// functions. Every member-facing word below is the contract's (CONTRACT-SCREENS.md section 3),
// copied verbatim: the server sends codes and numbers, never prose.
//
// ⛔ FAIL CLOSED. A value the row does not carry (null, absent, not a finite number) prints
// nothing. No part is ever guessed from another, and a missing part leaves no separator behind.

import { shortDay } from './dates'

const isNum = v => typeof v === 'number' && Number.isFinite(v)
const fmtInt = n => Math.round(n).toLocaleString('en-US')

// The column a row's place and its "was #N a month ago" are both about: the overall order.
export const OVERALL_PLACE = 'rs_rating_pos'

// A starter's row description, or null when it has none (then the row is today's).
// `place` (unit U6): the column the chosen quick-control option numbers the rows by, when it
// names one (rsScreens.placeOverride); it stands in for the starter's own. Only a screen that
// already shows a place column takes it.
export function rowConfigOf(starter, place = null) {
  const r = starter?.row
  if (!r || typeof r !== 'object' || Array.isArray(r)) return null
  const own = typeof r.place === 'string' && r.place ? r.place : null
  return {
    place: own && own !== INDEX_PLACE && typeof place === 'string' && place ? place : own,
    caption: Array.isArray(r.caption) ? r.caption.filter(p => typeof p === 'string') : [],
    tags: Array.isArray(r.tags) ? r.tags.filter(t => typeof t === 'string') : [],
  }
}

// ── the Setup label (words in the caption, never a coloured pill) ──────────
const SETUP_WORDS = {
  below_50: 'Below its 50-day line',
  extended: 'Extended',
  at_pivot: 'At pivot',
  pullback_8: 'Pullback to the 8-day',
  pullback_21: 'Pullback to the 21-day',
  uptrend: 'Uptrend, no setup',
}
// "Tight range" replaces "Uptrend, no setup", and follows a comma on the others, except these two.
const NO_TIGHT = new Set(['extended', 'below_50'])
export function setupWords(row) {
  const code = row?.rs_setup
  const base = Object.prototype.hasOwnProperty.call(SETUP_WORDS, code) ? SETUP_WORDS[code] : ''
  if (!base || row.rs_tight !== 1) return base
  if (code === 'uptrend') return 'Tight range'
  return NO_TIGHT.has(code) ? base : `${base}, tight range`
}

const FLAG_WORDS = { buyout_pending: 'Buyout pending', one_day_move: 'One-day move', new_issue: 'New issue' }
export const flagWords = row => (Object.prototype.hasOwnProperty.call(FLAG_WORDS, row?.rs_flag) ? FLAG_WORDS[row.rs_flag] : '')

// `rs_nh_bars_ago`: sessions since the RS line's newest 52-week high (0 = the newest session).
export function rsHighAgeWords(row) {
  const n = row?.rs_nh_bars_ago
  if (!isNum(n) || n < 0) return ''
  return n === 0 ? 'RS high today' : n === 1 ? 'RS high yesterday' : `RS high ${fmtInt(n)} sessions ago`
}

// `px_below_high_pct` (<= 0): the close against its own 252-session closing high, whole percent.
export function belowHighWords(row) {
  const p = row?.px_below_high_pct
  if (!isNum(p)) return ''
  return p > -0.5 ? 'At its high' : `${Math.round(Math.abs(p))}% below its high`
}

// Where the rating is going: the place a month ago when it differs, else this week's change.
// `overall` false (unit U6): the numeral beside this caption is NOT the overall place (a period
// board numbers its rows by its own column), so "was #N a month ago", which is the overall
// place a month ago, would be read against the wrong number. The week's change is said instead.
export function movingWords(row, { overall = true } = {}) {
  const prev = row?.rs_rating_pos_prev20
  if (overall && isNum(prev) && prev !== row.rs_rating_pos) return `was #${fmtInt(prev)} a month ago`
  const chg = row?.rs_rating_chg_5
  if (isNum(chg) && chg !== 0) return `RS Rating ${chg > 0 ? 'up' : 'down'} ${fmtInt(Math.abs(chg))} this week`
  return ''
}

// The row's theme when it has one (the Watchlist's theme read, one batched request per list),
// else its industry.
export const groupWords = (row, theme) => (typeof theme === 'string' && theme) || row?.industry || ''

const PARTS = {
  setup: row => setupWords(row),
  group: (row, theme) => groupWords(row, theme),
  rs_high_age: row => rsHighAgeWords(row),
  below_high: row => belowHighWords(row),
  moving: (row, _theme, cfg) => movingWords(row, { overall: !cfg?.place || cfg.place === OVERALL_PLACE || cfg.place === INDEX_PLACE }),
}
// The caption under the ticker: the starter's parts in its order, joined with " · ". The Setup
// words come first on the screens that have them, so a narrow list truncates the group.
export function captionOf(row, cfg, theme = null) {
  return (cfg?.caption || []).map(p => (PARTS[p] ? PARTS[p](row, theme, cfg) : '')).filter(Boolean).join(' · ')
}

// ── tags: ONE per row, the first of the starter's list that applies ────────
export const NEW_TAG = 'New'
const TAGS = {
  // The RS line made its high while price was still at least 3% under its own.
  before_price: row => (isNum(row?.rs_nhbp_age) && isNum(row.px_below_high_pct) && row.px_below_high_pct <= -3 ? 'Before price' : ''),
  // The newest RS high came on a session the market fell.
  down_day: row => (isNum(row?.rs_nh_red_bars_ago) && row.rs_nh_red_bars_ago === row.rs_nh_bars_ago ? 'Market down day' : ''),
  flag: row => flagWords(row),
  new: (row, isNew) => (isNew ? NEW_TAG : ''),
}
export function tagOf(row, cfg, isNew = false) {
  for (const t of cfg?.tags || []) {
    const words = TAGS[t] ? TAGS[t](row, isNew) : ''
    if (words) return words
  }
  return ''
}

// The place numeral at the left: a column's value, or the row's 1-based position in the list.
export const INDEX_PLACE = 'index'
export function placeOf(row, cfg, index) {
  if (!cfg?.place) return null
  if (cfg.place === INDEX_PLACE) return index + 1
  return isNum(row?.[cfg.place]) ? row[cfg.place] : null
}

// ── the columns an RS row reads ────────────────────────────────────────────
// Asked of the server ONLY for a starter that carries `row`: the scan refuses a column it does
// not have with a 400, and these exist only where the RS screens do.
const PART_COLUMNS = {
  setup: ['rs_setup', 'rs_tight'],
  group: ['industry'],
  rs_high_age: ['rs_nh_bars_ago'],
  below_high: ['px_below_high_pct'],
  moving: ['rs_rating_pos_prev20', 'rs_rating_pos', 'rs_rating_chg_5'],
}
const TAG_COLUMNS = {
  before_price: ['rs_nhbp_age', 'px_below_high_pct'],
  down_day: ['rs_nh_red_bars_ago', 'rs_nh_bars_ago'],
  flag: ['rs_flag'],
  new: [],
}
// Read on every RS screen whatever its caption: the lead number, the header line's rating date
// and the why strip's four facts.
export const RS_ROW_BASE_COLUMNS = ['rs_rank', 'rs_rating_session', 'rs_setup', 'rs_tight', 'rs_nh_bars_ago', 'px_below_high_pct', 'rs_rating_pos', 'rs_rating_pos_n']
export function rowColumns(cfg) {
  if (!cfg) return []
  return [...new Set([
    ...RS_ROW_BASE_COLUMNS,
    ...(cfg.place && cfg.place !== INDEX_PLACE ? [cfg.place] : []),
    ...cfg.caption.flatMap(p => PART_COLUMNS[p] || []),
    ...cfg.tags.flatMap(t => TAG_COLUMNS[t] || []),
  ])]
}

// What one row shows, as primitives (the row component is memoised on them).
export function rowDisplay(row, cfg, { index = 0, theme = null, isNew = false } = {}) {
  return { place: placeOf(row, cfg, index), caption: captionOf(row, cfg, theme), tag: tagOf(row, cfg, isNew) }
}

// The lead number on every RS screen: `RS <rs_rank>`, gold from 90 up.
export const LEAD_GOLD_FROM = 90
export function leadOf(row) {
  const v = row?.rs_rank
  return isNum(v) ? { value: Math.round(v), top: v >= LEAD_GOLD_FROM } : null
}

// ── the header line ────────────────────────────────────────────────────────
// "Ratings as of Nov 13", from the first row's `rs_rating_session`.
export function ratingsAsOf(rows) {
  const day = shortDay(rows?.[0]?.rs_rating_session)
  return day ? `Ratings as of ${day}` : ''
}

// "29 of 50 are Healthcare" when one sector holds this share of the loaded rows or more.
export const SECTOR_SHARE_MIN = 0.4
// ⭐ An assumption, not the contract's: under this many loaded rows no share is said. "1 of 1
// are Energy" and "2 of 3 are Technology" pass the 40% rule and tell a member nothing.
export const SECTOR_SHARE_MIN_ROWS = 5
export function sectorShare(rows) {
  const total = rows?.length || 0
  if (total < SECTOR_SHARE_MIN_ROWS) return ''
  const counts = new Map()
  for (const r of rows) if (typeof r?.sector === 'string' && r.sector) counts.set(r.sector, (counts.get(r.sector) || 0) + 1)
  let top = null
  for (const [sector, n] of counts) if (!top || n > top.n) top = { sector, n }
  return top && top.n / total >= SECTOR_SHARE_MIN ? `${fmtInt(top.n)} of ${fmtInt(total)} are ${top.sector}` : ''
}

// ── the why strip's fact notes ─────────────────────────────────────────────
// Facts about the row the screen did NOT test, so each is a note (an open circle), never a
// tick. Most distinctive first; the strip's own cap decides how many are shown.
export function rowFacts(row) {
  const pos = row?.rs_rating_pos
  const n = row?.rs_rating_pos_n
  const place = isNum(pos) ? `RS Rating place ${fmtInt(pos)}${isNum(n) ? ` of ${fmtInt(n)}` : ''}` : ''
  return [setupWords(row), rsHighAgeWords(row), belowHighWords(row), place].filter(Boolean).map(label => ({ kind: 'note', label }))
}
