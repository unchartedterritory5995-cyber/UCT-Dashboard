/**
 * Journal 2.0 — Notebook import: commit pipeline.
 * Spec: docs/superpowers/specs/2026-08-11-notebook-import-design.md
 *
 * Three exports:
 *  - checkExisting(docs)  -> POST /api/j2/notes/import/check   ({existing})
 *  - rewriteBody(bodyJson, {mediaUrls, idByKey}) -> {body, droppedMedia}, PURE
 *  - runImport({source, destFolderId, docs, onProgress}) -> summary
 */

const REF_PREFIX = 'import-ref://'
const LINK_PREFIX = 'import-link://'
const CONFIRM_BATCH_SIZE = 200 // server caps a single batch at 500; we stay well under it

// ---------------------------------------------------------------------------
// checkExisting
// ---------------------------------------------------------------------------

/**
 * @param {Array<{importKey: string}>} docs
 * @returns {Promise<{existing: Record<string, {id: string, updatedAt: string, importHash: string}>}>}
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
 *  - image nodes: `attrs.src === 'import-ref://<ref>'` -> `mediaUrls[ref]`.
 *    Unresolvable (upload failed, or the ref was never provided) -> the node
 *    is dropped from its parent's content and `<ref>` is recorded in
 *    `droppedMedia`.
 *  - attachmentChip nodes: same swap, on `attrs.href` instead of `attrs.src`.
 *  - link marks: `attrs.href === 'import-link://<targetKey>'` -> resolved via
 *    `idByKey[targetKey]` to `/journal?j2tab=notebook&note=<id>`. Unresolved
 *    (the target note never imported, or was itself dropped) -> the MARK is
 *    removed, but the text run it was attached to is kept as plain text.
 *
 * Deep-walks the whole tree (tables, lists, nested blocks — anywhere a media
 * node or a marked text run can live), and never mutates its input.
 *
 * @param {object} bodyJson
 * @param {{mediaUrls?: Record<string,string>, idByKey?: Record<string,string>}} opts
 * @returns {{body: object, droppedMedia: string[]}}
 */
export function rewriteBody(bodyJson, { mediaUrls = {}, idByKey = {} } = {}) {
  const droppedMedia = []

  function refFromPlaceholder(value) {
    if (typeof value !== 'string' || !value.startsWith(REF_PREFIX)) return null
    return value.slice(REF_PREFIX.length)
  }

  function rewriteMarks(marks) {
    const out = []
    for (const mark of marks) {
      if (mark.type === 'link' && typeof mark.attrs?.href === 'string' && mark.attrs.href.startsWith(LINK_PREFIX)) {
        const targetKey = mark.attrs.href.slice(LINK_PREFIX.length)
        const noteId = idByKey[targetKey]
        if (noteId) {
          out.push({ ...mark, attrs: { ...mark.attrs, href: `/journal?j2tab=notebook&note=${noteId}` } })
        }
        // unresolved -> drop the mark, keep the text run itself
        continue
      }
      out.push(mark)
    }
    return out
  }

  // Returns the rewritten node, or `null` if the node should be dropped
  // entirely from its parent's content array.
  function walkNode(node) {
    if (!node || typeof node !== 'object') return node

    if (node.type === 'image') {
      const ref = refFromPlaceholder(node.attrs?.src)
      if (ref === null) return node
      const url = mediaUrls[ref]
      if (url == null) {
        droppedMedia.push(ref)
        return null
      }
      return { ...node, attrs: { ...node.attrs, src: url } }
    }

    if (node.type === 'attachmentChip') {
      const ref = refFromPlaceholder(node.attrs?.href)
      if (ref === null) return node
      const url = mediaUrls[ref]
      if (url == null) {
        droppedMedia.push(ref)
        return null
      }
      return { ...node, attrs: { ...node.attrs, href: url } }
    }

    const next = { ...node }
    if (Array.isArray(node.marks)) next.marks = rewriteMarks(node.marks)
    if (Array.isArray(node.content)) {
      next.content = node.content.map(walkNode).filter((n) => n !== null)
    }
    return next
  }

  const body = walkNode(bodyJson)
  return { body, droppedMedia }
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

/**
 * POSTs with up to 2 retries (3 attempts total) on EITHER a 5xx response OR a
 * thrown network error (fetch rejecting outright — offline, DNS, aborted).
 * A non-5xx response (4xx, or a 5xx with retries exhausted) is returned
 * as-is for the caller to inspect/throw on; a network error that's still
 * failing on the last attempt is re-thrown.
 */
async function fetchWithRetry(url, opts, maxRetries = 2) {
  let lastErr
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, opts)
      if (res.ok || res.status < 500 || attempt === maxRetries) return res
      lastErr = new Error(`HTTP ${res.status}`)
    } catch (err) {
      lastErr = err
      if (attempt === maxRetries) throw err
    }
  }
  throw lastErr
}

// Both /images and /attachments enforce a server-side MIME allowlist
// (_ALLOWED_IMAGE_MIMES / _ALLOWED_FILE_MIMES in api/services/journal_two/notes.py)
// and reject on upload.content_type, NOT on the filename. `new Blob([bytes])`
// with no `type` sends `application/octet-stream` for every part — the server
// then 400s EVERY imported image/attachment, real browsers included. Derive a
// MIME from the extension so the multipart part matches what the file actually is.
const MIME_BY_EXT = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  pdf: 'application/pdf',
  txt: 'text/plain',
  csv: 'text/csv',
  md: 'text/markdown',
  zip: 'application/zip',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.document',
}

function extOf(name) {
  if (typeof name !== 'string') return ''
  const base = name.split('/').pop() || ''
  const idx = base.lastIndexOf('.')
  return idx === -1 ? '' : base.slice(idx + 1).toLowerCase()
}

// unknown extension -> application/octet-stream. The server will then reject
// it by name (MIME type ... not allowed) rather than the previous silent
// blanket rejection of every upload — an honest failure instead of a hidden one.
function mimeForName(name) {
  return MIME_BY_EXT[extOf(name)] || 'application/octet-stream'
}

async function uploadMediaItem(noteId, item) {
  const endpoint = item.kind === 'image'
    ? `/api/j2/notes/${noteId}/images`
    : `/api/j2/notes/${noteId}/attachments`
  const bytes = await item.vfile.bytes()
  const filename = item.name || item.vfile.path
  // Derive from item.name; fall back to the vfile path's extension only when
  // the name itself carries none (e.g. a bare display name with no suffix).
  const mimeSource = extOf(item.name) ? item.name : item.vfile.path
  const fd = new FormData()
  fd.append('file', new Blob([bytes], { type: mimeForName(mimeSource) }), filename)
  const res = await fetchWithRetry(endpoint, { method: 'POST', credentials: 'include', body: fd })
  if (!res.ok) throw new Error(`Upload failed (HTTP ${res.status})`)
  const data = await res.json()
  return data.url
}

/**
 * Runs the full commit: confirm (batched) -> per-note media upload -> body
 * rewrite -> PUT. Atomicity is per confirm batch: a batch that fails to
 * confirm stops the run, but every note from an earlier, successfully
 * confirmed batch is kept and still gets its media/link phase. Re-running the
 * same export resumes safely — `import/confirm`'s fingerprint match makes an
 * already-committed note a no-op `skipped` entry.
 *
 * @param {{source: string, destFolderId: string|null, docs: object[], onProgress?: (p: {phase: string, done: number, total: number}) => void}} args
 * @returns {Promise<{created: number, updated: number, skipped: number, failures: Array<{name: string, reason: string}>, failedBatch: {index: number, notes: number, reason: string, message: string}|null}>}
 */
export async function runImport({ source, destFolderId, docs, onProgress }) {
  const summary = { created: 0, updated: 0, skipped: 0, failures: [], failedBatch: null }
  const byImportKey = new Map(docs.map((d) => [d.importKey, d]))
  const idByKey = {}
  // importKeys of notes actually written this run (created or updated) — the
  // only ones that need the media/link phase. A `skipped` note (fingerprint
  // unchanged) was already fully committed by an earlier run.
  const toCommit = []

  const confirmTotal = docs.length
  let confirmDone = 0

  for (let i = 0; i < docs.length; i += CONFIRM_BATCH_SIZE) {
    const batch = docs.slice(i, i + CONFIRM_BATCH_SIZE)
    const batchIndex = Math.floor(i / CONFIRM_BATCH_SIZE)
    let res
    let networkError = null
    try {
      res = await fetch('/api/j2/notes/import/confirm', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source, destFolderId, notes: batch.map(toConfirmPayload) }),
      })
    } catch (err) {
      networkError = err
    }

    if (networkError || !res.ok) {
      const reason = networkError
        ? (networkError?.message || String(networkError))
        : `HTTP ${res.status}`
      summary.failedBatch = {
        index: batchIndex,
        notes: batch.length,
        reason,
        message: `Batch ${batchIndex + 1} failed (${reason}). Already-imported notes are safe; ` +
          're-dropping the same export resumes where it stopped.',
      }
      break
    }

    const body = await res.json()
    // Fire onProgress per NOTE (not once per batch) — loop each response
    // bucket's items individually so `done` climbs one at a time.
    for (const item of body.created || []) {
      idByKey[item.importKey] = item.id
      toCommit.push(item.importKey)
      summary.created += 1
      confirmDone += 1
      onProgress?.({ phase: 'confirm', done: confirmDone, total: confirmTotal })
    }
    for (const item of body.updated || []) {
      idByKey[item.importKey] = item.id
      toCommit.push(item.importKey)
      summary.updated += 1
      confirmDone += 1
      onProgress?.({ phase: 'confirm', done: confirmDone, total: confirmTotal })
    }
    for (const item of body.skipped || []) {
      idByKey[item.importKey] = item.id
      summary.skipped += 1
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
      const mediaUrls = {}
      for (const item of sourceDoc.media || []) {
        try {
          mediaUrls[item.ref] = await uploadMediaItem(noteId, item)
        } catch (err) {
          summary.failures.push({ name: item.name || item.ref, reason: err?.message || String(err) })
        }
      }
      const { body: rewritten } = rewriteBody(sourceDoc.bodyJson, { mediaUrls, idByKey })
      // The confirm step already counted this note as created/updated — that
      // outcome stands regardless of what happens here. A failure below is
      // reported via `failures` (the note's persisted body may still carry
      // literal import-ref://import-link:// placeholders), and — critically —
      // must NOT reject the whole runImport promise: swallow it and move on
      // to the next note so one bad PUT can't strand every note after it.
      try {
        const putRes = await fetch(`/api/j2/notes/${noteId}`, {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bodyJson: rewritten }),
        })
        if (!putRes.ok) {
          summary.failures.push({
            name: sourceDoc.title || importKey,
            reason: `saving final content failed (HTTP ${putRes.status})`,
          })
        }
      } catch (err) {
        summary.failures.push({
          name: sourceDoc.title || importKey,
          reason: `saving final content failed (${err?.message || String(err)})`,
        })
      }
    }

    commitDone += 1
    onProgress?.({ phase: 'commit', done: commitDone, total: commitTotal })
  }

  return summary
}
