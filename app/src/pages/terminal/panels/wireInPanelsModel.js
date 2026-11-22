// The news wire (UCT News) inside MOVE, CN and NEWS. The pure half (no React, no transport).
//
// ⭐ NO NEW ROUTE, NO NEW FLAG, NO SECOND MODEL. The three panels reuse what the UCT News panel
// (UctNewsPanel.jsx / uctNewsModel.js) and the /charts widget already have:
//   MOVE, CN   ONE request of the one-stock read `NVDA UCN` makes: POST
//              /api/trade-exchange-news/day with `history: true` and `symbol`. It walks every
//              archived day newest first under the server's own budget and answers `items`,
//              `has_older` and `searched_to`. Asked for a few rows, it stops at the first few.
//              It is a read at one moment, never a stream: MOVE and CN open nothing live.
//   NEWS       the shared pool (lib/tradeExchangeNewsStreamManager.js) through a declared need:
//              the one history load and the one stream the whole browser tab already shares.
// Every word a member reads about a state the UCT News panel already has (the wire switched off,
// signed out, how far back a search reached, that tickers are matched automatically) is that
// panel's own sentence, imported from uctNewsModel.js, never written a second time.
//
// ⛔ A WIRE THAT COULD NOT BE READ IS NEVER "NO HEADLINES". `failed` and `none` are two states
// with two sentences, and a refusal (404 switched off, 401, 403) is a third.
//
// ⛔ NOTHING HERE INVENTS DATA. The time on a row is when UCT RECEIVED the headline (the provider
// sends no publication time), and a row's stock is matched from the headline's words by UCT.
import { formatTimeEt } from '../../../lib/presentation/presentationPrimitives'
import { dayCmp, dayRequest, etDateKey, fmtStamp, visibleItems } from '../../charts/widgets/tradeExchangeNewsModel'
import { UCT_NEWS_NAME, connectionWords, feedOff, offState, reachSentence } from './uctNewsModel'

/** How many headlines each surface shows. A few: the full list is one row command away. */
export const WIRE_ROWS = Object.freeze({ MOVE: 4, CN: 3, NEWS: 3 })
/** The source label every wire row carries, beside another source's rows or not. */
export const WIRE_ROW_SOURCE = UCT_NEWS_NAME
/** The credit, as the UCT News panel's own footer words it. */
export const WIRE_CREDIT = `${UCT_NEWS_NAME}, powered by Trade Exchange`
/** What the time on a row is (the provider sends no publication time). */
export const WIRE_TIME_NOTE = 'Times are when UCT received each headline, in New York time.'
/** The command that opens the whole wire. */
export const WIRE_MARKET_COMMAND = 'UNEWS'

const upper = (sym) => String(sym || '').trim().toUpperCase()

/** The command that opens one stock's full wire history (`NVDA UCN`); '' with no stock. */
export function wireStockCommand(sym) {
  const s = upper(sym)
  return s ? `${s} UCN` : ''
}

/** The one-stock read, exactly the request `NVDA UCN` sends, asked for `limit` rows. */
export function stockWireRequest(sym, limit) {
  return { ...dayRequest({ linkedSym: upper(sym), hidePlaceholders: true }), history: true, limit }
}

/** A row's stamp. Today's rows say "Today" and the time; any other day carries its full date. */
export function wireStamp(ms, todayKey) {
  if (!ms) return 'time not recorded'
  const key = etDateKey(ms)
  if (key && todayKey && key === todayKey) {
    const time = formatTimeEt(ms, { seconds: true, zoneSuffix: 'ET', absent: '' })
    return time ? `Today ${time}` : 'time not recorded'
  }
  return fmtStamp(ms) || 'time not recorded'
}

/** One headline as a surface draws it: `{ seq, item, today, stamp, type }`. */
export function wireRow(item, todayKey) {
  const ms = item?.received_at_ms || 0
  return {
    seq: item?.seq,
    item,
    today: !!ms && !!todayKey && etDateKey(ms) === todayKey,
    stamp: wireStamp(ms, todayKey),
    type: item?.category || 'Other',
  }
}

/**
 * The answer of the one-stock read as a section state: `rows` (newest first, so today's come
 * first) or `none` (with the sentence that says how far back the search reached).
 */
export function stockWireResult(sym, body, limit, nowMs = Date.now()) {
  const s = upper(sym)
  const todayKey = etDateKey(nowMs)
  const items = (Array.isArray(body?.items) ? body.items : []).filter((it) => it && it.content != null)
  const rows = items.slice().sort(dayCmp).slice(0, Math.max(1, limit || 1)).map((it) => wireRow(it, todayKey))
  const hasOlder = !!body?.has_older
  const reach = reachSentence({
    hasOlder, searchedTo: body?.searched_to || null, oldestMs: rows.length ? rows[rows.length - 1].item.received_at_ms : null,
    meta: null, todayKey,
  })
  return {
    sym: s, phase: rows.length ? 'rows' : 'none', rows, today: rows.filter((r) => r.today).length,
    hasOlder, reach, readAt: nowMs,
  }
}

/**
 * A one-stock read that did not answer, as a section state. A refusal (`off`) is one plain
 * sentence and no Retry: trying again cannot switch the wire on. Anything else is `failed`:
 * it says the wire could not be checked, that this is not the same as no headlines, and offers
 * Retry.
 */
export function stockWireFailure(sym, err, deadlineMs = 30000) {
  const s = upper(sym)
  const status = err?.status
  if (status === 404 || status === 401 || status === 403) {
    const off = offState(status === 404 ? 'not_enabled' : status === 401 ? 'signed_out' : 'admin_only')
    return { sym: s, phase: 'off', title: off.title, retry: false }
  }
  return {
    sym: s,
    phase: 'failed',
    title: err?.timedOut
      ? `${UCT_NEWS_NAME} did not answer within ${Math.round(deadlineMs / 1000)} seconds.`
      : `${UCT_NEWS_NAME} could not be checked for ${s} just now.`,
    hint: `That is not the same as no headlines about ${s}.`,
    retry: true,
  }
}

const headlines = (n) => (n === 1 ? 'headline' : `${n} headlines`)

/** The sentence above the rows: how many are from today, and that earlier ones carry a date. */
export function stockWireLede(sym, res) {
  const s = upper(sym)
  const n = res?.rows?.length || 0
  const today = res?.today || 0
  if (!n) return ''
  if (today === 0) {
    return n === 1
      ? `No headline names ${s} today. The most recent one is shown, with its date.`
      : `No headline names ${s} today. The most recent ${n} are shown, each with its date.`
  }
  if (today === n) return `The newest ${headlines(n)} naming ${s}, from today.`
  return `The newest ${headlines(n)} naming ${s}: ${today} from today, the rest earlier (each row carries its date).`
}

/** What "none found" says: the UCT News panel's own title, then how far back the search reached. */
export function stockWireNone(sym, res) {
  const s = upper(sym)
  return {
    title: `No archived headline names ${s}.`,
    hint: res?.hasOlder
      ? `${res.reach} ${wireStockCommand(s)} can search the earlier days.`
      : `${res?.reach || ''} A new one shows in ${wireStockCommand(s)} the moment it arrives.`.trim(),
  }
}

/** The line under the rows: when the list was read, and that it does not update by itself. */
export function stockWireReadNote(sym, res) {
  const at = res?.readAt ? formatTimeEt(res.readAt, { zoneSuffix: 'ET', absent: '' }) : ''
  return `${at ? `Read at ${at}. ` : ''}This list does not update on its own; ${wireStockCommand(sym)} is live and holds the full history.`
}

/**
 * NEWS: the newest few headlines of the shared pool as a strip state.
 *   rows     headlines to show (newest first), `note` when the connection is not live
 *   none     the wire is on and has loaded, and holds no headline yet
 *   loading  the first load has not answered
 *   failed   the wire could not be read (never the same as a quiet wire); the pool keeps trying
 *   off      a refusal: one sentence, no Retry, and no row command
 */
export function wireStripView(feed, limit = WIRE_ROWS.NEWS, nowMs = Date.now()) {
  if (feedOff(feed)) {
    const off = offState(feed.reason)
    return off.retry
      ? { phase: 'failed', rows: [], title: off.title, hint: 'That is not the same as a quiet wire.', retry: true, command: true }
      : { phase: 'off', rows: [], title: off.title, retry: false, command: false }
  }
  const status = feed?.status
  const todayKey = etDateKey(nowMs)
  const rows = visibleItems(feed?.items || [], { hidePlaceholders: true }).slice(0, Math.max(1, limit || 1))
    .map((it) => wireRow(it, todayKey))
  const note = status === 'live' ? null : connectionWords(feed).words
  if (rows.length) return { phase: 'rows', rows, note, command: true }
  if (feed?.epoch != null) return { phase: 'none', rows, title: `${UCT_NEWS_NAME} holds no headline yet.`, note, command: true }
  if (status === 'reconnecting' || status === 'dropped' || status === 'failed') {
    return {
      phase: 'failed', rows,
      title: feed?.reason === 'not_started'
        ? `${UCT_NEWS_NAME} is starting on the server, so its latest headlines cannot be shown yet.`
        : `${UCT_NEWS_NAME} could not be read just now.`,
      hint: 'That is not the same as a quiet wire. This strip keeps trying.',
      retry: true, command: true,
    }
  }
  return { phase: 'loading', rows, command: true }
}
