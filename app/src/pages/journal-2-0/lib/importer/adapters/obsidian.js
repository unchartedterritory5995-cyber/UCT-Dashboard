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
 * Resolution (Plan B Task 8): ONE resolver, `../obsidianResolve.js`, built once per
 * parse() and used by embeds, wikilinks, relative markdown links, images and
 * `obsidian://open` deep links alike — Obsidian's own order (the linking note's folder,
 * then the attachment folder, then the shortest path), so `[[Plan]]` beside
 * `Notes/Plan.md` opens that one, not the first `Plan.md` the drop listed.
 *  - `[[Note\|alias]]` in a table cell: the `\` escapes the pipe from the table (O-8).
 *  - a wikilink's text reads as Obsidian shows it: `Note > Heading`; a block id not at all.
 *  - `![[Other note]]` (an embedded NOTE) is a link to that note, never a file chip (O-11).
 *  - after `resolveRelativeMedia`, every relative `<a href>` left is resolved (O-5):
 *    a note -> a note link; any other vault file -> an attachment chip; a miss is left for
 *    the post-parse pass (`../postParse.js`), which makes it its text.
 *  - `obsidian://open?vault=<this vault>&file=<f>` -> the note `f` names. A deep link into a
 *    vault with another name (when this drop names its vault folder) is left for the
 *    post-parse pass, which makes it text.
 *  - `![](attachments/x.png)` from a note in a sub-folder: the dir-relative path misses, the
 *    resolver finds it from the vault root (I-9).
 * An unresolved link is the member's text with no link (`pending` is server-only, see the
 * parity rail): a one-shot drag-in has no later sync to heal a key it never stores.
 */

import { mdToHtml, resolveRelativeMedia, dedupeMedia } from './generic'
import { extractFrontmatter, frontmatterDates } from '../frontmatter'
import { reportIgnoredFiles } from './reportIgnored'
import { IMAGE_EXT } from '../mediaRefs'
import { makeObsidianResolver } from '../obsidianResolve'

const SKIP_DIR_RE = /(^|\/)\.(obsidian|trash)\//i
// Fence alternative MUST come first — at a run of 3+ backticks it has to win
// over the inline-span alternative, or the inline pattern would consume just
// the fence's opening backticks and mis-split its content.
const CODE_RE = /```[\s\S]*?```|`[^`\n]*`/g
const EMBED_RE = /!\[\[([^\]]+)\]\]/g
const WIKILINK_RE = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g
const CALLOUT_RE = /^(\s*>\s*)\[!([A-Za-z0-9_-]+)\]\s*(.*)$/gm
// ⛔ A trader's prose is full of `==` COMPARISONS ("if rsi == 30 and macd == 0").
// The old `/==([^=\n]+)==/` highlighted the span between two comparisons and
// deleted both operators. A highlight now needs a non-space just inside each
// `==`, and neither marker may touch a letter, digit, `_` or another `=` on its
// outside. The leading context is CAPTURED, not a lookbehind: the iOS 16 floor
// cannot parse lookbehind (app/src/noRegexLookbehind.test.js). The server lane
// (`providers/obsidian.py`) uses the same rule; parity fixture `08-comparisons`.
const HIGHLIGHT_RE = /(^|[^=\p{L}\p{N}_])==(?=\S)([^=\n]*?\S)==(?![=\p{L}\p{N}_])/gu
// A vault note (the server's `_NOTE_EXT_RE`).
const NOTE_RE = /\.md$/i

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
  const resolver = await makeObsidianResolver(vfiles)

  const items = vfiles.filter((v) => /\.md$/i.test(v.path) && !SKIP_DIR_RE.test(v.path))

  const docs = []
  let done = 0
  for (const vfile of items) {
    try {
      const doc = await makeDoc(vfile, byPath, resolver)
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

async function makeDoc(vfile, byPath, resolver) {
  const raw = await readText(vfile)
  const { fields, tags, body } = extractFrontmatter(raw)

  const media = []
  const links = []
  const resolve = (target, opts) => resolver.resolve(target, vfile.path, opts)
  const ctx = { byPath, resolve, media, links }
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
  // I-9: a src that misses beside the note is looked up the Obsidian way (vault root,
  // attachment folder, by name). A note is never an image.
  const fallbackResolve = (rel) => {
    const hit = resolve(rel, { decode: true })
    return hit && !NOTE_RE.test(hit) ? hit : null
  }
  const resolved = resolveRelativeMedia(html, dir, byPath, { fallbackResolve })
  resolved.html = resolveVaultAnchors(resolved.html, ctx, resolver.root)
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
    const written = rawTarget.split('|')[0].trim()
    // The resolver drops a table-escaped pipe's `\` itself (O-8); this copy is the TEXT.
    const target = stripEscapedPipe(written)
    const resolvedPath = ctx.resolve(written)
    if (!resolvedPath) {
      // A note not in this drop reads as its name (the server's pending embed text);
      // anything else as the target written. Never a broken <img> or a phantom media entry.
      const bare = stripFragment(target)
      const noteish = bare && (!basename(bare).includes('.') || NOTE_RE.test(bare))
      return escapeHtml(noteish ? bare.replace(NOTE_RE, '') : target)
    }

    const name = basename(resolvedPath)
    const vfile = ctx.byPath.get(resolvedPath)
    if (NOTE_RE.test(resolvedPath)) {
      // O-11: an embedded NOTE is a link to it, named as the note (no `.md`, no anchor).
      return noteLink(resolvedPath, name.replace(NOTE_RE, ''), ctx)
    }
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
    // O-8: `[[Note\|alias]]` in a table cell -- the `\` escapes the pipe, it is not the
    // name. The resolver drops it for the lookup; `stripEscapedPipe` keeps it out of the text.
    const alias = rawAlias ? rawAlias.trim() : ''
    const display = alias || wikilinkDisplay(stripEscapedPipe(rawTarget.trim()))
    const resolvedPath = ctx.resolve(rawTarget.trim())
    if (!resolvedPath) return escapeHtml(display)
    return noteLink(resolvedPath, display, ctx)
  })
}

function noteLink(resolvedPath, display, ctx) {
  const targetKey = `obsidian:${resolvedPath}`
  ctx.links.push({ targetKey })
  return `<a data-import-link="${escapeAttr(targetKey)}">${escapeHtml(display)}</a>`
}

function stripEscapedPipe(target) {
  return target.endsWith('\\') ? target.slice(0, -1).trimEnd() : target
}

/** The server's `_wikilink_display`: `Note#Risk` reads `Note > Risk`, a block reference
 *  (`Note#^abc123`) reads `Note`, and `[[#Risk]]` (this note's own heading) reads `Risk`. */
function wikilinkDisplay(target) {
  const idx = target.indexOf('#')
  if (idx === -1) return target
  const note = target.slice(0, idx).trim()
  const anchor = target.slice(idx + 1).trim()
  if (anchor.startsWith('^') || !anchor) return note || target
  return note ? `${note} > ${anchor}` : anchor
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
  return text.replace(HIGHLIGHT_RE, (_, lead, inner) => `${lead}<mark>${escapeHtml(inner)}</mark>`)
}

// ---------------------------------------------------------------------------
// relative and deep-link anchors (O-5, `obsidian://`), after resolveRelativeMedia
// ---------------------------------------------------------------------------

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i
const OBSIDIAN_URI_RE = /^obsidian:/i

/**
 * Every `<a href>` resolveRelativeMedia left relative, and every `obsidian://open` link:
 * a note -> `data-import-link` (pushed onto `links`); any other vault file -> an attachment
 * chip plus its media item; an image target is left (images ride `<img>`). A miss is left
 * as written, for the post-parse pass to make it text. Never resolved against a web origin.
 */
function resolveVaultAnchors(html, ctx, root) {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  for (const a of [...doc.querySelectorAll('a[href]')]) {
    const href = a.getAttribute('href') || ''
    let resolvedPath = null
    if (OBSIDIAN_URI_RE.test(href)) {
      resolvedPath = resolveDeepLink(href, ctx, root)
      if (!resolvedPath || !NOTE_RE.test(resolvedPath)) continue
    } else {
      if (!href || href.startsWith('#') || href.startsWith('//') || SCHEME_RE.test(href)) continue
      resolvedPath = ctx.resolve(href, { decode: true })
      if (!resolvedPath || IMAGE_EXT.test(resolvedPath)) continue
    }
    if (NOTE_RE.test(resolvedPath)) {
      const targetKey = `obsidian:${resolvedPath}`
      a.removeAttribute('href')
      a.setAttribute('data-import-link', targetKey)
      ctx.links.push({ targetKey })
      continue
    }
    const vfile = ctx.byPath.get(resolvedPath)
    if (!vfile) continue
    const name = basename(resolvedPath)
    a.setAttribute('data-type', 'attachmentChip')
    a.setAttribute('data-import-ref', resolvedPath)
    a.setAttribute('data-name', name)
    a.setAttribute('href', `import-ref://${resolvedPath}`)
    ctx.media.push({ ref: resolvedPath, vfile, kind: 'file', name })
  }
  return doc.body.innerHTML
}

/** `obsidian://open?vault=<v>&file=<f>` -> the path `f` names, as a wikilink target
 *  (`URLSearchParams` has already decoded it once). A drop whose vault folder has a name
 *  answers only for that name; another vault's link is not this import's to resolve. */
function resolveDeepLink(href, ctx, root) {
  let url
  try {
    url = new URL(href)
  } catch {
    return null
  }
  if (url.hostname.toLowerCase() !== 'open') return null
  const file = (url.searchParams.get('file') || '').trim()
  const vault = (url.searchParams.get('vault') || '').trim().toLowerCase()
  if (!file) return null
  if (root && vault && vault !== basename(root).toLowerCase()) return null
  return ctx.resolve(file)
}

function stripFragment(target) {
  const idx = target.indexOf('#')
  return idx === -1 ? target : target.slice(0, idx).trim()
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
