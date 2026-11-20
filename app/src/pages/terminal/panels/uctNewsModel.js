// UNEWS: UCT News, the live news wire, inside the Terminal. The pure half (no React).
//
// ⭐ NO NEW ROUTE, NO NEW FLAG, NO SECOND MODEL. Everything about a headline (the tokenizer that
// finds a ticker in its text, the filter rule, the category list, the receipt-time stamp, the day
// arithmetic) is the /charts widget's own model, pages/charts/widgets/tradeExchangeNewsModel.js,
// imported here and never copied. This file holds only what a Terminal panel says that the widget
// does not: its states in plain sentences, the "how far back" sentence of the one-stock view, and
// the rule that holds new headlines back while the member reads further down.
//
// WHAT THE SERVER ANSWERS (api/routers/trade_exchange_news.py, read before this was written)
//   GATE   every route below is `Depends(get_current_user)`: ANY signed-in session, 401 signed
//          out. The router is dark unless `TXN_ENABLED` is on: every path answers 404 when off.
//          A server that is on but has not started its news pipeline answers 503
//          `{"reason":"not_started"}`.
//   GET  /api/trade-exchange-news/recent   the newest page (the shared pool's first load)
//   GET  /api/trade-exchange-news/stream   server-sent events; at most 6 streams per member, so
//          a panel NEVER opens one: it declares a need (lib/panelContract.js) and shares the one
//          connection lib/tradeExchangeNewsStreamManager.js holds for the whole browser tab.
//   POST /api/trade-exchange-news/day      one America/New_York calendar day by UCT's RECEIPT
//          time, filtered by the server (`query`, `categories`, `symbol`, `hide_placeholders`),
//          newest first by (received_at_ms, seq), in keyset steps of at most 200 (60 asked).
//          With `history: true` it walks EVERY archived day, newest first, under a budget
//          (1.5 s or 6,000 rows a request) and answers `searched_to` (the oldest date it has
//          fully searched), `has_older` and an `older_cursor` to continue from. That is the
//          one-stock read: `history: true` + `symbol`. It already existed for the widget's
//          "Linked to chart" view, so this unit adds no server code.
//   GET  /api/trade-exchange-news/days     headline counts per date, `first_day` (where the
//          archive begins), `first_day_partial`, `today`.
//   Every payload carries `tickers_provisional: true`: the tickers of a headline are worked out
//   by UCT from its words, not sent by the provider. The panel says so in words.
//
// ⛔ NOTHING HERE INVENTS DATA. The provider sends a label and the text. The time on a row is the
// time UCT RECEIVED it; there is no publication time to show.

import { formatTimeEt } from '../../../lib/presentation/presentationPrimitives'
import {
  CATEGORY_FILTERS, cleanCategories, dayLabel, dayStatus, etDateKey, fmtStamp, highlightRuns, searchNeedles, tokenize,
} from '../../charts/widgets/tradeExchangeNewsModel'

/** The terminal code this panel is registered under (the panel reads the live one from its frame). */
export const UCT_NEWS_CODE = 'UNEWS'
/** The member-facing name, as the /charts widget carries it. */
export const UCT_NEWS_NAME = 'UCT News'
/** The header's source line: the widget's own name and its own credit, nothing added. */
export const UCT_NEWS_SOURCE = 'UCT News (powered by Trade Exchange)'
/** The longest text filter the server reads (routers/trade_exchange_news.py trims at 80). */
export const FILTER_MAX = 80
/** A typed filter is sent this long after the last keystroke, so a word is one request. */
export const FILTER_DEBOUNCE_MS = 250
/** The list counts as "at its top" within this many pixels; further down, new rows are held. */
export const SCROLL_HOLD_PX = 4

/** Which view a panel shows: one stock's headlines (`NVDA UCN`) or the whole wire (`UNEWS`). */
export function newsView(sym) {
  const s = String(sym || '').trim().toUpperCase()
  return s ? { mode: 'stock', sym: s } : { mode: 'market', sym: null }
}

/** The category chips, cleaned: known categories only, in the widget's order. Empty = every type. */
export const cleanTypes = (raw) => cleanCategories(raw)

/** One chip pressed or released. Choosing every type is the same as choosing none. */
export function toggleType(types, type) {
  const have = new Set(cleanCategories(types))
  if (have.has(type)) have.delete(type)
  else have.add(type)
  const next = CATEGORY_FILTERS.filter((c) => have.has(c))
  return next.length === CATEGORY_FILTERS.length ? [] : next
}

/** The text filter as it is sent: trimmed, at most FILTER_MAX characters. */
export const cleanFilter = (raw) => String(raw || '').trim().slice(0, FILTER_MAX)

/** Whether the pool can be read at all. `unavailable` is a refusal the pool will not retry. */
export const feedOff = (feed) => feed?.status === 'unavailable'

/**
 * What the panel says when the feed cannot be read at all: `{ kind, title, retry }`.
 * A switched-off wire (every route answers 404) is ONE plain sentence and no Retry: trying again
 * cannot switch it on.
 */
export function offState(reason) {
  if (reason === 'not_enabled') return { kind: 'locked', title: 'The news wire is not switched on for this server.', retry: false }
  if (reason === 'signed_out') return { kind: 'locked', title: `You are signed out, so ${UCT_NEWS_NAME} cannot be read. Sign in again.`, retry: false }
  if (reason === 'admin_only') return { kind: 'locked', title: `${UCT_NEWS_NAME} is not available on this account.`, retry: false }
  return { kind: 'error', title: `${UCT_NEWS_NAME} could not be read just now.`, retry: true }
}

/**
 * The connection in words: `{ tone, words }`. It reports UCT's own connection to its server; it
 * cannot tell whether the provider itself is publishing, so a quiet wire is never called "down".
 * `live` is false when the member is on a past day (or has more recent rows still to load), where
 * new headlines are not added whatever the connection does.
 */
export function connectionWords(feed, { live = true, mode = 'market', dayText = '' } = {}) {
  const status = feed?.status
  if (!live && mode === 'market') {
    return { tone: 'off', words: `Showing ${dayText || 'an earlier day'}. New headlines are not added to an earlier day.` }
  }
  if (status === 'live') return { tone: 'live', words: 'Live. New headlines appear at the top as they arrive.' }
  if (status === 'failed') return { tone: 'off', words: 'Not live: the news stream could not be opened in this browser.' }
  if (status === 'reconnecting' || status === 'dropped') {
    return { tone: 'warn', words: feed?.reason === 'not_started'
      ? 'Not live yet: the news service is starting on the server. This panel keeps trying.'
      : 'Reconnecting. Headlines missed meanwhile are added in order when the stream returns.' }
  }
  return { tone: 'warn', words: 'Connecting to the news stream.' }
}

/** A row's time: the full stamp where days mix (one stock), the time alone inside one named day. */
export function rowTime(ms, mode) {
  if (!ms) return 'time not recorded'
  if (mode === 'stock') return fmtStamp(ms) || 'time not recorded'
  return formatTimeEt(ms, { seconds: true, zoneSuffix: 'ET', absent: '' }) || 'time not recorded'
}

/**
 * A headline cut into what the row draws, in order: `{ key, text, sym, hit }`. A piece with `sym`
 * is a ticker (or a company name the server resolved) exactly as it is written in the headline;
 * `hit` marks the letters a text filter matched. The text is never rewritten.
 */
export function rowPieces(item, query = '') {
  const needles = searchNeedles(query)
  const out = []
  tokenize(item?.content, item?.tickers, item?.mentions).forEach((p, i) => {
    if (p.sym) { out.push({ key: `${i}`, text: p.text, sym: p.sym, hit: false }); return }
    highlightRuns(p.text, needles).forEach((r, j) => {
      if (r.text) out.push({ key: `${i}.${j}`, text: r.text, sym: null, hit: !!r.hit })
    })
  })
  return out
}

/**
 * New headlines held back while the member reads further down: `{ shown, held }`.
 * `heldSeq` is the newest headline on screen when the member left the top (null = nothing held).
 * A headline is "new" by its sequence number, which only ever grows, so loading EARLIER rows at
 * the bottom is never counted and never hidden.
 */
export function splitHeld(rows, heldSeq) {
  const list = Array.isArray(rows) ? rows : []
  if (heldSeq == null) return { shown: list, held: 0 }
  const shown = list.filter((r) => r.seq <= heldSeq)
  return { shown, held: list.length - shown.length }
}

/** The newest sequence number in a list (null when it is empty). */
export function topSeq(rows) {
  let top = null
  for (const r of rows || []) if (top == null || r.seq > top) top = r.seq
  return top
}

/** "1 new headline" / "3 new headlines". */
export const heldLabel = (n) => `${n} new ${n === 1 ? 'headline' : 'headlines'}`

/**
 * The one-stock view's honest "how far back" sentence. The server searches the archive a few days
 * at a time, so until it reaches the first archived day the panel says where the search stands.
 *   hasOlder     the server has earlier days (or earlier rows of a day) still to search
 *   searchedTo   the oldest date it has searched in full ('YYYY-MM-DD'), when it has finished one
 *   oldestMs     the receipt time of the oldest headline on screen
 *   meta         GET /days (`first_day`, `first_day_partial`), when it has answered
 */
export function reachSentence({ hasOlder = false, searchedTo = null, oldestMs = null, meta = null, todayKey = null } = {}) {
  if (!hasOlder) {
    const first = meta?.first_day
    if (!first) return `Searched every day ${UCT_NEWS_NAME} has kept, back to the start of its archive.`
    return `Searched every day ${UCT_NEWS_NAME} has kept, back to ${dayLabel(first, todayKey)}, when its archive began`
      + `${meta.first_day_partial ? ' partway through the day' : ''}.`
  }
  if (searchedTo) return `Searched back to ${dayLabel(searchedTo, todayKey)} so far. Earlier days have not been searched yet.`
  const oldestKey = oldestMs ? etDateKey(oldestMs) : null
  if (oldestKey) {
    return `Searched back to ${formatTimeEt(oldestMs, { zoneSuffix: 'ET', absent: '' })} on ${dayLabel(oldestKey, todayKey)} so far. `
      + 'Earlier headlines have not been searched yet.'
  }
  return 'The search has not finished its first step yet. Earlier days have not been searched.'
}

/** The sentence that says ticker matching is automatic, in the one-stock view and under the wire. */
export function matchingSentence(sym = null) {
  return sym
    ? `Headlines are matched to ${sym} automatically, from the words of each headline. The provider does not tag them, `
      + 'so a headline about it can be missed and one about something else can be matched by mistake.'
    : 'Tickers are picked out of each headline automatically, from its words. The provider does not tag them, so a ticker '
      + 'can be missed or matched by mistake.'
}

/** Whether a date can be stepped to: not before the archive begins, not after today. */
export function canStep(key, meta, todayKey) {
  if (!key) return false
  if (todayKey && key > todayKey) return false
  if (meta?.first_day && key < meta.first_day) return false
  return true
}

/** What the list says when a day or a stock has no headline to show: `{ title, hint }`. */
export function emptyWords({ mode, sym, filtered, isToday, dateKey, todayKey, meta, searching = false, reach = '' }) {
  if (mode === 'stock') {
    if (searching) return { title: `No headline naming ${sym} found yet.`, hint: reach }
    return filtered
      ? { title: `No archived headline naming ${sym} matches the filters above.`, hint: reach }
      : { title: `No archived headline names ${sym}.`, hint: `${reach} A new one appears here the moment it arrives.` }
  }
  const label = dayLabel(dateKey, todayKey)
  if (filtered) return { title: `No headline on ${label} matches the filters above.`, hint: 'That is the filter, not a quiet wire.' }
  if (isToday) return { title: 'No headlines yet today.', hint: 'New ones appear here the moment they arrive.' }
  const st = dayStatus(dateKey, meta)
  if (st.kind === 'unretained') return { title: `${label} is before the ${UCT_NEWS_NAME} archive begins.`, hint: 'Nothing was kept for that day.' }
  return { title: `No headlines were kept for ${label}.`, hint: 'The wire can be quiet on a weekend or a holiday.' }
}
