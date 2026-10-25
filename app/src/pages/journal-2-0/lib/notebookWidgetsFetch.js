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
  // R60: only the map's own labels (a stored "__proto__" never reaches Object.prototype).
  if (!out.list && typeof p.listLabel === 'string' && Object.hasOwn(LIST_FROM_LABEL, p.listLabel)) out.list = LIST_FROM_LABEL[p.listLabel]
  if (p.range && typeof p.range === 'object') {
    if (!out.from && typeof p.range.from === 'string' && p.range.from) out.from = p.range.from
    if (!out.to && typeof p.range.to === 'string' && p.range.to) out.to = p.range.to
  }
  return out
}

const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false

/** F2 fix round 1 (review note): a widget request that has not answered in this long is given up as failed, so a
 *  stalled fetch can never hold the / menu's in-flight guard (or a See it now) open. The server bounds itself at 6 s
 *  per read; this is the client's own ceiling. */
export const FETCH_TIMEOUT_MS = 15000

/** One widget payload. Never throws: `{ok: true, payload}` or `{ok: false, reason}` with
 *  reason `offline` (no request made), `unavailable` (a 404: unknown or gated off) or `failed`. A 400 (a setting
 *  the server refuses, e.g. "month must be between ...") also carries the server's own sentence as `message`. */
export async function fetchWidgetPayload(kind, params = {}) {
  if (isOffline()) return { ok: false, reason: 'offline' }
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer = ctl ? setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS) : null
  try {
    const q = new URLSearchParams()
    for (const k of REQUEST_KEYS) {
      const v = params?.[k]
      if (typeof v === 'string' && v) q.set(k, v)
    }
    const qs = q.toString()
    // A READ: it writes no note. The literal method is what lets offline/doorEnumeration.test.js see that
    // through the spread (a spread with no method beside it is UNRESOLVED-METHOD there).
    const res = await fetch(`${WIDGETS_URL}/${encodeURIComponent(String(kind))}${qs ? `?${qs}` : ''}`, {
      method: 'GET', credentials: 'include', ...(ctl ? { signal: ctl.signal } : {}),
    })
    if (res.status === 404) return { ok: false, reason: 'unavailable' }
    if (res.status === 400) {
      // A 400 is failed whatever its body says; a readable `detail` only adds the server's own sentence. An
      // unreadable body is handled HERE, by name, so it is a 400 without a message and never a swallowed throw.
      let detail = null
      try {
        const body = await res.json()
        if (typeof body?.detail === 'string' && body.detail) detail = body.detail
      } catch {
        detail = null
      }
      return { ok: false, reason: 'failed', ...(detail ? { message: detail } : {}) }
    }
    if (!res.ok) return { ok: false, reason: 'failed' }
    const payload = await res.json()
    if (!payload || typeof payload !== 'object' || typeof payload.asOf !== 'string') {
      return { ok: false, reason: 'failed' }
    }
    return { ok: true, payload }
  } catch {
    return { ok: false, reason: isOffline() ? 'offline' : 'failed' }
  } finally {
    if (timer) clearTimeout(timer)
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
 *  gets nothing. Resolves the palette's `{ok, message}`; `title` names the widget in the success sentence. */
export function landSnapshot(editor, kind, params, pos, title) {
  if (editor.isDestroyed) return { ok: false, message: null }
  if (!editor.isEditable) {
    // The note turned read-only while the fetch ran: nothing goes in, and the busy "Adding …" toast is taken down.
    editor.storage?.uctJournalWidgets?.notify?.(null)
    return { ok: false, message: null }
  }
  editor.chain().focus().insertContentAt(Math.min(pos(), editor.state.doc.content.size), widgetEmbedNode(kind, params))
    .caretAfterWidgetEmbed().run()
  // R58 (UX I-2): the success sentence replaces the menu's "Adding …".
  if (title) editor.storage?.uctJournalWidgets?.notify?.(`${title} added.`, 'info')
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

const tradesOf = (t) => (Array.isArray(t?.trades) ? t.trades : []).filter((x) => x && x.id).slice(0, 10)

/** Wave 10 (Task 10.21): the member's recent closed trades alone, for the examples gallery's trade pick (Plan vs
 *  actual). Rejects when unreadable. */
export async function loadTrades() {
  const t = await getJson(TRADES_URL)
  if (!t) throw new Error('trades unavailable')
  return tradesOf(t)
}

/** The member's trades and screens. One failed read leaves its list empty; both failing is a failed load. */
export async function loadPicks() {
  const [t, d] = await Promise.all([getJson(TRADES_URL), getJson(SCREENS_URL)])
  if (!t && !d) throw new Error('picks unavailable')
  return {
    trades: tradesOf(t),
    // The server's own answer to "can this be a screen?" (user_definitions._stamped), never a shape check here.
    screens: (Array.isArray(d?.definitions) ? d.definitions : []).filter((r) => r && r.def_id && r.scannable === true),
  }
}

/** A stored trade date as "Oct 14", by the Journal's one trading-day rule (api timeutil.compute_trading_day_et):
 *  a bare day as it is; a DATE-ONLY entry, stored at exact UTC midnight, as the day the member typed; a real
 *  timestamp on the ET calendar. '' when unreadable.
 *  Fix F4 (D3): this converted every timestamp, so a manual exit typed 2026-10-15 (stored 2026-10-15T00:00:00Z,
 *  8 pm ET the evening before) read "Oct 14" on the /recap row. A naive stamp is read as UTC, as the server does. */
export function shortDay(raw) {
  const s = String(raw || '').trim()
  let day = s.slice(0, 10)
  if (s.length > 10) {
    const zoned = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(s) ? s : `${s}Z`
    const t = new Date(zoned)
    if (!Number.isNaN(t.getTime())) {
      const dateOnly = t.getUTCHours() === 0 && t.getUTCMinutes() === 0 && t.getUTCSeconds() === 0
      day = dateOnly ? t.toISOString().slice(0, 10) : t.toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
    }
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

/** A closed trade as a member reads it: "NVDA long, Oct 14". */
export const tradeLabel = (t) => {
  const day = shortDay(t.exitDate)
  return `${String(t.symbol || '?').toUpperCase()} ${String(t.side || 'trade').toLowerCase()}${day ? `, ${day}` : ''}`
}
const tradeTitle = (t) => `Recap — ${tradeLabel(t)}`
const tradeWords = (t) => `${t.symbol || ''} ${t.side || ''}`

/** Wave 10 (Task 10.21): the command word for Plan vs actual's trade rows (`/actual`, `/actual nvda`). */
export const ACTUAL_CMD = 'actual'

/** Wave 10 (Task 10.21): a ready-made dedicated kind as the one snapshot insert reads it. Its only door is a POST
 *  (lib/dedicatedWidgets.js, W10-R4): `capture(params)` runs it with the member's own `params.settings` and answers in
 *  the insert's words (offline is the insert's own sentence; anything else the widget client's). Both clients load
 *  only when it runs. Null for a kind that is not dedicated. */
export function dedicatedSnapshotKind(id) {
  const k = widgetKind(id)
  if (!k || k.dedicated !== 1) return null
  const capture = (params) => Promise.all([import('./dedicatedWidgets'), import('./builtWidgets')])
    .then(([d, b]) => d.runDedicated(id, d.dedicatedRequestOf(id, params)).then((got) => {
      if (got.ok) return { ok: true, payload: got.data }
      if (got.code === 'offline') return { ok: false, reason: 'offline' }
      return { ok: false, message: b.failureText(got.code, got.message) }
    }))
  return { ...k, capture }
}

/** The /recap and /screen rows for one query. `insert(kind, params)` is SlashMenu's snapshotCommand. Wave 10
 *  (`actual`): `/actual` lists the same trades for Plan vs actual, each inserting it with that trade in its own
 *  settings; never on a bare `/` (the trades are already there as recaps). */
export function pickRows(query, doc, insert, { actual = false } = {}) {
  const raw = String(query || '').trim()
  const recap = widgetKind('tradeRecap')
  const screen = widgetKind('myScreenToday')
  const trades = matching(raw, 'recap', doc?.trades || [], tradeWords)
  const screens = matching(raw, 'screen', doc?.screens || [], screenName)
  const pva = actual && raw ? dedicatedSnapshotKind('myPlanVsActual') : null
  const planned = pva ? matching(raw, ACTUAL_CMD, doc?.trades || [], tradeWords) : []
  return uniqueTitles([
    ...trades.map((t) => ({
      title: tradeTitle(t), cmd: 'recap', group: recap.group, description: recap.description,
      command: insert(recap, { tradeId: String(t.id) }),
    })),
    ...screens.map((r) => ({
      title: `Screen — ${screenName(r)}`, cmd: 'screen', group: screen.group, description: screen.description,
      command: insert(screen, { definitionId: String(r.def_id) }),
    })),
    ...planned.map((t) => ({
      title: `${pva.title} — ${tradeLabel(t)}`, cmd: ACTUAL_CMD, group: pva.group, description: pva.description,
      command: insert(pva, { settings: { tradeId: String(t.id) } }),
    })),
  ])
}
