// Notebook widgets phase 2, wave 11 (Task 11.15): the template library client.
//
// Every wave 11 call to `api/routers/notebook_template_gallery.py` (Task 11.12) lives here: the share preview and the
// two publish doors, the Template library list, preview with my data, adopting a tool, using and adopting a template,
// taking a library update, and the 3rd-day Helpful prompt. Later tasks (11.16, 11.17, 11.19) ADD calls to this file
// (ruling W11-R16); none of them writes a second fetcher.
//
// ⛔ LAZY. Only lazy code imports this file (the share preview, the adoption sheet, the Template library section, the
// Templates tab, the prompt line's body). A static import from anything on the Notebook's first open would put it on
// that first open (the bytes gate).
//
// Every function NEVER throws: `{ok: true, data}` or `{ok: false, code, message}`. Offline makes no request at all
// (`code: 'offline'`). A 404 is `unavailable` ("Not available right now."): the route is dark (wave 11 off, the
// library switch off) or the item went away, and the member reads the same sentence either way. 402 is `paid`, 429
// `rate`; any other refusal is the server's own `{detail: {code, message}}` (W9-R14: the code comes from the error's
// class; this file never matches sentences). Anything unreadable is `network`.
// ⛔ These calls never write a note: each names its method literally and answers JSON.
// ⛔ Use and Adopt are KEYED (ruling W11-R34, F-FE-1 F2): `useTemplate`, `adoptTemplate` and `adoptTool` send an
//    `Idempotency-Key` from lib/idempotencyKeys (the Notebook's one generator and per-intent rule, never a second).
//    One key per deliberate press: a press whose earlier request has no settled answer (`answerSettled`: a lost
//    answer, offline, the server's 409 "already on its way", its own failure) is sent again under the SAME key, so the
//    server answers what the first one made instead of making a second note or copy; a settled answer ends the press.
//    The key is held per door and item for the page session, whatever the body (W11-R44, see `keyedPost`).
import { isOffline } from './blocks/toolsApi'
import { keyedSender } from './idempotencyKeys'

export const GALLERY = '/api/j2/template-gallery'

export const LIBRARY_COPY = Object.freeze({
  offline: "You're offline. Try again when you're back online.",
  unavailable: 'Not available right now.',
  network: "That didn't go through. Try again.",
  paid: 'The library requires a paid plan',
  rate: 'Too many tries in a short time. Try again shortly.',
})

/** The four kinds a member can share (W11-R1). */
export const SHARE_KINDS = Object.freeze(['widget', 'routine', 'tracker', 'template'])
const TOOL_KINDS = new Set(['widget', 'routine', 'tracker'])
const HELPFUL_ANSWERS = new Set(['yes', 'not_really', 'dismissed'])
const JSON_HEADERS = { 'Content-Type': 'application/json' }

const enc = (v) => encodeURIComponent(String(v))
const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const isId = (v) => (typeof v === 'string' && v.trim() !== '') || (typeof v === 'number' && Number.isFinite(v))

const fail = (code) => ({ ok: false, code, message: LIBRARY_COPY[code] })

/** A refused answer: the server's own code and sentence when it sent them. */
async function refusal(res) {
  let detail = null
  try { detail = (await res.json())?.detail } catch { detail = null }
  if (res.status === 404) return fail('unavailable')
  if (res.status === 402) return fail('paid')
  const code = isRecord(detail) && typeof detail.code === 'string' && detail.code ? detail.code : null
  const message = isRecord(detail) && typeof detail.message === 'string' && detail.message.trim() ? detail.message.trim() : ''
  if (res.status === 429) return { ok: false, code: 'rate', message: message || LIBRARY_COPY.rate }
  // Ruling W11-R24 (Task 11.16): a refusal may name the choice it is about (`slot`); the adoption sheet shows it at
  // that choice's row. Kept only as a non-empty string; anything else is no slot (the sentence stands at the top).
  const slot = isRecord(detail) && typeof detail.slot === 'string' && detail.slot.trim() ? detail.slot.trim() : null
  const at = slot ? { slot } : {}
  if (code) return { ok: false, code, message: message || LIBRARY_COPY.network, ...at }
  if (message) return { ok: false, code: 'invalid', message, ...at }
  // The journal-styles router (Task 11.19's Templates tab) refuses with a plain-sentence `detail` at 400/409 (its `_bad`):
  // the server's words. Any other status's string (a 401 "Not authenticated", a 422 developer string) is never shown.
  if ((res.status === 400 || res.status === 409) && typeof detail === 'string' && detail.trim()) return { ok: false, code: 'invalid', message: detail.trim() }
  return fail('network')
}

/** Run one request (`send` returns the fetch promise) and read its answer. Total: never throws. */
async function call(send) {
  if (isOffline()) return fail('offline')
  try {
    const res = await send()
    if (!res || typeof res.status !== 'number') return fail('network')
    if (!res.ok) return await refusal(res)
    const body = await res.json()
    return isRecord(body) ? { ok: true, data: body } : fail('network')
  } catch {
    return fail('network')
  }
}

/** A JSON body for a POST: a plain object, or `{}` (a caller's junk never reaches the wire as something else). */
function bodyOf(raw) {
  try {
    return JSON.stringify(isRecord(raw) ? raw : {})
  } catch {
    return null
  }
}

function post(url, raw, extraHeaders = null) {
  const body = bodyOf(raw)
  if (body === null) return Promise.resolve(fail('network'))
  const headers = extraHeaders ? { ...JSON_HEADERS, ...extraHeaders } : JSON_HEADERS
  return call(() => fetch(url, { method: 'POST', credentials: 'include', headers, body }))
}

/**
 * Whether an answer to a keyed Use or Adopt settled what happened (W11-R34): it was made (`ok`), or the server refused
 * it for good. Unsettled, so the next press resends the SAME key: nothing came back (`network`, which is also a bare
 * 5xx), nothing was sent (`offline`), the server's own failure (`server`, `busy`), or `conflict`, which is how the
 * server answers a twin request still in flight ("That is already on its way. Try again in a moment.",
 * `template_gallery.S_KEY_IN_FLIGHT`). Every other code settles, `too_long` included (the run was refused before it
 * wrote), and so do `key_reused` (the key sent for another item or door, a definite refusal, A9; it cannot come from
 * here, because a key is held per door and item, the pair the server compares) and `listing_moved` (the listing
 * changed twice under the press and nothing was made, W11-R60). All of this is railed against the server's source
 * (templateLibrary.server.test.js).
 */
const UNSETTLED = new Set(['network', 'offline', 'server', 'busy', 'conflict'])
export const answerSettled = (got) => !!got && (got.ok === true || !UNSETTLED.has(got.code))

const sendKeyed = keyedSender({ confirmed: answerSettled })

/**
 * A keyed POST. Ruling W11-R44: the press is `<door>:<item>` ALONE, held in this module for the page session (never
 * browser storage), so it survives closing and reopening the sheet. While no clear answer has come its key is resent
 * even when the body changed: a reopened sheet re-asks the preview, and after a lost Use its reuse question can now
 * read "Use your <routine>", a new body that must not mint a new key and let the server make a second note (the
 * server replays the first answer for a known key, whatever the body). A clear answer ends the press.
 * The member: the server scopes every key to the session's member (`_key_lookup ... WHERE user_id = ?`), so a key
 * still held when another member signs in on this page is, for them, an unused key and a plain first request.
 */
function keyedPost(door, galleryId, raw) {
  if (bodyOf(raw) === null) return Promise.resolve(fail('network'))
  return sendKeyed(`${door}:${String(galleryId)}`, null,
    (key) => post(`${GALLERY}/${enc(galleryId)}/${door}`, raw, { 'Idempotency-Key': key }))
}

const keepList = (keep) => (Array.isArray(keep) ? keep.filter((k) => typeof k === 'string' && k) : [])

// ── sharing ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The server's answer for what a share would send: `{travels, slots, kept, notShared, prefill}` (Task 11.8's
 * `template_gallery.share_preview`). Nothing is written. `edits` are only what the author typed in the share preview;
 * `keep` the paths of the numbers they chose to share (W11-R6).
 */
export function sharePreview(kind, id, opts) {
  const { edits, keep } = isRecord(opts) ? opts : {}
  if (!SHARE_KINDS.includes(kind) || !isId(id)) return Promise.resolve(fail('unavailable'))
  const body = { kind, id }
  if (isRecord(edits)) body.edits = edits
  body.keep = keepList(keep)
  return post(`${GALLERY}/share/preview`, body)
}

/** Send a widget, routine or tracker for review: `body` is `{title, description?, edits, keep?}`. */
export function publishTool(kind, id, body = {}) {
  if (!TOOL_KINDS.has(kind) || !isId(id)) return Promise.resolve(fail('unavailable'))
  const b = isRecord(body) ? body : {}
  return post(`${GALLERY}/tools`, { ...b, kind, id, keep: keepList(b.keep) })
}

/** Send a template (one of the member's styles) for review: `body` is the style share's own fields
 *  (`title, description?, category, tradingStyle?`) plus `edits` and `keep`. */
export function publishTemplate(styleId, body = {}) {
  if (!isId(styleId)) return Promise.resolve(fail('unavailable'))
  const b = isRecord(body) ? body : {}
  return post(`${GALLERY}/styles`, { ...b, styleId, keep: keepList(b.keep) })
}

// ── the library ───────────────────────────────────────────────────────────────────────────────────

/** The official templates, by group (`group` optional). */
export function libraryList(group) {
  const q = typeof group === 'string' && group ? `?group=${enc(group)}` : ''
  return call(() => fetch(`${GALLERY}/library${q}`, { method: 'GET', credentials: 'include' }))
}

/**
 * The official templates' groups, in the server's order and words (`template_library.GROUPS`, Task 11.10). The
 * Template library section draws one row per group in THIS order (Task 11.16); a listed row names its group by key.
 * ⛔ One fact in two files, PINNED: TemplateLibrarySection.test.jsx parses the server's tuple from
 *    template_library.py and asserts this list equals it, key for key and word for word (merge step M4).
 */
export const LIBRARY_GROUPS = Object.freeze([
  Object.freeze({ key: 'night_before', label: 'The night before' }),
  Object.freeze({ key: 'before_open', label: 'Before the open' }),
  Object.freeze({ key: 'during_day', label: 'During the day' }),
  Object.freeze({ key: 'after_close', label: 'After the close' }),
  Object.freeze({ key: 'weekly_monthly', label: 'Weekly / monthly' }),
  Object.freeze({ key: 'playbook', label: 'Playbook' }),
  Object.freeze({ key: 'mindset', label: 'Mindset' }),
  Object.freeze({ key: 'challenges', label: 'Challenges' }),
  Object.freeze({ key: 'habits', label: 'Habits' }),
])

/**
 * Task 11.16 fix round 1 (review I-1): the template picker's category chips are its FAMILIES keys
 * (lib/notebookTemplates.js), and a listed template carries one of the gallery's CATEGORIES
 * (`template_gallery.CATEGORIES`, lib/templateGallery.js GALLERY_CATEGORIES). No existing module relates the two, so
 * this is the ONE mapping: a family chip keeps the Template library rows whose category is in its list.
 *   * rituals ("Daily & weekly rituals") -> journal, review: the daily journal and the weekly review;
 *   * research ("Thesis & research") -> research;
 *   * trades ("Around a trade") -> trade_plan;
 *   * mind ("Mindset") -> no category; it keeps the library's own Mindset GROUP (FAMILY_GROUPS below).
 * Merge step M3: mind used to map to journal, so two chips shared one category, and the official seed
 * (template_library_seed.json, Task 11.10) holds no journal row at all: the Mindset chip reached no official template.
 * A mindset template is a research or review row by category, so the chip that names it is matched by GROUP.
 * ⛔ Railed by TemplateLibrarySection.test.jsx: its keys are exactly FAMILIES' keys, every category it names is in
 *    the server's CATEGORIES tuple (parsed from template_gallery.py, never retyped), every server category is
 *    reached by exactly ONE chip, and every chip keeps at least one row of the shipped seed (parsed, never retyped).
 */
export const FAMILY_CATEGORIES = Object.freeze({
  rituals: Object.freeze(['journal', 'review']),
  research: Object.freeze(['research']),
  trades: Object.freeze(['trade_plan']),
  mind: Object.freeze([]),
})

/**
 * Merge step M3: a family chip may also keep the library rows of named GROUPS (`template_library.GROUPS` keys, the
 * LIBRARY_GROUPS above). A row passes a chip when its category OR its group is the chip's.
 */
export const FAMILY_GROUPS = Object.freeze({
  mind: Object.freeze(['mindset']),
})

/** Does a library row pass a family chip (a FAMILIES key)? Its category or its group is the chip's. */
export function familyKeeps(family, row) {
  const cats = Object.hasOwn(FAMILY_CATEGORIES, family) ? FAMILY_CATEGORIES[family] : []
  const groups = Object.hasOwn(FAMILY_GROUPS, family) ? FAMILY_GROUPS[family] : []
  return cats.includes(row?.category) || groups.includes(row?.group)
}

/** Preview with my data (W11-R12): each choice at its answer, its suggested value or Any. */
export function previewMine(galleryId, answers) {
  if (!isId(galleryId)) return Promise.resolve(fail('unavailable'))
  return post(`${GALLERY}/${enc(galleryId)}/preview-mine`, isRecord(answers) ? { answers } : {})
}

/** Adopt a listed widget, routine or tracker: `body` is `{answers?, notify?}`. */
export function adoptTool(galleryId, body = {}) {
  if (!isId(galleryId)) return Promise.resolve(fail('unavailable'))
  return keyedPost('adopt-tool', galleryId, body)
}

/** Use a listed template to make a note: `body` is `{answers?, choices?, ticker?, title?}`. */
export function useTemplate(galleryId, body = {}) {
  if (!isId(galleryId)) return Promise.resolve(fail('unavailable'))
  return keyedPost('use-template', galleryId, body)
}

/** Adopt a listed template as one of the member's own: `body` is `{notify?, answers?, choices?}`. */
export function adoptTemplate(galleryId, body = {}) {
  if (!isId(galleryId)) return Promise.resolve(fail('unavailable'))
  return keyedPost('adopt', galleryId, body)
}

/** Take the listed version of an adopted widget, routine or tracker: `body` is `{answers?}`. */
export function updateTool(kind, copyId, body = {}) {
  if (!TOOL_KINDS.has(kind) || !isId(copyId)) return Promise.resolve(fail('unavailable'))
  return post(`${GALLERY}/tools/updates/${enc(kind)}/${enc(copyId)}`, body)
}

// ── the 3rd-day prompt ────────────────────────────────────────────────────────────────────────────

/** Whether a note shows the one-time Helpful prompt (W11-R9). */
export function helpfulPrompt(noteId) {
  if (!isId(noteId)) return Promise.resolve(fail('unavailable'))
  return call(() => fetch(`${GALLERY}/notes/${enc(noteId)}/helpful-prompt`, { method: 'GET', credentials: 'include' }))
}

/** The prompt's answer: 'yes' (also marks Helpful), 'not_really' or 'dismissed'. */
export function answerHelpfulPrompt(galleryId, answer) {
  if (!isId(galleryId) || !HELPFUL_ANSWERS.has(answer)) return Promise.resolve(fail('unavailable'))
  return post(`${GALLERY}/${enc(galleryId)}/helpful-prompt`, { answer })
}

// ── My tools' Templates tab (Task 11.19) ──────────────────────────────────────────────────────────
// The member's own templates are their journal styles (ruling W11-R10), read and written through the journal-styles
// router's wave 11 routes (Task 11.12 over Task 11.13's store). Same answers as every call above: `{ok, data}` or
// `{ok: false, code, message}`, never a throw; a 404 is `unavailable` (wave 11 off, or the template went away).

export const STYLES = '/api/j2/journal-styles'
/** The Templates tab's three lists, keyed by the router's `?view=`. */
export const TEMPLATE_VIEWS = Object.freeze(['live', 'archived', 'deleted'])

function put(url, raw) {
  const body = bodyOf(raw)
  if (body === null) return Promise.resolve(fail('network'))
  return call(() => fetch(url, { method: 'PUT', credentials: 'include', headers: JSON_HEADERS, body }))
}
const styleUrl = (id, tail = '') => `${STYLES}/${enc(id)}${tail}`

/** One of the three lists: `{kinds, styles}` (each style with `usedIn`, `credit`, `fromLibrary`, Task 11.13). */
export function listTemplates(view) {
  if (!TEMPLATE_VIEWS.includes(view)) return Promise.resolve(fail('unavailable'))
  return call(() => fetch(`${STYLES}?view=${view}`, { method: 'GET', credentials: 'include' }))
}

/** One template, whole (its outline too): `{style}`. */
export function getTemplate(id) {
  if (!isId(id)) return Promise.resolve(fail('unavailable'))
  return call(() => fetch(styleUrl(id), { method: 'GET', credentials: 'include' }))
}

/** Rename: the name only (`PUT /journal-styles/{id}` is a patch). */
export function renameTemplate(id, name) {
  if (!isId(id) || typeof name !== 'string' || !name.trim()) return Promise.resolve(fail('unavailable'))
  return put(styleUrl(id), { name: name.trim() })
}

export function duplicateTemplate(id) {
  if (!isId(id)) return Promise.resolve(fail('unavailable'))
  return post(styleUrl(id, '/duplicate'), {})
}

export function archiveTemplate(id) {
  if (!isId(id)) return Promise.resolve(fail('unavailable'))
  return post(styleUrl(id, '/archive'), {})
}

/** Restore from Archived. */
export function unarchiveTemplate(id) {
  if (!isId(id)) return Promise.resolve(fail('unavailable'))
  return post(styleUrl(id, '/unarchive'), {})
}

/** "Delete permanently": only an archived template, with its name typed (the server checks both again). */
export function deleteTemplate(id, typedName) {
  if (!isId(id) || typeof typedName !== 'string') return Promise.resolve(fail('unavailable'))
  return post(styleUrl(id, '/delete'), { typedName })
}

/** Restore from Recently deleted (the existing restore route; refused after 30 days with the server's sentence). */
export function restoreTemplate(id) {
  if (!isId(id)) return Promise.resolve(fail('unavailable'))
  return post(styleUrl(id, '/restore'), {})
}

/** The member's live notes made with this template: `{notes: [{id, title, updatedAt}]}`. */
export function templateUsedIn(id) {
  if (!isId(id)) return Promise.resolve(fail('unavailable'))
  return call(() => fetch(styleUrl(id, '/used-in'), { method: 'GET', credentials: 'include' }))
}
