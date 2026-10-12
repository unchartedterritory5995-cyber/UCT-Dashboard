// The only module that knows the /api/agent/* wire shapes.

async function post(url, body) {
  let r
  try {
    r = await fetch(url, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    return { ok: false, error: 'Could not reach UCT. Check your connection.' }
  }
  let data = null
  try { data = await r.json() } catch { /* empty */ }
  if (!r.ok) return { ok: false, status: r.status, error: (data && typeof data.detail === 'string' && data.detail) || "UCT Agent couldn't complete that request. No changes were made." }
  return { ok: true, data }
}

export const agentTurn = (body) => post('/api/agent/turn', body)

/**
 * The same turn as `agentTurn`, over POST /api/agent/turn/stream (text/event-stream). `onEvent` gets
 * the server's early events — {t:'delta', text} (an answer's reply as written), {t:'retract'} (drop
 * it: a web search follows), {t:'status', stage} — and the result is EXACTLY agentTurn's: the final
 * event is /api/agent/turn's own JSON. Exactly ONE request per turn: an unexpected reply (an error
 * status, or anything but an event stream) is a failed turn, never re-sent on /api/agent/turn.
 * Kill switch: localStorage `uct.agent.stream = '0'` always asks the old way (before any request).
 */
export function streamingEnabled() {
  try { return globalThis.localStorage?.getItem('uct.agent.stream') !== '0' } catch { return true }
}
// Whether THIS server streams turns (GET /api/agent/config, read once when the Agent opens). Until it
// has answered yes, every turn is asked the old way — a server with streaming off sees no change at all.
let serverStream = { on: false, inflight: null, at: 0 }
const CONFIG_TTL_MS = 5 * 60 * 1000
export function loadAgentConfig() {
  if (serverStream.inflight) return serverStream.inflight
  if (serverStream.at && Date.now() - serverStream.at < CONFIG_TTL_MS) return Promise.resolve(serverStream.on)
  serverStream.inflight = fetch('/api/agent/config', { credentials: 'include', cache: 'no-store' })
    .then(r => (r.ok ? r.json() : null))
    .then((c) => { serverStream.on = !!(c && c.stream === true); serverStream.at = Date.now(); return serverStream.on })
    .catch(() => serverStream.on)
    .finally(() => { serverStream.inflight = null })
  return serverStream.inflight
}
export const serverStreams = () => serverStream.on && streamingEnabled()
export const _resetAgentConfig = () => { serverStream = { on: false, inflight: null, at: 0 } }
const FAILED = "UCT Agent couldn't complete that request. No changes were made."
export async function agentTurnStream(body, onEvent = () => {}) {
  if (!streamingEnabled()) return agentTurn(body)
  let r
  try {
    r = await fetch('/api/agent/turn/stream', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify(body),
    })
  } catch {
    return { ok: false, error: 'Could not reach UCT. Check your connection.' }
  }
  // ⛔ NEVER RESENT. The request may already have been taken by the server (the member's message
  // stored, the daily allowance charged, a model call started), so a reply that is not the event stream
  // — any error status, or a 200 that is not text/event-stream (an edge page, an older server) — ends
  // the turn honestly. It is never re-asked on /api/agent/turn automatically: the member asks again.
  // (Nothing runs in the browser without a final envelope, so "No changes were made" stays true.)
  if (r.ok && !String(r.headers?.get?.('content-type') || '').includes('text/event-stream')) {
    return { ok: false, status: r.status, error: FAILED }
  }
  if (!r.ok || !r.body?.getReader) {
    let data = null
    try { data = await r.json() } catch { /* empty */ }
    return { ok: false, status: r.status, error: (data && typeof data.detail === 'string' && data.detail) || FAILED }
  }
  const reader = r.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      let cut
      while ((cut = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, cut)
        buf = buf.slice(cut + 2)
        const line = block.split('\n').find(l => l.startsWith('data: '))
        if (!line) continue                                   // a comment (": open") or keep-alive
        let ev
        try { ev = JSON.parse(line.slice(6)) } catch { continue }
        if (ev?.t === 'final') { const { t: _t, ...data } = ev; return { ok: true, data } }
        if (ev?.t === 'error') return { ok: false, status: ev.status, error: ev.detail || FAILED }
        try { onEvent(ev) } catch { /* a display hiccup never breaks the turn */ }
      }
    }
  } catch {
    return { ok: false, error: 'The connection to UCT dropped before the answer finished. No changes were made.' }
  }
  return { ok: false, error: FAILED }
}
export const agentRecord = (body) => post('/api/agent/record', body)

export async function agentConversations() {
  try {
    const r = await fetch('/api/agent/conversations', { credentials: 'include' })
    if (!r.ok) return []
    return (await r.json()).conversations || []
  } catch { return [] }
}

// History: rename / pin / delete one of the member's own chats; search across all of them.
async function send(url, method, body) {
  try {
    const r = await fetch(url, {
      method, credentials: 'include',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
    let data = null
    try { data = await r.json() } catch { /* empty */ }
    return r.ok ? { ok: true, data } : { ok: false, status: r.status, error: (data && typeof data.detail === 'string' && data.detail) || 'That didn’t work. Try again.' }
  } catch {
    return { ok: false, error: 'Could not reach UCT. Check your connection.' }
  }
}
const convUrl = (id) => `/api/agent/conversations/${encodeURIComponent(id)}`
export const renameConversation = (id, title) => send(convUrl(id), 'PATCH', { title })
export const pinConversation = (id, pinned) => send(convUrl(id), 'PATCH', { pinned })
export const deleteConversation = (id) => send(convUrl(id), 'DELETE')
export async function searchHistory(q) {
  const r = await send(`/api/agent/search?q=${encodeURIComponent(q)}`, 'GET')
  return r.ok ? (r.data?.results || []) : []
}

export async function agentConversation(id) {
  try {
    const r = await fetch(`/api/agent/conversations/${encodeURIComponent(id)}`, { credentials: 'include' })
    if (!r.ok) return null
    return await r.json()
  } catch { return null }
}

/**
 * Which of these tickers does UCT NOT know? Exact-match against the same
 * /api/ticker-search the chart's own symbol search uses. A lookup failure is
 * "unknown": the Agent refuses rather than charting something it couldn't check.
 */
// A ticker found KNOWN stays known for a while: the proposal already looked it up,
// so Apply (minutes later at most) need not wait on the search again (~2s measured
// in production 2026-10-08). Unknown / failed lookups are never cached — they are
// asked again every time.
const KNOWN_TTL_MS = 10 * 60 * 1000
const knownAt = new Map()
export const _resetKnownTickers = () => knownAt.clear()

export async function unknownSymbols(symbols) {
  const out = new Set()
  const now = Date.now()
  await Promise.all([...new Set(symbols)].map(async (s) => {
    if (now - (knownAt.get(s) ?? -Infinity) < KNOWN_TTL_MS) return
    try {
      const r = await fetch(`/api/ticker-search?q=${encodeURIComponent(s)}&limit=10`, { credentials: 'include' })
      const rows = r.ok ? ((await r.json()).results || []) : []
      if (rows.some(x => String(x.ticker || x.symbol || '').toUpperCase() === s)) knownAt.set(s, Date.now())
      else out.add(s)
    } catch { out.add(s) }
  }))
  return out
}
