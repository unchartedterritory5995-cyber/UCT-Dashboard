// History list: pinned first, then by last activity — Today / Yesterday / Previous 7 days /
// Previous 30 days / Older — and a short "when" for each row.

const DAY = 86400000
const startOfDay = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime() }

export function groupConversations(list, now = Date.now()) {
  const today = startOfDay(now)
  const buckets = [
    ['Pinned', []], ['Today', []], ['Yesterday', []], ['Previous 7 days', []], ['Previous 30 days', []], ['Older', []],
  ]
  const by = Object.fromEntries(buckets)
  for (const c of list || []) {
    const at = (c.updated_at || 0) * 1000
    if (c.pinned_at) by.Pinned.push(c)
    else if (at >= today) by.Today.push(c)
    else if (at >= today - DAY) by.Yesterday.push(c)
    else if (at >= today - 7 * DAY) by['Previous 7 days'].push(c)
    else if (at >= today - 30 * DAY) by['Previous 30 days'].push(c)
    else by.Older.push(c)
  }
  return buckets.filter(([, xs]) => xs.length).map(([label, items]) => ({ label, items }))
}

// "11:31 PM" today · "Yesterday" · "Mon" this week · "10/1/2026" before that.
export function whenShort(sec, now = Date.now()) {
  const ms = (sec || 0) * 1000
  const today = startOfDay(now)
  if (ms >= today) return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  if (ms >= today - DAY) return 'Yesterday'
  if (ms >= today - 6 * DAY) return new Date(ms).toLocaleDateString([], { weekday: 'short' })
  return new Date(ms).toLocaleDateString()
}

// Search hits grouped under their conversation, newest conversation first (hits keep their order).
export function groupHits(results) {
  const out = []
  const at = new Map()
  for (const h of results || []) {
    if (!at.has(h.conversation_id)) { at.set(h.conversation_id, out.length); out.push({ id: h.conversation_id, title: h.title, hits: [] }) }
    out[at.get(h.conversation_id)].hits.push(h)
  }
  return out
}
