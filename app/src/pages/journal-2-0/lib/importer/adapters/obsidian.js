/**
 * Obsidian adapter.
 *
 * Detection: two tiers.
 *  - 0.95 SYNCHRONOUS when the export contains a `.obsidian/` config
 *    directory (a vault marker Obsidian writes on every vault, exported or
 *    not) — no file content needs to be read for this signal.
 *  - 0.6 ASYNC, only checked when the `.obsidian/` marker is absent: samples
 *    up to `SAMPLE_LIMIT` `.md` files (skipping any over `SAMPLE_MAX_BYTES`)
 *    and scores 0.6 if any sampled file's content contains `[[` wiki-link
 *    syntax. `detect()` therefore returns either a plain number or a
 *    Promise<number> depending on which tier fires — `registry.js`'s
 *    `detectAdapter` normalizes both via `Promise.resolve(...)`, per the
 *    Task 9 review's async-tolerant contract. A `bytes()` failure on any
 *    sampled file is swallowed and counts as "no signal" from that file —
 *    the whole scan must never reject.
 *
 * Parse: every `.md` file in the vault becomes a doc (skipping `.obsidian/`
 * and `.trash/`). Frontmatter (`--- ... ---` at byte 0, parsed by the
 * shared `../frontmatter` module also used by the generic adapter) is
 * stripped from the body before markdown conversion; `tags` (bracketed
 * list, comma string, or YAML `- item` list, all quote-aware — a quoted
 * item containing a literal comma, e.g. `[swing, "reclaim, tight"]`, no
 * longer gets mis-split on that inner comma), `created`/`date` (created
 * wins) and `updated`/`modified` (updated wins) feed the doc directly;
 * `title`/`subtitle`/`ticker` feed the doc when present (an explicit
 * front-matter `title:` wins over an inferred `<h1>`); a `hero_image:`
 * pointing at a real file in the vault is surfaced as an actual leading
 * image in the body rather than left as inert YAML text with its file an
 * orphan in the archive.
 *
 * Ordinary CommonMark `![alt](path)` / `[text](path)` attachment references
 * (not just `![[wiki-embeds]]`) are resolved too, via the SAME
 * `resolveRelativeMedia` pass `generic.js` uses — real vaults mix both
 * forms (wiki-links are a per-vault Obsidian SETTING, not a guarantee; a
 * vault with "Use [[Wikilinks]]" turned off, or content pasted in from
 * elsewhere, links images the plain markdown way), and a vault fed through
 * this adapter used to drop every one of those silently.
 *
 * Wiki-syntax is pre-processed with regex passes BEFORE `mdToHtml`, applied
 * only OUTSIDE code — both fenced (```) blocks AND inline (`) spans (the raw
 * text is split on a combined regex that tries the fence alternative FIRST,
 * since fence content can itself contain single/double backticks — matching
 * inline-span first would slice a fence into pieces at its first backtick
 * run; code segments pass through byte-for-byte untouched so wiki syntax
 * inside a code sample, fenced or inline, is never rewritten), in this
 * fixed order:
 *   1. `![[target]]` embeds       -> `<img import-ref://...>` or an
 *                                     attachment chip (non-image target)
 *   2. `[[Target|alias]]`/`[[Target]]` links -> `<a data-import-link=...>`,
 *                                     or plain text when unresolvable
 *   3. `> [!type] Title` callout marker -> `> **Title**` (renders as a
 *                                     blockquote with a bold first line)
 *   4. `==highlight==`             -> `<mark>highlight</mark>`
 * (Frontmatter extraction is pass 0, applied once to the raw file before
 * the fenced/inline code split, since a frontmatter block is only ever at
 * byte 0.)
 *
 * Resolution (used by both embeds and links): a single basename map,
 * `Map<lowercased basename sans extension, full vault path>`, built ONCE
 * per parse() call over every vfile in the drop (first occurrence per key
 * wins — ambiguity between same-named files across folders is accepted for
 * v1). A target containing `/` is treated as path-qualified and resolved
 * directly against the full vault paths instead (exact match preferred,
 * falling back to a `/`-boundary suffix match) — this is what lets
 * `[[Setups/VCP|the setup]]` resolve even though the vault root folder
 * (`Vault/`) isn't part of the written target.
 */

import { mdToHtml, resolveRelativeMedia, dedupeMedia } from './generic'
import { extractFrontmatter, frontmatterDates } from '../frontmatter'
import { reportIgnoredFiles } from './reportIgnored'

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|heic)$/i
const SKIP_DIR_RE = /(^|\/)\.(obsidian|trash)\//i
// Fence alternative MUST come first — at a run of 3+ backticks it has to win
// over the inline-span alternative, or the inline pattern would consume just
// the fence's opening backticks and mis-split its content.
const CODE_RE = /```[\s\S]*?```|`[^`\n]*`/g
const EMBED_RE = /!\[\[([^\]]+)\]\]/g
const WIKILINK_RE = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g
const CALLOUT_RE = /^(\s*>\s*)\[!([A-Za-z0-9_-]+)\]\s*(.*)$/gm
const HIGHLIGHT_RE = /==([^=\n]+)==/g

const SAMPLE_LIMIT = 20
const SAMPLE_MAX_BYTES = 256 * 1024

export const obsidianAdapter = {
  id: 'obsidian',
  label: 'Obsidian',
  detect,
  parse,
}

// ---------------------------------------------------------------------------
// detection
// ---------------------------------------------------------------------------

function detect(vfiles) {
  const hasObsidianDir = vfiles.some((v) => /(^|\/)\.obsidian\//i.test(v.path))
  if (hasObsidianDir) return 0.95
  return detectByWikiLinkContent(vfiles)
}

async function detectByWikiLinkContent(vfiles) {
  const candidates = vfiles
    .filter((v) => /\.md$/i.test(v.path) && !SKIP_DIR_RE.test(v.path) && v.size <= SAMPLE_MAX_BYTES)
    .slice(0, SAMPLE_LIMIT)

  for (const v of candidates) {
    try {
      const text = await readText(v)
      if (text.includes('[[')) return 0.6
    } catch {
      // A single unreadable sample is not a verdict either way — move on.
      // (Never let detection reject; a bytes() failure counts as no signal.)
    }
  }
  return 0
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
  const basenameMap = buildBasenameMap(vfiles)

  const items = vfiles.filter((v) => /\.md$/i.test(v.path) && !SKIP_DIR_RE.test(v.path))

  const docs = []
  let done = 0
  for (const vfile of items) {
    try {
      const doc = await makeDoc(vfile, vfiles, byPath, basenameMap)
      docs.push(doc)
    } catch (err) {
      warnings.push(`Could not import "${vfile.path}": ${err?.message || err}`)
    }
    done += 1
    onProgress?.({ phase: 'parsing', done, total: items.length })
  }

  // audit B4: name whatever this drop contained that the vault never
  // touched — neither a note, nor media a note referenced, nor Obsidian's
  // own `.obsidian/`/`.trash/` housekeeping. Most commonly another
  // platform's export dropped in the same batch (the Export Guide's own
  // "drop them all in together" advice), silently discarded before this fix.
  const consumed = new Set(items.map((v) => v.path))
  for (const doc of docs) {
    for (const m of doc.media || []) consumed.add(m.ref)
  }
  const ignored = vfiles.filter((v) => !consumed.has(v.path) && !SKIP_DIR_RE.test(v.path))
  warnings.push(...reportIgnoredFiles(ignored, obsidianAdapter.label))

  return { docs, warnings }
}

async function makeDoc(vfile, vfiles, byPath, basenameMap) {
  const raw = await readText(vfile)
  const { fields, tags, body } = extractFrontmatter(raw)

  const media = []
  const links = []
  const ctx = { vfiles, byPath, basenameMap, media, links }
  const processed = preprocessWikiSyntax(body, ctx)
  let html = mdToHtml(processed)
  if (fields.hero_image) {
    // Same reasoning as generic.js's identical block: a front-matter cover
    // image is real authored content, not metadata to discard. Prepending
    // it lets it ride the SAME resolveRelativeMedia pass below as every
    // other image, rather than inventing a second resolution path.
    html = `<p><img src="${escapeAttr(fields.hero_image)}"></p>\n${html}`
  }

  const dir = dirOf(vfile.path)
  // Wiki-embeds (`![[chart.png]]`) are already resolved above by
  // transformEmbeds; this second pass catches ordinary CommonMark
  // `![alt](path)` / `[text](path)` references (our own export's shape,
  // and plenty of real vaults') that the wiki-syntax pass never touches.
  // Anything already rewritten to `import-ref://...` is skipped by
  // resolveRelativeMedia's own absolute-scheme check, so this can't
  // double-resolve or duplicate a media entry.
  const resolved = resolveRelativeMedia(html, dir, byPath)
  const allMedia = dedupeMedia([...media, ...resolved.media])
  const title = fields.title || extractH1Title(resolved.html) || filenameSansExt(basename(vfile.path))

  return {
    importKey: `obsidian:${vfile.path}`,
    title,
    html: resolved.html,
    tags,
    subtitle: fields.subtitle,
    ticker: fields.ticker,
    folderPath: dir ? dir.split('/') : [],
    media: allMedia,
    links,
    ...frontmatterDates(fields, vfile.lastModified),
  }
}

// ---------------------------------------------------------------------------
// wiki-syntax pre-processing (outside fenced AND inline code, in fixed order)
// ---------------------------------------------------------------------------

function preprocessWikiSyntax(text, ctx) {
  return transformOutsideCode(text, (segment) => {
    let out = segment
    out = transformEmbeds(out, ctx)
    out = transformWikiLinks(out, ctx)
    out = transformCallouts(out)
    out = transformHighlights(out)
    return out
  })
}

/** Splits on fenced (```) AND inline (`) code and runs `fn` over each non-code segment only; code segments pass through untouched, byte-for-byte. */
function transformOutsideCode(text, fn) {
  CODE_RE.lastIndex = 0
  let result = ''
  let lastIndex = 0
  let m
  while ((m = CODE_RE.exec(text))) {
    result += fn(text.slice(lastIndex, m.index))
    result += m[0]
    lastIndex = CODE_RE.lastIndex
  }
  result += fn(text.slice(lastIndex))
  return result
}

function transformEmbeds(text, ctx) {
  return text.replace(EMBED_RE, (_, rawTarget) => {
    // A trailing `|width` (Obsidian's embed-sizing syntax) is not a target
    // segment — strip it before resolving.
    const target = rawTarget.split('|')[0].trim()
    const resolvedPath = resolveTarget(target, ctx.vfiles, ctx.basenameMap)
    if (!resolvedPath) return escapeHtml(target)

    const name = basename(resolvedPath)
    const vfile = ctx.byPath.get(resolvedPath)
    if (IMAGE_EXT.test(resolvedPath)) {
      ctx.media.push({ ref: resolvedPath, vfile, kind: 'image', name })
      return `<img src="import-ref://${escapeAttr(resolvedPath)}">`
    }
    ctx.media.push({ ref: resolvedPath, vfile, kind: 'file', name })
    return `<a data-type="attachmentChip" data-import-ref="${escapeAttr(resolvedPath)}" data-name="${escapeAttr(name)}" href="import-ref://${escapeAttr(resolvedPath)}">${escapeHtml(name)}</a>`
  })
}

function transformWikiLinks(text, ctx) {
  return text.replace(WIKILINK_RE, (_, rawTarget, rawAlias) => {
    const target = rawTarget.trim()
    const alias = rawAlias ? rawAlias.trim() : ''
    const display = alias || target
    const resolvedPath = resolveTarget(target, ctx.vfiles, ctx.basenameMap)
    if (!resolvedPath) return escapeHtml(display)

    const targetKey = `obsidian:${resolvedPath}`
    ctx.links.push({ targetKey })
    return `<a data-import-link="${escapeAttr(targetKey)}">${escapeHtml(display)}</a>`
  })
}

function transformCallouts(text) {
  return text.replace(CALLOUT_RE, (_, prefix, type, rest) => {
    const title = rest.trim() || capitalize(type)
    // Every other pass escapes text it inserts into the markdown/HTML stream
    // (a title containing a literal `<...>` would otherwise be interpreted
    // as raw HTML passthrough by markdown-it's `html:true`, not shown as
    // text) — normalize callouts to match.
    return `${prefix}**${escapeHtml(title)}**`
  })
}

function transformHighlights(text) {
  return text.replace(HIGHLIGHT_RE, (_, inner) => `<mark>${escapeHtml(inner)}</mark>`)
}

// ---------------------------------------------------------------------------
// target resolution
// ---------------------------------------------------------------------------

function buildBasenameMap(vfiles) {
  const map = new Map()
  for (const v of vfiles) {
    const key = stripExt(basename(v.path)).toLowerCase()
    if (!map.has(key)) map.set(key, v.path)
  }
  return map
}

/**
 * Resolves an embed/link target to a full vault path, or null.
 *  - A trailing `#Heading` / `#^blockId` anchor (Obsidian's link-to-a-specific-
 *    section syntax) is stripped before resolving — the target note is what
 *    gets imported; the finer-grained anchor has no equivalent here and is
 *    dropped rather than making the whole link fail to resolve.
 *  - No `/` in the (anchor-stripped) target -> basename search (map lookup,
 *    first-wins).
 *  - Contains `/` -> path-qualified: an exact match against a vfile's full
 *    path (with or without its extension) wins immediately; otherwise the
 *    first `/`-boundary suffix match is used (so `Setups/VCP` resolves
 *    against `Vault/Setups/VCP.md` even though `Vault/` isn't written).
 */
function resolveTarget(rawTarget, vfiles, basenameMap) {
  const target = stripFragment((rawTarget || '').trim())
  if (!target) return null
  if (target.includes('/')) return resolvePathQualified(target, vfiles)
  const key = stripExt(target).toLowerCase()
  return basenameMap.get(key) || null
}

function stripFragment(target) {
  const idx = target.indexOf('#')
  return idx === -1 ? target : target.slice(0, idx).trim()
}

function resolvePathQualified(target, vfiles) {
  const lower = target.toLowerCase()
  let suffixMatch = null
  for (const v of vfiles) {
    const pLower = v.path.toLowerCase()
    const pSansExt = stripExt(pLower)
    if (pLower === lower || pSansExt === lower) return v.path
    if (!suffixMatch && (pLower.endsWith(`/${lower}`) || pSansExt.endsWith(`/${lower}`))) {
      suffixMatch = v.path
    }
  }
  return suffixMatch
}

// ---------------------------------------------------------------------------
// small path/text helpers (mirrors adapters/generic.js and adapters/notion.js
// — kept self-contained per-adapter, matching the existing pattern rather
// than sharing internals)
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

function stripExt(path) {
  const idx = path.lastIndexOf('.')
  return idx > 0 ? path.slice(0, idx) : path
}

function filenameSansExt(name) {
  const idx = name.lastIndexOf('.')
  return idx > 0 ? name.slice(0, idx) : name
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s
}

function extractH1Title(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const h1 = doc.querySelector('h1')
  const text = h1?.textContent?.trim()
  return text || null
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, '&quot;')
}
