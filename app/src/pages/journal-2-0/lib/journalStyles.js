// Journal styles (Notebook P1): the client for api/routers/notebook_journal_styles.py, shapes pinned
// by the contract fixtures. Imported ONLY by lazy chunks and the hook (never on first open).
// ⛔ Two calls move a note's revision (update layout, the mapping offer); each LANDS what it moved
// with settleNoteWrite before returning (lib/offline/doorEnumeration.test.js).
//   · The PLAN is a GET on its own route (never the write's route) and a refused write (409 stale base)
//     moved nothing: neither settles. Both settles use the account that ASKED, read before the request.
//   · The write refuses to leave without its base revision: a compare-and-set with no base is a blind write.
//   · It imports settleNoteWrite, NEVER useDurableNote (importing that takes a Web Lock).
// Offline (spec P1.6): the list is cached in the offline DB's `meta` store and read back when the
// network fails. Creating offline is refused by the create door (NotebookTab), never queued.
//   · The cache belongs to the account that ASKED: the id is read when the request starts, so an
//     account switch while it is in flight cannot write one member's styles into another's store.
//   · "Offline" means the server never answered, or a deploy swap's proxy did (502/503/504, or
//     Cloudflare's 520-524). If the account changed meanwhile, the old account's cache is not served. A real
//     refusal (402 free plan, 404 gate off, 400, 500) is the server speaking and is never papered over.
import { settleNoteWrite, settleNoteWrites } from './offline/settleNoteWrite'
import { openNotebookDb, getMeta, putMeta, offlineStorageAvailable } from './offline/notebookDb'
import { offlineEnabled } from './offline/offlineFlag'
import { getCurrentAccountId } from './offline/currentAccount'

export const STYLES_URL = '/api/j2/journal-styles'
/** The server's cap on a style's name (journal_styles.MAX_STYLE_NAME_CHARS), pinned by
 *  tests/test_journal_styles_store.py. The one client copy: every name field and seed reads it. */
export const MAX_STYLE_NAME_CHARS = 80
export const STYLES_CACHE_KEY = 'journal-styles:v1'
const KINDS_URL = '/api/j2/note-kinds'
const NOTES_URL = '/api/j2/notes'
// A reverse proxy answering for a server that is mid-swap says nothing about the member's styles.
// (Cloudflare's 520-524 are the same statement from the edge.)
const PROXY_UNREACHABLE = new Set([502, 503, 504, 520, 521, 522, 523, 524])

async function call(url, { method = 'GET', body } = {}) {
  const res = await fetch(url, {
    method, credentials: 'include',
    ...(body !== undefined ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    const err = new Error(data.detail || `${res.status}`)
    err.status = res.status
    throw err
  }
  return res.json()
}

async function withDb(fn, accountId = getCurrentAccountId()) {
  if (!accountId || !offlineEnabled() || !offlineStorageAvailable()) return undefined
  let db
  try {
    db = await openNotebookDb(accountId)
    return await fn(db)
  } catch {
    return undefined
  } finally {
    try { db?.close() } catch { /* already closed */ }
  }
}

export const readCachedStyles = (accountId) => withDb((db) => getMeta(db, STYLES_CACHE_KEY), accountId)
const writeCachedStyles = (payload, accountId) => withDb((db) => putMeta(db, STYLES_CACHE_KEY, payload), accountId)

export async function fetchJournalStyles({ readCache = readCachedStyles } = {}) {
  const accountId = getCurrentAccountId()
  try {
    const data = await call(STYLES_URL)
    writeCachedStyles(data, accountId)             // best effort, off the read's critical path
    return data
  } catch (e) {
    if (e?.status && !PROXY_UNREACHABLE.has(e.status)) throw e       // the server answered: not "offline"
    // The member moved to another account while this was out: the cached list is the OLD account's.
    if (getCurrentAccountId() !== accountId) throw e
    const cached = await readCache(accountId)
    if (cached) return { ...cached, fromCache: true }
    throw e
  }
}

const enc = encodeURIComponent
export const getJournalStyle = (id) => call(`${STYLES_URL}/${enc(id)}`)
export const createJournalStyle = (body) => call(STYLES_URL, { method: 'POST', body })
export const updateJournalStyle = (id, patch) => call(`${STYLES_URL}/${enc(id)}`, { method: 'PUT', body: patch })
export const deleteJournalStyle = (id) => call(`${STYLES_URL}/${enc(id)}`, { method: 'DELETE' })
export const restoreJournalStyle = (id) => call(`${STYLES_URL}/${enc(id)}/restore`, { method: 'POST' })
export const setDefaultJournalStyle = (id) => call(`${STYLES_URL}/${enc(id)}/default`, { method: 'POST' })
export const previewJournalStyle = (body) => call(`${STYLES_URL}/preview`, { method: 'POST', body })
export const createKind = (body) => call(KINDS_URL, { method: 'POST', body })
export const updateKind = (id, patch) => call(`${KINDS_URL}/${enc(id)}`, { method: 'PUT', body: patch })
export const deleteKind = (id) => call(`${KINDS_URL}/${enc(id)}`, { method: 'DELETE' })
export const getMappingOffer = () => call(`${KINDS_URL}/mapping-offer`)

/** Writes `builtin:note_kind` on every note the member did not exclude. Each note it changed is landed. */
export async function applyMappingOffer(excludeNoteIds = []) {
  const accountId = getCurrentAccountId()
  const out = await call(`${KINDS_URL}/mapping-offer`, { method: 'POST', body: { excludeNoteIds } })
  // The batch idiom: one account for the whole batch, sequential inside (every settle read-modify-writes
  // the same landed ring).
  await settleNoteWrites(out.notes || [], accountId)
  return out
}

/** The preview behind "Update layout": a GET on its own route (the server's style-update-plan), so it
 *  can never be taken for the write; it writes nothing and settles nothing. */
export const planStyleUpdate = (noteId, { styleId } = {}) =>
  call(`${NOTES_URL}/${enc(noteId)}/style-update-plan${styleId ? `?styleId=${enc(styleId)}` : ''}`)

/** The one compare-and-set write. `baseUpdatedAt` (the revision the member is looking at) is REQUIRED:
 *  the server refuses a request without it (400), and a base that is not the note's current revision is a
 *  409 that writes nothing. Either refusal throws and moved nothing. */
export async function applyStyleUpdate(noteId, { styleId, baseUpdatedAt } = {}) {
  if (!baseUpdatedAt) throw new Error('applyStyleUpdate needs baseUpdatedAt, the revision the member is looking at')
  const accountId = getCurrentAccountId()
  const out = await call(`${NOTES_URL}/${enc(noteId)}/apply-style-update`, {
    method: 'POST', body: { ...(styleId ? { styleId } : {}), baseUpdatedAt },
  })
  await settleNoteWrite(out.note.id, out.note, accountId)
  return out
}

// P2b N9: a note can record its style with no version (an older note, a restore that predates the stamp).
// A version is a whole number from 1 up; anything else is unknown, and the copy says so in words.
export function knownStyleVersion(v) {
  if (typeof v !== 'number' && typeof v !== 'string') return null
  const n = Number(v)
  return Number.isInteger(n) && n >= 1 ? n : null
}

export const stylesOfKind = (payload, kindId) => (payload?.styles || []).filter((s) => s.kindId === kindId)
export const defaultStyleFor = (payload, kindId) => stylesOfKind(payload, kindId).find((s) => s.isDefault) || null
