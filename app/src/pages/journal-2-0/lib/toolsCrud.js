// Notebook widgets phase 2, wave 9 (Task 9.16): the routine and tracker CRUD client.
//
// ⛔ LAZY. Only lazy code imports this file: the routine and tracker editors (components/notebook/routines/*, reached
// through the openers' dynamic imports), and later the tool picker and My tools. A static import from anything on the
// Notebook's first open would put it on that first open (the bytes gate; toolsCrud.lazy.test.js rails it).
//
// Server shapes (api/routers/notebook_routines.py, Task 9.6): `GET <base>?filter=` answers `{routines|trackers: [...]}`,
// `GET <base>/{id}` the tool, `POST <base>` creates, `PUT <base>/{id}` edits with `If-Match: <etag>` (R-15; a missing
// header is a 428 the client reads as a conflict, R-27), `POST <base>/{id}/archive|delete {typedName}|undelete|
// duplicate`, `GET <base>/{id}/used-in` answers `{notes}`, and the routines only: `GET /starters` `{starters}` and
// `GET /import-day-rules` `{labels}`. A refusal is `{detail: {code, message}}`; the server's sentence is shown as it came.
//
// Every function NEVER throws: `{ok: true, data}` or `{ok: false, code, message}`. Offline makes no request at all.
// A 404 on a READ is `unavailable` ("Not available right now.": the route or the dark wave), on a WRITE `missing`
// ("Not available.": the tool went away), as lib/blocks/toolsApi reads them. 402 is `paid`, 429 `rate`, anything
// unreadable `network`.
//
// ⛔ ONE restore write (ruling W9-R42): `unarchiveTool` is lib/blocks/toolsApi's `unarchive`, which also re-reads every
// placed block of the tool ON THIS PAGE (it broadcasts nothing: another tab catches up when it returns to the front,
// W9-R44). This file never fetches `/unarchive` itself.
// ⛔ ONE refresh path: after a save, an archive, a delete or an undelete lands, `toolEdited` (toolsApi, the same step
// `unarchive` runs) re-reads every placed block of that tool on this page, so a block shows its new name and items at
// once. Never a second mechanism here.
// ⛔ These writes land in the routine and tracker tables, NEVER a note. Each fetch names its method literally (the door
// rails read methods from the call site), with the kind choosing between two literal URLs.
import { TOOL_COPY, isOffline, toolEdited, unarchive } from './blocks/toolsApi'

export const CRUD_COPY = Object.freeze({
  offline: "You're offline. Try again when you're back online.",
  network: "That didn't go through. Try again.",
  paid: 'Routines and trackers require a paid plan', // the router's own 402 sentence (notebook_routines.require_paid)
  rate: 'Too many changes in a minute. Try again shortly.',
  conflict: 'Changed in another tab. Reload to see the newer version.',
})

const KINDS = new Set(['routine', 'tracker'])
const JSON_HEADERS = { 'Content-Type': 'application/json' }
const enc = (v) => encodeURIComponent(String(v))
const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

const offline = () => ({ ok: false, code: 'offline', message: CRUD_COPY.offline })
const network = () => ({ ok: false, code: 'network', message: CRUD_COPY.network })
const unknownKind = () => ({ ok: false, code: 'missing', message: TOOL_COPY.missing })

/** `{'If-Match': '<etag>'}` for an integer etag (or an all-digit string), else no header (the server's 428). */
function ifMatch(etag) {
  if (typeof etag === 'number' && Number.isInteger(etag)) return { 'If-Match': String(etag) }
  if (typeof etag === 'string' && /^\d+$/.test(etag.trim())) return { 'If-Match': etag.trim() }
  return {}
}

/** A refused answer as `{ok: false, code, message}`: the server's own code and sentence when it sent them. */
async function refusal(res, isRead) {
  let detail = null
  try { detail = (await res.json())?.detail } catch { detail = null }
  if (res.status === 402) return { ok: false, code: 'paid', message: CRUD_COPY.paid }
  if (res.status === 404) {
    return isRead ? { ok: false, code: 'unavailable', message: TOOL_COPY.flagOff } : { ok: false, code: 'missing', message: TOOL_COPY.missing }
  }
  const code = isRecord(detail) && typeof detail.code === 'string' && detail.code ? detail.code : null
  const message = isRecord(detail) && typeof detail.message === 'string' && detail.message.trim() ? detail.message.trim() : ''
  if (res.status === 428) return { ok: false, code: 'conflict', message: message || CRUD_COPY.conflict }
  if (res.status === 429) return { ok: false, code: 'rate', message: message || CRUD_COPY.rate }
  if (code === 'not_found') return { ok: false, code: 'missing', message: TOOL_COPY.missing }
  if (code) return { ok: false, code, message: message || (code === 'conflict' ? CRUD_COPY.conflict : CRUD_COPY.network) }
  return network()
}

/** Run one request (`send` returns the fetch promise) and read its answer; `pick` takes the data out of the body. */
async function call(kind, send, { isRead = false, pick = (d) => d } = {}) {
  if (!KINDS.has(kind)) return unknownKind()
  if (isOffline()) return offline()
  try {
    const res = await send()
    if (!res || typeof res.status !== 'number') return network()
    if (!res.ok) return await refusal(res, isRead)
    const body = await res.json()
    const data = isRecord(body) ? pick(body) : undefined
    return data === undefined ? network() : { ok: true, data }
  } catch {
    return network()
  }
}

const listOf = (key) => (body) => (Array.isArray(body[key]) ? body[key] : undefined)

// ── reads ─────────────────────────────────────────────────────────────────────────────────────────

/** The member's routines or trackers: `filter` is 'active' (default), 'archived' or 'deleted'. `data` is the list. */
export function listTools(kind, filter = 'active') {
  const f = enc(filter || 'active')
  return call(kind, () => (kind === 'routine'
    ? fetch(`/api/j2/routines?filter=${f}`, { method: 'GET', credentials: 'include' })
    : fetch(`/api/j2/trackers?filter=${f}`, { method: 'GET', credentials: 'include' })),
  { isRead: true, pick: listOf(kind === 'routine' ? 'routines' : 'trackers') })
}

/** One routine or tracker (its etag, items or kind, settings, archived, usedIn). */
export function getTool(kind, id) {
  return call(kind, () => (kind === 'routine'
    ? fetch(`/api/j2/routines/${enc(id)}`, { method: 'GET', credentials: 'include' })
    : fetch(`/api/j2/trackers/${enc(id)}`, { method: 'GET', credentials: 'include' })), { isRead: true })
}

/** The member's notes that place the tool: `data` is `[{noteId, title, updatedAt}]`, newest first. */
export function usedIn(kind, id) {
  return call(kind, () => (kind === 'routine'
    ? fetch(`/api/j2/routines/${enc(id)}/used-in`, { method: 'GET', credentials: 'include' })
    : fetch(`/api/j2/trackers/${enc(id)}/used-in`, { method: 'GET', credentials: 'include' })),
  { isRead: true, pick: listOf('notes') })
}

/** The ready-made routines: `data` is `[{key, name, items: [{text, negative, suggest}]}]`. */
export function starters() {
  return call('routine', () => fetch('/api/j2/routines/starters', { method: 'GET', credentials: 'include' }),
    { isRead: true, pick: listOf('starters') })
}

/** The labels of the member's newest day note's rules list: `data` is a list of strings (possibly empty). */
export function importDayRules() {
  return call('routine', () => fetch('/api/j2/routines/import-day-rules', { method: 'GET', credentials: 'include' }),
    { isRead: true, pick: listOf('labels') })
}

// ── writes ────────────────────────────────────────────────────────────────────────────────────────

/** JSON.stringify that answers null instead of throwing (a cyclic body is a refusal, never a throw). */
function bodyOf(body) {
  try { return JSON.stringify(body ?? {}) } catch { return null }
}

/** A new routine `{name, items, schedule, settings}` or tracker `{name, kind, unit?, settings}`. */
export function createTool(kind, body) {
  const payload = bodyOf(body)
  if (payload === null) return Promise.resolve(KINDS.has(kind) ? network() : unknownKind())
  return call(kind, () => (kind === 'routine'
    ? fetch('/api/j2/routines', { method: 'POST', credentials: 'include', headers: JSON_HEADERS, body: payload })
    : fetch('/api/j2/trackers', { method: 'POST', credentials: 'include', headers: JSON_HEADERS, body: payload })))
}

/** A write's answer, after which the tool's placed blocks on this page re-read (never awaited: the caller's answer
 *  does not wait on a block's read, and a refresh that fails changes nothing). */
async function landed(kind, id, pending) {
  const out = await pending
  if (out.ok) {
    try { Promise.resolve(toolEdited(kind, id)).catch(() => {}) } catch { /* a refresh never fails the write */ }
  }
  return out
}

/** Edit a tool, carrying `If-Match: <etag>` (R-15). A stale etag answers `conflict` and writes nothing. */
export function saveTool(kind, id, etag, body) {
  const payload = bodyOf(body)
  if (payload === null) return Promise.resolve(KINDS.has(kind) ? network() : unknownKind())
  const headers = { ...JSON_HEADERS, ...ifMatch(etag) }
  return landed(kind, id, call(kind, () => (kind === 'routine'
    ? fetch(`/api/j2/routines/${enc(id)}`, { method: 'PUT', credentials: 'include', headers, body: payload })
    : fetch(`/api/j2/trackers/${enc(id)}`, { method: 'PUT', credentials: 'include', headers, body: payload }))))
}

/** Archive: hidden from `/`, every placed block turns read-only, and all history is kept. */
export function archiveTool(kind, id) {
  return landed(kind, id, call(kind, () => (kind === 'routine'
    ? fetch(`/api/j2/routines/${enc(id)}/archive`, { method: 'POST', credentials: 'include' })
    : fetch(`/api/j2/trackers/${enc(id)}/archive`, { method: 'POST', credentials: 'include' }))))
}

/** Restore an archived tool. W9-R42: the block layer's one restore write, whose answer is the tool. */
export async function unarchiveTool(kind, id) {
  if (!KINDS.has(kind)) return unknownKind()
  try {
    const out = await unarchive(kind, id)
    if (out?.ok) return { ok: true, data: out.entry }
    // M-5: one offline sentence in the editor (the block layer's own says "Ticks save…", which is not a restore).
    if (out?.code === 'offline') return offline()
    return {
      ok: false,
      code: typeof out?.code === 'string' && out.code ? out.code : 'network',
      message: typeof out?.message === 'string' && out.message ? out.message : CRUD_COPY.network,
    }
  } catch {
    return network()
  }
}

/** Move an ARCHIVED tool to Recently deleted (30 days); the server checks the typed name again. */
export function deleteTool(kind, id, typedName) {
  const payload = bodyOf({ typedName: String(typedName ?? '') })
  return landed(kind, id, call(kind, () => (kind === 'routine'
    ? fetch(`/api/j2/routines/${enc(id)}/delete`, { method: 'POST', credentials: 'include', headers: JSON_HEADERS, body: payload })
    : fetch(`/api/j2/trackers/${enc(id)}/delete`, { method: 'POST', credentials: 'include', headers: JSON_HEADERS, body: payload }))))
}

/** Bring a recently deleted tool back (it comes back archived). */
export function undeleteTool(kind, id) {
  return landed(kind, id, call(kind, () => (kind === 'routine'
    ? fetch(`/api/j2/routines/${enc(id)}/undelete`, { method: 'POST', credentials: 'include' })
    : fetch(`/api/j2/trackers/${enc(id)}/undelete`, { method: 'POST', credentials: 'include' }))))
}

/** A new live copy, "<name> copy" (no history is copied). Refused at the count cap. */
export function duplicateTool(kind, id) {
  return call(kind, () => (kind === 'routine'
    ? fetch(`/api/j2/routines/${enc(id)}/duplicate`, { method: 'POST', credentials: 'include' })
    : fetch(`/api/j2/trackers/${enc(id)}/duplicate`, { method: 'POST', credentials: 'include' })))
}
