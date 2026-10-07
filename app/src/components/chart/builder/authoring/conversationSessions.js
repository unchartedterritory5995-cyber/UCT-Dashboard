// app/src/components/chart/builder/authoring/conversationSessions.js
//
// ─── SLICE 2 — A CONVERSATION OUTLIVES ITS PANEL, NOT ITS TAB ────────────────
//
// Closing the Create Indicator dock (or the formula sheet) must not throw away
// the conversation the member was just having. The smallest correct lifetime is
// IN MEMORY, PER BROWSER TAB: a module-level map of snapshots keyed by
// AUTHORING CONTEXT. A reload, a logout or a new tab starts clean; there is no
// server-side chat history.
//
// ⛔ CONTEXT KEYS ARE OPAQUE. `create:<scope>` (a new definition, scoped to the
// chart that opened it), `edit:<def id>` (a stored definition — the store's own
// id) and `new:<scope>` (the sheet's new-formula context). Never a name, never
// formula text, never anything a member typed. Two contexts never share a key,
// so definition B can never be shown definition A's conversation.

const MAX_SESSIONS = 24
const sessions = new Map()

function hex(n) {
  const bytes = new Uint8Array(n)
  const c = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes)
  else for (let i = 0; i < n; i += 1) bytes[i] = Math.floor(Math.random() * 256)
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** An opaque scope for one chart's (or one sheet's) new-definition context. */
export const mintScope = () => `s_${hex(6)}`

export const createKey = (scope) => `create:${scope}`
export const editKey = (defId) => `edit:${defId}`
export const newKey = (scope) => `new:${scope}`

export function readSession(key) {
  if (!key) return null
  return sessions.get(key) || null
}

/** Store a snapshot (most recent last; the oldest beyond the cap is dropped). */
export function writeSession(key, snapshot) {
  if (!key) return
  sessions.delete(key)
  sessions.set(key, snapshot)
  while (sessions.size > MAX_SESSIONS) sessions.delete(sessions.keys().next().value)
}

export function clearSession(key) {
  if (key) sessions.delete(key)
}

/** Tests only. */
export function _resetSessions() { sessions.clear() }
