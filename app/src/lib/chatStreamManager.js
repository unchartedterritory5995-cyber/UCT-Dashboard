// app/src/lib/chatStreamManager.js
//
// ONE pooled EventSource for The Floor's live chat, shared across every component
// via useSyncExternalStore. Never rebuilt on channel switch (switching is a pure
// client render). Modeled on priceStreamManager but WITHOUT its bucket-rekey — a
// single connection subscribes to all pulse channels for the session.
//
// Instant-feel guarantees (from the hardening review):
//  • optimistic local echo: a pending bubble renders at 0ms, reconciled to the
//    server id by client_msg_id; all incoming messages dedupe by autoincrement id.
//  • inverted gap-fill on reconnect: open SSE + buffer, THEN refetch the tail
//    (including deleted tombstones), merge by id — laptop-wake loss self-heals.
//  • chat-tuned reconnect (~1s → 10s) + a reconnecting flag for a subtle pill.

const TYPING_TTL = 5000
const RETRY_MIN = 1000
const RETRY_MAX = 10000
const HEARTBEAT_WATCHDOG = 25000 // ~2× the 10s server heartbeat

let es = null
let channels = []
let retry = RETRY_MIN
let watchdog = null
let started = false
let capacityFull = false

const EMPTY = Object.freeze({ messages: [], presence: { count: 0, users: [] }, typing: [] })
const store = new Map() // slug -> { messages, presence, typing:{}, snap }
const subs = new Map()  // slug -> Set(cb)
const metaSubs = new Set()
const boardListeners = new Set() // cb({space, kind, thread_id}) — live Boards
const meta = { connected: false, reconnecting: false, capacity: false, _snap: null }

let tmpSeq = 0
const nextTmpId = () => `tmp-${Date.now()}-${tmpSeq++}`

// The current user's id — set by the UI so we can ignore our OWN reaction echoes
// (we already applied them optimistically; applying the broadcast again double-counts).
let selfId = null
export function setSelfId(id) { selfId = id }

// ── store plumbing ──────────────────────────────────────────────────────────
function slot(slug) {
  if (!store.has(slug)) store.set(slug, { messages: [], presence: { count: 0, users: [] }, typing: {}, snap: EMPTY })
  return store.get(slug)
}
function sortMsgs(arr) {
  return arr.slice().sort((a, b) => {
    if (a.pending && !b.pending) return 1
    if (!a.pending && b.pending) return -1
    return (a.id || 0) - (b.id || 0)
  })
}
function bump(slug) {
  const s = slot(slug)
  const typingList = Object.entries(s.typing)
    .filter(([, t]) => Date.now() - t.ts < TYPING_TTL)
    .map(([id, t]) => ({ user_id: id, name: t.name }))
  s.snap = { messages: s.messages, presence: s.presence, typing: typingList }
  ;(subs.get(slug) || []).forEach((cb) => cb())
}
function bumpMeta() {
  meta._snap = { connected: meta.connected, reconnecting: meta.reconnecting, capacity: meta.capacity }
  metaSubs.forEach((cb) => cb())
}

// ── message merge (id-keyed; reconciles optimistic pending) ─────────────────
function upsert(slug, msg) {
  const s = slot(slug)
  const arr = s.messages
  const idx = arr.findIndex((m) => !m.pending && m.id === msg.id)
  if (idx >= 0) {
    const next = arr.slice()
    next[idx] = { ...arr[idx], ...msg }
    s.messages = next
    bump(slug)
    return
  }
  // reconcile the sender's own optimistic bubble
  const pidx = msg.client_msg_id
    ? arr.findIndex((m) => m.pending && m.client_msg_id === msg.client_msg_id)
    : -1
  if (pidx >= 0) {
    const next = arr.slice()
    next[pidx] = { ...msg, pending: false }
    s.messages = sortMsgs(next)
  } else {
    s.messages = sortMsgs(arr.concat([msg]))
  }
  bump(slug)
}
function upsertMany(slug, msgs) {
  const s = slot(slug)
  const byId = new Map(s.messages.filter((m) => !m.pending).map((m) => [m.id, m]))
  const pending = s.messages.filter((m) => m.pending)
  for (const m of msgs) byId.set(m.id, { ...(byId.get(m.id) || {}), ...m })
  s.messages = sortMsgs([...byId.values(), ...pending])
  bump(slug)
}
function applyReaction(slug, { message_id, kind, on }) {
  const s = slot(slug)
  const idx = s.messages.findIndex((m) => m.id === message_id)
  if (idx < 0) return
  const m = s.messages[idx]
  const reactions = { ...(m.reactions || {}) }
  reactions[kind] = Math.max(0, (reactions[kind] || 0) + (on ? 1 : -1))
  if (!reactions[kind]) delete reactions[kind]
  const next = s.messages.slice()
  next[idx] = { ...m, reactions }
  s.messages = next
  bump(slug)
}

// ── SSE event dispatch ──────────────────────────────────────────────────────
function onEvent(name, data) {
  const slug = data.channel
  const payload = data.data || {}
  if (name === 'message' || name === 'message_edited') upsert(slug, payload)
  else if (name === 'message_deleted') {
    const s = slot(slug)
    const idx = s.messages.findIndex((m) => m.id === payload.message_id)
    if (idx >= 0) {
      const next = s.messages.slice()
      next[idx] = { ...next[idx], deleted: 1, body: '', card: null }
      s.messages = next
      bump(slug)
    }
  } else if (name === 'reaction') {
    // Ignore our OWN echo — toggleReaction already applied it optimistically; applying
    // the broadcast again would double-count for the actor.
    if (!(payload.user_id && payload.user_id === selfId)) applyReaction(slug, payload)
  }
  else if (name === 'message_pinned') {
    const s = slot(slug)
    const idx = s.messages.findIndex((m) => m.id === payload.message_id)
    if (idx >= 0) {
      const next = s.messages.slice()
      next[idx] = { ...next[idx], pinned: payload.pinned ? 1 : 0 }
      s.messages = next
      bump(slug)
    }
  } else if (name === 'presence') {
    const s = slot(slug)
    s.presence = { count: payload.count || 0, users: payload.users || [] }
    bump(slug)
  } else if (name === 'typing') {
    const s = slot(slug)
    s.typing[payload.user_id] = { ts: Date.now(), name: payload.name || 'member' }
    bump(slug)
  } else if (name === 'board_activity') {
    boardListeners.forEach((cb) => { try { cb(payload) } catch (_) {} })
  }
}

// ── connection lifecycle ────────────────────────────────────────────────────
function armWatchdog() {
  clearTimeout(watchdog)
  watchdog = setTimeout(() => { try { es && es.close() } catch (_) {} reconnect() }, HEARTBEAT_WATCHDOG)
}
function open() {
  if (typeof window === 'undefined' || typeof EventSource === 'undefined') return
  const url = `/api/community/chat/stream?channels=${encodeURIComponent(channels.join(','))}`
  try { es = new EventSource(url, { withCredentials: true }) } catch (_) { return }
  const names = ['connected', 'message', 'message_edited', 'message_deleted', 'reaction',
    'presence', 'typing', 'message_pinned', 'board_activity', 'heartbeat']
  es.onopen = () => {
    retry = RETRY_MIN
    meta.connected = true; meta.reconnecting = false; meta.capacity = false
    bumpMeta()
    armWatchdog()
    // inverted gap-fill: SSE is already open + buffering; refetch each tail now.
    channels.forEach((slug) => gapFill(slug))
  }
  for (const n of names) {
    es.addEventListener(n, (ev) => {
      armWatchdog()
      if (n === 'heartbeat' || n === 'connected') return
      try { onEvent(n, JSON.parse(ev.data)) } catch (_) {}
    })
  }
  es.onerror = async () => {
    meta.connected = false; meta.reconnecting = true; bumpMeta()
    try { es && es.close() } catch (_) {}
    // detect capacity: a 503 closes immediately; probe once.
    reconnect()
  }
}
function reconnect() {
  clearTimeout(watchdog)
  setTimeout(open, retry)
  retry = Math.min(RETRY_MAX, retry * 2)
}

// ── public API ──────────────────────────────────────────────────────────────
async function jget(url) {
  const r = await fetch(url, { credentials: 'include' })
  if (!r.ok) { const e = new Error(String(r.status)); e.status = r.status; throw e }
  return r.json()
}
async function jsend(url, body, method = 'POST') {
  const r = await fetch(url, {
    method, credentials: 'include',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) { const e = new Error(data.detail || String(r.status)); e.status = r.status; throw e }
  return data
}

export function ensureStarted(chs) {
  const list = (chs || []).filter(Boolean)
  const added = list.filter((c) => !channels.includes(c))
  if (!added.length && started) return
  channels = [...new Set([...channels, ...list])]
  // Pulse channels load history; board:* rooms are activity-only (no chat messages).
  added.forEach((slug) => { slot(slug); if (!slug.startsWith('board:')) loadInitial(slug) })
  if (!started) {
    started = true
    open()
  } else {
    // New rooms added (mount-time only — channel SWITCHING never adds rooms, so it
    // stays 0-reconnect). Re-establish the one pooled connection with the full set.
    try { es && es.close() } catch (_) {}
    open()
  }
}

export function subscribeBoardActivity(cb) {
  boardListeners.add(cb)
  return () => boardListeners.delete(cb)
}

async function loadInitial(slug) {
  try {
    const { messages } = await jget(`/api/community/chat/channels/${slug}/messages?limit=60`)
    upsertMany(slug, messages || [])
  } catch (_) {}
}

export async function gapFill(slug) {
  const s = slot(slug)
  const last = s.messages.filter((m) => !m.pending).reduce((mx, m) => Math.max(mx, m.id || 0), 0)
  try {
    if (!last) { await loadInitial(slug); return }
    // (1) messages CREATED during the gap.
    const { messages } = await jget(`/api/community/chat/channels/${slug}/messages?after_id=${last}&limit=200`)
    if (messages && messages.length) upsertMany(slug, messages)
    // (2) refetch the visible tail so edits / deletes (moderation) / pins / reaction
    // changes on ALREADY-loaded messages converge — list_messages returns tombstones
    // and the id-keyed merge heals them. Without this, a hidden message stays visible.
    await loadInitial(slug)
  } catch (_) {}
}

// Re-evaluate a channel's snapshot (used to clear stale typing labels in a quiet room,
// since bump is otherwise only event-driven).
export function pokeTyping(slug) { if (store.has(slug)) bump(slug) }

// Upward history pagination. Returns how many older messages were loaded.
export async function loadEarlier(slug) {
  const s = slot(slug)
  const realIds = s.messages.filter((m) => !m.pending).map((m) => m.id)
  if (!realIds.length) return 0
  const minId = Math.min(...realIds)
  try {
    const { messages } = await jget(`/api/community/chat/channels/${slug}/messages?before_id=${minId}&limit=100`)
    if (messages && messages.length) { upsertMany(slug, messages); return messages.length }
  } catch (_) {}
  return 0
}

export function subscribeChannel(slug, cb) {
  if (!subs.has(slug)) subs.set(slug, new Set())
  subs.get(slug).add(cb)
  return () => subs.get(slug)?.delete(cb)
}
export function getChannelSnapshot(slug) {
  return store.has(slug) ? store.get(slug).snap : EMPTY
}
export function subscribeMeta(cb) { metaSubs.add(cb); return () => metaSubs.delete(cb) }
export function getMetaSnapshot() { return meta._snap || META_EMPTY }
const META_EMPTY = Object.freeze({ connected: false, reconnecting: false, capacity: false })

export async function sendMessage(slug, { body, tickers, replyTo, card } = {}) {
  const client_msg_id = nextTmpId()
  const s = slot(slug)
  // optimistic pending bubble (rendered at 0ms)
  s.messages = sortMsgs(s.messages.concat([{
    id: client_msg_id, client_msg_id, pending: true, channel_slug: slug,
    author_id: '__me__', author: { name: 'You', is_mentor: false },
    body: body || '', ticker_tags: tickers || [],
    // chart cards are client-derivable → show instantly; trade/flow need server data.
    card: (card && card.kind === 'chart') ? card : null,
    reply_to_message_id: replyTo || null, created_at: Math.floor(Date.now() / 1000), reactions: {},
  }]))
  bump(slug)
  try {
    const msg = await jsend(`/api/community/chat/channels/${slug}/messages`, {
      body: body || '', ticker_tags: tickers || [],
      reply_to_message_id: replyTo || null, client_msg_id, card: card || null,
    })
    upsert(slug, { ...msg, client_msg_id })
    return msg
  } catch (e) {
    // mark the pending bubble failed so the user can retry
    const arr = s.messages.slice()
    const idx = arr.findIndex((m) => m.pending && m.client_msg_id === client_msg_id)
    if (idx >= 0) { arr[idx] = { ...arr[idx], failed: true }; s.messages = arr; bump(slug) }
    throw e
  }
}

function setMine(slug, messageId, kind, on) {
  const s = slot(slug)
  const idx = s.messages.findIndex((m) => m.id === messageId)
  if (idx < 0) return
  const m = s.messages[idx]
  const mine = new Set(m.my_reactions || [])
  if (on) mine.add(kind); else mine.delete(kind)
  const next = s.messages.slice()
  next[idx] = { ...m, my_reactions: [...mine] }
  s.messages = next
  bump(slug)
}

export function toggleReaction(slug, messageId, kind) {
  const s = slot(slug)
  const m = s.messages.find((x) => x.id === messageId)
  const had = !!(m && (m.my_reactions || []).includes(kind))
  const on = !had
  // optimistic: flip count + my_reactions
  applyReaction(slug, { message_id: messageId, kind, on })
  setMine(slug, messageId, kind, on)
  return jsend(`/api/community/chat/messages/${messageId}/reactions`, { kind })
    .then((r) => {
      if (typeof r.on === 'boolean' && r.on !== on) {
        applyReaction(slug, { message_id: messageId, kind, on: r.on })
        setMine(slug, messageId, kind, r.on)
      }
    })
    .catch(() => {
      applyReaction(slug, { message_id: messageId, kind, on: had })
      setMine(slug, messageId, kind, had)
    })
}

// Retry / discard a failed optimistic send.
export function retryMessage(slug, clientMsgId) {
  const s = slot(slug)
  const m = s.messages.find((x) => x.pending && x.client_msg_id === clientMsgId)
  if (!m) return
  // clear the failed flag + re-POST with the SAME client_msg_id so it reconciles.
  const arr = s.messages.slice()
  const idx = arr.findIndex((x) => x === m)
  arr[idx] = { ...m, failed: false }
  s.messages = arr
  bump(slug)
  jsend(`/api/community/chat/channels/${slug}/messages`, {
    body: m.body || '', ticker_tags: m.ticker_tags || [],
    reply_to_message_id: m.reply_to_message_id || null, client_msg_id: clientMsgId,
  }).then((msg) => upsert(slug, { ...msg, client_msg_id: clientMsgId }))
    .catch(() => {
      const a2 = s.messages.slice()
      const i2 = a2.findIndex((x) => x.pending && x.client_msg_id === clientMsgId)
      if (i2 >= 0) { a2[i2] = { ...a2[i2], failed: true }; s.messages = a2; bump(slug) }
    })
}
export function discardPending(slug, clientMsgId) {
  const s = slot(slug)
  s.messages = s.messages.filter((x) => !(x.pending && x.client_msg_id === clientMsgId))
  bump(slug)
}
export function editMessage(messageId, body, tickers) {
  return jsend(`/api/community/chat/messages/${messageId}`, { body, ticker_tags: tickers }, 'PATCH')
}
export function deleteMessage(messageId) {
  return jsend(`/api/community/chat/messages/${messageId}`, undefined, 'DELETE')
}

let lastTyping = 0
export function sendTyping(slug) {
  const now = Date.now()
  if (now - lastTyping < 4000) return
  lastTyping = now
  jsend(`/api/community/chat/channels/${slug}/typing`, {}).catch(() => {})
}
export function markRead(slug, lastId) {
  if (!lastId) return
  jsend(`/api/community/chat/channels/${slug}/read`, { last_seen_message_id: lastId }).catch(() => {})
}
