// RSS: the five UCT RS screens (relative strength leader lists), the pure half (no React, so an
// agent capability can reuse it).
//
// ⭐ NO NEW ROUTE AND NO INVENTED SPEC. The panel uses the two doors the Screener page uses
// (api/routers/screener.py, both `Depends(require_paid)`):
//
//   GET  /api/screener/saved-screens   { saved, starters, rs_market?, rs_pending?, rs_alerts? }
//   POST /api/screener/scan            { total, rows, view, view_columns, snapshot_date, snapshot,
//                                        coverage? }; 400 with a sentence when a spec cannot run
//
// Each RS screen is one of `starters` (api/services/screener/rs_screens.py): its `spec` is what
// the Screener posts to the scan route, and its `row` says what each result row is about
// (`place`, `caption` parts, `tags`, `facts`). This module reads both and types neither.
//
// THE GATE IS THE SERVER'S. The five are in `starters` only for a member the screens are shown
// to (`saved_screens.rs_screens_served`, the RS_SCREENS_ENABLED switch). For everyone else the
// payload carries the older single-rule RS lists instead: no `row`, and three of them even share
// an id with one of the five. So a screen is recognised by what the server SENT (the Relative
// strength group, a `row` recipe, not `hidden`), never by its id, and when none is sent the
// screens are off for this member: said as that, never drawn as an empty list.
//   rs_pending  { text }  the lists have not been built yet (the first night under the switch)
//   rs_market   { state, text, asof } | null  the market caution line the screens print
//
// The row words (setup, RS line high, below its high, rating trend, warning, the one tag) are
// the Screener's own, from pages/screener/focus/rsRows.js: the server sends codes and numbers,
// and one module turns them into words for both surfaces.
//
// The two route constants live in RsScreensPanel.jsx, the module that draws the results: the
// coverage-receipt census finds a result surface by the scan routes its OWN module names
// (components/provenance/panelAdoption.ratchet.test.js, TERM-047).
import {
  INDEX_PLACE, OVERALL_PLACE, belowHighWords, exitWarningWords, movingWords, placeOf, rowColumns, rowConfigOf, rsHighAgeWords,
  setupWords, tagOf,
} from '../../screener/focus/rsRows'
import { isoDay } from '../../screener/focus/dates'

/** The terminal code this panel is registered under (the panel reads the live one from its frame). */
export const RS_SCREENS_CODE = 'RSS'
/** The picker group the server files the RS screens under (`rs_screens.GROUP`), lower-cased. */
export const RS_SCREENS_GROUP = 'relative strength'
/** The screen a bare `RSS` opens: the one the Screener's own default pins lead with. */
export const DEFAULT_RS_SCREEN = 'starter_rs_leaders'
/** Rows asked for: one page, the size the Screener's list asks for. */
export const RS_PAGE_SIZE = 100

/** The word a chip writes into the command for each screen (`RSS NHBP`). A screen the server
 *  adds later has no word: its chip still works, it is just not kept in the command. */
export const RS_SCREEN_TOKENS = Object.freeze({
  starter_rs_leaders: 'LEADERS',
  starter_rs_top_rating: 'TOP',
  starter_rs_new_high: 'NH',
  starter_rs_nh_before_price: 'NHBP',
  starter_rs_exit_warning_5: 'EXIT',
})
/** Every word a screen can be typed as -> its starter id. For an args.js kind. */
export const RS_SCREEN_WORDS = Object.freeze({
  LEADERS: 'starter_rs_leaders', LEADER: 'starter_rs_leaders', LDR: 'starter_rs_leaders',
  TOP: 'starter_rs_top_rating', RATING: 'starter_rs_top_rating',
  NH: 'starter_rs_new_high', HIGHS: 'starter_rs_new_high',
  NHBP: 'starter_rs_nh_before_price', BEFORE: 'starter_rs_nh_before_price',
  EXIT: 'starter_rs_exit_warning_5', WARN: 'starter_rs_exit_warning_5', WARNINGS: 'starter_rs_exit_warning_5',
})

/** The step of the fold ladder each screen's table names on its box (`data-fold`; the ladder is
 *  explained in marketPanels.module.css): the step just above the width that screen was measured to need with its cells
 *  wrapped and every column showing, beside the scrollbar (2026-11-18, sample rows: leaders 552px,
 *  new high before price 513, new highs 511, top rating 496, exit warnings 464). From its step down
 *  the screen folds its less-used columns, as on a phone. A screen the server adds later was never
 *  measured, so it names no step and folds only in a narrow panel. */
export const RS_SCREEN_FOLD = Object.freeze({
  starter_rs_leaders: 570,
  starter_rs_nh_before_price: 530,
  starter_rs_new_high: 530,
  starter_rs_top_rating: 510,
  starter_rs_exit_warning_5: 480,
})

/** Pure: a typed word as a screen id (`nhbp` -> 'starter_rs_nh_before_price'), or null. */
export function parseRsScreen(token) {
  const t = String(token ?? '').trim().toUpperCase()
  return Object.prototype.hasOwnProperty.call(RS_SCREEN_WORDS, t) ? RS_SCREEN_WORDS[t] : null
}

/** Pure: the arguments a screen writes into the panel's command (the default screen is the bare
 *  command; a screen with no word writes nothing). */
export function rsScreensCommandArgs({ screen = null } = {}) {
  const id = String(screen ?? '')
  if (id === DEFAULT_RS_SCREEN || !Object.prototype.hasOwnProperty.call(RS_SCREEN_TOKENS, id)) return []
  return [RS_SCREEN_TOKENS[id]]
}

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const text = (v) => (typeof v === 'string' ? v.trim() : '')
/** A sentence as sent, with its full stop. */
const sentence = (v) => { const s = text(v); return s && !/[.!?]$/.test(s) ? `${s}.` : s }

/**
 * Pure: the saved-screens payload as the RS screens it serves.
 *   ok       false when the body is not a saved-screens answer at all (a failed read)
 *   screens  [{ id, name, description, spec, cfg, emptyText, token }] in the server's order;
 *            EMPTY when the screens are not switched on for this member
 *   market   { state, text, asOf } when the server sends a caution line with words, else null
 *   pending  the server's own sentence while the lists have not been built yet, else null
 */
export function rsScreensOf(body) {
  const none = { ok: false, screens: [], market: null, pending: null }
  if (!isObj(body) || !Array.isArray(body.starters)) return none
  const screens = []
  const seen = new Set()
  for (const s of body.starters) {
    if (!isObj(s) || s.hidden || !isObj(s.spec)) continue
    const id = text(s.id)
    const cfg = rowConfigOf(s)
    if (!id || seen.has(id) || !cfg || text(s.group).toLowerCase() !== RS_SCREENS_GROUP) continue
    seen.add(id)
    screens.push({
      id,
      name: text(s.name) || id,
      description: sentence(s.description),
      spec: s.spec,
      cfg,
      emptyText: sentence(s.empty?.text) || null,
      token: Object.prototype.hasOwnProperty.call(RS_SCREEN_TOKENS, id) ? RS_SCREEN_TOKENS[id] : null,
    })
  }
  const m = body.rs_market
  const market = isObj(m) && text(m.text) ? { state: text(m.state) || null, text: sentence(m.text), asOf: isoDay(m.asof) } : null
  const pending = isObj(body.rs_pending) && text(body.rs_pending.text) ? sentence(body.rs_pending.text) : null
  return { ok: true, screens, market, pending }
}

/** Pure: the screen to show: the one asked for when the server serves it, else the default, else
 *  the first one served, else null. */
export function pickRsScreen(screens, wanted = null) {
  const list = Array.isArray(screens) ? screens : []
  return list.find((s) => s.id === wanted) || list.find((s) => s.id === DEFAULT_RS_SCREEN) || list[0] || null
}

/** Read on every screen whatever its recipe: what the fixed columns show. */
const BASE_COLUMNS = ['ticker', 'company', 'price', 'chg_pct_1d', 'industry', 'sector']

/** Pure: the body POSTed to the scan route for one screen: the starter's OWN spec, with the
 *  columns its rows read and one page. Nothing is added to, or taken from, its rules or order. */
export function rsScanBody(screen) {
  const spec = isObj(screen?.spec) ? screen.spec : {}
  return {
    filters: Array.isArray(spec.filters) ? spec.filters : [],
    ...(isObj(spec.sort) ? { sort: spec.sort } : {}),
    ...(typeof spec.view === 'string' && spec.view ? { view: spec.view } : {}),
    ...(isObj(spec.rank) ? { rank: spec.rank } : {}),
    ...(isObj(spec.logic) ? { logic: spec.logic } : {}),
    columns: [...new Set([...BASE_COLUMNS, ...rowColumns(screen?.cfg || null)])],
    page: 1,
    page_size: RS_PAGE_SIZE,
  }
}

/** What each caption part is called as a column, and how its words are read from a row. */
const PART_COLUMNS = Object.freeze({
  setup: { label: 'Setup', title: 'Where the stock sits against its moving averages and its pivot', words: (row) => setupWords(row) },
  moving: {
    label: 'Rating trend',
    title: 'Where the RS Rating is going',
    words: (row, cfg) => movingWords(row, { overall: !cfg?.place || cfg.place === OVERALL_PLACE || cfg.place === INDEX_PLACE }),
  },
  rs_high_age: { label: 'RS line high', title: 'When the RS line (price against SPY) last made a 52-week high', words: (row) => rsHighAgeWords(row) },
  below_high: { label: 'Price vs its high', title: 'The close against its own 52-week closing high', words: (row) => belowHighWords(row) },
  exit_warning: { label: 'Warning', title: 'The newest RS exit warning and how old it is', words: (row) => exitWarningWords(row) },
})

/**
 * Pure: the columns one screen shows, from its own row recipe: the ticker and RS Rating always,
 * then the two or three things that screen is about, then the price, the industry and the note.
 * Each is `{ key, label, title?, phoneHide?, wrap? }`.
 */
export function rsScreenColumns(screen) {
  const cfg = screen?.cfg || null
  const cols = [
    { key: 'sym', label: 'Symbol', title: 'Click a symbol to load it into the linked panels' },
    { key: 'rs', label: 'RS Rating', title: 'UCT RS Rating, 1 to 99 (99 is strongest)' },
  ]
  if (cfg?.place && cfg.place !== INDEX_PLACE) cols.push({ key: 'place', label: 'Place', title: 'The exact place among every rated stock (1 is strongest)' })
  for (const p of cfg?.caption || []) {
    if (PART_COLUMNS[p]) cols.push({ key: p, label: PART_COLUMNS[p].label, title: PART_COLUMNS[p].title, wrap: true })
  }
  if ((cfg?.facts || []).includes('days')) cols.push({ key: 'days', label: 'Days on list', title: 'Sessions in a row the stock has been on this list, counting the latest' })
  cols.push({ key: 'price', label: 'Price', phoneHide: true })
  cols.push({ key: 'chgPct', label: 'Day change', phoneHide: true, title: 'The change of the session the price is from' })
  if ((cfg?.caption || []).includes('group')) cols.push({ key: 'group', label: 'Industry', phoneHide: true, wrap: true })
  if ((cfg?.tags || []).some((t) => t !== 'new')) cols.push({ key: 'tag', label: 'Note', phoneHide: true, wrap: true, title: 'The one thing most worth knowing about the row' })
  return cols
}

/**
 * Pure: the scan answer as panel rows, for one screen.
 *   ok       false when the body is not a scan answer (a failed read, never an empty list)
 *   rows     [{ sym, company, rs, price, chgPct, place, days, group, tag, parts, order }] in the
 *            server's order (the screen's own); `parts` holds the words of each caption part,
 *            '' where the row says nothing
 *   total    how many stocks the screen matched (the rows are one page)
 *   session  the market session the RS numbers describe (a calendar date), or null
 *   snapshotDate, coverage   as sent
 * `now` (epoch ms) is the instant the earnings note counts from.
 */
export function rsScanView(body, screen, { now = Date.now() } = {}) {
  const none = { ok: false, rows: [], total: 0, session: null, snapshotDate: null, coverage: null }
  if (!isObj(body) || !Array.isArray(body.rows)) return none
  const cfg = screen?.cfg || null
  const rows = []
  const seen = new Set()
  for (const r of body.rows) {
    const sym = text(r?.ticker).toUpperCase()
    if (!sym || seen.has(sym)) continue
    seen.add(sym)
    const parts = {}
    for (const p of cfg?.caption || []) if (PART_COLUMNS[p]) parts[p] = PART_COLUMNS[p].words(r, cfg) || ''
    const days = num(r.rs_leaders_days)
    rows.push({
      sym,
      company: text(r.company) || null,
      rs: num(r.rs_rank),
      price: num(r.price),
      chgPct: num(r.chg_pct_1d),
      place: cfg?.place && cfg.place !== INDEX_PLACE ? placeOf(r, cfg, rows.length) : null,
      days: days !== null && Number.isInteger(days) && days >= 1 ? days : null,
      group: text(r.industry) || null,
      // "New" needs the list's membership record, which this panel does not read: never guessed.
      tag: tagOf(r, cfg, false, now) || '',
      parts,
      order: rows.length,
    })
  }
  const total = num(body.total)
  return {
    ok: true,
    rows,
    total: total !== null && total > rows.length ? total : rows.length,
    session: isoDay(body.rows.find((r) => isoDay(r?.rs_rating_session))?.rs_rating_session),
    snapshotDate: isoDay(body.snapshot_date) || isoDay(body.snapshot?.snapshot_date),
    coverage: isObj(body.coverage) ? body.coverage : null,
  }
}
