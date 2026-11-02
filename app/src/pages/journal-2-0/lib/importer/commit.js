/**
 * Journal 2.0 — Notebook import: commit pipeline.
 * Spec: docs/superpowers/specs/2026-08-11-notebook-import-design.md
 *
 * Three exports:
 *  - checkExisting(docs)  -> POST /api/j2/notes/import/check
 *    ({existing, checked, total, truncated}) — `truncated` is only ever true
 *    past the server's own resource cap (tens of thousands of keys in one
 *    request); below it every key in `docs` is checked, in full (audit B1:
 *    this used to silently cap at 5,000 with no signal at all, so a
 *    >5,000-note library's tail came back "not existing" and duplicated on
 *    re-import instead of updating).
 *  - rewriteBody(bodyJson, {mediaUrls, mediaResults, idByKey}) -> {body, droppedMedia, notices, keptLinks}, PURE
 *  - runImport({source, destFolderId, docs, onProgress}) -> summary
 */

const REF_PREFIX = 'import-ref://'
const LINK_PREFIX = 'import-link://'

// ---------------------------------------------------------------------------
// checkExisting
// ---------------------------------------------------------------------------

import { settleNoteWrite, settleNoteWrites } from '../offline/settleNoteWrite'
import { notebookSchemaHeaders } from '../notebookSchema'
import { noteKeyFor } from './uctJson'
import { planConfirmBatches, confirmBody, noteTooLargeSentence } from './confirmBatches'
import { importNoticeNode, NOTICE_REASONS, nameOrNull, reasonForUploadFailure } from './importNotice'
import { readSuccessBody, failureDetail } from '../../../../lib/responseBody'

/**
 * @param {Array<{importKey: string}>} docs
 * @returns {Promise<{existing: Record<string, {id: string, updatedAt: string, importHash: string}>, checked: number, total: number, truncated: boolean}>}
 */
export async function checkExisting(docs) {
  const importKeys = docs.map((d) => d.importKey)
  const res = await fetch('/api/j2/notes/import/check', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ importKeys }),
  })
  if (!res.ok) throw new Error(`Failed to check existing notes (HTTP ${res.status})`)
  return res.json()
}

// ---------------------------------------------------------------------------
// rewriteBody — pure deep-walk of a TipTap doc
// ---------------------------------------------------------------------------

/**
 * Resolves the import-time placeholder refs/links a converted doc's bodyJson
 * carries into their real, post-confirm values:
 *  - `mediaResults[ref]` is `{ok:true, src, kind, name, original?}` or
 *    `{ok:false, reason, name, sourceUrl}`; the legacy `mediaUrls[ref]` string
 *    still means "stored, as the node's own kind".
 *  - image nodes (`attrs.src === 'import-ref://<ref>'`): stored as `image` ->
 *    `src` swapped; stored as `file` (an SVG, say) -> an `attachmentChip`;
 *    a returned `original` (a HEIC's) -> a chip for it right after the image.
 *  - attachmentChip nodes: `href` swapped, `name` taken from the result.
 *  - not stored, or no entry at all -> an `importNotice` IN THE SAME POSITION
 *    (`./importNotice.js`; reason `missing_resource` when there was no result).
 *    The ref goes into `droppedMedia` and `{ref, reason, name, sourceUrl}` into
 *    `notices`. Nothing is dropped in silence (Plan B Task 4). A widgetEmbed's
 *    unstored archived picture places no notice (the widget stays) but is still
 *    recorded in both lists, so their counts always match.
 *  - link marks: `attrs.href === 'import-link://<targetKey>'` -> resolved via
 *    `idByKey[targetKey]` to `/journal?j2tab=notebook&note=<id>`. Unresolved
 *    -> the mark is KEPT unchanged (the editor renders it as plain text) and
 *    `{key, text}` goes into `keptLinks`, so the heal door can fix it later.
 *
 * Deep-walks the whole tree (tables, lists, nested blocks — anywhere a media
 * node or a marked text run can live; one node can become two), and never
 * mutates its input.
 *
 * @param {object} bodyJson
 * @param {{mediaUrls?: Record<string,string>, mediaResults?: Record<string,object>, idByKey?: Record<string,string>}} opts
 * @returns {{body: object, droppedMedia: string[], notices: Array<{ref: string, reason: string, name: string|null, sourceUrl: string|null}>, keptLinks: Array<{key: string, text: string}>}}
 */
export function rewriteBody(bodyJson, { mediaUrls = {}, mediaResults = {}, idByKey = {} } = {}) {
  const droppedMedia = []
  const notices = []
  const keptLinks = []

  function refFromPlaceholder(value) {
    if (typeof value !== 'string' || !value.startsWith(REF_PREFIX)) return null
    return value.slice(REF_PREFIX.length)
  }

  // `mediaResults[ref]` wins; a legacy `mediaUrls[ref]` string means "stored, as the node's own
  // kind" (`kind: null` = keep the node type). No entry at all -> undefined (a notice).
  function resultFor(ref) {
    const r = Object.prototype.hasOwnProperty.call(mediaResults, ref) ? mediaResults[ref] : undefined
    if (r && typeof r === 'object') return r
    const url = Object.prototype.hasOwnProperty.call(mediaUrls, ref) ? mediaUrls[ref] : null
    return typeof url === 'string' && url ? { ok: true, src: url, kind: null } : undefined
  }

  const stored = (r) => r && r.ok === true && typeof r.src === 'string' && r.src !== ''

  // The notice for a ref that was not stored, recorded in `droppedMedia` and `notices` (one row
  // per placeholder occurrence). A blank server name falls back to the node's own alt/title.
  function noticeNodeFor(ref, result, nodeName) {
    const failed = result && result.ok === false ? result : null
    const node = importNoticeNode({
      reason: failed?.reason ?? NOTICE_REASONS.missingResource,
      name: nameOrNull(failed?.name) ?? nameOrNull(nodeName),
      sourceUrl: failed?.sourceUrl ?? null,
      ref,
    })
    droppedMedia.push(ref)
    const { reason, name, sourceUrl } = node.attrs
    notices.push({ ref, reason, name, sourceUrl })
    return node
  }
  const noticeFor = (ref, result, nodeName) => [noticeNodeFor(ref, result, nodeName)]

  const chipNode = (href, name) => ({ type: 'attachmentChip', attrs: { href, name: typeof name === 'string' && name ? name : 'file' } })

  function textOf(node) {
    return typeof node?.text === 'string' ? node.text : ''
  }

  // The kept link the previous text run carried. A link split across adjacent runs (a bold word
  // inside it) is ONE kept link with its joined text; any other node in between ends it.
  let streak = null

  function keepLink(key, owner) {
    if (owner?.type === 'text' && streak && streak.key === key) {
      streak.text += textOf(owner)
      return
    }
    const entry = { key, text: textOf(owner) }
    keptLinks.push(entry)
    streak = owner?.type === 'text' ? entry : null
  }

  function rewriteMarks(marks, owner) {
    const out = []
    let kept = false
    for (const mark of marks) {
      if (mark.type === 'link' && typeof mark.attrs?.href === 'string' && mark.attrs.href.startsWith(LINK_PREFIX)) {
        const targetKey = mark.attrs.href.slice(LINK_PREFIX.length)
        const noteId = idByKey[targetKey]
        if (noteId) {
          out.push({ ...mark, attrs: { ...mark.attrs, href: `/journal?j2tab=notebook&note=${noteId}` } })
        } else {
          // Unresolved -> the mark is KEPT, unchanged: the editor renders an `import-link://`
          // as plain text, and the server's heal door (Task 5) can still point it at the note
          // once that note exists. Stripping it would lose the target for good.
          out.push(mark)
          keepLink(targetKey, owner)
          kept = true
        }
        continue
      }
      out.push(mark)
    }
    if (!kept) streak = null
    return out
  }

  // Returns the ARRAY of nodes this node becomes in its parent's content: one node usually,
  // two for an image with a kept original. Never empty for a media placeholder: a failure
  // becomes an importNotice in the same position.
  function walk(node) {
    if (!node || typeof node !== 'object') return [node]
    if (node.type !== 'text' || !Array.isArray(node.marks)) streak = null

    if (node.type === 'image') {
      const ref = refFromPlaceholder(node.attrs?.src)
      if (ref === null) return [node]
      const result = resultFor(ref)
      if (!stored(result)) return noticeFor(ref, result, node.attrs?.alt || node.attrs?.title || null)
      // The server decides what it stored: `kind: "file"` (an SVG, say) is a chip, never an
      // <img> of a stored file.
      const out = result.kind === 'file'
        ? [chipNode(result.src, result.name)]
        : [{ ...node, attrs: { ...node.attrs, src: result.src } }]
      const original = result.original
      if (original && typeof original === 'object' && typeof original.src === 'string' && original.src) {
        out.push(chipNode(original.src, original.name))
      }
      return out
    }

    if (node.type === 'attachmentChip') {
      const ref = refFromPlaceholder(node.attrs?.href)
      if (ref === null) return [node]
      const result = resultFor(ref)
      if (!stored(result)) return noticeFor(ref, result, node.attrs?.name || null)
      const attrs = { ...node.attrs, href: result.src }
      if (typeof result.name === 'string' && result.name) attrs.name = result.name
      return [{ ...node, attrs }]
    }

    // Wave 8 lane 8C — two shapes only our own JSON export carries (`uctJson.js`):
    //  · a chart/widget's ARCHIVED image (`attrs.fallback.url`). Unresolved, the widget
    //    stays and only its archived picture is let go — the widget is still the widget.
    //  · a note link whose target came in with this same import: re-pointed from the
    //    note's ORIGINAL id (its import key is `uct:<id>`) to its new one. A target that
    //    did not come in is left exactly as it is.
    if (node.type === 'widgetEmbed' && node.attrs?.fallback && typeof node.attrs.fallback === 'object') {
      const ref = refFromPlaceholder(node.attrs.fallback.url)
      if (ref !== null) {
        const result = resultFor(ref)
        const url = stored(result) ? result.src : null
        // Not placed (the widget is still the widget), but RECORDED: `notices` and
        // `droppedMedia` count the same refs, so the summary names the lost picture too.
        if (url == null) noticeNodeFor(ref, result, null)
        return [{ ...node, attrs: { ...node.attrs, fallback: url == null ? null : { ...node.attrs.fallback, url } } }]
      }
    }
    if (node.type === 'noteLink' && typeof node.attrs?.noteId === 'string') {
      const newId = idByKey[noteKeyFor(node.attrs.noteId)]
      if (newId) return [{ ...node, attrs: { ...node.attrs, noteId: newId } }]
      return [node]
    }

    const next = { ...node }
    if (Array.isArray(node.marks)) next.marks = rewriteMarks(node.marks, node)
    if (Array.isArray(node.content)) next.content = node.content.flatMap(walk)
    return [next]
  }

  const [body] = walk(bodyJson)
  return { body, droppedMedia, notices, keptLinks }
}

// ---------------------------------------------------------------------------
// runImport
// ---------------------------------------------------------------------------

function toConfirmPayload(doc) {
  return {
    importKey: doc.importKey,
    title: doc.title,
    subtitle: doc.subtitle,
    bodyJson: doc.bodyJson,
    tags: doc.tags || [],
    ticker: doc.ticker,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    folderPath: doc.folderPath || [],
  }
}

// A 429 from a door is "busy", never a refusal (handoff H4): the upload doors answer it at 2
// in flight per member and 4 per pod, the fetch door at 2 per member, the heal door past
// 30/min. It is retried BUSY_RETRIES times with exponential backoff plus jitter
// (0.5 s, 1 s, 2 s, + up to 250 ms), or after the server's own `Retry-After` when it sends one,
// capped at BUSY_MAX_DELAY_MS. Past that the 429 is returned like any other final answer, and
// the caller names it (`upload_failed` / `fetch_failed` / the heal fallback): never a silent drop.
export const BUSY_RETRIES = 3
const BUSY_BASE_MS = 500
const BUSY_JITTER_MS = 250
const BUSY_MAX_DELAY_MS = 10_000

const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** The server's `Retry-After` in ms (delta-seconds or an HTTP date), or null. */
function retryAfterMs(res) {
  const raw = res.headers?.get?.('Retry-After')
  if (typeof raw !== 'string' || !raw.trim()) return null
  const secs = Number(raw.trim())
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000)
  const at = Date.parse(raw)
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : null
}

/**
 * POSTs with up to 2 retries (3 attempts total) on EITHER a 5xx response OR a
 * thrown network error (fetch rejecting outright — offline, DNS, aborted), and
 * up to BUSY_RETRIES more on a 429 (above), each after a delay.
 * Any other response (2xx, a 4xx, or a 5xx/429 with retries exhausted) is
 * returned as-is for the caller to inspect; a network error that's still
 * failing on the last attempt is re-thrown.
 *
 * `retry` exists for tests (`{sleep, random}`); the wizard passes none.
 */
async function fetchWithRetry(url, opts, retry = {}, maxRetries = 2) {
  const sleep = retry.sleep || realSleep
  const random = retry.random || Math.random
  let failures = 0
  let busy = 0
  for (;;) {
    let res
    try {
      res = await fetch(url, opts)
    } catch (err) {
      if (failures >= maxRetries) throw err
      failures += 1
      continue
    }
    if (res.status === 429 && busy < BUSY_RETRIES) {
      const told = retryAfterMs(res)
      const delay = told ?? BUSY_BASE_MS * 2 ** busy + Math.floor(random() * BUSY_JITTER_MS)
      busy += 1
      await sleep(Math.min(delay, BUSY_MAX_DELAY_MS))
      continue
    }
    if (res.status >= 500 && failures < maxRetries) {
      failures += 1
      continue
    }
    return res
  }
}

// ⛔ I-1: THE SERVER SNIFFS THE BYTES AND IS THE AUTHORITY on what a file is (A1: an SVG comes
// back `kind: "file"`, a HEIC comes back a JPEG plus its kept original). What the client sends
// is a DECLARATION: the MIME the source itself carried (an Evernote `<mime>`, a data: URI's
// type) wins, and the extension table below is only a hint for a file that declared nothing.
// A part with no type at all would go as `application/octet-stream`, which tells the server
// nothing it can use.
const MIME_BY_EXT = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  avif: 'image/avif',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  txt: 'text/plain',
  csv: 'text/csv',
  md: 'text/markdown',
  zip: 'application/zip',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  // Real xlsx MIME is "...spreadsheetml.sheet", not "...document" (that was
  // a copy-paste typo off the docx entry above). The server now accepts
  // both, but send the correct one.
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

function extOf(name) {
  if (typeof name !== 'string') return ''
  const base = name.split('/').pop() || ''
  const idx = base.lastIndexOf('.')
  return idx === -1 ? '' : base.slice(idx + 1).toLowerCase()
}

/**
 * The MIME a media item is uploaded as: its declared `mime` (parameters stripped, trimmed,
 * lowercased), else the extension hint from its name, then from its vfile path, else
 * `application/octet-stream`. A declaration, never a decision (I-1, above).
 */
export function declaredType(item) {
  const declared = typeof item?.mime === 'string' ? item.mime.split(';', 1)[0].trim().toLowerCase() : ''
  if (declared) return declared
  return MIME_BY_EXT[extOf(item?.name)] || MIME_BY_EXT[extOf(item?.vfile?.path)] || 'application/octet-stream'
}

const FETCH_DOOR = '/api/j2/notes/media/fetch'

const originalOf = (o) => (o && typeof o === 'object' && typeof o.url === 'string' && o.url
  ? { src: o.url, name: typeof o.name === 'string' ? o.name : null }
  : null)

/**
 * Stores one media item for a note through the server's doors, and NEVER THROWS: every
 * outcome is a result `rewriteBody` can place.
 *  - `item.failed` (a data: URI that would not decode, an unresolvable src) -> that failure,
 *    with no request.
 *  - `item.remoteUrl` -> the fetch door (A2) `{url, noteImportKey}`. 200 -> stored; 422 -> the
 *    server's own reason; anything else (404, a 429 that never cleared, 5xx, no network) ->
 *    `fetch_failed`.
 *  - otherwise the upload door (A1), `/images` or `/attachments` by the item's kind, with the
 *    declared type. A refusal keeps the server's `reason` (`reasonForUploadFailure`).
 * A failure that a member can read about also carries `message` (the server's sentence, or the
 * status), which `runImport` puts in `summary.failures` exactly as before.
 *
 * @returns {Promise<{ok: true, src: string, kind: string, name: string|null, original?: object|null} | {ok: false, reason: string, name: string|null, sourceUrl: string|null, message?: string}>}
 */
export async function storeMediaItem(noteId, importKey, item, retry = {}) {
  const name = nameOrNull(item?.name)
  if (item?.failed) return { ok: false, sourceUrl: null, ...item.failed, name }
  if (typeof item?.remoteUrl === 'string' && item.remoteUrl) return fetchRemote(importKey, item, name, retry)
  return uploadLocal(noteId, item, name, retry)
}

async function fetchRemote(importKey, item, name, retry) {
  const url = item.remoteUrl
  const failed = (message, reason = NOTICE_REASONS.fetchFailed) => ({ ok: false, reason, name, sourceUrl: url, ...(message ? { message } : {}) })
  let res
  try {
    res = await fetchWithRetry(FETCH_DOOR, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, noteImportKey: importKey }),
    }, retry)
  } catch (err) {
    return failed(`Copying the linked image failed (${err?.message || String(err)})`)
  }
  if (res.status === 422) {
    // A policy refusal: the reason is the server's, passed through. The status alone decided
    // this is a refusal; an unreadable body only means no reason was given.
    const read = await readSuccessBody(res)
    const reason = read.ok && typeof read.body?.reason === 'string' && read.body.reason.trim()
      ? read.body.reason.trim() : NOTICE_REASONS.fetchFailed
    return failed(null, reason)
  }
  if (!res.ok) return failed((await failureDetail(res)) || `Copying the linked image failed (HTTP ${res.status})`)
  const read = await readSuccessBody(res)
  const data = read.ok ? read.body : null
  if (!data || typeof data.src !== 'string' || !data.src) return failed('Copying the linked image failed (the reply could not be read)')
  return {
    ok: true,
    src: data.src,
    kind: typeof data.kind === 'string' && data.kind ? data.kind : item.kind,
    name: nameOrNull(data.filename) ?? name,
    original: originalOf(data.original),
  }
}

async function uploadLocal(noteId, item, name, retry) {
  const failed = (reason, message) => ({ ok: false, reason, name, sourceUrl: null, message })
  let res
  try {
    const endpoint = item.kind === 'image'
      ? `/api/j2/notes/${noteId}/images`
      : `/api/j2/notes/${noteId}/attachments`
    const bytes = await item.vfile.bytes()
    const fd = new FormData()
    fd.append('file', new Blob([bytes], { type: declaredType(item) }), item.name || item.vfile.path)
    res = await fetchWithRetry(endpoint, { method: 'POST', credentials: 'include', body: fd }, retry)
  } catch (err) {
    return failed(NOTICE_REASONS.uploadFailed, err?.message || String(err))
  }
  if (!res.ok) {
    // One read of the refusal: the server's `reason` (A1 always sends one on a 400) decides the
    // notice, its `detail` sentence goes to `failures`. A 5xx detail is plumbing, so the status
    // stands for it. An unreadable body only means there is no sentence to quote.
    const read = res.status < 500 ? await readSuccessBody(res) : { ok: false }
    const body = read.ok && read.body && typeof read.body === 'object' ? read.body : null
    const said = typeof body?.detail === 'string' && body.detail ? body.detail : null
    return failed(reasonForUploadFailure(res.status, body), said || `Upload failed (HTTP ${res.status})`)
  }
  const read = await readSuccessBody(res)
  const data = read.ok ? read.body : null
  if (!data || typeof data.url !== 'string' || !data.url) {
    return failed(NOTICE_REASONS.uploadFailed, 'Upload failed (the reply could not be read)')
  }
  return {
    ok: true,
    src: data.url,
    kind: typeof data.kind === 'string' && data.kind ? data.kind : item.kind,
    name: nameOrNull(data.name) ?? name,
    original: originalOf(data.original),
  }
}

// ---------------------------------------------------------------------------
// The heal door (A6, controller ruling R6)
// ---------------------------------------------------------------------------

const HEAL_DOOR = '/api/j2/notes/import/heal-links'
/** The door refuses more than this many noteIds in one call (400). */
export const HEAL_CHUNK = 500

/**
 * One note's kept links, one entry per target (the first text it was linked with). A link split
 * across text runs is already ONE entry with its joined text: `rewriteBody` joins adjacent runs.
 */
export function dedupeKeptLinks(keptLinks) {
  const seen = new Set()
  const out = []
  for (const { key, text } of keptLinks) {
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ key, text })
  }
  return out
}

/**
 * Runs the full commit: confirm (batched) -> per-note media upload -> body
 * rewrite -> PUT.
 *
 * ⛔⛔ session-audit.md A2: a batch that fails at the HTTP level (network
 * drop, a 5xx after retries, a malformed overall payload) no longer stops
 * the whole run — every OTHER batch still confirms. Before this fix, one
 * failed batch `break`'d the loop, so notes past it (index-ordered — batch
 * 2's failure permanently blocked every batch after it, forever, on every
 * re-run) never even got a confirm attempt. The server side of this same
 * fix (`notes_svc.import_confirm`'s per-note isolation) means a single bad
 * NOTE inside an otherwise-healthy batch no longer fails that batch's HTTP
 * call at all — it comes back as a normal 200 with that one note named in
 * `body.failed`, handled below alongside `created`/`updated`/`skipped`. A
 * `failedBatches` entry is now reserved for a genuine whole-batch failure.
 * Re-running the same export resumes safely either way —
 * `import/confirm`'s fingerprint match makes an already-committed note a
 * no-op `skipped` entry, and a batch that never got a confirm attempt (or a
 * note reported in `failed`) is retried fresh, not skipped as already-seen.
 *
 * ⛔ THE CONFIRM STEP IS SENT IN PIECES, bounded by bytes and by count
 * (`./confirmBatches.js`): the server holds one request to 32 MiB, and one
 * request with a whole library in it is a body one process would have to hold
 * in memory for every member's sake. `limits` exists for tests; the wizard
 * passes none and gets the module's own numbers.
 *
 * Plan B Task 5: each note's media goes through `storeMediaItem` ONCE PER DISTINCT REF (one
 * at a time: the doors cap a member at 2 in flight, so sequential uploads normally never meet
 * their 429), and every result, stored or not, is placed by `rewriteBody`. What did not come
 * over is listed in `notices`; after the PUTs, ONE heal pass (`healImportedLinks`) runs for any
 * import that wrote a note, and what it could not connect is listed in `unconnectedLinks`.
 * `retry` exists for tests (`{sleep, random}` for the 429 backoff); the wizard passes none.
 *
 * @param {{source: string, destFolderId: string|null, docs: object[], limits?: {maxNotes?: number, maxBytes?: number}, retry?: {sleep?: Function, random?: Function}, onProgress?: (p: {phase: string, done: number, total: number}) => void}} args
 * @returns {Promise<{created: number, updated: number, skipped: number, failures: Array<{name: string, reason: string}>, failedBatches: Array<{index: number, notes: number, reason: string, message: string}>, notices: Array<{note: string, importKey: string, reason: string, name: string|null, sourceUrl: string|null}>, unconnectedLinks: Array<{note: string, text: string}>}>}
 */
export async function runImport({ source, destFolderId, docs, onProgress, limits, retry = {} }) {
  // `outcomes` and `importedNoteIds` are DERIVED alongside the counts above,
  // never a second pass over the same responses — the arrival screen (Wave
  // 5, §9) reads `outcomes` to build its per-folder breakdown, and the
  // enrichment offer (§8.1) reads `importedNoteIds` to know which notes are
  // eligible for a ticker scan. Both are additive fields; no existing
  // consumer of `created`/`updated`/`skipped`/`failures`/`failedBatches` is
  // touched.
  const summary = {
    created: 0, updated: 0, skipped: 0, failures: [], failedBatches: [],
    outcomes: {}, importedNoteIds: [],
    // importKeys of a note that WAS created/updated but whose media/link
    // finalization phase (below) hit a snag — distinct from `failures`
    // (which also carries whole-note write failures): this note IS in the
    // notebook, just not fully clean yet. The arrival screen's "needs
    // attention" section reads this to separate "not imported at all" from
    // "imported, but check it."
    attentionKeys: [],
    // Plan B Task 5: one row per media placeholder that did not come over (an importNotice is
    // in the note in its place), and one per link the heal pass could not connect.
    notices: [],
    unconnectedLinks: [],
  }
  // noteId -> {title, keptLinks} for every note whose body was rewritten, for the heal pass.
  const keptByNote = new Map()
  const byImportKey = new Map(docs.map((d) => [d.importKey, d]))
  const idByKey = {}
  // importKeys of notes actually written this run (created or updated) — the
  // only ones that need the media/link phase. A `skipped` note (fingerprint
  // unchanged) was already fully committed by an earlier run — genuinely
  // true as of audit B5's fix: the server's skip decision now also checks
  // `import_media_pending`, so a note whose media/link phase never finished
  // clean (a failed upload, a PUT that never landed) comes back `updated`,
  // not `skipped`, and lands in `toCommit` below to retry that phase.
  const toCommit = []

  const confirmTotal = docs.length
  let confirmDone = 0

  const plan = planConfirmBatches(docs, toConfirmPayload, limits)
  // A note that cannot fit one request on its own is never sent. No legal note
  // is this large (the service holds a body to 1 MB); this is the honest answer
  // for one that is, named like any other note that could not be stored.
  for (const { item, bytes } of plan.tooLarge) {
    summary.failures.push({ name: item.title || item.importKey, reason: noteTooLargeSentence(bytes) })
    summary.outcomes[item.importKey] = 'failed'
    confirmDone += 1
    onProgress?.({ phase: 'confirm', done: confirmDone, total: confirmTotal })
  }

  for (let batchIndex = 0; batchIndex < plan.batches.length; batchIndex++) {
    const batch = plan.batches[batchIndex].items
    let res
    let networkError = null
    try {
      res = await fetch('/api/j2/notes/import/confirm', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: confirmBody({ source, destFolderId }, plan.batches[batchIndex].parts),
      })
    } catch (err) {
      networkError = err
    }

    if (networkError || !res.ok) {
      let reason
      if (networkError) {
        reason = networkError?.message || String(networkError)
      } else {
        // Best-effort: surface the server's own explanation (FastAPI's
        // {detail: "..."} error shape) instead of a bare status code, so a
        // real cause (e.g. a DB error, a validation failure the client-side
        // preview couldn't catch) is visible in the summary instead of just
        // "HTTP 500".
        let detail = null
        try {
          const body = await res.json()
          detail = typeof body?.detail === 'string' ? body.detail : null
        } catch {
          // non-JSON body — fall back to the bare status
        }
        reason = detail ? `HTTP ${res.status}: ${detail}` : `HTTP ${res.status}`
      }
      // A whole-batch HTTP failure no longer stops the run (A2) — every
      // OTHER batch still gets its own confirm attempt. `confirmDone`
      // still climbs by this batch's size so the progress bar keeps
      // moving instead of stalling on the failed batch.
      summary.failedBatches.push({
        index: batchIndex,
        notes: batch.length,
        reason,
        message: `Batch ${batchIndex + 1} failed (${reason}). The import continued with the ` +
          "remaining batches — this batch's notes were not imported. Running the import again " +
          'will retry them; already-imported notes are safe and will not be duplicated.',
      })
      for (const d of batch) summary.outcomes[d.importKey] = 'batch_failed'
      confirmDone += batch.length
      onProgress?.({ phase: 'confirm', done: confirmDone, total: confirmTotal })
      continue
    }

    const body = await res.json()
    // Fire onProgress per NOTE (not once per batch) — loop each response
    // bucket's items individually so `done` climbs one at a time.
    for (const item of body.created || []) {
      idByKey[item.importKey] = item.id
      toCommit.push(item.importKey)
      summary.created += 1
      summary.outcomes[item.importKey] = 'created'
      summary.importedNoteIds.push(item.id)
      confirmDone += 1
      onProgress?.({ phase: 'confirm', done: confirmDone, total: confirmTotal })
    }
    for (const item of body.updated || []) {
      idByKey[item.importKey] = item.id
      toCommit.push(item.importKey)
      summary.updated += 1
      summary.outcomes[item.importKey] = 'updated'
      summary.importedNoteIds.push(item.id)
      confirmDone += 1
      onProgress?.({ phase: 'confirm', done: confirmDone, total: confirmTotal })
    }
    // ⛔⛔ `import_confirm` ADVANCES `updated_at` ON EVERY NOTE IT WRITES, and the
    // `updated` bucket is the one that matters: re-importing an export a member
    // already has REWRITES existing notes, and any of those can have unsent
    // offline work queued against it. Unlanded, the next drain meets a revision
    // it has never heard of and forks the member's note against their own
    // import. `created` notes carry theirs too — free, since they are in the
    // same response — though nothing can be queued against a note that did not
    // exist a moment ago.
    // ⛔ NO EDITOR IS MOUNTED during an import. That is precisely why the settle
    // is store-direct and mount-independent.
    await settleNoteWrites([...(body.created || []), ...(body.updated || [])])
    for (const item of body.skipped || []) {
      idByKey[item.importKey] = item.id
      summary.skipped += 1
      summary.outcomes[item.importKey] = 'skipped'
      confirmDone += 1
      onProgress?.({ phase: 'confirm', done: confirmDone, total: confirmTotal })
    }
    // A2/session-audit.md A1: a note the server could not store (oversized
    // body, most commonly) is isolated per-note by `import_confirm` rather
    // than failing this whole batch — named here exactly like a media/PUT
    // failure below, never silently dropped and never counted as
    // created/updated/skipped.
    for (const item of body.failed || []) {
      const doc = byImportKey.get(item.importKey)
      summary.failures.push({
        name: doc?.title || item.importKey,
        reason: item.error || 'could not be stored',
      })
      summary.outcomes[item.importKey] = 'failed'
      confirmDone += 1
      onProgress?.({ phase: 'confirm', done: confirmDone, total: confirmTotal })
    }
  }

  const commitTotal = toCommit.length
  let commitDone = 0

  for (const importKey of toCommit) {
    const sourceDoc = byImportKey.get(importKey)
    const noteId = idByKey[importKey]
    const hasMedia = (sourceDoc?.media || []).length > 0
    const hasLinks = (sourceDoc?.links || []).length > 0

    if (sourceDoc && noteId && (hasMedia || hasLinks)) {
      // One request per distinct ref: a ref repeated in the body (the same hotlinked image
      // twice) is stored once and every occurrence takes that one result.
      const mediaResults = {}
      for (const item of sourceDoc.media || []) {
        if (!item || Object.prototype.hasOwnProperty.call(mediaResults, item.ref)) continue
        const result = await storeMediaItem(noteId, importKey, item, retry)
        mediaResults[item.ref] = result
        if (!result.ok && result.message) summary.failures.push({ name: item.name || item.ref, reason: result.message })
      }
      const { body: rewritten, droppedMedia, notices, keptLinks } = rewriteBody(sourceDoc.bodyJson, { mediaResults, idByKey })
      const noteName = sourceDoc.title || importKey
      for (const { reason, name, sourceUrl } of notices) {
        summary.notices.push({ note: noteName, importKey, reason, name, sourceUrl })
      }
      if (keptLinks.length > 0) keptByNote.set(noteId, { title: noteName, keptLinks: dedupeKeptLinks(keptLinks) })
      if (droppedMedia.length > 0) summary.attentionKeys.push(importKey)
      // The confirm step already counted this note as created/updated — that
      // outcome stands regardless of what happens here. A failure below is
      // reported via `failures` (the note's persisted body may still carry
      // literal import-ref://import-link:// placeholders), and — critically —
      // must NOT reject the whole runImport promise: swallow it and move on
      // to the next note so one bad PUT can't strand every note after it.
      //
      // audit B5: `importMediaPending` is the honest signal `import_confirm`
      // gates its skip-on-fingerprint-match decision on. A dropped media ref
      // means this note's import is NOT actually done — say so, so a later
      // re-import of the same export retries this note's media instead of
      // matching its fingerprint and skipping it (and the still-missing
      // image) forever.
      try {
        const putRes = await fetch(`/api/j2/notes/${noteId}`, {
          method: 'PUT',
          credentials: 'include',
          // ⛔ S1/H14: a body write declares the schema this bundle can read.
          // Without it the server reads this PUT as the OLDEST client and
          // refuses it on a note the importer itself just wrote with a wave-5
          // type (the Obsidian adapter's ==x== is a highlight mark).
          headers: { 'Content-Type': 'application/json', ...(await notebookSchemaHeaders()) },
          body: JSON.stringify({ bodyJson: rewritten, importMediaPending: droppedMedia.length > 0 }),
        })
        if (!putRes.ok) {
          summary.failures.push({
            name: sourceDoc.title || importKey,
            reason: `saving final content failed (HTTP ${putRes.status})`,
          })
          if (!summary.attentionKeys.includes(importKey)) summary.attentionKeys.push(importKey)
        } else {
          // ⛔ The media-rewrite PUT is a door like any other. An import runs
          // over many notes, so leaving these unlanded is one unrecorded
          // revision per imported note.
          await settleNoteWrite(noteId, putRes)
        }
      } catch (err) {
        summary.failures.push({
          name: sourceDoc.title || importKey,
          reason: `saving final content failed (${err?.message || String(err)})`,
        })
        if (!summary.attentionKeys.includes(importKey)) summary.attentionKeys.push(importKey)
      }
    }

    commitDone += 1
    onProgress?.({ phase: 'commit', done: commitDone, total: commitTotal })
  }

  // R6: ALWAYS once per import that wrote a note, even with no kept links of its own: the
  // door's sweep also heals OLD notes whose target this import just brought in.
  if (toCommit.length > 0) summary.unconnectedLinks = await healImportedLinks(keptByNote, retry)

  return summary
}

/**
 * `POST /api/j2/notes/import/heal-links {noteIds}` over the notes that kept links (possibly
 * none: `[]` still runs the server's sweep), in chunks of HEAL_CHUNK, each through the 429
 * retry. A chunk the door answered with its `unresolved` list contributes that list; a chunk
 * that failed (a non-ok status, an unreadable body, no network) contributes its OWN kept links
 * instead, so a link is never reported connected when nobody checked.
 *
 * @returns {Promise<Array<{note: string, text: string}>>}
 */
async function healImportedLinks(keptByNote, retry) {
  const ids = [...keptByNote.keys()]
  const chunks = []
  for (let i = 0; i < ids.length; i += HEAL_CHUNK) chunks.push(ids.slice(i, i + HEAL_CHUNK))
  if (chunks.length === 0) chunks.push([])
  const out = []
  const ownList = (chunk) => chunk.flatMap((id) => keptByNote.get(id).keptLinks.map(({ text }) => ({ note: keptByNote.get(id).title, text })))
  for (const chunk of chunks) {
    let unresolved = null
    try {
      const res = await fetchWithRetry(HEAL_DOOR, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ noteIds: chunk }),
      }, retry)
      if (res.ok) {
        const read = await readSuccessBody(res)
        if (read.ok && Array.isArray(read.body?.unresolved)) unresolved = read.body.unresolved
      }
    } catch {
      unresolved = null // no network after the retries: this chunk's own list stands
    }
    if (unresolved === null) {
      out.push(...ownList(chunk))
      continue
    }
    for (const u of unresolved) {
      const id = typeof u?.noteId === 'string' ? u.noteId : null
      const text = typeof u?.text === 'string' ? u.text : ''
      out.push({ note: keptByNote.get(id)?.title ?? id ?? '', text })
    }
  }
  return out
}
