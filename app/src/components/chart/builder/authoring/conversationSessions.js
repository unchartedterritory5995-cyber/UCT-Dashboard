// app/src/components/chart/builder/authoring/conversationSessions.js
//
// ─── SLICE 2 — A CONVERSATION OUTLIVES ITS PANEL, NOT ITS TAB ────────────────
//
// Closing the Create Indicator dock (or the formula sheet) must not throw away
// the conversation the member was just having. The smallest correct lifetime is
// IN MEMORY, PER BROWSER TAB: a module-level map of snapshots keyed by
// AUTHORING CONTEXT. A logout or a new tab starts clean; there is no
// server-side chat history.
//
// ⭐⭐ BATCH 1 — …AND A RELOAD OF THAT TAB DOES NOT LOSE IT. A writer that opts in
// (`{ persist: true }` — the Create Indicator studio) is MIRRORED into this tab's
// `sessionStorage`, the browser's own per-tab store: it survives a reload of the
// same tab and dies with it, exactly the lifetime the map already promised plus
// the reload. The map stays the authority while the page lives; the mirror is
// read only for a key the map does not hold (the first read after a reload).
//
// ⛔ THE MIRROR CAN NEVER BREAK AUTHORING. Every storage access is wrapped: a
// private window, a full quota, blocked site data or a corrupt entry reads as
// "nothing kept" and writes are dropped — the in-memory map works as before.
// What comes back is SHAPE-CHECKED here (`isRestorable`); whether it is still
// CURRENT (an edit's base version) is the caller's decision, because only the
// caller knows the stored row.
//
// ⛔ CONTEXT KEYS ARE OPAQUE. `create:<scope>` (a new definition, scoped to the
// chart that opened it), `edit:<def id>` (a stored definition — the store's own
// id) and `new:<scope>` (the sheet's new-formula context). Never a name, never
// formula text, never anything a member typed. Two contexts never share a key,
// so definition B can never be shown definition A's conversation.

// ⛔ NOT imported from `authoringState`: the toolbar loads this module eagerly and the
// authoring engine is lazy (the studio's own chunk). A test holds the two equal.
const STATE_CONTRACT = 'uct.authoring.state/1'

const MAX_SESSIONS = 24
const sessions = new Map()

/** The tab-scoped mirror. One key, versioned; most recent entry last. */
export const STORAGE_KEY = 'uct.authoring.drafts.v1'
const MAX_PERSISTED = 8
/** A draft older than this is not offered back (a tab left open overnight). */
export const PERSIST_TTL_MS = 12 * 60 * 60 * 1000
/** Characters, the whole mirror. Browsers allow ~5M; this stays well inside it. */
const MAX_PERSIST_CHARS = 1_500_000
/** Undo steps carried across a reload (the in-memory stack keeps its 50). */
export const PERSIST_HISTORY = 10

function hex(n) {
  const bytes = new Uint8Array(n)
  const c = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes)
  else for (let i = 0; i < n; i += 1) bytes[i] = Math.floor(Math.random() * 256)
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** An opaque scope for one chart's (or one sheet's) new-definition context. */
export const mintScope = () => `s_${hex(6)}`

/** ⭐ BATCH 1 — the scope of a chart that has a STABLE id (its workspace widget id):
 *  the same chart after a reload is the same context, so its create draft is found
 *  again. Hashed, so the key still carries nothing a member typed. */
export function chartScope(chartId) {
  if (typeof chartId !== 'string' && typeof chartId !== 'number') return null
  const s = String(chartId)
  if (!s) return null
  let h = 2166136261
  for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0 }
  return `c_${h.toString(16).padStart(8, '0')}`
}

export const createKey = (scope) => `create:${scope}`
export const editKey = (defId) => `edit:${defId}`
export const newKey = (scope) => `new:${scope}`

// ─── the mirror ──────────────────────────────────────────────────────────────

function storage() {
  try {
    const s = typeof window !== 'undefined' ? window.sessionStorage : undefined
    return s && typeof s.getItem === 'function' ? s : null
  } catch { return null }
}

function readMirror() {
  const s = storage()
  if (!s) return []
  try {
    const raw = s.getItem(STORAGE_KEY)
    if (!raw) return []
    const doc = JSON.parse(raw)
    return doc && doc.v === 1 && Array.isArray(doc.entries) ? doc.entries.filter((e) => Array.isArray(e) && typeof e[0] === 'string' && e[1]) : []
  } catch { return [] }
}

function writeMirror(entries) {
  const s = storage()
  if (!s) return false
  try {
    let list = entries.slice(-MAX_PERSISTED)
    let raw = JSON.stringify({ v: 1, entries: list })
    while (raw.length > MAX_PERSIST_CHARS && list.length > 1) {
      list = list.slice(1)
      raw = JSON.stringify({ v: 1, entries: list })
    }
    if (raw.length > MAX_PERSIST_CHARS) return false
    if (!list.length) s.removeItem(STORAGE_KEY)
    else s.setItem(STORAGE_KEY, raw)
    return true
  } catch { return false }
}

/** The snapshot as it is written: the undo stack trimmed to what a reload carries. */
function persistable(snapshot) {
  const st = snapshot && snapshot.state
  if (!st || !Array.isArray(st.history) || st.history.length <= PERSIST_HISTORY) return snapshot
  return { ...snapshot, state: { ...st, history: st.history.slice(-PERSIST_HISTORY) } }
}

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)

/**
 * Is a snapshot read back from storage something the studio can open? A SHAPE
 * check only — the working definition's validity (`validateUserDefinitions`) and
 * an edit's base version are checked by the caller, which owns those authorities.
 */
export function isRestorable(snapshot) {
  if (!isObj(snapshot)) return false
  const st = snapshot.state
  if (!isObj(st) || st.contract !== STATE_CONTRACT || typeof st.lineage !== 'string') return false
  if (!Number.isInteger(st.revision) || st.revision < 0) return false
  if (!(st.working === null || isObj(st.working))) return false
  if (!(st.base === null || st.base === undefined || isObj(st.base))) return false
  if (!Array.isArray(st.history) || !Array.isArray(st.assumptions) || !Array.isArray(st.questions)) return false
  if (!isObj(st.requests) || !isObj(st.source)) return false
  if (!Array.isArray(snapshot.transcript)) return false
  return snapshot.transcript.every((t) => isObj(t) && (t.role === 'member' || t.role === 'uct'))
}

function readPersisted(key) {
  const hit = readMirror().find((e) => e[0] === key)
  if (!hit) return null
  const { savedAt, snapshot } = hit[1]
  if (!Number.isFinite(savedAt) || Date.now() - savedAt > PERSIST_TTL_MS || !isRestorable(snapshot)) {
    forgetPersisted(key)
    return null
  }
  return { ...snapshot, recovered: true }
}

function forgetPersisted(key) {
  const entries = readMirror()
  if (entries.some((e) => e[0] === key)) writeMirror(entries.filter((e) => e[0] !== key))
}

// ─── the store ───────────────────────────────────────────────────────────────

/**
 * The kept snapshot for `key`, or null. While the page lives, the in-memory map
 * answers; for a key it does not hold, a persisted snapshot from before a reload
 * (shape-checked, not expired) comes back marked `recovered: true`.
 */
export function readSession(key) {
  if (!key) return null
  if (sessions.has(key)) return sessions.get(key)
  return readPersisted(key)
}

/**
 * ⭐ AGENT M1 — will opening the studio on `key` RESTORE a draft? The same rule
 * `useIndicatorConversation` applies at mount (a snapshot with a transcript or a working
 * definition; for an edit, the SAME definition opened from the version still stored),
 * minus its registry-validity drop — which only ever makes the answer "no draft"
 * later, so a seed is at worst withheld, never typed over a member's draft.
 * Read-only: it never clears or writes a session.
 * @param {string} key  `createKey(scope)` / `editKey(defId)`
 * @param {{defId: string, version: number}|null} open  the definition an edit opens, or null
 */
export function draftWillRestore(key, open = null) {
  const kept = readSession(key)
  if (!kept) return false
  const st = kept.state
  if (open && !(st && st.defId === open.defId && st.baseVersion === open.version)) return false
  return !!((kept.transcript && kept.transcript.length) || (st && st.working))
}

/** Store a snapshot (most recent last; the oldest beyond the cap is dropped).
 *  `persist` mirrors it into this tab's sessionStorage (best effort). */
export function writeSession(key, snapshot, { persist = false } = {}) {
  if (!key) return
  sessions.delete(key)
  sessions.set(key, snapshot)
  while (sessions.size > MAX_SESSIONS) sessions.delete(sessions.keys().next().value)
  if (persist) {
    const entries = readMirror().filter((e) => e[0] !== key)
    entries.push([key, { savedAt: Date.now(), snapshot: persistable(snapshot) }])
    writeMirror(entries)
  }
}

/** End a context: the map AND the mirror. */
export function clearSession(key) {
  if (!key) return
  sessions.delete(key)
  forgetPersisted(key)
}

/** ⭐ M3 — every key a conversation is kept under in this tab (the map and the unexpired
 *  mirror), most recently written last. Read-only. */
export function sessionKeys() {
  const out = [...sessions.keys()]
  for (const [key] of readMirror()) if (!out.includes(key) && readPersisted(key)) out.push(key)
  return out
}

// ─── ⭐ M3 (AGENT-M3-CONTRACT D6) — which drafts an OPEN Create Indicator dock holds ──────
//
// NOT a draft store: only "is a dock showing this key right now?". While it is, the dock
// owns the draft — UCT Agent's writes on it are refused (`draft-open-in-dock`) at call
// time, so two writers never race on one snapshot. In-memory: a reload closes every dock.
const dockHolds = new Map()
export function holdInDock(key) { if (key) dockHolds.set(key, (dockHolds.get(key) || 0) + 1) }
export function releaseDock(key) {
  if (!key || !dockHolds.has(key)) return
  const n = dockHolds.get(key) - 1
  if (n > 0) dockHolds.set(key, n); else dockHolds.delete(key)
}
export function isHeldInDock(key) { return !!key && dockHolds.has(key) }

/** Tests only — a page RELOAD: the in-memory map is gone, the tab's storage is not. */
export function _simulateReload() { sessions.clear(); dockHolds.clear() }

/** Tests only. */
export function _resetSessions() {
  sessions.clear()
  const s = storage()
  try { if (s) s.removeItem(STORAGE_KEY) } catch { /* ignore */ }
}
