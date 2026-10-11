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
