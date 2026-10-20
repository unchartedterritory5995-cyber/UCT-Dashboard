// Notebook widgets: the client lib (Task 7).
//
// The kinds, the one fetch, the node builder and the refresh merge. Every snapshot widget is
// fetched once from `GET /api/j2/notebook-widgets/{kind}`, frozen into the node's `params` and
// rendered from those params by its embed (components/notebook/widgets/*Embed.jsx).
//
// ⛔ KEEP THIS FILE LIGHT. WidgetEmbedView imports it, and WidgetEmbedView is on the Notebook's
// first open. It imports widgetEmbedCore (already there) and nothing else.
import { buildWidgetEmbedAttrs } from './widgetEmbedCore'

export const WIDGETS_URL = '/api/j2/notebook-widgets'

/** All nine kinds, in menu order. `group` is when a member reaches for it: before the open,
 *  planning a trade, or reviewing. `account` kinds read the member's own account and stay off
 *  public pages unless the member switches `share` on. */
export const WIDGET_KINDS = Object.freeze([
  { id: 'myWatchlistToday', wave: 1, group: 'open', title: 'My watchlist today',
    description: 'Your names: price, move today, earnings soon',
    keywords: ['watchlist', 'names', 'today', 'premarket', 'prep'], account: false },
  { id: 'myNamesReporting', wave: 1, group: 'open', title: 'My names reporting',
    description: 'Earnings this week with expected move',
    keywords: ['earnings', 'reporting', 'expected move', 'implied move'], account: false },
  { id: 'marketOnMyNames', wave: 3, group: 'open', title: 'Market on my names',
    description: 'Which of your names lead or lag their sector',
    keywords: ['sector', 'leading', 'lagging', 'relative strength'], account: false },
  { id: 'tickerCard', wave: 1, group: 'plan', title: 'Ticker card',
    description: 'Price, levels, earnings date, your history',
    keywords: ['ticker', 'card', 'symbol', 'levels', 'history'], account: false },
  { id: 'tickerFlow', wave: 3, group: 'plan', title: 'Options flow on a ticker',
    description: "Today's biggest options trades and bullish vs bearish premium",
    keywords: ['flow', 'options', 'calls', 'puts'], account: false },
  { id: 'myPnlStats', wave: 1, group: 'review', title: 'My P&L and stats',
    description: 'Net P&L, win rate and average R for a range',
    keywords: ['pnl', 'p&l', 'stats', 'win rate', 'review'], account: true },
  { id: 'myPositionsRisk', wave: 1, group: 'review', title: 'My open positions and risk',
    description: 'Size, open P&L, distance to stop',
    keywords: ['positions', 'risk', 'stops', 'open'], account: true },
  { id: 'myRulesCheck', wave: 2, group: 'review', title: 'My rules check',
    description: 'Which rules you kept this week',
    keywords: ['rules', 'discipline', 'checklist'], account: true },
  { id: 'myMistakes', wave: 2, group: 'review', title: 'My recurring mistakes',
    description: 'What your mistakes cost, and the trend',
    keywords: ['mistakes', 'errors', 'cost', 'review'], account: true },
])

/** Notebook widgets Task 16: existing /charts widget kinds the / menu inserts by fetch-and-freeze, through
 *  the SAME insert path as WIDGET_KINDS. Deliberately NOT in WIDGET_KINDS: they are not endpoint snapshots,
 *  so a stored one gets no refresh doors (isSnapshotKind) and renders exactly as before. `capture` loads
 *  the kind's capture module only when the command runs; `cmd` (a symbol) or `day` is its slash grammar. */
export const CAPTURE_KINDS = Object.freeze([
  { id: 'calendar', wave: 4, group: 'more', title: 'UCT Terminal day', day: 1,
    description: "Today's earnings and economic events", keywords: ['calendar', 'economic'],
    capture: () => import('../../charts/widgets/captures/calendarCapture') },
])

const BY_ID = new Map(WIDGET_KINDS.map((k) => [k.id, k]))

/** The kind's entry, or null for an id that is not a Notebook widget. */
export const widgetKind = (id) => BY_ID.get(id) || null
/** Is this widget id one of the snapshot kinds (the embed host hands it the refresh doors)? */
export const isSnapshotKind = (id) => BY_ID.has(id)

/** The query keys the endpoint passes to its builder. A refresh re-asks with the SAME ones. */
export const REQUEST_KEYS = Object.freeze(['symbol', 'list', 'from', 'to'])

/** The member's own words when the app is offline, and when a refresh fails (Global Constraints). */
export const OFFLINE_SENTENCE = "You're offline. This shows the saved snapshot."
export const REFRESH_FAILED_SENTENCE = "Couldn't refresh. The saved snapshot is unchanged."

const LIST_FROM_LABEL = { Watchlist: 'watchlist', Flagged: 'flagged' }

/** The request a stored snapshot was made with, read back from its params. The explicit request
 *  keys win; otherwise they are recovered from what the payload recorded (`listLabel`, `range`),
 *  because the node's params are normalized through the registry schema at insert. */
export function requestParamsOf(params) {
  const p = params && typeof params === 'object' ? params : {}
  const out = {}
  for (const k of REQUEST_KEYS) {
    if (typeof p[k] === 'string' && p[k]) out[k] = p[k]
  }
  if (!out.list && LIST_FROM_LABEL[p.listLabel]) out.list = LIST_FROM_LABEL[p.listLabel]
  if (p.range && typeof p.range === 'object') {
    if (!out.from && typeof p.range.from === 'string' && p.range.from) out.from = p.range.from
    if (!out.to && typeof p.range.to === 'string' && p.range.to) out.to = p.range.to
  }
  return out
}

const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false

/** One widget payload. Never throws: `{ok: true, payload}` or `{ok: false, reason}` with
 *  reason `offline` (no request made), `unavailable` (a 404: unknown or gated off) or `failed`. */
export async function fetchWidgetPayload(kind, params = {}) {
  if (isOffline()) return { ok: false, reason: 'offline' }
  try {
    const q = new URLSearchParams()
    for (const k of REQUEST_KEYS) {
      const v = params?.[k]
      if (typeof v === 'string' && v) q.set(k, v)
    }
    const qs = q.toString()
    const res = await fetch(`${WIDGETS_URL}/${encodeURIComponent(String(kind))}${qs ? `?${qs}` : ''}`, {
      credentials: 'include',
    })
    if (res.status === 404) return { ok: false, reason: 'unavailable' }
    if (!res.ok) return { ok: false, reason: 'failed' }
    const payload = await res.json()
    if (!payload || typeof payload !== 'object' || typeof payload.asOf !== 'string') {
      return { ok: false, reason: 'failed' }
    }
    return { ok: true, payload }
  } catch {
    return { ok: false, reason: isOffline() ? 'offline' : 'failed' }
  }
}

/** A frozen widgetEmbed node for one payload, built by the SAME attr constructor every capture
 *  uses (params normalized through the registry, searchText derived from them). */
export function widgetEmbedNode(kind, payload) {
  const p = payload && typeof payload === 'object' ? payload : {}
  return {
    type: 'widgetEmbed',
    attrs: buildWidgetEmbedAttrs(kind, p, { capturedAt: p.asOf, mode: 'snapshot' }),
  }
}

/** The params a refresh writes: the new payload, the request keys the old snapshot was made
 *  with, and the member's own `share` switch (a refresh never publishes or unpublishes). */
export function refreshParams(oldParams, payload) {
  const old = oldParams && typeof oldParams === 'object' ? oldParams : {}
  const next = { ...(payload && typeof payload === 'object' ? payload : {}) }
  for (const k of REQUEST_KEYS) {
    if (old[k] !== undefined) next[k] = old[k]
  }
  next.share = old.share === true
  return next
}

/** The sentence a failed refresh shows. */
export const refreshFailureText = (reason) => (reason === 'offline' ? OFFLINE_SENTENCE : REFRESH_FAILED_SENTENCE)
