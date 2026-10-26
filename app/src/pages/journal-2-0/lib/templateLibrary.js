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
import { isOffline } from './blocks/toolsApi'

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
  if (code) return { ok: false, code, message: message || LIBRARY_COPY.network }
  if (message) return { ok: false, code: 'invalid', message }
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

function post(url, raw) {
  const body = bodyOf(raw)
  if (body === null) return Promise.resolve(fail('network'))
  return call(() => fetch(url, { method: 'POST', credentials: 'include', headers: JSON_HEADERS, body }))
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

/** Preview with my data (W11-R12): each choice at its answer, its suggested value or Any. */
export function previewMine(galleryId, answers) {
  if (!isId(galleryId)) return Promise.resolve(fail('unavailable'))
  return post(`${GALLERY}/${enc(galleryId)}/preview-mine`, isRecord(answers) ? { answers } : {})
}

/** Adopt a listed widget, routine or tracker: `body` is `{answers?, notify?}`. */
export function adoptTool(galleryId, body = {}) {
  if (!isId(galleryId)) return Promise.resolve(fail('unavailable'))
  return post(`${GALLERY}/${enc(galleryId)}/adopt-tool`, body)
}

/** Use a listed template to make a note: `body` is `{answers?, choices?, ticker?, title?}`. */
export function useTemplate(galleryId, body = {}) {
  if (!isId(galleryId)) return Promise.resolve(fail('unavailable'))
  return post(`${GALLERY}/${enc(galleryId)}/use-template`, body)
}

/** Adopt a listed template as one of the member's own: `body` is `{notify?, answers?, choices?}`. */
export function adoptTemplate(galleryId, body = {}) {
  if (!isId(galleryId)) return Promise.resolve(fail('unavailable'))
  return post(`${GALLERY}/${enc(galleryId)}/adopt`, body)
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
