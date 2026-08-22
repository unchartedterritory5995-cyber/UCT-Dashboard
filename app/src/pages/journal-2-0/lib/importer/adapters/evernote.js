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
 *    Resources never referenced by an `<en-media>` are appended as the same
 *    attachment-chip markup at the end of the note. Two resources that
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
 *  - `evernote:///...` links are unwrapped to their bare text (an internal
 *    Evernote deep link has no meaning post-import).
 *  - Resource `<data>` is base64-decoded straight to a `Uint8Array` (the
 *    intermediate `atob()` binary string is never retained) and wrapped in a
 *    SYNTHETIC vfile named by the resource's hash, matching how the generic
 *    adapter synthesizes vfiles for mammoth-extracted docx images.
 *  - `importKey` = `evernote:<notebook filename>/<title>/<created RAW enDate
 *    string>` — stable across re-exports of the same notebook. Note this
 *    uses the RAW `YYYYMMDDTHHMMSSZ` string, not the ISO-converted `createdAt`.
 */

import SparkMD5 from 'spark-md5'

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
          docs.push(await makeNoteDoc(noteEl, notebookName))
        } catch (err) {
          const t = noteEl.querySelector('title')?.textContent?.trim() || '(untitled)'
          warnings.push(`Could not import note "${t}" in "${vfile.path}": ${err?.message || err}`)
        }
      }
    } catch (err) {
      warnings.push(`Could not import "${vfile.path}": ${err?.message || err}`)
    }
    done += 1
    onProgress?.({ phase: 'parsing', done, total: enexFiles.length })
  }

  return { docs, warnings }
}

// ---------------------------------------------------------------------------
// per-note conversion
// ---------------------------------------------------------------------------

async function makeNoteDoc(noteEl, notebookName) {
  const title = noteEl.querySelector('title')?.textContent?.trim() || 'Untitled'
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
  const referencedHashes = new Set()
  replaceEnMedia(innerDoc, enNote, resourcesByHash, referencedHashes)
  unwrapEvernoteLinks(enNote)
  groupTodoLines(enNote)
  appendUnreferencedChips(innerDoc, enNote, resources, referencedHashes)

  const media = dedupeMedia(
    resources.map((r) => ({ ref: r.hash, vfile: r.vfile, kind: r.kind, name: r.name }))
  )

  return {
    importKey: `evernote:${notebookName}/${title}/${createdRaw}`,
    title,
    html: enNote.innerHTML,
    tags,
    folderPath: [notebookName],
    media,
    links: [],
    createdAt: enDate(createdRaw),
    updatedAt: enDate(updatedRaw),
  }
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
function replaceEnMedia(doc, root, resourcesByHash, referencedHashes) {
  root.querySelectorAll('en-media').forEach((el) => {
    const hash = (el.getAttribute('hash') || '').toLowerCase()
    const resource = resourcesByHash.get(hash)
    if (!resource) {
      // Dangling reference — no matching resource in this note. Unwrap
      // rather than remove, so any trailing content HTML parsing nested
      // inside it is not discarded along with the unrenderable tag.
      unwrapInPlace(el)
      return
    }
    referencedHashes.add(hash)
    el.parentNode.insertBefore(mediaNode(doc, resource), el)
    unwrapInPlace(el)
  })
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

function appendUnreferencedChips(doc, enNote, resources, referencedHashes) {
  // Dedupe by hash, not just by `referencedHashes` membership: two resources
  // that are BOTH unreferenced but byte-identical (same computed MD5) must
  // not each get their own chip — that would contradict the file-level
  // "not double-appended as unreferenced" guarantee documented above.
  const appended = new Set()
  for (const r of resources) {
    if (referencedHashes.has(r.hash) || appended.has(r.hash)) continue
    appended.add(r.hash)
    enNote.appendChild(mediaNode(doc, { ...r, kind: 'file' }))
  }
}

function unwrapEvernoteLinks(root) {
  root.querySelectorAll('a[href^="evernote:///"]').forEach((a) => {
    a.replaceWith(root.ownerDocument.createTextNode(a.textContent))
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
