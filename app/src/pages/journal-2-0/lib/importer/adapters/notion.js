/**
 * Notion adapter.
 *
 * Detection: see `detect()` below (0.9 hex-suffixed-filename tier unchanged
 * from Task 9's stub; the 0.7 index.html tier tightened per Task 9's review
 * carry-forward to same-directory adjacency — an `index.html` scores 0.7
 * only when a hex-suffixed directory is a DIRECT sibling of it, not merely
 * present anywhere in the tree).
 *
 * Parse: Notion appends a 32-char hex page id to every exported file/folder
 * name (`<Title> <id>`). That id is stripped from every path segment when
 * building importKey/title/folderPath/link-targetKey, so the SAME logical
 * page re-exported later (fresh zip layout, fresh ids) still resolves to
 * the same keys. Raw (unstripped) paths are kept for `byPath` lookups,
 * since images/links inside the export reference the literal exported
 * filenames, hex ids and all.
 *
 * - Markdown lane via `mdToHtml` (Task 9) — `<aside>`/`<details>` HTML
 *   islands pass straight through (markdown-it's `html: true`).
 * - `.html` export files win over a `.md` twin for the same page id (same
 *   directory + identical "<title> <id>" stem); an internal link that still
 *   points at the losing `.md` twin is redirected to the `.html` winner's
 *   key.
 * - `.csv` "database" exports become a `<table>` doc when they have <= 50
 *   data rows; larger ones are skipped with a warning naming the file.
 * - Images/non-image attachments resolve exactly like the generic adapter
 *   (`import-ref://<path>` placeholders + media entries).
 */

import { mdToHtml } from './generic'

const NOTION_FILE_RE = / [0-9a-f]{32}\.(md|html|csv)$/i
const NOTION_DIR_RE = / [0-9a-f]{32}$/i
const STRIP_ID_RE = / [0-9a-f]{32}(?=(\.[a-z]+)?$)/i
const PAGE_EXT = /\.(md|html)$/i
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|heic)$/i
const CSV_MAX_ROWS = 50

export const notionAdapter = {
  id: 'notion',
  label: 'Notion',
  detect,
  parse,
}

// ---------------------------------------------------------------------------
// detection
// ---------------------------------------------------------------------------

function detect(vfiles) {
  if (!vfiles.length) return 0

  const basenames = vfiles.map((v) => basename(v.path))
  const matchCount = basenames.filter((n) => NOTION_FILE_RE.test(n)).length
  if (matchCount / vfiles.length >= 0.3) return 0.9

  // A single-page HTML export writes `index.html` PLUS a hex-suffixed
  // directory (sub-pages/assets) as DIRECT siblings in the same folder.
  // Tightened from "index.html anywhere + a hex-suffixed dir anywhere" per
  // the Task 9 review — that looser reading scored a coincidental
  // hex-suffixed dir located elsewhere in an unrelated tree.
  const indexDirs = vfiles
    .filter((v) => basename(v.path).toLowerCase() === 'index.html')
    .map((v) => dirOf(v.path))

  for (const dir of indexDirs) {
    const siblings = directChildNames(vfiles, dir)
    if ([...siblings].some((name) => NOTION_DIR_RE.test(name))) return 0.7
  }

  return 0
}

/** Names of entries (files or subdirectories) directly inside `dir`. */
function directChildNames(vfiles, dir) {
  const prefix = dir ? `${dir}/` : ''
  const names = new Set()
  for (const v of vfiles) {
    if (dir && !v.path.startsWith(prefix)) continue
    const rest = v.path.slice(prefix.length)
    if (!rest) continue
    names.add(rest.split('/')[0])
  }
  return names
}

// ---------------------------------------------------------------------------
// parse
// ---------------------------------------------------------------------------

/**
 * @param {import('../intake').VFile[]} vfiles
 * @param {{onProgress?: (p: {phase: string, done: number, total: number}) => void}} [opts]
 * @returns {Promise<{docs: object[], warnings: string[]}>}
 */
async function parse(vfiles, opts = {}) {
  const { onProgress } = opts
  const warnings = []
  const byPath = new Map(vfiles.map((v) => [v.path, v]))
  const { winners, shadow } = groupPageTwins(vfiles)

  const items = vfiles.filter((v) => {
    const ext = extOf(v.path)
    if (ext === 'md' || ext === 'html') return winners.has(v)
    return ext === 'csv'
  })

  const docs = []
  // Parallel to `docs` — the RAW (unstripped) source path that produced each
  // doc, kept only to disambiguate an importKey collision below (docs
  // themselves never carry it).
  const rawPaths = []
  let done = 0
  for (const vfile of items) {
    try {
      const ext = extOf(vfile.path)
      const doc =
        ext === 'csv'
          ? await makeCsvDoc(vfile, warnings)
          : await makePageDoc(vfile, ext, byPath, shadow)
      if (doc) {
        docs.push(doc)
        rawPaths.push(vfile.path)
      }
    } catch (err) {
      warnings.push(`Could not import "${vfile.path}": ${err?.message || err}`)
    }
    done += 1
    onProgress?.({ phase: 'parsing', done, total: items.length })
  }

  warnings.push(...resolveImportKeyCollisions(docs, rawPaths))

  return { docs, warnings }
}

// ---------------------------------------------------------------------------
// duplicate stripped-importKey collision handling
// ---------------------------------------------------------------------------

/**
 * Two distinct Notion pages can strip to the SAME importKey — e.g. two
 * same-directory pages named "Untitled" by their author, exported as
 * `Untitled <hexA>.md` / `Untitled <hexB>.md`. Both strip to
 * `notion:<dir>/Untitled.md`, and import_confirm keys upserts on importKey —
 * so without this, the second one silently UPDATEs (overwrites) the first
 * within a single confirm, losing its content with no error.
 *
 * For every colliding group, regenerate every doc's importKey using its RAW
 * (unstripped) source path, so the hex id that made the page unique in the
 * export makes its importKey unique too. Non-colliding docs are untouched —
 * they keep their clean, re-export-stable keys. Mutates `docs` in place;
 * returns warning strings naming the affected titles.
 */
function resolveImportKeyCollisions(docs, rawPaths) {
  const groups = new Map()
  docs.forEach((d, i) => {
    if (!groups.has(d.importKey)) groups.set(d.importKey, [])
    groups.get(d.importKey).push(i)
  })

  const warnings = []
  for (const [key, idxs] of groups) {
    if (idxs.length <= 1) continue
    for (const i of idxs) {
      docs[i].importKey = `notion:${rawPaths[i]}`
    }
    const titles = idxs.map((i) => docs[i].title).join(', ')
    warnings.push(
      `Multiple pages ("${titles}") share the same name and location, so they ` +
        `would have collapsed into one note on import (key ${key}). Kept them ` +
        'separate using their Notion page ids.'
    )
  }
  return warnings
}

// ---------------------------------------------------------------------------
// .md / .html page docs
// ---------------------------------------------------------------------------

/**
 * Groups .md/.html files by page identity (directory + "<title> <id>" stem
 * — everything but the extension; the id is deliberately NOT stripped here
 * since a true twin pair shares the identical stem). Within a group, .html
 * wins over .md. Returns the winning VFile set plus a shadow map from a
 * losing .md's path to its .html winner's path, so an internal link that
 * still points at the .md twin resolves to whichever page actually got
 * imported.
 */
function groupPageTwins(vfiles) {
  const groups = new Map()
  for (const v of vfiles) {
    const ext = extOf(v.path)
    if (ext !== 'md' && ext !== 'html') continue
    const key = pageIdentityKey(v.path)
    if (!groups.has(key)) groups.set(key, {})
    groups.get(key)[ext] = v
  }

  const winners = new Set()
  const shadow = new Map()
  for (const group of groups.values()) {
    const winner = group.html || group.md
    winners.add(winner)
    if (group.md && group.html) shadow.set(group.md.path, group.html.path)
  }
  return { winners, shadow }
}

function pageIdentityKey(path) {
  const dir = dirOf(path)
  const stem = filenameSansExt(basename(path))
  return dir ? `${dir}/${stem}` : stem
}

async function makePageDoc(vfile, ext, byPath, shadow) {
  const dir = dirOf(vfile.path)
  const rawHtml = ext === 'md' ? mdToHtml(await readText(vfile)) : await readText(vfile)
  const { html, media, links } = resolveReferences(rawHtml, dir, byPath, shadow)

  const strippedPath = stripIdPath(vfile.path)
  const strippedDir = dirOf(strippedPath)
  const title = extractH1Title(html) || filenameSansExt(basename(strippedPath))

  return {
    importKey: `notion:${strippedPath}`,
    title,
    html,
    tags: [],
    folderPath: strippedDir ? strippedDir.split('/') : [],
    media,
    links,
    ...datesFromLastModified(vfile.lastModified),
  }
}

/**
 * Resolves `<img src>` / `<a href>` targets relative to `dir` (the source
 * file's own directory) against the RAW (unstripped) path tree — Notion's
 * exported refs are literal filenames, hex ids included, so lookups happen
 * before any id-stripping.
 *  - image -> `import-ref://<resolvedPath>` + media entry (kind: 'image').
 *  - .md/.html target -> internal doc link: redirected through `shadow`
 *    when it points at a .md twin that lost to an .html winner, then
 *    rewritten to `data-import-link="notion:<id-stripped resolved path>"`
 *    (the original relative href is dropped — it's a raw Notion export path
 *    with no meaning post-import; Task 13's sanitizer supplies the real
 *    href from `data-import-link`, mirroring the Obsidian adapter's shape).
 *  - any other known sibling -> non-image attachment chip, same shape as
 *    the generic adapter (`data-type="attachmentChip"`,
 *    `href="import-ref://<resolvedPath>"`, `data-name`).
 *  - unresolvable/absolute/fragment-only refs are left untouched.
 */
function resolveReferences(html, dir, byPath, shadow) {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const media = []
  const links = []

  doc.querySelectorAll('img[src]').forEach((img) => {
    const src = img.getAttribute('src')
    if (!src || isAbsoluteRef(src)) return
    const resolvedPath = resolvePath(dir, src)
    const target = byPath.get(resolvedPath)
    if (!target) return
    img.setAttribute('src', `import-ref://${resolvedPath}`)
    media.push({ ref: resolvedPath, vfile: target, kind: 'image', name: basename(resolvedPath) })
  })

  doc.querySelectorAll('a[href]').forEach((a) => {
    const href = a.getAttribute('href')
    if (!href || isAbsoluteRef(href) || href.startsWith('#')) return
    const resolvedPath = resolvePath(dir, href)
    if (IMAGE_EXT.test(resolvedPath)) return // images are handled via <img>, not <a>

    if (PAGE_EXT.test(resolvedPath)) {
      const finalPath = shadow.get(resolvedPath) || resolvedPath
      if (!byPath.has(finalPath)) return // dangling internal link — leave inert
      const targetKey = `notion:${stripIdPath(finalPath)}`
      a.setAttribute('data-import-link', targetKey)
      a.removeAttribute('href')
      links.push({ targetKey, placeholder: href })
      return
    }

    const target = byPath.get(resolvedPath)
    if (!target) return
    const name = basename(resolvedPath)
    a.setAttribute('data-type', 'attachmentChip')
    a.setAttribute('data-import-ref', resolvedPath)
    a.setAttribute('data-name', name)
    a.setAttribute('href', `import-ref://${resolvedPath}`)
    media.push({ ref: resolvedPath, vfile: target, kind: 'file', name })
  })

  return { html: doc.body.innerHTML, media, links }
}

// ---------------------------------------------------------------------------
// .csv "database" docs
// ---------------------------------------------------------------------------

async function makeCsvDoc(vfile, warnings) {
  const text = await readText(vfile)
  const rows = parseCsv(text)
  if (rows.length === 0) return null

  const strippedPath = stripIdPath(vfile.path)
  const title = filenameSansExt(basename(strippedPath))
  const dataRowCount = rows.length - 1

  if (dataRowCount > CSV_MAX_ROWS) {
    warnings.push(
      `Skipped "${title}" (${vfile.path}): CSV database has ${dataRowCount} rows, ` +
        `only databases with ${CSV_MAX_ROWS} rows or fewer import as tables.`
    )
    return null
  }

  const dir = dirOf(strippedPath)
  return {
    importKey: `notion:${strippedPath}`,
    title,
    html: csvToTable(rows),
    tags: [],
    folderPath: dir ? dir.split('/') : [],
    media: [],
    links: [],
    ...datesFromLastModified(vfile.lastModified),
  }
}

function parseCsv(text) {
  return text
    .split(/\r\n|\r|\n/)
    .filter((line) => line.length > 0)
    .map(parseCsvLine)
}

/** Splits one CSV line on commas, respecting simple "quoted, with commas" fields (`""` = escaped quote). */
function parseCsvLine(line) {
  const fields = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i += 1
        } else {
          inQuotes = false
        }
      } else {
        cur += c
      }
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      fields.push(cur)
      cur = ''
    } else {
      cur += c
    }
  }
  fields.push(cur)
  return fields
}

function csvToTable(rows) {
  const [header, ...data] = rows
  const thead = `<thead><tr>${header.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>`
  const tbody = `<tbody>${data
    .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`)
    .join('')}</tbody>`
  return `<table>${thead}${tbody}</table>`
}

// ---------------------------------------------------------------------------
// id stripping
// ---------------------------------------------------------------------------

const stripId = (s) => s.replace(STRIP_ID_RE, '')

function stripIdPath(path) {
  return path.split('/').map(stripId).join('/')
}

// ---------------------------------------------------------------------------
// small path/text helpers (mirrors adapters/generic.js — kept self-contained
// per-adapter, matching the existing pattern rather than sharing internals)
// ---------------------------------------------------------------------------

async function readText(vfile) {
  const bytes = await vfile.bytes()
  return new TextDecoder('utf-8').decode(bytes)
}

function basename(path) {
  return path.split('/').pop()
}

function dirOf(path) {
  const idx = path.lastIndexOf('/')
  return idx === -1 ? '' : path.slice(0, idx)
}

function extOf(path) {
  const base = basename(path)
  const idx = base.lastIndexOf('.')
  return idx === -1 ? '' : base.slice(idx + 1).toLowerCase()
}

function filenameSansExt(name) {
  const idx = name.lastIndexOf('.')
  return idx > 0 ? name.slice(0, idx) : name
}

function isAbsoluteRef(src) {
  // Any URI scheme (http:, https:, mailto:, data:, import-ref:, tel:, ...) —
  // everything else is treated as a path relative to the doc's own directory.
  return /^[a-z][a-z0-9+.-]*:/i.test(src)
}

function resolvePath(dir, rel) {
  let clean = rel.split('#')[0].split('?')[0]
  try {
    clean = decodeURIComponent(clean)
  } catch {
    // malformed escape sequence — fall back to the raw string
  }
  const stack = dir ? dir.split('/') : []
  for (const part of clean.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      stack.pop()
      continue
    }
    stack.push(part)
  }
  return stack.join('/')
}

function extractH1Title(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const h1 = doc.querySelector('h1')
  const text = h1?.textContent?.trim()
  return text || null
}

function datesFromLastModified(lastModified) {
  if (lastModified == null) return {}
  const iso = new Date(lastModified).toISOString()
  return { createdAt: iso, updatedAt: iso }
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
