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
 * and `.trash/`). Frontmatter (`--- ... ---` at byte 0) is parsed for
 * `tags` (bracketed list, comma string, or YAML `- item` list) and
 * `created`/`date` (created wins when both are present) and stripped from
 * the body before markdown conversion.
 *
 * Wiki-syntax is pre-processed with regex passes BEFORE `mdToHtml`, applied
 * only OUTSIDE fenced code blocks (the raw text is split on ``` fences
 * first; code segments pass through byte-for-byte untouched so wiki syntax
 * inside a code sample is never rewritten), in this fixed order:
 *   1. `![[target]]` embeds       -> `<img import-ref://...>` or an
 *                                     attachment chip (non-image target)
 *   2. `[[Target|alias]]`/`[[Target]]` links -> `<a data-import-link=...>`,
 *                                     or plain text when unresolvable
 *   3. `> [!type] Title` callout marker -> `> **Title**` (renders as a
 *                                     blockquote with a bold first line)
 *   4. `==highlight==`             -> `<mark>highlight</mark>`
 * (Frontmatter extraction is pass 0, applied once to the raw file before
 * the code-fence split, since a frontmatter block is only ever at byte 0.)
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

import { mdToHtml } from './generic'

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|heic)$/i
const SKIP_DIR_RE = /(^|\/)\.(obsidian|trash)\//i
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/
const CODE_FENCE_RE = /```[\s\S]*?```/g
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

  return { docs, warnings }
}

async function makeDoc(vfile, vfiles, byPath, basenameMap) {
  const raw = await readText(vfile)
  const { tags, createdAt, body } = extractFrontmatter(raw)

  const media = []
  const links = []
  const ctx = { vfiles, byPath, basenameMap, media, links }
  const processed = preprocessWikiSyntax(body, ctx)
  const html = mdToHtml(processed)

  const dir = dirOf(vfile.path)
  const title = extractH1Title(html) || filenameSansExt(basename(vfile.path))

  return {
    importKey: `obsidian:${vfile.path}`,
    title,
    html,
    tags,
    folderPath: dir ? dir.split('/') : [],
    media,
    links,
    ...computeDates(createdAt, vfile.lastModified),
  }
}

// ---------------------------------------------------------------------------
// frontmatter
// ---------------------------------------------------------------------------

/**
 * Extracts a `--- ... ---` frontmatter block anchored at byte 0 (the `^`
 * anchor with no 'm' flag matches only the very start of the string).
 * Returns `{tags, createdAt, body}` — `body` is the file text with the
 * frontmatter block (delimiters included) removed. Absent frontmatter
 * yields `{tags: [], createdAt: null, body: <original text>}`.
 */
function extractFrontmatter(text) {
  const match = FRONTMATTER_RE.exec(text)
  if (!match) return { tags: [], createdAt: null, body: text }
  const { tags, createdAt } = parseFrontmatterBlock(match[1])
  return { tags, createdAt, body: text.slice(match[0].length) }
}

function parseFrontmatterBlock(block) {
  const lines = block.split(/\r?\n/)
  let tags = []
  let createdAt = null
  let dateAt = null

  for (let i = 0; i < lines.length; i++) {
    const m = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(lines[i])
    if (!m) continue
    const key = m[1].toLowerCase()
    const rawValue = m[2].trim()

    if (key === 'tags') {
      if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
        tags = rawValue
          .slice(1, -1)
          .split(',')
          .map((s) => unquote(s.trim()))
          .filter(Boolean)
      } else if (rawValue) {
        tags = rawValue
          .split(',')
          .map((s) => unquote(s.trim()))
          .filter(Boolean)
      } else {
        // YAML list form: `tags:` followed by `  - item` lines.
        const collected = []
        let j = i + 1
        while (j < lines.length && /^\s*-\s+/.test(lines[j])) {
          collected.push(unquote(lines[j].replace(/^\s*-\s+/, '').trim()))
          j++
        }
        tags = collected.filter(Boolean)
        i = j - 1
      }
    } else if (key === 'created') {
      createdAt = unquote(rawValue) || createdAt
    } else if (key === 'date') {
      dateAt = unquote(rawValue) || dateAt
    }
  }

  return { tags, createdAt: createdAt || dateAt || null }
}

function unquote(s) {
  if (!s) return s
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1)
  }
  return s
}

/** Frontmatter `created`/`date` wins over `lastModified`; `updatedAt` (when derivable) still comes from `lastModified`. */
function computeDates(frontmatterCreatedAt, lastModified) {
  const fromModified = datesFromLastModified(lastModified)
  if (frontmatterCreatedAt) return { ...fromModified, createdAt: frontmatterCreatedAt }
  return fromModified
}

// ---------------------------------------------------------------------------
// wiki-syntax pre-processing (outside fenced code blocks, in fixed order)
// ---------------------------------------------------------------------------

function preprocessWikiSyntax(text, ctx) {
  return transformOutsideCodeFences(text, (segment) => {
    let out = segment
    out = transformEmbeds(out, ctx)
    out = transformWikiLinks(out, ctx)
    out = transformCallouts(out)
    out = transformHighlights(out)
    return out
  })
}

/** Splits on fenced code blocks and runs `fn` over each non-code segment only; code segments pass through untouched. */
function transformOutsideCodeFences(text, fn) {
  CODE_FENCE_RE.lastIndex = 0
  let result = ''
  let lastIndex = 0
  let m
  while ((m = CODE_FENCE_RE.exec(text))) {
    result += fn(text.slice(lastIndex, m.index))
    result += m[0]
    lastIndex = CODE_FENCE_RE.lastIndex
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
    return `${prefix}**${title}**`
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
 *  - No `/` in the target -> basename search (map lookup, first-wins).
 *  - Contains `/` -> path-qualified: an exact match against a vfile's full
 *    path (with or without its extension) wins immediately; otherwise the
 *    first `/`-boundary suffix match is used (so `Setups/VCP` resolves
 *    against `Vault/Setups/VCP.md` even though `Vault/` isn't written).
 */
function resolveTarget(rawTarget, vfiles, basenameMap) {
  const target = (rawTarget || '').trim()
  if (!target) return null
  if (target.includes('/')) return resolvePathQualified(target, vfiles)
  const key = stripExt(target).toLowerCase()
  return basenameMap.get(key) || null
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

function datesFromLastModified(lastModified) {
  if (lastModified == null) return {}
  const iso = new Date(lastModified).toISOString()
  return { createdAt: iso, updatedAt: iso }
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, '&quot;')
}
