import MarkdownIt from 'markdown-it'
import taskLists from 'markdown-it-task-lists'

// ---------------------------------------------------------------------------
// mdToHtml — exported for reuse by the Obsidian/Notion adapters (Tasks 10/11).
// ---------------------------------------------------------------------------

let _md
function getMd() {
  if (!_md) {
    _md = new MarkdownIt({ html: true, linkify: true }).use(taskLists)
  }
  return _md
}

export function mdToHtml(text) {
  return getMd().render(text || '')
}

// ---------------------------------------------------------------------------
// generic adapter
// ---------------------------------------------------------------------------

const SUPPORTED_EXT = /\.(md|txt|html|docx)$/i
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|heic)$/i
const TEXTBUNDLE_TEXT_RE = /\.textbundle\/text\.md$/i
const TEXTBUNDLE_DIR_RE = /(^|\/)[^/]+\.textbundle\//i

export const genericAdapter = {
  id: 'file',
  label: 'Files (Markdown, Text, HTML, Word)',
  detect,
  parse,
}

function detect(vfiles) {
  const hasSupported = vfiles.some(
    (v) => SUPPORTED_EXT.test(v.path) || TEXTBUNDLE_TEXT_RE.test(v.path)
  )
  return hasSupported ? 0.1 : 0
}

/**
 * @param {import('../intake').VFile[]} vfiles
 * @param {{onProgress?: (p: {phase: string, done: number, total: number}) => void}} [opts]
 * @returns {Promise<{docs: object[], warnings: string[]}>}
 */
async function parse(vfiles, opts = {}) {
  const { onProgress } = opts
  const warnings = []
  const byPath = new Map(vfiles.map((v) => [v.path, v]))

  // TextBundle dirs (`X.textbundle/text.md` + `assets/`) collapse into ONE
  // doc named after the bundle. Their text.md (and any other member under
  // the bundle dir) is excluded from ordinary single-file processing below.
  const bundleTextPaths = new Set()
  const bundles = []
  for (const v of vfiles) {
    if (!TEXTBUNDLE_TEXT_RE.test(v.path)) continue
    bundleTextPaths.add(v.path)
    bundles.push({ bundleDir: v.path.slice(0, v.path.length - '/text.md'.length), textVfile: v })
  }

  const singleFiles = vfiles.filter((v) => {
    if (bundleTextPaths.has(v.path)) return false
    if (TEXTBUNDLE_DIR_RE.test(v.path)) return false // other bundle members (assets/, info.json)
    return SUPPORTED_EXT.test(v.path)
  })

  const items = [
    ...bundles.map((b) => ({ type: 'bundle', ...b })),
    ...singleFiles.map((v) => ({ type: 'file', vfile: v })),
  ]

  const docs = []
  let done = 0
  for (const item of items) {
    try {
      const doc =
        item.type === 'bundle'
          ? await makeBundleDoc(item, byPath)
          : await makeFileDoc(item.vfile, byPath, warnings)
      docs.push(doc)
    } catch (err) {
      const path = item.vfile ? item.vfile.path : item.bundleDir
      warnings.push(`Could not import "${path}": ${err?.message || err}`)
    }
    done += 1
    onProgress?.({ phase: 'parsing', done, total: items.length })
  }

  warnings.push(...applyFallbackImageBug(docs))

  return { docs, warnings }
}

// ---------------------------------------------------------------------------
// per-file conversion
// ---------------------------------------------------------------------------

async function makeFileDoc(vfile, byPath, warnings) {
  const ext = extOf(vfile.path)
  const dir = dirOf(vfile.path)
  let html
  let extraMedia = []

  if (ext === 'md') {
    html = mdToHtml(await readText(vfile))
  } else if (ext === 'txt') {
    html = txtToHtml(await readText(vfile))
  } else if (ext === 'html') {
    html = await readText(vfile)
  } else if (ext === 'docx') {
    const converted = await convertDocx(vfile)
    html = converted.html
    extraMedia = converted.media
    warnings.push(...converted.warnings)
  } else {
    throw new Error(`Unsupported file type: ${vfile.path}`)
  }

  const resolved = resolveRelativeMedia(html, dir, byPath)
  const media = dedupeMedia([...extraMedia, ...resolved.media])
  const title = extractH1Title(resolved.html) || filenameSansExt(vfile.path)

  return {
    importKey: `file:${vfile.path}`,
    title,
    html: resolved.html,
    tags: [],
    folderPath: dir ? dir.split('/') : [],
    media,
    links: [],
    ...datesFromLastModified(vfile.lastModified),
  }
}

async function makeBundleDoc(item, byPath) {
  const { bundleDir, textVfile } = item
  const html = mdToHtml(await readText(textVfile))
  const resolved = resolveRelativeMedia(html, bundleDir, byPath)
  const media = dedupeMedia(resolved.media)
  const title = extractH1Title(resolved.html) || bundleTitleFromDir(bundleDir)
  const parentDir = dirOf(bundleDir)

  return {
    importKey: `file:${bundleDir}`,
    title,
    html: resolved.html,
    tags: [],
    folderPath: parentDir ? parentDir.split('/') : [],
    media,
    links: [],
    ...datesFromLastModified(textVfile.lastModified),
  }
}

async function convertDocx(vfile) {
  const bytes = await vfile.bytes()
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  const mammoth = await import('mammoth')
  const result = await mammoth.convertToHtml({ arrayBuffer })
  const { html, media } = extractDocxImages(result.value)
  const warnings = (result.messages || [])
    .filter((m) => m.type === 'warning')
    .map((m) => `${vfile.path}: ${m.message}`)
  return { html, media, warnings }
}

/**
 * mammoth's default image handling embeds images as base64 data URIs. Pull
 * each one out into a synthetic VFile (`docx-img-N`) so it flows through the
 * same media/upload pipeline as every other attachment, and swap the <img>
 * src for the same import-ref:// placeholder scheme used elsewhere.
 */
function extractDocxImages(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const media = []
  let counter = 0
  doc.querySelectorAll('img[src^="data:"]').forEach((img) => {
    const src = img.getAttribute('src') || ''
    const match = /^data:([^;,]+);base64,([\s\S]*)$/i.exec(src)
    if (!match) return
    counter += 1
    const bytes = base64ToBytes(match[2])
    const name = `docx-img-${counter}`
    const syntheticVfile = {
      path: name,
      size: bytes.length,
      lastModified: null,
      bytes: async () => bytes,
    }
    img.setAttribute('src', `import-ref://${name}`)
    media.push({ ref: name, vfile: syntheticVfile, kind: 'image', name })
  })
  return { html: doc.body.innerHTML, media }
}

function base64ToBytes(b64) {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

// ---------------------------------------------------------------------------
// .txt -> escaped, blank-line-separated paragraphs
// ---------------------------------------------------------------------------

function txtToHtml(text) {
  const paragraphs = (text || '')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
  return paragraphs.map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('')
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// ---------------------------------------------------------------------------
// relative <img>/<a> reference resolution -> import-ref:// media placeholders
// ---------------------------------------------------------------------------

/**
 * Resolves relative `<img src>` / `<a href>` targets against `dir` (the
 * doc's own directory) into known sibling vfiles, rewriting them to
 * `import-ref://<path>` placeholders and collecting `{ref, vfile, kind, name}`
 * media entries. Also doubles as the ".html -> body as-is" extraction step,
 * since DOMParser populates `.body` whether given a full document or a
 * fragment.
 */
function resolveRelativeMedia(html, dir, byPath) {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const media = []

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
    const target = byPath.get(resolvedPath)
    if (!target) return
    if (IMAGE_EXT.test(resolvedPath)) return // images are handled via <img>, not <a>
    // A relative link to another importable doc (.md/.txt/.html/.docx/a
    // TextBundle's text.md) is a link BETWEEN notes, not a file attachment —
    // leave it as an inert relative anchor. Resolving doc-to-doc links into
    // `data-import-link="<targetKey>"` is the Notion/Obsidian adapters' job.
    if (SUPPORTED_EXT.test(resolvedPath)) return
    const name = basename(resolvedPath)
    a.setAttribute('data-type', 'attachmentChip')
    a.setAttribute('data-import-ref', resolvedPath)
    a.setAttribute('data-name', name)
    // The AttachmentChip TipTap node (Task 5) reads `href` in parseHTML — not
    // `data-import-ref` — mirroring the <img src> branch above. Without this,
    // the placeholder never reaches bodyJson and Task 13's rewriteBody (which
    // matches `href === 'import-ref://<ref>'`) has nothing to swap.
    a.setAttribute('href', `import-ref://${resolvedPath}`)
    media.push({ ref: resolvedPath, vfile: target, kind: 'file', name })
  })

  return { html: doc.body.innerHTML, media }
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

// ---------------------------------------------------------------------------
// Apple Notes "FallbackImage.png" bulk-export bug
// ---------------------------------------------------------------------------
// A known Apple Notes export bug stamps a placeholder image named exactly
// "FallbackImage.png" (same basename, one copy per note folder) into every
// note that failed to export its real attachment. If more than one doc ends
// up referencing an image with that basename, none of those references are
// real images worth importing — drop them all and say which notes lost one.

function applyFallbackImageBug(docs) {
  const pairs = []
  for (const doc of docs) {
    for (const m of doc.media) {
      if (m.kind === 'image' && basename(m.ref) === 'FallbackImage.png') {
        pairs.push({ doc, ref: m.ref })
      }
    }
  }
  const distinctDocs = [...new Set(pairs.map((p) => p.doc))]
  if (distinctDocs.length <= 1) return []

  for (const doc of distinctDocs) {
    const dropRefs = doc.media
      .filter((m) => m.kind === 'image' && basename(m.ref) === 'FallbackImage.png')
      .map((m) => m.ref)
    doc.media = doc.media.filter((m) => !(m.kind === 'image' && basename(m.ref) === 'FallbackImage.png'))
    doc.html = stripImgBySrc(
      doc.html,
      dropRefs.map((r) => `import-ref://${r}`)
    )
  }

  const names = distinctDocs.map((d) => d.title).join(', ')
  return [`Dropped shared "FallbackImage.png" image references (Apple Notes bulk-export bug) in: ${names}`]
}

function stripImgBySrc(html, srcs) {
  if (!srcs.length) return html
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const srcSet = new Set(srcs)
  doc.querySelectorAll('img[src]').forEach((img) => {
    if (srcSet.has(img.getAttribute('src'))) img.remove()
  })
  return doc.body.innerHTML
}

// ---------------------------------------------------------------------------
// small path/text helpers
// ---------------------------------------------------------------------------

async function readText(vfile) {
  const bytes = await vfile.bytes()
  return new TextDecoder('utf-8').decode(bytes)
}

function extOf(path) {
  const base = basename(path)
  const idx = base.lastIndexOf('.')
  return idx === -1 ? '' : base.slice(idx + 1).toLowerCase()
}

function basename(path) {
  return path.split('/').pop()
}

function dirOf(path) {
  const idx = path.lastIndexOf('/')
  return idx === -1 ? '' : path.slice(0, idx)
}

function filenameSansExt(path) {
  const base = basename(path)
  const idx = base.lastIndexOf('.')
  return idx > 0 ? base.slice(0, idx) : base
}

function bundleTitleFromDir(bundleDir) {
  return basename(bundleDir).replace(/\.textbundle$/i, '')
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
