// Notebook widgets: the fetch and the refresh merge (Task 7), split out of notebookWidgets.js in Task 16D.
//
// ⛔ NOT ON THE FIRST OPEN. Only lazy code imports this file statically (SnapshotFrame, TickerCardPopover);
// the / menu loads it when a snapshot command runs (SlashMenu.snapshotCommand) and, while wave 6 is on, for the
// /recap and /screen rows (SlashMenu.pickItems). Keep it that way: an eager
// import here puts every byte below back on the Notebook's first open.

import { SETTINGS_KEYS } from './notebookSets'
import { widgetKind, widgetEmbedNode } from './notebookWidgets'

export const WIDGETS_URL = '/api/j2/notebook-widgets'

/** The query keys the endpoint passes to its builder (the server's SETTING_KEYS: symbol, list, from, to, month,
 *  definitionId, tradeId). A refresh re-asks with the SAME ones. ONE list: the presets' SETTINGS_KEYS, which
 *  tests/test_journal_styles_compose.py pins to the server's, so the fetch can never drift from it. */
export const REQUEST_KEYS = SETTINGS_KEYS

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

/** The slash / palette snapshot insert's last step (SlashMenu.snapshotCommand), here so it costs no first-open
 *  bytes: the frozen widget goes in at `pos()` (the command's place, mapped through anything typed while the
 *  fetch ran). Final review M-2: the fetch can take seconds, so a note destroyed or turned read-only meanwhile
 *  gets nothing. Resolves the palette's `{ok, message}`. */
export function landSnapshot(editor, kind, params, pos) {
  if (editor.isDestroyed || !editor.isEditable) return { ok: false, message: null }
  editor.chain().focus().insertContentAt(Math.min(pos(), editor.state.doc.content.size), widgetEmbedNode(kind, params))
    .caretAfterWidgetEmbed().run()
  return { ok: true, message: null }
}

/** The sentence a failed refresh shows. */
export const refreshFailureText = (reason) => (reason === 'offline' ? OFFLINE_SENTENCE : REFRESH_FAILED_SENTENCE)

// ── Task 20 (wave 6): the / menu rows that let a member CHOOSE what a snapshot is about ─────────────────────
// `/recap` lists the member's 10 most recent closed trades ("Recap — NVDA long, Oct 14") and `/screen` their
// saved screens ("Screen — Tight flags"). Each row inserts through the menu's own snapshotCommand (the one
// snapshot insert), with the request key the endpoint reads: `tradeId` or `definitionId`. Here, in the module
// the snapshot insert already loads, so the / menu pays no second lazy import for it (first-open bytes).
// SlashMenu.pickItems reads them once per load (its background loader: 60 s fresh, 30 s after a failure).

/** A bare `/` shows at most this many of each; typing narrows to every match. */
export const BARE_ROWS = 5
/** j2_trades holds closed trades only (an open trade is a position); the route lists them newest first. */
export const TRADES_URL = '/api/j2/trades?limit=10'
export const SCREENS_URL = '/api/user-definitions'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

async function getJson(url) {
  try {
    const res = await fetch(url, { credentials: 'include' })
    return res.ok ? await res.json() : null
  } catch {
    return null
  }
}

/** The member's trades and screens. One failed read leaves its list empty; both failing is a failed load. */
export async function loadPicks() {
  const [t, d] = await Promise.all([getJson(TRADES_URL), getJson(SCREENS_URL)])
  if (!t && !d) throw new Error('picks unavailable')
  return {
    trades: (Array.isArray(t?.trades) ? t.trades : []).filter((x) => x && x.id).slice(0, 10),
    // The server's own answer to "can this be a screen?" (user_definitions._stamped), never a shape check here.
    screens: (Array.isArray(d?.definitions) ? d.definitions : []).filter((r) => r && r.def_id && r.scannable === true),
  }
}

/** A stored trade date as "Oct 14", read on the ET calendar (a bare day as it is). '' when unreadable. */
export function shortDay(raw) {
  const s = String(raw || '')
  let day = s.slice(0, 10)
  if (s.length > 10) {
    const t = new Date(s)
    if (!Number.isNaN(t.getTime())) day = t.toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  return m && MONTHS[Number(m[2]) - 1] ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}` : ''
}

/** ScreensManager's name for a saved screen: the member's own, else its id (the server's `_screen_name`). */
export const screenName = (r) => (typeof r?.definition?.meta?.name === 'string' && r.definition.meta.name.trim())
  || String(r?.def_id || '') || 'Untitled screen'

/** Which of `list` a query offers for `cmd`, the /set grammar: a single token is a prefix of the command (a bare
 *  `/` takes the first BARE_ROWS); once a space follows, only the exact command, narrowed by `label`. */
function matching(raw, cmd, list, label) {
  const tokens = raw.split(/\s+/).filter(Boolean)
  const first = tokens[0]?.toLowerCase() || ''
  if (!raw) return list.slice(0, BARE_ROWS)
  if (tokens.length <= 1) return cmd.startsWith(first) ? list : []
  if (first !== cmd) return []
  const q = raw.slice(first.length).trim().toLowerCase()
  return list.filter((x) => label(x).toLowerCase().includes(q))
}

/** Titles are the row's key in the menu, so a second trade with the same words gets a count. */
function uniqueTitles(rows) {
  const seen = new Map()
  return rows.map((r) => {
    const n = (seen.get(r.title) || 0) + 1
    seen.set(r.title, n)
    return n > 1 ? { ...r, title: `${r.title} (${n})` } : r
  })
}

const tradeTitle = (t) => {
  const day = shortDay(t.exitDate)
  return `Recap — ${String(t.symbol || '?').toUpperCase()} ${String(t.side || 'trade').toLowerCase()}${day ? `, ${day}` : ''}`
}

/** The /recap and /screen rows for one query. `insert(kind, params)` is SlashMenu's snapshotCommand. */
export function pickRows(query, doc, insert) {
  const raw = String(query || '').trim()
  const recap = widgetKind('tradeRecap')
  const screen = widgetKind('myScreenToday')
  const trades = matching(raw, 'recap', doc?.trades || [], (t) => `${t.symbol || ''} ${t.side || ''}`)
  const screens = matching(raw, 'screen', doc?.screens || [], screenName)
  return uniqueTitles([
    ...trades.map((t) => ({
      title: tradeTitle(t), cmd: 'recap', group: recap.group, description: recap.description,
      command: insert(recap, { tradeId: String(t.id) }),
    })),
    ...screens.map((r) => ({
      title: `Screen — ${screenName(r)}`, cmd: 'screen', group: screen.group, description: screen.description,
      command: insert(screen, { definitionId: String(r.def_id) }),
    })),
  ])
}
