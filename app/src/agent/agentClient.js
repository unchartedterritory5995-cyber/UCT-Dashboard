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
  if (!r.ok) return { ok: false, status: r.status, error: (data && data.detail) || `UCT Agent error (${r.status}).` }
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
export async function unknownSymbols(symbols) {
  const out = new Set()
  await Promise.all([...new Set(symbols)].map(async (s) => {
    try {
      const r = await fetch(`/api/ticker-search?q=${encodeURIComponent(s)}&limit=10`, { credentials: 'include' })
      const rows = r.ok ? ((await r.json()).results || []) : []
      if (!rows.some(x => String(x.ticker || x.symbol || '').toUpperCase() === s)) out.add(s)
    } catch { out.add(s) }
  }))
  return out
}
