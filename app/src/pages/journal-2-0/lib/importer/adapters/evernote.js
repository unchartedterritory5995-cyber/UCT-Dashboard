/**
 * Evernote (.enex) adapter.
 *
 * Detection: 1.0 when the export contains any `.enex` file (Evernote's
 * export format is unambiguous — no other tool produces it).
 *
 * Parse:
 *  - Outer XML parsed via `DOMParser(..., 'text/xml')`. One doc per `<note>`.
 *  - `folderPath` = [enex filename sans extension] — the notebook name lives
 *    ONLY in the filename in ENEX, never inside the note XML itself. Two
 *    `.enex` files dropped together therefore land in two separate folders,
 *    one per file, since folderPath is derived per-vfile.
 *  - `<content>` CDATA holds an ENML fragment (`<?xml?>` + DOCTYPE preamble
 *    + `<en-note>...</en-note>`). Stripped of its preamble and re-parsed with
 *    a SECOND DOMParser as 'text/html' — forgiving of ENML's self-closing
 *    custom tags (`<en-todo/>`, `<en-media/>`), which HTML parsing does not
 *    honor as truly void: an `<en-todo checked="true"/>` immediately followed
 *    by text ends up wrapping that text as a *child* rather than leaving it
 *    as a sibling, because HTML tree construction ignores the self-closing
 *    flag on non-void, non-foreign elements. `extractTodoChecked` below
 *    unwraps `en-todo`'s children back out to its own position before
 *    grouping, so this is correct regardless of which shape the parser
 *    produced.
 *  - `<en-todo checked="true|false"/>` lines: consecutive sibling `<div>`s
 *    that each carry an `en-todo` are grouped into one
 *    `<ul data-type="taskList">` of `<li data-type="taskItem"
 *    data-checked="true|false">` items.
 *  - `<en-media type hash>` resolves against the note's `<resource>` list by
 *    MD5 of the resource's DECODED bytes (`SparkMD5.ArrayBuffer.hash`) — ENEX
 *    carries no explicit hash attribute on `<resource>` itself, so the match
 *    is computed, not read. An image-mime resource becomes
 *    `<img src="import-ref://<hash>">`; anything else becomes an attachment
 *    chip (`data-type="attachmentChip"` + `data-name` + `href="import-ref://<hash>"`
 *    — the href is LOAD-BEARING, Task 13 matches import-ref:// hrefs).
 *    Every media item carries the resource's declared `<mime>` (the upload
 *    door is sent it; the server sniffs the bytes and is the authority).
 *    An `<en-media>` whose hash matches no resource is paired with an uncited
 *    resource ONLY when unambiguous (`unambiguousPairs`: the only unmatched one
 *    of its kind, and exactly one uncited resource of that kind); otherwise it
 *    becomes `<img src="import-ref://missing-<n>">` plus a failed
 *    `missing_resource` media item, which the commit turns into a visible notice
 *    IN PLACE (E-14), and the uncited resources are appended. Never a guess,
 *    never a silent drop.
 *    Media inside a link is lifted out on the LIVE DOM in `parse()`, after the
 *    by-title link pass and after `resolveWebLinks` (so an emptied link shows its
 *    RESOLVED href, never a raw one), before anything serialises (E-4, E-11).
 *    Resources never referenced by an `<en-media>` are appended at the end of
 *    the note as their own kind (an image as `<img>`, a file as a chip). Two resources that
 *    happen to hash identically (byte-identical content) collapse to ONE
 *    deduped media entry (first-wins, matching `dedupeMedia`'s own first-wins
 *    order so a chip's `data-name` never disagrees with `media[]`'s) — every
 *    `<en-media>` citing that hash still resolves against it, and it is not
 *    double-appended as unreferenced.
 *    ⚠️ `<en-media/>` is ALSO self-closing custom-tag syntax, so it is subject
 *    to the exact same HTML-parsing trap as `<en-todo/>` above: any content
 *    textually AFTER an `<en-media/>` on the same line (a caption, a second
 *    `<en-media/>` citation) can land AS its child rather than as a later
 *    sibling. `replaceEnMedia` unwraps those children out to the position
 *    right after the injected `<img>`/chip — via the same `unwrapInPlace`
 *    helper `extractTodoChecked` uses — so that content is never discarded.
 *  - `<en-crypt>` becomes a plain, visible
 *    `<p>[encrypted content — cannot be imported]</p>` placeholder.
 *  - Links to another Evernote note (`isEvernoteNoteHref`: `evernote:///view/…`,
 *    shard / share / `/l/` links) keep their href and every child (bold, images)
 *    and are marked `data-evernote-link="1"` (E-6). ⚰️ They used to be replaced
 *    by their bare text, which erased an image inside one.
 *    Once EVERY .enex in the drop is parsed, `resolveEvernoteLinks` resolves them
 *    BY TITLE (the link's text; ENEX carries no note ids) on the live DOM, BEFORE
 *    the media lift: one note of that title in the import -> its importKey; none
 *    -> an `evernote-title:<title>` key the server heals later; two or more, or
 *    no text -> the link's content plus a warning (E-5, Q5).
 *  - `<note-attributes><source-url>` (a web clip's page), when http(s) and not
 *    our own site, becomes `doc.sourceUrl` (relative links resolve against it in
 *    the post-parse pass) and a visible first line `Source: <link>` (E-12).
 *  - Resource `<data>` is base64-decoded straight to a `Uint8Array` (the
 *    intermediate `atob()` binary string is never retained) and wrapped in a
 *    SYNTHETIC vfile named by the resource's hash, matching how the generic
 *    adapter synthesizes vfiles for mammoth-extracted docx images.
 *  - `importKey` = `evernote:<notebook filename>/<title>/<created RAW enDate
 *    string>` — stable across re-exports of the same notebook. Note this
 *    uses the RAW `YYYYMMDDTHHMMSSZ` string, not the ISO-converted `createdAt`.
 */

import SparkMD5 from 'spark-md5'
import { reportIgnoredFiles } from './reportIgnored'
import { liftMediaOutOfLinks } from '../mediaRefs'
import { resolveHref, neutraliseRefusedAnchor } from '../linkPolicy'
import { isEvernoteNoteHref, resolveEvernoteLinks, settleEvernoteLinks, pyStrip } from '../evernoteLinks'

const ENEX_EXT = /\.enex$/i
const ENML_PROLOG_RE = /^\s*<\?xml[^>]*\?>\s*<!DOCTYPE[^>]*>\s*/i

export const evernoteAdapter = {
  id: 'evernote',
  label: 'Evernote',
  detect,
  parse,
}

function detect(vfiles) {
  return vfiles.some((v) => ENEX_EXT.test(v.path)) ? 1.0 : 0
}

/**
 * @param {import('../intake').VFile[]} vfiles
 * @param {{onProgress?: (p: {phase: string, done: number, total: number}) => void}} [opts]
 * @returns {Promise<{docs: object[], warnings: string[]}>}
 */
async function parse(vfiles, opts = {}) {
  const { onProgress } = opts
  const warnings = []
  const docs = []

  const enexFiles = vfiles.filter((v) => ENEX_EXT.test(v.path))
  let done = 0
  for (const vfile of enexFiles) {
    const notebookName = filenameSansExt(basename(vfile.path))
    try {
      const text = new TextDecoder('utf-8').decode(await vfile.bytes())
      const xmlDoc = new DOMParser().parseFromString(text, 'text/xml')
      if (xmlDoc.querySelector('parsererror')) {
        throw new Error('Could not parse .enex XML')
      }
      const noteEls = Array.from(xmlDoc.querySelectorAll('note'))
      for (const noteEl of noteEls) {
        try {
          // `root` = the note's LIVE DOM, held until every .enex is parsed (Task 7).
          docs.push(await makeNoteDoc(noteEl, notebookName))
        } catch (err) {
          const t = pyStrip(noteEl.querySelector('title')?.textContent) || '(untitled)'
          warnings.push(`Could not import note "${t}" in "${vfile.path}": ${err?.message || err}`)
        }
      }
    } catch (err) {
      warnings.push(`Could not import "${vfile.path}": ${err?.message || err}`)
    }
    done += 1
    onProgress?.({ phase: 'parsing', done, total: enexFiles.length })
  }

  // Task 7 (E-5, Q5): note links resolve BY TITLE, across every .enex in the drop, on the LIVE
  // DOM and BEFORE the lift: the lift unwraps a note link with no text, so a pass after it would
  // meet a link already gone. A resolved link keeps its marker through the lift, so the lift
  // still moves media out of it; `settleEvernoteLinks` then drops the href and the marker.
  resolveEvernoteLinks(docs, warnings)
  for (const doc of docs) {
    const root = doc.root
    delete doc.root
    // ⛔ Before the lift (fix round 1, ruling 2): the lift writes an emptied link's HREF as its
    // text, so that href must already be the resolved one, and an unsafe or unresolvable link
    // must already be its content. Otherwise `/chart` or `javascript:x` became visible text.
    resolveWebLinks(root, doc.sourceUrl)
    // ⛔ On the LIVE DOM, before anything serialises (Review Focus 1): a chip is itself an <a>, and
    // a chip inside a link, written out and parsed again, closes the outer link early.
    liftMediaOutOfLinks(root)
    settleEvernoteLinks(root)
    doc.html = root.innerHTML
  }

  // audit B4: Evernote resources travel as base64 INSIDE the .enex XML, never
  // as separate files, so any non-.enex vfile in the drop is by construction
  // something this adapter did not use — most commonly another platform's
  // export, dropped alongside per the Export Guide's own "drop them all in
  // together" advice. Name it instead of discarding it with no signal.
  const ignored = vfiles.filter((v) => !ENEX_EXT.test(v.path))
  warnings.push(...reportIgnoredFiles(ignored, evernoteAdapter.label))

  return { docs, warnings }
}

// ---------------------------------------------------------------------------
// per-note conversion
// ---------------------------------------------------------------------------

async function makeNoteDoc(noteEl, notebookName) {
  // `pyStrip`, not `trim()`: the server stores `title.strip()` (Python), and a title the two
  // sides strip differently resolves here but never heals there (Task 7 fix round 1).
  const title = pyStrip(noteEl.querySelector('title')?.textContent) || 'Untitled'
  const createdRaw = noteEl.querySelector('created')?.textContent?.trim() || ''
  const updatedRaw = noteEl.querySelector('updated')?.textContent?.trim() || createdRaw
  const tags = Array.from(noteEl.querySelectorAll('tag')).map((t) => t.textContent.trim())
  const contentText = noteEl.querySelector('content')?.textContent || ''

  const resourceEls = Array.from(noteEl.querySelectorAll('resource'))
  const resources = await Promise.all(resourceEls.map(parseResource))
  // First-wins on a duplicate hash (byte-identical resources) — matches
  // dedupeMedia's own first-wins order below, so an <en-media>/chip's
  // data-name can never disagree with the media[] entry a caller resolves
  // the same hash to. `new Map(pairs)` would be last-wins; build it by hand.
  const resourcesByHash = new Map()
  for (const r of resources) {
    if (!resourcesByHash.has(r.hash)) resourcesByHash.set(r.hash, r)
  }

  const innerDoc = new DOMParser().parseFromString(stripEnmlProlog(contentText), 'text/html')
  const enNote = innerDoc.querySelector('en-note') || innerDoc.body

  replaceEnCrypt(enNote)
  // Before the lift: an emptied note link is unwrapped (data-evernote-link), never shown as its
  // raw `evernote:///…` href.
  markEvernoteLinks(enNote)
  const referencedHashes = new Set()
  const missing = replaceEnMedia(innerDoc, enNote, resources, resourcesByHash, referencedHashes)
  // The lift (media out of links) runs in `parse()`, after the by-title link pass (Task 7).
  groupTodoLines(enNote)
  appendUnreferencedMedia(innerDoc, enNote, resources, referencedHashes)

  const sourceUrl = noteSourceUrl(noteEl)
  if (sourceUrl) prependSourceLine(innerDoc, enNote, sourceUrl)

  const media = dedupeMedia([
    ...resources.map((r) => ({ ref: r.hash, vfile: r.vfile, kind: r.kind, name: r.name, mime: r.mime })),
    ...missing,
  ])

  return {
    importKey: `evernote:${notebookName}/${title}/${createdRaw}`,
    title,
    // Written by `parse()` once links are resolved and media lifted; until then `root` holds it.
    html: '',
    root: enNote,
    tags,
    folderPath: [notebookName],
    media,
    links: [],
    createdAt: enDate(createdRaw),
    updatedAt: enDate(updatedRaw),
    ...(sourceUrl ? { sourceUrl } : {}),
  }
}

/**
 * The post-parse pass's href step (`postParse.js` step 3), run early on the live DOM: every link
 * that is not a note link gets `resolveHref(href, sourceUrl)` written back, or becomes its content
 * (children kept, media stays in place) when that is null. Note links are left to
 * `resolveEvernoteLinks`/`settleEvernoteLinks`. finishDoc repeats the step; it is idempotent.
 */
function resolveWebLinks(root, sourceUrl) {
  for (const a of [...root.querySelectorAll('a[href]')]) {
    if (a.hasAttribute('data-evernote-link')) continue
    const href = a.getAttribute('href')
    const resolved = resolveHref(href, sourceUrl || null)
    if (resolved === null) neutraliseRefusedAnchor(a)
    else if (resolved !== href) a.setAttribute('href', resolved)
  }
}

// ---------------------------------------------------------------------------
// the web clip's source URL (E-12)
// ---------------------------------------------------------------------------

const APP_HOST = 'uctintelligence.com'

/** The NOTE's `<note-attributes><source-url>` (never a resource's), when it is an http(s) URL
 *  off our own site; otherwise undefined. The post-parse pass resolves relative links against it. */
function noteSourceUrl(noteEl) {
  const attrs = Array.from(noteEl.children).find((c) => c.tagName === 'note-attributes')
  const el = attrs && Array.from(attrs.children).find((c) => c.tagName === 'source-url')
  const raw = el?.textContent?.trim()
  if (!raw) return undefined
  let url
  try {
    url = new URL(raw)
  } catch {
    return undefined
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
  const host = url.hostname.toLowerCase()
  if (!host || host === APP_HOST || host.endsWith('.' + APP_HOST)) return undefined
  return raw
}

/** `<p>Source: <a href="URL">URL</a></p>` as the note's first line: visible and clickable. */
function prependSourceLine(doc, enNote, sourceUrl) {
  const p = doc.createElement('p')
  p.appendChild(doc.createTextNode('Source: '))
  const a = doc.createElement('a')
  a.setAttribute('href', sourceUrl)
  a.textContent = sourceUrl
  p.appendChild(a)
  enNote.insertBefore(p, enNote.firstChild)
}

// ---------------------------------------------------------------------------
// resources (base64 -> bytes -> MD5 -> synthetic vfile)
// ---------------------------------------------------------------------------

async function parseResource(resourceEl) {
  const dataEl = resourceEl.querySelector('data')
  const mimeEl = resourceEl.querySelector('mime')
  const fileNameEl = resourceEl.querySelector('resource-attributes file-name')

  const b64 = (dataEl?.textContent || '').replace(/\s+/g, '')
  const bytes = base64ToBytes(b64)
  const hash = SparkMD5.ArrayBuffer.hash(bytes.buffer).toLowerCase()
  const mime = mimeEl?.textContent?.trim() || 'application/octet-stream'
  const kind = mime.startsWith('image/') ? 'image' : 'file'
  const name = fileNameEl?.textContent?.trim() || `attachment.${extFromMime(mime)}`

  const vfile = {
    path: hash,
    size: bytes.length,
    lastModified: null,
    bytes: async () => bytes,
  }

  return { hash, mime, kind, name, vfile }
}

function base64ToBytes(b64) {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function extFromMime(mime) {
  const subtype = (mime.split('/')[1] || 'bin').toLowerCase()
  const MAP = { jpeg: 'jpg', 'svg+xml': 'svg', quicktime: 'mov', msword: 'doc' }
  return MAP[subtype] || subtype.replace(/^x-/, '')
}

// ---------------------------------------------------------------------------
// ENML -> HTML in-DOM transforms
// ---------------------------------------------------------------------------

function stripEnmlProlog(text) {
  return text.replace(ENML_PROLOG_RE, '')
}

function replaceEnCrypt(root) {
  root.querySelectorAll('en-crypt').forEach((el) => {
    const p = root.ownerDocument.createElement('p')
    p.textContent = '[encrypted content — cannot be imported]'
    el.replaceWith(p)
  })
}

/**
 * `<en-media/>` is self-closing custom-tag syntax, same as `<en-todo/>` — HTML
 * tree construction ignores the self-closing flag on it too, so content
 * textually AFTER an `<en-media/>` on the same line (a caption, a second
 * `<en-media/>` citation) can land AS ITS CHILD rather than as a later
 * sibling. A plain `el.replaceWith(mediaNode)` would silently discard that
 * subtree. Instead: insert the replacement node at el's position, then
 * `unwrapInPlace(el)` moves el's children out to occupy el's OLD position
 * (now immediately after the inserted node) before the empty shell is
 * removed — so trailing content survives, in order, right after the
 * `<img>`/chip it followed in the source.
 */
function replaceEnMedia(doc, root, resources, resourcesByHash, referencedHashes) {
  const els = Array.from(root.querySelectorAll('en-media'))
  const hashOf = (el) => (el.getAttribute('hash') || '').toLowerCase()
  // Exact matches first, across the whole note, so a mismatched <en-media> earlier in the note
  // can never take a resource a later one cites exactly.
  for (const el of els) if (resourcesByHash.has(hashOf(el))) referencedHashes.add(hashOf(el))
  const pairs = unambiguousPairs(els.filter((el) => !resourcesByHash.has(hashOf(el))), resourcesByHash, referencedHashes)

  const missing = []
  for (const el of els) {
    const hash = hashOf(el)
    const resource = resourcesByHash.get(hash) || pairs.get(el) || null
    if (resource) referencedHashes.add(resource.hash)
    let node
    if (resource) {
      node = mediaNode(doc, resource)
    } else {
      // No unambiguous resource: a placeholder the commit turns into a visible missing_resource
      // notice IN PLACE. Never a silent drop; any uncited resource is still appended at the end.
      const ref = `missing-${missing.length + 1}`
      missing.push({ ref, kind: 'image', name: null, failed: { reason: 'missing_resource', sourceUrl: null } })
      node = doc.createElement('img')
      node.setAttribute('src', `import-ref://${ref}`)
    }
    el.parentNode.insertBefore(node, el)
    unwrapInPlace(el)
  }
  return missing
}

/** The media kind an `<en-media type>` asks for; null (any) when it has none. */
function kindOfType(type) {
  const t = (type || '').trim().toLowerCase()
  if (!t) return null
  return t.startsWith('image/') ? 'image' : 'file'
}

/**
 * E-14 (fix round 1, ruling 1): an `<en-media>` whose hash matches no resource (an export that
 * re-encoded the bytes) is paired with an uncited resource ONLY when that cannot be a guess:
 * it is the ONLY unmatched en-media of its kind and there is exactly ONE uncited resource of
 * that kind. An en-media with no `type` pairs only when it is the only unmatched one of all and
 * exactly one resource is uncited. ⛔ Never positional: two and two in swapped order would put
 * each picture where the other belongs. Everything else is a notice in place, and the uncited
 * resources are appended at the end, so no bytes are lost.
 * @returns {Map<Element, object>} en-media -> its resource
 */
function unambiguousPairs(unmatched, resourcesByHash, referencedHashes) {
  const pairs = new Map()
  const uncited = [...resourcesByHash.values()].filter((r) => !referencedHashes.has(r.hash))
  const typed = (k) => unmatched.filter((el) => kindOfType(el.getAttribute('type')) === k)
  const untyped = typed(null)
  for (const k of ['image', 'file']) {
    const els = typed(k)
    const candidates = uncited.filter((r) => r.kind === k)
    if (els.length === 1 && candidates.length === 1 && untyped.length === 0) pairs.set(els[0], candidates[0])
  }
  if (untyped.length === 1 && unmatched.length === 1 && uncited.length === 1) pairs.set(untyped[0], uncited[0])
  return pairs
}

/** Moves `el`'s children out to occupy `el`'s own position, then removes the
 * now-empty `el`. Used to recover content HTML parsing nested inside a
 * self-closing ENML tag (`en-todo`, `en-media`) instead of leaving it a
 * later sibling. */
function unwrapInPlace(el) {
  const parent = el.parentNode
  while (el.firstChild) parent.insertBefore(el.firstChild, el)
  parent.removeChild(el)
}

function mediaNode(doc, resource) {
  if (resource.kind === 'image') {
    const img = doc.createElement('img')
    img.setAttribute('src', `import-ref://${resource.hash}`)
    return img
  }
  const a = doc.createElement('a')
  a.setAttribute('data-type', 'attachmentChip')
  a.setAttribute('data-import-ref', resource.hash)
  a.setAttribute('data-name', resource.name)
  a.setAttribute('href', `import-ref://${resource.hash}`)
  return a
}

/** Resources nothing cites, appended at the end AS THEIR OWN KIND: an image as `<img>`, a file
 *  as a chip. */
function appendUnreferencedMedia(doc, enNote, resources, referencedHashes) {
  // Dedupe by hash, not just by `referencedHashes` membership: two resources
  // that are BOTH unreferenced but byte-identical (same computed MD5) must
  // not each be appended — that would contradict the file-level
  // "not double-appended as unreferenced" guarantee documented above.
  const appended = new Set()
  for (const r of resources) {
    if (referencedHashes.has(r.hash) || appended.has(r.hash)) continue
    appended.add(r.hash)
    enNote.appendChild(mediaNode(doc, r))
  }
}

/** A link to another Evernote note keeps its href and EVERY child (bold, images) and is marked
 *  `data-evernote-link="1"` (E-6). ⚰️ It used to be replaced by its `textContent`, which erased
 *  an image inside it and flattened its formatting. */
function markEvernoteLinks(root) {
  root.querySelectorAll('a[href]').forEach((a) => {
    if (isEvernoteNoteHref(a.getAttribute('href'))) a.setAttribute('data-evernote-link', '1')
  })
}

/**
 * Groups consecutive `<div>` siblings that each carry an `<en-todo>` into one
 * `<ul data-type="taskList">` of `<li data-type="taskItem" data-checked>`
 * items. Runs per-parent so nested todo lines (not just top-level en-note
 * children) are grouped too.
 */
function groupTodoLines(root) {
  const parents = new Set()
  root.querySelectorAll('en-todo').forEach((t) => {
    const div = t.closest('div')
    if (div && div.parentNode) parents.add(div.parentNode)
  })
  parents.forEach((parent) => groupConsecutiveTodoDivs(parent))
}

function groupConsecutiveTodoDivs(parent) {
  const children = Array.from(parent.children)
  let i = 0
  while (i < children.length) {
    if (!isTodoDiv(children[i])) {
      i += 1
      continue
    }
    const start = i
    while (i < children.length && isTodoDiv(children[i])) i += 1
    const run = children.slice(start, i)

    const doc = parent.ownerDocument
    const ul = doc.createElement('ul')
    ul.setAttribute('data-type', 'taskList')
    for (const div of run) {
      const checked = extractTodoChecked(div)
      const li = doc.createElement('li')
      li.setAttribute('data-type', 'taskItem')
      li.setAttribute('data-checked', checked ? 'true' : 'false')
      while (div.firstChild) li.appendChild(div.firstChild)
      ul.appendChild(li)
    }
    parent.insertBefore(ul, run[0])
    run.forEach((div) => div.remove())
  }
}

function isTodoDiv(el) {
  return el.tagName === 'DIV' && !!el.querySelector('en-todo')
}

/**
 * Reads `checked` off the div's `<en-todo>`, then `unwrapInPlace`s it — HTML
 * tree construction does not honor ENML's self-closing syntax on this custom
 * element, so text following `<en-todo/>` can land AS en-todo's child rather
 * than as a later sibling. Correct regardless of which shape the parser
 * produced. Same trap, same fix, as `replaceEnMedia` below.
 */
function extractTodoChecked(div) {
  const todo = div.querySelector('en-todo')
  const checked = todo.getAttribute('checked') === 'true'
  unwrapInPlace(todo)
  return checked
}

// ---------------------------------------------------------------------------
// dates
// ---------------------------------------------------------------------------

const enDate = (s) => (s || '').replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z')

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

function dedupeMedia(list) {
  const seen = new Set()
  const out = []
  for (const m of list) {
    if (seen.has(m.ref)) continue
    seen.add(m.ref)
    out.push(m)
  }
  return out
}

function basename(path) {
  return path.split('/').pop()
}

function filenameSansExt(name) {
  const idx = name.lastIndexOf('.')
  return idx > 0 ? name.slice(0, idx) : name
}
