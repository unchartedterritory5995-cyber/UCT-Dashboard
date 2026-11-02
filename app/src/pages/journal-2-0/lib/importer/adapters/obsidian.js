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
 *   3. `==highlight==`             -> `<mark>highlight</mark>`
 * then, on the whole body, `> [!type] Title` callouts become the editor's
 * callout node (`splitCalloutTitles` before markdown, `calloutsInHtml` after
 * it, the server lane's two halves; D2 item 1).
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

import { mdToHtml, mdInlineText, resolveRelativeMedia, dedupeMedia } from './generic'
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
// ⛔ A trader's prose is full of `==` COMPARISONS ("if rsi == 30 and macd == 0").
// The old `/==([^=\n]+)==/` highlighted the span between two comparisons and
// deleted both operators. A highlight now needs a non-space just inside each
// `==`, and neither marker may touch a letter, digit, `_` or another `=` on its
// outside. The leading context is CAPTURED, not a lookbehind: the iOS 16 floor
// cannot parse lookbehind (app/src/noRegexLookbehind.test.js). The server lane
// (`providers/obsidian.py`) uses the same rule; parity fixture `08-comparisons`.
const HIGHLIGHT_RE = /(^|[^=\p{L}\p{N}_])==(?=\S)([^=\n]*?\S)==(?![=\p{L}\p{N}_])/gu

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
  const ctx = { vfiles, byPath, basenameMap, media, links, fromDir: dirOf(vfile.path) }
  const processed = splitCalloutTitles(preprocessWikiSyntax(body, ctx))
  let html = calloutsInHtml(mdToHtml(processed))
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
    const held = []
    const lists = [] // lists[i]: what piece i adds to `media` / `links` once it is SHOWN
    const shown = new Set()
    const open = holdOpenFor(segment)
    const hctx = {
      ...ctx,
      hold: (html, list) => {
        lists[held.length] = list
        return holdMarkup(held, html, open)
      },
      // A string that is exactly one placeholder this segment made (an embed already
      // held): only the importer writes a run of `open`'s length (see below).
      isHeld: (s) => s.length > open.length && s.startsWith(open)
        && /^[-]+$/.test(s.slice(open.length)),
    }
    let out = segment
    out = transformEmbeds(out, hctx)
    out = transformWikiLinks(out, hctx)
    out = transformHighlights(out)
    out = releaseMarkup(out, held, open, shown)
    // ⛔ D2 item 4: a piece's media entry or link is listed only when the piece is
    // released into the note. `[[![[img.png]]|al.ias]]` shows the alias, so the
    // image placeholder is dropped and nothing uploads a file no node references.
    // In index order, which is the order the passes made them (embeds, then links).
    for (let i = 0; i < held.length; i += 1) if (shown.has(i)) lists[i]?.()
    return out
  })
}

// ⛔ The embed and wikilink passes emit finished HTML (`<a ...>`, `<img>`, an
// entity-encoded unresolved name), and the callout and highlight passes after
// them ESCAPE their text. So each finished piece is HELD: the pass writes a
// placeholder of noncharacter and private-use code points (no `&`, `<`, `>`,
// `=` or ASCII digit for a later pass to escape or match), and the real markup
// goes back in only after every pass has run, right before `mdToHtml`.
// ⚰️ D1 fix round 2 wrote `&#46;` straight into the text, and a highlight or
// callout title escaped it again into a visible `&#46;`; a link inside
// `==...==` lost the highlight, and one in a callout title showed as escaped
// `<a>` markup (D1 fix round 3, N1/N2).
//
// ⛔ The OPEN is chosen PER SEGMENT so it can never be the member's own text:
// a run of U+FDD0 (a Unicode noncharacter, reserved for internal use like
// this) one longer than the longest U+FDD0 run already in the segment. The
// passes only ever ADD placeholders and never join two member runs, so a
// U+FDD0 run followed by index digits and the close that is at least `open`
// long ends in OUR open; whatever comes before that is the member's own text,
// put back unchanged. A shorter run is the member's and is left alone.
// The release regex is CONSTANT-SIZE and the length is checked in code: the
// open can be any length (a 40,000-long member run makes a 40,001-long open),
// and V8 refuses a regex of 32,768+ characters, which failed the whole note
// (D1 re-review M-a, fix round 5). The cost is placeholder size,
// O(links x longest run).
// ⚰️ D1 fix round 3 used a fixed U+E000 open, so a member's own
// `U+E000 U+E010 U+E001` was swapped for another link's markup: a duplicate
// link appeared and their text was lost (D1 re-review P1, fix round 4).
//
// ⛔ Release is RECURSIVE: a held piece can contain an EARLIER placeholder
// (`[[![[img.png]]]]` holds the embed's `<img>`, then holds the outer
// unresolved name, whose text is that first placeholder). A piece only ever
// contains placeholders created before it, so the recursion ends.
// ⚰️ One flat pass left U+FDD0 U+E010 U+E001 in the stored text and lost
// the image (D1 re-review M-b, fix round 5).
const HOLD_SENTINEL = '\uFDD0'
const HOLD_CLOSE = '\uE001'
const HOLD_RE = /(\uFDD0+)([\uE010-\uE019]+)\uE001/g

function holdOpenFor(segment) {
  let longest = 0
  for (const m of segment.matchAll(/\uFDD0+/g)) longest = Math.max(longest, m[0].length)
  return HOLD_SENTINEL.repeat(longest + 1)
}

function holdMarkup(held, html, open) {
  held.push(html)
  const digits = String(held.length - 1).replace(/[0-9]/g, (d) => String.fromCharCode(0xe010 + Number(d)))
  return open + digits + HOLD_CLOSE
}

function releaseMarkup(text, held, open, shown) {
  return text.replace(HOLD_RE, (whole, run, digits) => {
    if (run.length < open.length) return whole
    const idx = Number(digits.replace(/[\uE010-\uE019]/g, (c) => String(c.charCodeAt(0) - 0xe010)))
    if (idx >= held.length) return whole
    shown.add(idx)
    return run.slice(0, run.length - open.length) + releaseMarkup(held[idx], held, open, shown)
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
    const resolvedPath = resolveTarget(target, ctx.vfiles, ctx.basenameMap, ctx.fromDir)
    if (!resolvedPath) {
      // A missing NOTE reads as the note's name (`![[Ghost#Risk]]`, `![[Ghost.md]]`
      // -> `Ghost`), as the server's pending link does; a missing FILE as written
      // (D2 item 8, `providers/obsidian.py::_transform_wiki_and_embeds`).
      const bare = unresolvedBareTarget(target)
      if (bare && (/\.md$/i.test(bare) || !isAttachmentName(bare))) {
        return ctx.hold(unresolvedText(bare.replace(/\.md$/i, '')))
      }
      return ctx.hold(unresolvedText(target))
    }

    const name = basename(resolvedPath)
    if (/\.md$/i.test(resolvedPath)) {
      // An embed of a NOTE is a link to that note, never an attachment chip
      // that would upload the `.md` as a file. It reads by the note's name,
      // as the server lane's does (`providers/obsidian.py`, Task 13).
      const targetKey = `obsidian:${resolvedPath}`
      return ctx.hold(`<a data-import-link="${escapeAttr(targetKey)}">${escapeHtml(name.replace(/\.md$/i, ''))}</a>`,
        () => ctx.links.push({ targetKey }))
    }
    const vfile = ctx.byPath.get(resolvedPath)
    if (IMAGE_EXT.test(resolvedPath)) {
      return ctx.hold(`<img src="import-ref://${escapeAttr(resolvedPath)}">`,
        () => ctx.media.push({ ref: resolvedPath, vfile, kind: 'image', name }))
    }
    return ctx.hold(`<a data-type="attachmentChip" data-import-ref="${escapeAttr(resolvedPath)}" data-name="${escapeAttr(name)}" href="import-ref://${escapeAttr(resolvedPath)}">${escapeHtml(name)}</a>`,
      () => ctx.media.push({ ref: resolvedPath, vfile, kind: 'file', name }))
  })
}

function transformWikiLinks(text, ctx) {
  const piece = (rawTarget, rawAlias) => {
    const target = rawTarget.trim()
    const alias = rawAlias ? rawAlias.trim() : ''
    if (alias && ctx.isHeld?.(alias)) {
      // D2 fix round 1 (e): an embed in alias position, `[[Plan|![[img.png]]]]`, is the
      // embed and then the link to Plan as `[[Plan]]` reads -- both kept, as the server
      // lane writes it. ⚰️ The image went inside the link and the link was lost.
      return alias + piece(rawTarget, '')
    }
    const resolvedPath = resolveTarget(target, ctx.vfiles, ctx.basenameMap, ctx.fromDir)
    // A missing FILE whose name holds `#` (`[[report #2.pdf]]`) keeps its name;
    // anything else reads as Obsidian shows it (`wikilinkDisplay`, D2 item 8).
    const fileName = !resolvedPath && unresolvedBareTarget(target) !== stripFragment(target)
    const display = alias || (fileName ? target : wikilinkDisplay(target))
    if (!resolvedPath) return ctx.hold(unresolvedText(display))

    if (!/\.md$/i.test(resolvedPath)) {
      // D2 fix round 1, I3: a wikilink to a FILE (`[[q.pdf]]`, `[[q.pdf|the deck]]`,
      // `[[chart.png]]`) is the file chip, as the server lane makes it for the plugin's
      // non-embed ref; the alias, as rendered text, is its label. ⚰️ It was a link to a
      // note key no note has: commit stripped it and the file never uploaded.
      const name = basename(resolvedPath)
      const vfile = ctx.byPath.get(resolvedPath)
      const label = alias ? mdInlineText(alias).trim() : ''
      const labelAttr = label && label !== name ? ` data-label="${escapeAttr(label)}"` : ''
      return ctx.hold(`<a data-type="attachmentChip" data-import-ref="${escapeAttr(resolvedPath)}" data-name="${escapeAttr(name)}"${labelAttr} href="import-ref://${escapeAttr(resolvedPath)}">${escapeHtml(name)}</a>`,
        () => ctx.media.push({ ref: resolvedPath, vfile, kind: 'file', name }))
    }

    const targetKey = `obsidian:${resolvedPath}`
    return ctx.hold(`<a data-import-link="${escapeAttr(targetKey)}">${escapeHtml(display)}</a>`,
      () => ctx.links.push({ targetKey }))
  }
  return text.replace(WIKILINK_RE, (_, rawTarget, rawAlias) => piece(rawTarget, rawAlias))
}

// ---------------------------------------------------------------------------
// callouts (D2 item 1): THE server lane's two halves, step for step
// (`providers/obsidian.py::_split_callout_titles` / `_callouts_in_doc`).
// Before markdown: the marker line is split from the callout's body with an
// empty quote line, or markdown-it folds title and body into ONE paragraph.
// After it: each blockquote whose first paragraph opens with `[!type]` becomes
// the editor's callout node (`calloutNode.js`, an `<aside data-variant>`):
// `variant` from the type, the title (or the type, capitalised) as a bold
// first paragraph, then the rest of the quote. The fold marker `+`/`-` is
// dropped, as the server drops it. Fenced code is never touched.
// ⚰️ The client wrote `> **Title**`, a blockquote, and its marker regex let
// `\s*` run across the line end, so an untitled `> [!tip]` took the NEXT line
// as its title (parity fixtures 12, 16, 17).
// `[^\n]` stands for Python's `.`, which (unlike JS's) matches `\r`.
// ---------------------------------------------------------------------------
const CALLOUT_FENCE_RE = /```[\s\S]*?```|~~~[\s\S]*?~~~/g
const CALLOUT_LINE_RE = /^([ \t]{0,3}(?:>[ \t]?)+)\[![A-Za-z0-9_-]+\][+-]?[^\n]*$/
const QUOTE_PREFIX_RE = /^[ \t]{0,3}>/
const CALLOUT_MARK_RE = /^\[!([A-Za-z0-9_-]+)\][+-]?[ \t]*/
// Obsidian's callout types -> the editor's five (`calloutNode.js::CALLOUT_VARIANTS`).
// Any other type is a `note`. Mirrors `providers/obsidian.py::_CALLOUT_VARIANTS`.
const CALLOUT_VARIANTS = {
  note: 'note', info: 'info', success: 'success', warning: 'warning', danger: 'danger',
  tip: 'success', caution: 'warning', important: 'warning', bug: 'danger', failure: 'danger',
}

function splitCalloutTitles(text) {
  const linesPass = (part) => {
    const lines = part.split('\n')
    const out = []
    lines.forEach((line, i) => {
      out.push(line)
      const m = CALLOUT_LINE_RE.exec(line)
      const opensQuote = i === 0 || !QUOTE_PREFIX_RE.test(lines[i - 1])
      if (m && opensQuote && i + 1 < lines.length && QUOTE_PREFIX_RE.test(lines[i + 1])) {
        out.push(m[1].replace(/\s+$/, ''))
      }
    })
    return out.join('\n')
  }
  let result = ''
  let last = 0
  for (const m of text.matchAll(CALLOUT_FENCE_RE)) {
    result += linesPass(text.slice(last, m.index)) + m[0]
    last = m.index + m[0].length
  }
  return result + linesPass(text.slice(last))
}

function calloutsInHtml(html) {
  if (!html.includes('[!')) return html
  const doc = new DOMParser().parseFromString(html, 'text/html')
  // Innermost first, as the server converts a node's children before the node.
  for (const quote of [...doc.querySelectorAll('blockquote')].reverse()) {
    const first = quote.firstElementChild
    const lead = first?.tagName === 'P' ? first.firstChild : null
    if (!lead || lead.nodeType !== 3) continue // TEXT_NODE, with no mark around it
    const m = CALLOUT_MARK_RE.exec(lead.data)
    if (!m) continue
    const kind = m[1]
    lead.data = lead.data.slice(m[0].length)
    if (!lead.data) lead.remove()
    const title = doc.createElement('p')
    const bold = doc.createElement('strong')
    if ((first.textContent || '').trim()) {
      while (first.firstChild) bold.appendChild(first.firstChild)
    } else {
      bold.textContent = capitalize(kind)
    }
    title.appendChild(bold)
    const aside = doc.createElement('aside')
    aside.setAttribute('data-variant', CALLOUT_VARIANTS[kind.toLowerCase()] || 'note')
    aside.appendChild(title)
    first.remove()
    while (quote.firstChild) aside.appendChild(quote.firstChild)
    quote.replaceWith(aside)
  }
  return doc.body.innerHTML
}

function transformHighlights(text) {
  return text.replace(HIGHLIGHT_RE, (_, lead, inner) => `${lead}<mark>${escapeHtml(inner)}</mark>`)
}

// ---------------------------------------------------------------------------
// target resolution
// ---------------------------------------------------------------------------

// basenameMap -> (lowercased extension-stripped file name -> EVERY path with
// that name, in the order seen). `resolveTarget` filters and picks among them,
// mirroring the server's `_VaultIndex` dict.
const BY_STEM = new WeakMap()

function buildBasenameMap(vfiles) {
  const map = new Map()
  const byStem = new Map()
  for (const v of vfiles) {
    const key = stripExt(basename(v.path)).toLowerCase()
    if (!map.has(key)) map.set(key, v.path)
    if (!byStem.has(key)) byStem.set(key, [])
    byStem.get(key).push(v.path)
  }
  BY_STEM.set(map, byStem)
  return map
}

/**
 * The note file a wikilink target names, lowercased: `<target>.md`, or the
 * target itself when it already ends in `.md`. Every dot is part of the
 * note's name: `[[Dr.Smith]]`, `[[Q3.Review]]`, `[[v1.2 notes]]` and even
 * `[[Brief.txt]]` name `Dr.Smith.md`, `Q3.Review.md`, `v1.2 notes.md` and
 * `Brief.txt.md`; that note, when present, ALWAYS wins. ⚰️ The basename rule
 * used to strip `.Smith` as an extension and look up `Dr`, so those links
 * fell back to plain text or opened `Dr.md`. Mirrors
 * `providers/obsidian.py::_note_file_of`.
 */
function noteFileOf(target) {
  const lower = target.toLowerCase()
  return lower.endsWith('.md') ? lower : `${lower}.md`
}

/**
 * Resolves an embed/link target to a full vault path, or null. THE rule of
 * `providers/obsidian.py::_resolve_in`, step for step (the parity fixture
 * `15-dotted-names` pins both). A target with a `/` is matched against the end
 * of each path at a folder boundary (`Setups/VCP` -> `Vault/Setups/VCP.md`); a
 * bare one against the file name. First, a target holding a `#` (an anchor, or
 * part of a NAME: `my chart #1 (v2).png`) that EXACTLY names a vault file opens
 * that file; only otherwise is the `#Heading` / `#^blockId` anchor stripped
 * (Plan C Task 4 fix round 1). Then, in order:
 *  1. the exact note `noteFileOf(target)` (`[[Dr.Smith]]` -> `Dr.Smith.md`,
 *     `[[report.pdf]]` -> `report.pdf.md`), always first;
 *  2. a file whose full name IS the target (`[[report.pdf]]` -> `report.pdf`).
 * Never an extension-stripped form: `[[Dr.Smith]]` never opens `Dr.md` or
 * `Dr.Smith.csv`, `[[Notes/Plan]]` never `Notes/Plan.md.bak`. ⚰️ A third step
 * stem-matched a dot-less name to a file (`[[chart]]` -> `chart.png`); Obsidian
 * assumes `.md` for a link with no extension, so it is gone (fix round 1).
 * Same-named candidates go through `pick`.
 */
function resolveTarget(rawTarget, vfiles, basenameMap, fromDir = null) {
  const whole = (rawTarget || '').trim()
  if (whole.includes('#')) {
    const hit = resolveSteps(whole, basenameMap, fromDir, true)
    if (hit) return hit
  }
  const target = stripFragment(whole)
  if (!target) return null
  return resolveSteps(target, basenameMap, fromDir, false)
}

// Steps 1 and 2 of `resolveTarget` over an anchor-free target (`exactFileOnly`:
// step 2 alone, the full-name check a `#`-holding target gets first). Mirrors
// `providers/obsidian.py::_resolve_steps`.
function resolveSteps(target, basenameMap, fromDir, exactFileOnly) {
  const byStem = BY_STEM.get(basenameMap) || new Map()
  const lower = target.toLowerCase()
  const noteFile = noteFileOf(target)
  const name = basename(lower)
  const near = lower.includes('/') ? null : fromDir
  const steps = exactFileOnly ? [] : [[stripExt(basename(noteFile)), noteFile]]
  steps.push([stripExt(name), lower])
  for (const [key, want] of steps) {
    const hits = (byStem.get(key) || []).filter((p) => endsAt(p.toLowerCase(), want))
    if (hits.length) return pick(hits, near)
  }
  return null
}

// THE tie-break among same-named paths, mirroring `providers/obsidian.py::_pick`:
// the one in the linking note's folder (bare names only), else the shortest
// path (fewest folders), else the first path in sort order.
function pick(candidates, fromDir) {
  let pool = candidates
  if (fromDir !== null && fromDir !== undefined) {
    const here = fromDir.toLowerCase()
    const beside = pool.filter((p) => dirOf(p).toLowerCase() === here)
    if (beside.length) pool = beside
  }
  const depth = (p) => p.split('/').length
  return pool.reduce((best, p) => {
    if (depth(p) !== depth(best)) return depth(p) < depth(best) ? p : best
    return p < best ? p : best
  })
}

function endsAt(form, want) {
  return form === want || form.endsWith(`/${want}`)
}

function stripFragment(target) {
  const idx = target.indexOf('#')
  return idx === -1 ? target : target.slice(0, idx).trim()
}

/**
 * What a wikilink with no alias shows, as Obsidian shows it: `Note#Risk` reads
 * `Note > Risk`; a block reference (`Note#^abc123`) reads just `Note`;
 * `[[#Risk]]` (this note's own heading) reads `Risk`. Mirrors
 * `providers/obsidian.py::_wikilink_display` (D2 item 8). ⚰️ It showed the
 * target as written, `Note#Risk`.
 */
function wikilinkDisplay(rawTarget) {
  const idx = rawTarget.indexOf('#')
  if (idx === -1) return rawTarget
  const note = rawTarget.slice(0, idx).trim()
  const anchor = rawTarget.slice(idx + 1).trim()
  if (anchor.startsWith('^') || !anchor) return note || rawTarget
  return note ? `${note} > ${anchor}` : anchor
}

// THE extensions an unresolved target reads as a FILE, not a note. ⛔ The same
// list as `providers/obsidian.py::_UNSENT_ATTACHMENT_EXTS`, pinned against it by
// `test_obsidian_provider.py::test_the_client_attachment_extensions_are_the_servers`.
const ATTACHMENT_EXTS = new Set((
  'png jpg jpeg gif webp bmp svg heic heif tif tiff avif ' +
  'pdf doc docx xls xlsx ppt pptx odt ods odp rtf csv tsv txt json xml ' +
  'zip 7z rar gz tar ' +
  'mp3 m4a wav ogg flac aac opus ' +
  'mp4 mov m4v webm mkv avi ' +
  'canvas epub'
).split(' '))

function isAttachmentName(path) {
  const name = basename(path)
  const idx = name.lastIndexOf('.')
  return idx > 0 && ATTACHMENT_EXTS.has(name.slice(idx + 1).toLowerCase())
}

/**
 * The name an UNRESOLVED target stands for, for the fallbacks that ask "is
 * this a file?": the FULL text when it holds a `#` and its own extension is an
 * attachment's (`my chart #1 (v2).png` is a file NAME), else the target with its
 * anchor split off. Mirrors `providers/obsidian.py::_unresolved_bare_target`.
 */
function unresolvedBareTarget(target) {
  const whole = target.trim()
  if (whole.includes('#') && isAttachmentName(whole)) return whole
  return stripFragment(whole)
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

// An unresolved wikilink/embed reads as its plain text, and must STAY plain
// text: markdown-it's linkify would turn `Ghost.Name` (`.name` is a real TLD)
// into a link to `http://Ghost.Name`, a wrong link where the member wrote a
// note name (D1 fix round 2). An entity-encoded dot is a separate token that
// linkify never sees; it renders as `.`. Always HELD (`holdMarkup`), so no
// later pass escapes the entity into visible text.
function unresolvedText(s) {
  return escapeHtml(s).replace(/\./g, '&#46;')
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, '&quot;')
}
