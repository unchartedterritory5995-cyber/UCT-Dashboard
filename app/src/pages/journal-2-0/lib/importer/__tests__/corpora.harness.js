/**
 * Plan B Task 12 (spec §10): the shared harness for the CLIENT import corpora.
 *
 * The corpora under `__fixtures__/corpora/**` are small, synthetic, real-export-shaped drops
 * (an Evernote .enex pair, two Obsidian vaults, a Notion export, a generic md/html pile, our
 * own UCT JSON export). `importCorpus` runs one through the REAL client path the wizard runs:
 *
 *   expandArchives -> detectAdapter -> parseImport (adapter + the one post-parse pass)
 *   -> htmlToNote per doc -> runImport
 *
 * against a SCRIPTED SERVER that mirrors the real Plan A door shapes (controller ruling R10):
 *   - `POST /import/confirm`   -> {created, updated, recovered, keptEdited, skipped, failed}.
 *       Like `notes.import_confirm`: a known key whose fingerprint (here: the confirmed note's
 *       JSON) is unchanged and whose media phase finished is `skipped` (non-recover only);
 *   - `POST /{id}/images|attachments` -> 200 `_stored_media_payload`
 *       {url, kind, name, size, mime, width, height, original}: an `image/svg+xml` part is
 *       stored as `kind: "file"`, an `image/heic` part as a JPEG plus its kept `original`;
 *       a part named in `storageLimit` -> 400 {detail, reason: "storage_limit"};
 *   - `POST /media/fetch` -> 200 {src, kind, filename, original?} for `cdn.example.com` /
 *       `news.example.com`, NO ANSWER (until aborted) for `slow.example.com`, else (a dead or
 *       refused upstream, `gone.example.com` included) 422 {reason: "fetch_failed", markerText}.
 *       Its ONLY 404 is the real door's: an unknown `noteImportKey` (a key in `trashed`);
 *   - `POST /import/heal-links` -> {healed, unresolved: [{noteId, key, text}]}, like
 *       `link_keys.heal_pending_links` over `resolve_link_keys`: an exact key resolves to the
 *       note holding that importKey; an `evernote-title:` key to the ONE Evernote-sourced note
 *       whose whitespace-collapsed title equals it (two or more => nothing, never a guess).
 *       Resolved marks in the named notes are REWRITTEN in the stored body; `unresolved` lists
 *       each key left once, with its (adjacent-run-joined) text;
 *   - `PUT /{id}` -> the body is STORED (`puts`), never normalised;
 *   - every one of the four doors answers its FIRST call with a plain 429 {detail}, NO
 *     `Retry-After` (the real doors send none), then 200: ONE 429-then-200 per door, so every
 *     corpus run crosses commit.js's own exponential back-off branch (H4). `run.sleeps` records
 *     the back-off delays the client asked for.
 * Every multipart upload is recorded with its `Blob.type` and its bytes. Nothing touches the
 * network: an unscripted URL throws.
 *
 * `renderBody(bodyJson)` mounts a stored body in the REAL editor (`buildExtensions()`,
 * read-only) and returns `editor.view.dom`; `destroyEditors()` tears every one down.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { zipSync } from 'fflate'
import { expect, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { buildExtensions } from '../../tiptap'
import { openableLinkHref, internalNoteIdFromHref, pendingLinkFallbackHref, isPlainTextPendingLink } from '../../linkClickOpen'
import { importNoticeText, OPEN_ORIGINAL } from '../../importNoticeText'
import { hrefAsRead } from '../linkPolicy'
import { expandArchives } from '../intake'
import { detectAdapter } from '../registry'
import { parseImport } from '../postParse'
import { htmlToNote } from '../convert'
import { runImport } from '../commit'

if (typeof Range !== 'undefined') {
  if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => []
  if (!Range.prototype.getBoundingClientRect) {
    Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })
  }
}

export const CORPORA = join(process.cwd(), 'src/pages/journal-2-0/lib/importer/__fixtures__/corpora')

// ── fixtures -> vfiles ──────────────────────────────────────────────────────

function walk(dir, prefix) {
  const out = []
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name)
    const rel = prefix ? `${prefix}/${name}` : name
    if (statSync(full).isDirectory()) out.push(...walk(full, rel))
    else out.push({ rel, bytes: new Uint8Array(readFileSync(full)) })
  }
  return out
}

export const vfileOf = (path, bytes) => ({ path, size: bytes.length, lastModified: null, bytes: async () => bytes })

/** Every file under `corpora/<rel>`, as dropped vfiles (paths relative to `corpora/<rel>`). */
export function folderDrop(rel) {
  return walk(join(CORPORA, rel), '').map(({ rel: p, bytes }) => vfileOf(p, bytes))
}

/** The same files, zipped in memory: the drop is ONE .zip, so `expandArchives` really runs. */
export function zipDrop(rel, zipName = 'export.zip') {
  const entries = {}
  for (const f of walk(join(CORPORA, rel), '')) entries[f.rel] = f.bytes
  const bytes = zipSync(entries)
  return [vfileOf(zipName, bytes)]
}

export const fixtureBytes = (rel) => new Uint8Array(readFileSync(join(CORPORA, rel)))

// ── the scripted server ─────────────────────────────────────────────────────

export const ATTACH = '/api/j2/notes/attachments/u-corpus/'
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', ...headers } })
// ⛔ No Retry-After: journal_two.py's upload gate and fetch in-flight cap, and
// public_note_payload.enforce_rate, all raise a plain HTTPException(429, detail).
const busy = () => json({ detail: 'Busy, try again.' }, 429)

/** Python `" ".join(t.split())` for the titles here (`link_keys._norm_title`). */
const normTitle = (t) => (typeof t === 'string' ? t.split(/\s+/).filter(Boolean).join(' ') : '')

const FETCH_OK = new Set(['cdn.example.com', 'news.example.com'])
const LINK_PREFIX = 'import-link://'

function walkNodes(node, out = []) {
  if (node && typeof node === 'object') {
    out.push(node)
    for (const c of node.content || []) walkNodes(c, out)
  }
  return out
}

/**
 * @param {{existing?: Record<string, {id: string, body: object, title?: string, source?: string,
 *            edited?: boolean, hash?: string}>,
 *          inherit?: object, trashed?: string[], storageLimit?: string[]}} [opts]
 *   `inherit`: an earlier server's `state` -- the member's notebook after a previous import
 *   (notes, titles, sources, fingerprints, media-pending flags), so a re-import meets it.
 *   `trashed`: importKeys the fetch door no longer finds (its 404).
 */
export function makeServer(opts = {}) {
  const prev = opts.inherit || null
  const state = {
    seq: prev ? prev.seq : 0,
    byKey: new Map(prev?.byKey), // importKey -> id
    bodies: new Map(prev?.bodies), // id -> stored body (what the member's notebook holds)
    titles: new Map(prev?.titles), // id -> title
    sources: new Map(prev?.sources), // id -> import_source (the adapter label)
    hashes: new Map(prev?.hashes), // id -> import fingerprint
    pending: new Set(prev?.pending), // ids whose media phase did not finish (import_media_pending)
    trashed: new Set(opts.trashed || []),
    edited: new Set(), // importKeys the member edited since import
    puts: new Map(), // id -> the body the import PUT
    putsRaw: [], // every PUT, in order: {id, bodyJson, importMediaPending}
    uploads: [], // {noteId, door, type, name, bytes}
    fetches: [], // {url, noteImportKey, status}
    heals: [], // {noteIds, status}
    confirms: [], // parsed confirm payloads
    calls: [], // {url, method, status}
    busyServed: new Set(),
    storageLimit: new Set(opts.storageLimit || []),
  }
  for (const [key, row] of Object.entries(opts.existing || {})) {
    state.byKey.set(key, row.id)
    state.bodies.set(row.id, row.body)
    state.titles.set(row.id, row.title || key)
    if (row.source) state.sources.set(row.id, row.source)
    if (row.hash) state.hashes.set(row.id, row.hash)
    if (row.edited) state.edited.add(key)
  }

  /** `resolve_link_keys`: exact importKey, or the ONE Evernote note of that title. */
  function resolveKey(key) {
    if (key.startsWith('evernote-title:')) {
      const want = normTitle(key.slice('evernote-title:'.length))
      const ids = [...state.titles].filter(([id, t]) => (state.sources.get(id) || '').toLowerCase() === 'evernote'
        && normTitle(t) === want).map(([id]) => id)
      return ids.length === 1 ? ids[0] : null
    }
    return state.byKey.get(key) || null
  }

  /** `_link_runs`: {key: first run's text, joined with adjacent runs carrying the same key}. */
  function linkRuns(body) {
    const out = new Map()
    for (const block of walkNodes(body)) {
      if (!Array.isArray(block.content)) continue
      let open = null
      for (const child of block.content) {
        const href = child.type === 'text' ? (child.marks || []).find((m) => m.type === 'link')?.attrs?.href : null
        const key = typeof href === 'string' && href.startsWith(LINK_PREFIX) ? href.slice(LINK_PREFIX.length) : null
        if (!key) { open = null; continue }
        if (open === key) { if (out.get(key).joinable) out.get(key).text += child.text; continue }
        if (out.has(key)) out.get(key).joinable = false
        else out.set(key, { text: child.text, joinable: true })
        open = key
      }
    }
    return new Map([...out].map(([k, v]) => [k, v.text]))
  }

  /** The body with every mark whose key is in `ids` pointed at its note (a structural copy). */
  function rewriteMarks(node, ids) {
    if (!node || typeof node !== 'object') return node
    const next = { ...node }
    if (Array.isArray(node.marks)) {
      next.marks = node.marks.map((m) => {
        const href = m.type === 'link' ? m.attrs?.href : null
        const key = typeof href === 'string' && href.startsWith(LINK_PREFIX) ? href.slice(LINK_PREFIX.length) : null
        return key && ids[key] ? { ...m, attrs: { ...m.attrs, href: `/journal?j2tab=notebook&note=${ids[key]}` } } : m
      })
    }
    if (Array.isArray(node.content)) next.content = node.content.map((c) => rewriteMarks(c, ids))
    return next
  }

  // ONE 429-then-200 per door: the first call of each kind is answered busy.
  const busyOnce = (door) => {
    if (state.busyServed.has(door)) return null
    state.busyServed.add(door)
    return busy()
  }

  async function handle(url, init = {}) {
    const method = init.method || 'GET'
    if (url === '/api/j2/notes/import/confirm') {
      const payload = JSON.parse(init.body)
      state.confirms.push(payload)
      const out = { created: [], updated: [], recovered: [], keptEdited: [], skipped: [], failed: [] }
      for (const n of payload.notes) {
        const known = state.byKey.get(n.importKey)
        if (known && state.edited.has(n.importKey)) {
          out.keptEdited.push({ importKey: n.importKey, id: known })
          continue
        }
        const updatedAt = '2026-11-02T00:00:00Z'
        const hash = JSON.stringify(n)
        if (known) {
          if (payload.mode !== 'recover' && state.hashes.get(known) === hash && !state.pending.has(known)) {
            out.skipped.push({ importKey: n.importKey, id: known })
            continue
          }
          state.bodies.set(known, n.bodyJson)
          state.hashes.set(known, hash)
          state.titles.set(known, n.title)
          state.sources.set(known, payload.source)
          out[payload.mode === 'recover' ? 'recovered' : 'updated'].push({ importKey: n.importKey, id: known, updatedAt })
          continue
        }
        state.seq += 1
        const id = `n${state.seq}`
        state.byKey.set(n.importKey, id)
        state.bodies.set(id, n.bodyJson)
        state.titles.set(id, n.title)
        state.sources.set(id, payload.source)
        state.hashes.set(id, hash)
        out.created.push({ importKey: n.importKey, id, updatedAt })
      }
      return json(out)
    }
    if (url === '/api/j2/notes/import/heal-links') {
      const b = busyOnce('heal')
      const { noteIds } = JSON.parse(init.body)
      state.heals.push({ noteIds, status: b ? 429 : 200 })
      if (b) return b
      const unresolved = []
      let healed = 0
      for (const id of noteIds) {
        const body = state.bodies.get(id)
        const runs = linkRuns(body)
        const mine = {}
        for (const key of runs.keys()) {
          const target = resolveKey(key)
          if (target) mine[key] = target
        }
        if (Object.keys(mine).length) {
          state.bodies.set(id, rewriteMarks(body, mine))
          healed += 1
        }
        for (const [key, text] of runs) if (!mine[key]) unresolved.push({ noteId: id, key, text })
      }
      return json({ healed, unresolved })
    }
    if (url === '/api/j2/notes/media/fetch') {
      const b = busyOnce('fetch')
      const { url: target, noteImportKey } = JSON.parse(init.body)
      const host = new URL(target).hostname
      const record = { url: target, noteImportKey, status: b ? 429 : null }
      state.fetches.push(record)
      if (b) return b
      // The real door's ONLY 404: `import_check` found no live note for this key.
      if (!state.byKey.has(noteImportKey) || state.trashed.has(noteImportKey)) {
        record.status = 404
        return json({ detail: 'Not found' }, 404)
      }
      if (host === 'slow.example.com') {
        record.status = 'aborted'
        return new Promise((_, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
        })
      }
      // A dead or refusing upstream (`gone.example.com` too) is the door's named 422.
      if (!FETCH_OK.has(host)) {
        record.status = 422
        return json({ reason: 'fetch_failed', markerText: 'Linked image could not be copied' }, 422)
      }
      record.status = 200
      const name = decodeURIComponent(new URL(target).pathname.split('/').pop())
      const id = state.byKey.get(noteImportKey)
      return json({ src: `${ATTACH}${id}/inline/fetched-${name}`, kind: 'image', filename: name })
    }
    let m = /^\/api\/j2\/notes\/([^/]+)\/(images|attachments)$/.exec(url)
    if (m && method === 'POST') {
      const [, noteId, door] = m
      const b = busyOnce(door)
      const file = init.body.get('file')
      const bytes = new Uint8Array(await file.arrayBuffer())
      state.uploads.push({ noteId, door, type: file.type, name: file.name, bytes, status: b ? 429 : null })
      if (b) return b
      const n = state.uploads.length
      if (state.storageLimit.has(file.name)) {
        state.uploads[n - 1].status = 400
        return json({ detail: `${file.name} would go over your storage limit.`, reason: 'storage_limit' }, 400)
      }
      state.uploads[n - 1].status = 200
      const base = { size: bytes.length, mime: file.type, width: null, height: null, original: null }
      if (file.type === 'image/svg+xml') {
        return json({ ...base, url: `${ATTACH}${noteId}/files/${n}-${file.name}`, kind: 'file', name: file.name })
      }
      if (file.type === 'image/heic') {
        const jpg = file.name.replace(/\.[^.]*$/, '') + '.jpg'
        return json({ ...base, url: `${ATTACH}${noteId}/inline/${n}-${jpg}`, kind: 'image', name: jpg, mime: 'image/jpeg',
          original: { url: `${ATTACH}${noteId}/files/${n}-${file.name}`, name: file.name } })
      }
      const kind = door === 'images' ? 'image' : 'file'
      return json({ ...base, url: `${ATTACH}${noteId}/${kind === 'image' ? 'inline' : 'files'}/${n}-${file.name}`, kind, name: file.name })
    }
    m = /^\/api\/j2\/notes\/([^/]+)$/.exec(url)
    if (m && method === 'PUT') {
      const id = m[1]
      const payload = JSON.parse(init.body)
      state.puts.set(id, payload.bodyJson)
      state.putsRaw.push({ id, ...payload })
      state.bodies.set(id, payload.bodyJson)
      if (payload.importMediaPending) state.pending.add(id)
      else state.pending.delete(id)
      return json({ id, updatedAt: '2026-11-02T00:00:01Z' })
    }
    throw new Error(`unscripted ${method} ${url}`)
  }

  const fetchImpl = vi.fn(async (url, init) => {
    const res = await handle(url, init)
    state.calls.push({ url, method: init?.method || 'GET', status: res.status })
    return res
  })
  return { state, fetchImpl }
}

// ── the real client path ────────────────────────────────────────────────────

/** commit.js's first busy back-off with `random() = 0`: BUSY_BASE_MS * 2^0, no jitter. */
export const FIRST_BACKOFF_MS = 500

/** Test timing for the door calls: the back-off sleep is recorded, not slept; a short deadline. */
const retryFor = (sleeps) => ({ sleep: async (ms) => { sleeps.push(ms) }, random: () => 0, timeoutMs: 150 })

/**
 * @param {Array} vfiles  the drop, as the wizard receives it
 * @param {{server?: object, mode?: 'recover', isCancelled?: () => boolean, expectAdapter?: string}} [opts]
 */
export async function importCorpus(vfiles, opts = {}) {
  const server = opts.server || makeServer()
  const { files, warnings: expandWarnings } = await expandArchives(vfiles)
  const { adapter } = await detectAdapter(files)
  if (opts.expectAdapter && adapter.id !== opts.expectAdapter) {
    throw new Error(`expected the ${opts.expectAdapter} adapter, detection chose ${adapter.id}`)
  }
  const parsed = await parseImport(adapter, files)
  const docs = parsed.docs
  for (const doc of docs) {
    const { bodyJson, bodyPlain } = htmlToNote(doc.html)
    doc.bodyJson = bodyJson
    doc.bodyPlain = bodyPlain
  }
  vi.stubGlobal('fetch', server.fetchImpl)
  let summary
  const sleeps = []
  try {
    summary = await runImport({
      source: adapter.label, destFolderId: null, docs, mode: opts.mode,
      isCancelled: opts.isCancelled, retry: retryFor(sleeps), onProgress: opts.onProgress,
    })
  } finally {
    vi.unstubAllGlobals()
  }
  const { state } = server
  const putsByKey = new Map()
  // What the member's notebook HOLDS for each note: the PUT body, or (a note with no media and
  // no note links is complete at confirm) the confirmed body.
  const storedByKey = new Map()
  for (const [key, id] of state.byKey) {
    if (state.puts.has(id)) putsByKey.set(key, state.puts.get(id))
    if (state.bodies.has(id)) storedByKey.set(key, state.bodies.get(id))
  }
  return {
    adapter: adapter.id,
    docs,
    warnings: [...expandWarnings, ...parsed.warnings],
    summary,
    /** The back-off delays commit.js asked to sleep, in order (one per 429 it retried). */
    sleeps,
    server: state,
    puts: state.puts,
    putsByKey,
    storedByKey,
    idOf: (key) => state.byKey.get(key),
    /** The stored body of the one doc titled `title`. */
    bodyOf: (title) => {
      const hits = docs.filter((d) => d.title === title)
      if (hits.length !== 1) throw new Error(`${hits.length} docs titled ${JSON.stringify(title)}`)
      const body = storedByKey.get(hits[0].importKey)
      if (!body) throw new Error(`nothing stored for ${JSON.stringify(title)}`)
      return body
    },
  }
}

// ── reading a stored body ───────────────────────────────────────────────────

export const nodes = (body, type) => walkNodes(body).filter((n) => !type || n.type === type)
/** Every text run carrying a link mark: [{text, href}], in document order. */
export const storedLinks = (body) => nodes(body, 'text').flatMap((n) => (n.marks || [])
  .filter((m) => m.type === 'link').map((m) => ({ text: n.text, href: m.attrs.href })))
/**
 * The anchors a stored body renders as: adjacent text runs of one textblock that carry the SAME
 * link href are one `<a>` (a bold word inside a link is two runs, one anchor). [{text, href}].
 */
export function storedLinkAnchors(body) {
  const out = []
  for (const block of walkNodes(body)) {
    if (!Array.isArray(block.content) || !block.content.some((c) => c.type === 'text')) continue
    let open = null
    for (const child of block.content) {
      const href = child.type === 'text' ? (child.marks || []).find((m) => m.type === 'link')?.attrs?.href : undefined
      if (href === undefined) { open = null; continue }
      if (open && open.href === href) { open.text += child.text; continue }
      open = { text: child.text, href }
      out.push(open)
    }
  }
  return out
}
export const storedText = (body) => nodes(body, 'text').map((n) => n.text).join('')
export const noteHref = (id) => `/journal?j2tab=notebook&note=${id}`

// ── the real editor ─────────────────────────────────────────────────────────

const editors = []

/** The stored body, mounted read-only in the real editor; `editor.view.dom`. */
export function renderBody(bodyJson) {
  const element = document.createElement('div')
  document.body.appendChild(element)
  const editor = new Editor({ element, extensions: buildExtensions(), content: bodyJson, editable: false })
  editors.push(editor)
  return editor.view.dom
}

export function destroyEditors() {
  while (editors.length) editors.pop().destroy()
  document.body.textContent = ''
}

/** `<img>`s the body rendered (ProseMirror's own separator images excluded), raw `src`. */
export const renderedImgs = (root) => [...root.querySelectorAll('img:not(.ProseMirror-separator)')].map((i) => i.getAttribute('src'))
export const renderedChips = (root) => [...root.querySelectorAll('[data-type="attachmentChip"]')]
  .map((a) => ({ href: a.getAttribute('href'), name: a.textContent }))
export const renderedNotices = (root) => [...root.querySelectorAll('[data-type="import-notice"]')]
  .map((n) => ({ text: n.textContent, href: n.querySelector('a')?.getAttribute('href') ?? null }))

/** Text-link anchors in a rendered body (not a chip, a notice's "open the original", an embed bar). */
export const renderedLinks = (root) => [...root.querySelectorAll('a[href]')].filter((a) => a.getAttribute('data-type') !== 'attachmentChip'
  && !a.closest('[data-type="import-notice"]') && !a.closest('[data-type="web-embed"]'))
  .map((a) => ({ text: a.textContent, href: a.getAttribute('href'), plain: a.hasAttribute('data-link-plain') }))

const UNSAFE_READ = /^(javascript|data|vbscript|file):/i

/**
 * What must hold for EVERY note an import wrote, on the stored body AND the rendered DOM, raw:
 *   - every stored link renders, with the same href (sorted arrays, never Sets);
 *   - a rendered link has a door (web/mail/tel, an in-app note, a notion.so fallback) or is a
 *     plain-text placeholder; no stored or rendered href reads as an unsafe scheme;
 *   - every image renders its stored src, and every one is an attachment URL: nothing hotlinked,
 *     no `data:`, no `import-ref://` left anywhere;
 *   - every attachment chip is an attachment URL;
 *   - every importNotice renders its sentence (+ "open the original" to its sourceUrl).
 * Returns how many notes it checked, so a caller can pin that the corpus was not empty.
 */
export function assertCorpusInvariants(run) {
  let checked = 0
  for (const doc of run.docs) {
    // Written this run (a `skipped` note was finished by an earlier one) and with a media/link phase.
    const written = ['created', 'updated', 'recovered'].includes(run.summary.outcomes[doc.importKey])
    const needsPut = written && ((doc.media || []).length > 0 || (doc.links || []).length > 0)
    if (needsPut) expect(run.putsByKey.get(doc.importKey), `${doc.title}: an import with media or links is PUT`).toBeTruthy()
    const body = run.storedByKey.get(doc.importKey)
    expect(body, `${doc.title}: stored`).toBeTruthy()
    checked += 1
    const where = (s) => `${doc.title}: ${s}`
    const stored = storedLinks(body)
    for (const { href } of stored) expect(UNSAFE_READ.test(hrefAsRead(href)), where(href)).toBe(false)
    for (const img of nodes(body, 'image')) {
      expect(img.attrs.src.startsWith(ATTACH), where(img.attrs.src)).toBe(true)
    }
    for (const chip of nodes(body, 'attachmentChip')) expect(chip.attrs.href.startsWith(ATTACH), where(chip.attrs.href)).toBe(true)
    expect(JSON.stringify(body), where('no import-ref')).not.toContain('import-ref://')

    const root = renderBody(body)
    const links = renderedLinks(root)
    expect(links.map(({ text, href }) => ({ text, href })), where('links render raw, in order'))
      .toEqual(storedLinkAnchors(body))
    for (const l of links) {
      expect(UNSAFE_READ.test(hrefAsRead(l.href)), where(l.href)).toBe(false)
      if (l.plain) expect(isPlainTextPendingLink(l.href), where(l.href)).toBe(true)
      else expect(Boolean(openableLinkHref(l.href) || internalNoteIdFromHref(l.href) || pendingLinkFallbackHref(l.href)), where(`door for ${l.href}`)).toBe(true)
    }
    expect(renderedImgs(root), where('images')).toEqual(nodes(body, 'image').map((i) => i.attrs.src))
    expect(renderedChips(root).map((c) => c.href), where('chips')).toEqual(nodes(body, 'attachmentChip').map((c) => c.attrs.href))
    const notices = nodes(body, 'importNotice')
    expect(renderedNotices(root), where('notices')).toEqual(notices.map((n) => ({
      text: importNoticeText(n.attrs) + (n.attrs.sourceUrl ? ` — ${OPEN_ORIGINAL}` : ''),
      href: n.attrs.sourceUrl,
    })))
    expect(root.innerHTML, where('rendered import-ref')).not.toContain('import-ref://')
  }
  destroyEditors()
  return checked
}
